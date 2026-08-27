export type Segment = {
  kind: "same" | "removed" | "added";
  text: string;
};

export type DiffLine = {
  number: number;
  text: string;
};

export type DiffRow = {
  kind: "same" | "changed";
  left: DiffLine | null;
  right: DiffLine | null;
};

export type LineOperation =
  | {
      kind: "same";
      leftText: string;
      rightText: string;
      leftNumber: number;
      rightNumber: number;
    }
  | { kind: "removed"; text: string; number: number }
  | { kind: "added"; text: string; number: number };

const EXACT_LINE_DIFF_CELL_LIMIT = 300_000;
const EXACT_INLINE_DIFF_CELL_LIMIT = 120_000;
const CHANGED_ROW_ALIGNMENT_CELL_LIMIT = 300_000;
const MAX_LINE_EDIT_DISTANCE = 256;
const MAX_INLINE_EDIT_DISTANCE = 2_048;
const CHANGED_ROW_BAND_MARGIN = 96;
const MAX_BANDED_ALIGNMENT_CELLS = 5_000_000;
const GREEDY_ALIGNMENT_LOOKAHEAD = 32;

type RemovedOperation = Extract<LineOperation, { kind: "removed" }>;
type AddedOperation = Extract<LineOperation, { kind: "added" }>;

type SequenceEdit =
  | { kind: "same"; leftIndex: number; rightIndex: number }
  | { kind: "removed"; leftIndex: number }
  | { kind: "added"; rightIndex: number };

function frontierValue(
  frontier: Int32Array,
  offset: number,
  diagonal: number,
) {
  const index = offset + diagonal;
  return index >= 0 && index < frontier.length ? frontier[index] : -1;
}

function backtrackMyers(
  trace: Int32Array[],
  offset: number,
  leftLength: number,
  rightLength: number,
) {
  const reversed: SequenceEdit[] = [];
  let x = leftLength;
  let y = rightLength;

  for (let distance = trace.length - 1; distance >= 0; distance -= 1) {
    const frontier = trace[distance];
    const diagonal = x - y;
    const previousDiagonal =
      diagonal === -distance ||
      (diagonal !== distance &&
        frontierValue(frontier, offset, diagonal - 1) <
          frontierValue(frontier, offset, diagonal + 1))
        ? diagonal + 1
        : diagonal - 1;
    const previousX = frontierValue(frontier, offset, previousDiagonal);
    const previousY = previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      reversed.push({ kind: "same", leftIndex: x - 1, rightIndex: y - 1 });
      x -= 1;
      y -= 1;
    }

    if (distance === 0) break;

    if (x === previousX) {
      reversed.push({ kind: "added", rightIndex: y - 1 });
      y -= 1;
    } else {
      reversed.push({ kind: "removed", leftIndex: x - 1 });
      x -= 1;
    }
  }

  return reversed.reverse();
}

function boundedMyersDiff(
  left: string[],
  right: string[],
  maximumDistance = MAX_LINE_EDIT_DISTANCE,
) {
  const maximum = left.length + right.length;
  const limit = Math.min(maximum, maximumDistance);
  const offset = limit + 1;
  const frontier = new Int32Array(2 * limit + 3);
  frontier.fill(-1);
  frontier[offset + 1] = 0;
  const trace: Int32Array[] = [];

  for (let distance = 0; distance <= limit; distance += 1) {
    trace.push(frontier.slice());

    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      let x =
        diagonal === -distance ||
        (diagonal !== distance &&
          frontierValue(frontier, offset, diagonal - 1) <
            frontierValue(frontier, offset, diagonal + 1))
          ? frontierValue(frontier, offset, diagonal + 1)
          : frontierValue(frontier, offset, diagonal - 1) + 1;
      let y = x - diagonal;

      while (x < left.length && y < right.length && left[x] === right[y]) {
        x += 1;
        y += 1;
      }

      frontier[offset + diagonal] = x;

      if (x >= left.length && y >= right.length) {
        return backtrackMyers(trace, offset, left.length, right.length);
      }
    }
  }

  return null;
}

function hasCommonValue(left: string[], right: string[]) {
  const [smaller, larger] =
    left.length <= right.length ? [left, right] : [right, left];
  const values = new Set(smaller);
  return larger.some((value) => values.has(value));
}

export function splitLines(text: string) {
  if (!text) return [];
  return text.replace(/\r\n?/g, "\n").split("\n");
}

export function normalizeLine(line: string, ignoreWhitespace: boolean) {
  const normalized = line.normalize("NFC");
  return ignoreWhitespace ? normalized.replace(/\s+/g, " ").trim() : normalized;
}

function sameOperation(
  left: string[],
  right: string[],
  leftIndex: number,
  rightIndex: number,
): LineOperation {
  return {
    kind: "same",
    leftText: left[leftIndex],
    rightText: right[rightIndex],
    leftNumber: leftIndex + 1,
    rightNumber: rightIndex + 1,
  };
}

function exactLineDiffRange(
  left: string[],
  right: string[],
  leftNormalized: string[],
  rightNormalized: string[],
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
) {
  const leftLength = leftEnd - leftStart;
  const rightLength = rightEnd - rightStart;
  const table = Array.from(
    { length: leftLength + 1 },
    () => new Uint32Array(rightLength + 1),
  );
  const driftTable = Array.from(
    { length: leftLength + 1 },
    () => new Float64Array(rightLength + 1),
  );
  const actions = Array.from(
    { length: leftLength },
    () => new Uint8Array(rightLength),
  );
  const epsilon = 1e-12;

  for (let i = leftLength - 1; i >= 0; i -= 1) {
    for (let j = rightLength - 1; j >= 0; j -= 1) {
      let bestLength = 0;
      let bestDrift = Number.POSITIVE_INFINITY;
      let bestAction = 1;

      if (leftNormalized[leftStart + i] === rightNormalized[rightStart + j]) {
        bestLength = table[i + 1][j + 1] + 1;
        bestDrift =
          driftTable[i + 1][j + 1] +
          Math.abs(
            (i + 0.5) / leftLength - (j + 0.5) / rightLength,
          );
        bestAction = 0;
      }

      const removedLength = table[i + 1][j];
      const removedDrift = driftTable[i + 1][j];
      if (
        removedLength > bestLength ||
        (removedLength === bestLength &&
          removedDrift < bestDrift - epsilon)
      ) {
        bestLength = removedLength;
        bestDrift = removedDrift;
        bestAction = 1;
      }

      const addedLength = table[i][j + 1];
      const addedDrift = driftTable[i][j + 1];
      if (
        addedLength > bestLength ||
        (addedLength === bestLength && addedDrift < bestDrift - epsilon)
      ) {
        bestLength = addedLength;
        bestDrift = addedDrift;
        bestAction = 2;
      }

      table[i][j] = bestLength;
      driftTable[i][j] = Number.isFinite(bestDrift) ? bestDrift : 0;
      actions[i][j] = bestAction;
    }
  }

  const operations: LineOperation[] = [];
  let i = 0;
  let j = 0;

  while (i < leftLength && j < rightLength) {
    const leftIndex = leftStart + i;
    const rightIndex = rightStart + j;

    if (actions[i][j] === 0) {
      operations.push(sameOperation(left, right, leftIndex, rightIndex));
      i += 1;
      j += 1;
    } else if (actions[i][j] === 1) {
      operations.push({ kind: "removed", text: left[leftIndex], number: leftIndex + 1 });
      i += 1;
    } else {
      operations.push({ kind: "added", text: right[rightIndex], number: rightIndex + 1 });
      j += 1;
    }
  }

  while (i < leftLength) {
    const leftIndex = leftStart + i;
    operations.push({ kind: "removed", text: left[leftIndex], number: leftIndex + 1 });
    i += 1;
  }

  while (j < rightLength) {
    const rightIndex = rightStart + j;
    operations.push({ kind: "added", text: right[rightIndex], number: rightIndex + 1 });
    j += 1;
  }

  return operations;
}

type Anchor = { leftIndex: number; rightIndex: number };

function findUniqueAnchors(
  leftNormalized: string[],
  rightNormalized: string[],
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
) {
  const leftOccurrences = new Map<string, { count: number; index: number }>();
  const rightOccurrences = new Map<string, { count: number; index: number }>();

  for (let index = leftStart; index < leftEnd; index += 1) {
    const key = leftNormalized[index];
    const occurrence = leftOccurrences.get(key);
    if (occurrence) occurrence.count += 1;
    else leftOccurrences.set(key, { count: 1, index });
  }

  for (let index = rightStart; index < rightEnd; index += 1) {
    const key = rightNormalized[index];
    const occurrence = rightOccurrences.get(key);
    if (occurrence) occurrence.count += 1;
    else rightOccurrences.set(key, { count: 1, index });
  }

  const candidates: Anchor[] = [];
  for (let index = leftStart; index < leftEnd; index += 1) {
    const key = leftNormalized[index];
    const leftOccurrence = leftOccurrences.get(key);
    const rightOccurrence = rightOccurrences.get(key);
    if (leftOccurrence?.count === 1 && rightOccurrence?.count === 1) {
      candidates.push({ leftIndex: index, rightIndex: rightOccurrence.index });
    }
  }

  if (!candidates.length) return [];

  const tailValues: number[] = [];
  const tailIndexes: number[] = [];
  const previous = new Int32Array(candidates.length);
  previous.fill(-1);

  for (let index = 0; index < candidates.length; index += 1) {
    const value = candidates[index].rightIndex;
    let low = 0;
    let high = tailValues.length;

    while (low < high) {
      const middle = (low + high) >> 1;
      if (tailValues[middle] < value) low = middle + 1;
      else high = middle;
    }

    if (low > 0) previous[index] = tailIndexes[low - 1];
    tailValues[low] = value;
    tailIndexes[low] = index;
  }

  const anchors: Anchor[] = [];
  let candidateIndex = tailIndexes[tailValues.length - 1];
  while (candidateIndex !== undefined && candidateIndex >= 0) {
    anchors.push(candidates[candidateIndex]);
    candidateIndex = previous[candidateIndex];
  }

  return anchors.reverse();
}

function diffLineRange(
  operations: LineOperation[],
  left: string[],
  right: string[],
  leftNormalized: string[],
  rightNormalized: string[],
  initialLeftStart: number,
  initialLeftEnd: number,
  initialRightStart: number,
  initialRightEnd: number,
) {
  let leftStart = initialLeftStart;
  let leftEnd = initialLeftEnd;
  let rightStart = initialRightStart;
  let rightEnd = initialRightEnd;

  while (
    leftStart < leftEnd &&
    rightStart < rightEnd &&
    leftNormalized[leftStart] === rightNormalized[rightStart]
  ) {
    operations.push(sameOperation(left, right, leftStart, rightStart));
    leftStart += 1;
    rightStart += 1;
  }

  let suffixLength = 0;
  while (
    leftStart < leftEnd &&
    rightStart < rightEnd &&
    leftNormalized[leftEnd - 1] === rightNormalized[rightEnd - 1]
  ) {
    leftEnd -= 1;
    rightEnd -= 1;
    suffixLength += 1;
  }

  const leftLength = leftEnd - leftStart;
  const rightLength = rightEnd - rightStart;

  if (!leftLength) {
    for (let index = rightStart; index < rightEnd; index += 1) {
      operations.push({ kind: "added", text: right[index], number: index + 1 });
    }
  } else if (!rightLength) {
    for (let index = leftStart; index < leftEnd; index += 1) {
      operations.push({ kind: "removed", text: left[index], number: index + 1 });
    }
  } else if (leftLength * rightLength <= EXACT_LINE_DIFF_CELL_LIMIT) {
    operations.push(
      ...exactLineDiffRange(
        left,
        right,
        leftNormalized,
        rightNormalized,
        leftStart,
        leftEnd,
        rightStart,
        rightEnd,
      ),
    );
  } else {
    const anchors = findUniqueAnchors(
      leftNormalized,
      rightNormalized,
      leftStart,
      leftEnd,
      rightStart,
      rightEnd,
    );

    if (anchors.length) {
      let leftCursor = leftStart;
      let rightCursor = rightStart;

      for (const anchor of anchors) {
        diffLineRange(
          operations,
          left,
          right,
          leftNormalized,
          rightNormalized,
          leftCursor,
          anchor.leftIndex,
          rightCursor,
          anchor.rightIndex,
        );
        operations.push(
          sameOperation(left, right, anchor.leftIndex, anchor.rightIndex),
        );
        leftCursor = anchor.leftIndex + 1;
        rightCursor = anchor.rightIndex + 1;
      }

      diffLineRange(
        operations,
        left,
        right,
        leftNormalized,
        rightNormalized,
        leftCursor,
        leftEnd,
        rightCursor,
        rightEnd,
      );
    } else {
      const leftKeys = leftNormalized.slice(leftStart, leftEnd);
      const rightKeys = rightNormalized.slice(rightStart, rightEnd);
      const edits = hasCommonValue(leftKeys, rightKeys)
        ? boundedMyersDiff(leftKeys, rightKeys)
        : null;

      if (edits) {
        for (const edit of edits) {
          if (edit.kind === "same") {
            operations.push(
              sameOperation(
                left,
                right,
                leftStart + edit.leftIndex,
                rightStart + edit.rightIndex,
              ),
            );
          } else if (edit.kind === "removed") {
            const index = leftStart + edit.leftIndex;
            operations.push({ kind: "removed", text: left[index], number: index + 1 });
          } else {
            const index = rightStart + edit.rightIndex;
            operations.push({ kind: "added", text: right[index], number: index + 1 });
          }
        }
      } else {
        for (let index = leftStart; index < leftEnd; index += 1) {
          operations.push({ kind: "removed", text: left[index], number: index + 1 });
        }
        for (let index = rightStart; index < rightEnd; index += 1) {
          operations.push({ kind: "added", text: right[index], number: index + 1 });
        }
      }
    }
  }

  for (let offset = 0; offset < suffixLength; offset += 1) {
    operations.push(sameOperation(left, right, leftEnd + offset, rightEnd + offset));
  }
}

export function buildLineOperations(
  leftText: string,
  rightText: string,
  ignoreWhitespace: boolean,
) {
  const left = splitLines(leftText);
  const right = splitLines(rightText);
  const leftNormalized = left.map((line) => normalizeLine(line, ignoreWhitespace));
  const rightNormalized = right.map((line) => normalizeLine(line, ignoreWhitespace));
  const operations: LineOperation[] = [];

  diffLineRange(
    operations,
    left,
    right,
    leftNormalized,
    rightNormalized,
    0,
    left.length,
    0,
    right.length,
  );

  return operations;
}

type LineFingerprint = {
  normalized: string;
  graphemes: string[];
  bigrams: Set<string>;
};

function createLineFingerprint(text: string): LineFingerprint {
  const normalized = text
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
  const graphemes = splitGraphemes(normalized);
  const bigrams = new Set<string>();

  if (graphemes.length === 1) {
    bigrams.add(graphemes[0]);
  } else {
    for (let index = 0; index < graphemes.length - 1; index += 1) {
      bigrams.add(
        `${graphemes[index].length}:${graphemes[index]}${graphemes[index + 1]}`,
      );
    }
  }

  return { normalized, graphemes, bigrams };
}

function lineAffinity(left: LineFingerprint, right: LineFingerprint) {
  if (left.normalized === right.normalized) return 1;
  if (!left.graphemes.length || !right.graphemes.length) return 0;

  const [smallerBigrams, largerBigrams] =
    left.bigrams.size <= right.bigrams.size
      ? [left.bigrams, right.bigrams]
      : [right.bigrams, left.bigrams];
  let sharedBigrams = 0;
  for (const bigram of smallerBigrams) {
    if (largerBigrams.has(bigram)) sharedBigrams += 1;
  }

  const bigramScore =
    left.bigrams.size + right.bigrams.size > 0
      ? (2 * sharedBigrams) / (left.bigrams.size + right.bigrams.size)
      : 0;
  const maximumLength = Math.max(
    left.graphemes.length,
    right.graphemes.length,
  );
  const lengthScore =
    Math.min(left.graphemes.length, right.graphemes.length) / maximumLength;

  let prefixLength = 0;
  while (
    prefixLength < left.graphemes.length &&
    prefixLength < right.graphemes.length &&
    left.graphemes[prefixLength] === right.graphemes[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < left.graphemes.length - prefixLength &&
    suffixLength < right.graphemes.length - prefixLength &&
    left.graphemes[left.graphemes.length - 1 - suffixLength] ===
      right.graphemes[right.graphemes.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const edgeScore = (prefixLength + suffixLength) / maximumLength;
  return 0.7 * bigramScore + 0.2 * lengthScore + 0.1 * edgeScore;
}

function linePairCost(left: LineFingerprint, right: LineFingerprint) {
  const affinity = lineAffinity(left, right);
  const squaredAffinity = affinity * affinity;
  return 2 - 1.8 * squaredAffinity * squaredAffinity;
}

function changedRow(
  leftLine: RemovedOperation | undefined,
  rightLine: AddedOperation | undefined,
): DiffRow {
  return {
    kind: "changed",
    left: leftLine ? { number: leftLine.number, text: leftLine.text } : null,
    right: rightLine ? { number: rightLine.number, text: rightLine.text } : null,
  };
}

function finishChangedRows(
  rows: DiffRow[],
  removed: RemovedOperation[],
  added: AddedOperation[],
  initialLeftIndex: number,
  initialRightIndex: number,
) {
  let leftIndex = initialLeftIndex;
  let rightIndex = initialRightIndex;

  while (leftIndex < removed.length) {
    rows.push(changedRow(removed[leftIndex], undefined));
    leftIndex += 1;
  }
  while (rightIndex < added.length) {
    rows.push(changedRow(undefined, added[rightIndex]));
    rightIndex += 1;
  }

  return rows;
}

function alignChangedRowsBanded(
  removed: RemovedOperation[],
  added: AddedOperation[],
  leftFingerprints: LineFingerprint[],
  rightFingerprints: LineFingerprint[],
) {
  const leftLength = removed.length;
  const rightLength = added.length;
  const finalDiagonal = rightLength - leftLength;
  const minimumDiagonal =
    Math.min(0, finalDiagonal) - CHANGED_ROW_BAND_MARGIN;
  const maximumDiagonal =
    Math.max(0, finalDiagonal) + CHANGED_ROW_BAND_MARGIN;
  const maximumBandWidth = maximumDiagonal - minimumDiagonal + 1;

  if (
    (leftLength + 1) * maximumBandWidth >
    MAX_BANDED_ALIGNMENT_CELLS
  ) {
    return null;
  }

  const rowStarts = new Int32Array(leftLength + 1);
  const actionRows: Uint8Array[] = new Array(leftLength + 1);
  let previousStart = 0;
  let previousCosts = new Float64Array(0);
  const infinity = Number.POSITIVE_INFINITY;
  const epsilon = 1e-9;

  for (let leftIndex = 0; leftIndex <= leftLength; leftIndex += 1) {
    const start = Math.max(0, leftIndex + minimumDiagonal);
    const end = Math.min(rightLength, leftIndex + maximumDiagonal);
    const costs = new Float64Array(end - start + 1);
    costs.fill(infinity);
    const actions = new Uint8Array(costs.length);
    rowStarts[leftIndex] = start;
    actionRows[leftIndex] = actions;

    const previousCostAt = (rightIndex: number) => {
      const offset = rightIndex - previousStart;
      return offset >= 0 && offset < previousCosts.length
        ? previousCosts[offset]
        : infinity;
    };

    for (let rightIndex = start; rightIndex <= end; rightIndex += 1) {
      const offset = rightIndex - start;

      if (leftIndex === 0 && rightIndex === 0) {
        costs[offset] = 0;
        continue;
      }

      let bestCost = infinity;
      let bestAction = 0;

      if (leftIndex > 0 && rightIndex > 0) {
        const previousCost = previousCostAt(rightIndex - 1);
        if (Number.isFinite(previousCost)) {
          bestCost =
            previousCost +
            linePairCost(
              leftFingerprints[leftIndex - 1],
              rightFingerprints[rightIndex - 1],
            );
          bestAction = 1;
        }
      }

      if (leftIndex > 0) {
        const removeCost = previousCostAt(rightIndex) + 1;
        if (removeCost < bestCost - epsilon) {
          bestCost = removeCost;
          bestAction = 2;
        }
      }

      if (rightIndex > start) {
        const addCost = costs[offset - 1] + 1;
        if (addCost < bestCost - epsilon) {
          bestCost = addCost;
          bestAction = 3;
        }
      }

      costs[offset] = bestCost;
      actions[offset] = bestAction;
    }

    previousStart = start;
    previousCosts = costs;
  }

  const finalOffset = rightLength - rowStarts[leftLength];
  if (
    finalOffset < 0 ||
    finalOffset >= previousCosts.length ||
    !Number.isFinite(previousCosts[finalOffset])
  ) {
    return null;
  }

  const reversed: DiffRow[] = [];
  let leftIndex = leftLength;
  let rightIndex = rightLength;

  while (leftIndex > 0 || rightIndex > 0) {
    const action =
      actionRows[leftIndex][rightIndex - rowStarts[leftIndex]];

    if (action === 1) {
      reversed.push(changedRow(removed[leftIndex - 1], added[rightIndex - 1]));
      leftIndex -= 1;
      rightIndex -= 1;
    } else if (action === 2) {
      reversed.push(changedRow(removed[leftIndex - 1], undefined));
      leftIndex -= 1;
    } else if (action === 3) {
      reversed.push(changedRow(undefined, added[rightIndex - 1]));
      rightIndex -= 1;
    } else {
      return null;
    }
  }

  return reversed.reverse();
}

function alignChangedRowsGreedy(
  removed: RemovedOperation[],
  added: AddedOperation[],
  leftFingerprints: LineFingerprint[],
  rightFingerprints: LineFingerprint[],
) {
  const rows: DiffRow[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < removed.length && rightIndex < added.length) {
    const currentAffinity = lineAffinity(
      leftFingerprints[leftIndex],
      rightFingerprints[rightIndex],
    );
    const remainingDifference =
      added.length - rightIndex - (removed.length - leftIndex);
    let bestRightIndex = rightIndex;
    let bestRightAffinity = currentAffinity;
    let bestLeftIndex = leftIndex;
    let bestLeftAffinity = currentAffinity;
    const rightLookahead = Math.min(
      added.length - 1,
      rightIndex +
        GREEDY_ALIGNMENT_LOOKAHEAD +
        Math.max(0, remainingDifference),
    );
    const leftLookahead = Math.min(
      removed.length - 1,
      leftIndex +
        GREEDY_ALIGNMENT_LOOKAHEAD +
        Math.max(0, -remainingDifference),
    );

    for (
      let candidate = rightIndex + 1;
      candidate <= rightLookahead;
      candidate += 1
    ) {
      const affinity = lineAffinity(
        leftFingerprints[leftIndex],
        rightFingerprints[candidate],
      );
      if (affinity > bestRightAffinity) {
        bestRightAffinity = affinity;
        bestRightIndex = candidate;
      }
    }

    for (
      let candidate = leftIndex + 1;
      candidate <= leftLookahead;
      candidate += 1
    ) {
      const affinity = lineAffinity(
        leftFingerprints[candidate],
        rightFingerprints[rightIndex],
      );
      if (affinity > bestLeftAffinity) {
        bestLeftAffinity = affinity;
        bestLeftIndex = candidate;
      }
    }

    const rightImprovement = bestRightAffinity - currentAffinity;
    const leftImprovement = bestLeftAffinity - currentAffinity;

    if (
      bestRightIndex > rightIndex &&
      rightImprovement > 0.15 &&
      rightImprovement >= leftImprovement
    ) {
      while (rightIndex < bestRightIndex) {
        rows.push(changedRow(undefined, added[rightIndex]));
        rightIndex += 1;
      }
    } else if (bestLeftIndex > leftIndex && leftImprovement > 0.15) {
      while (leftIndex < bestLeftIndex) {
        rows.push(changedRow(removed[leftIndex], undefined));
        leftIndex += 1;
      }
    }

    rows.push(changedRow(removed[leftIndex], added[rightIndex]));
    leftIndex += 1;
    rightIndex += 1;
  }

  return finishChangedRows(rows, removed, added, leftIndex, rightIndex);
}

function alignChangedRows(
  removed: RemovedOperation[],
  added: AddedOperation[],
) {
  if (!removed.length || !added.length) {
    const count = Math.max(removed.length, added.length);
    return Array.from({ length: count }, (_, index) =>
      changedRow(removed[index], added[index]),
    );
  }

  const leftFingerprints = removed.map((line) =>
    createLineFingerprint(line.text),
  );
  const rightFingerprints = added.map((line) =>
    createLineFingerprint(line.text),
  );

  if (removed.length * added.length > CHANGED_ROW_ALIGNMENT_CELL_LIMIT) {
    return (
      alignChangedRowsBanded(
        removed,
        added,
        leftFingerprints,
        rightFingerprints,
      ) ??
      alignChangedRowsGreedy(
        removed,
        added,
        leftFingerprints,
        rightFingerprints,
      )
    );
  }

  const columnCount = added.length + 1;
  const costs = new Float64Array((removed.length + 1) * columnCount);
  const at = (leftIndex: number, rightIndex: number) =>
    leftIndex * columnCount + rightIndex;

  for (let leftIndex = removed.length - 1; leftIndex >= 0; leftIndex -= 1) {
    costs[at(leftIndex, added.length)] = removed.length - leftIndex;
  }
  for (let rightIndex = added.length - 1; rightIndex >= 0; rightIndex -= 1) {
    costs[at(removed.length, rightIndex)] = added.length - rightIndex;
  }

  for (let leftIndex = removed.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = added.length - 1; rightIndex >= 0; rightIndex -= 1) {
      const pairCost =
        linePairCost(
          leftFingerprints[leftIndex],
          rightFingerprints[rightIndex],
        ) +
        costs[at(leftIndex + 1, rightIndex + 1)];
      const removeCost = 1 + costs[at(leftIndex + 1, rightIndex)];
      const addCost = 1 + costs[at(leftIndex, rightIndex + 1)];
      costs[at(leftIndex, rightIndex)] = Math.min(
        pairCost,
        removeCost,
        addCost,
      );
    }
  }

  const rows: DiffRow[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  const epsilon = 1e-9;

  while (leftIndex < removed.length && rightIndex < added.length) {
    const pairCost =
      linePairCost(
        leftFingerprints[leftIndex],
        rightFingerprints[rightIndex],
      ) +
      costs[at(leftIndex + 1, rightIndex + 1)];
    const removeCost = 1 + costs[at(leftIndex + 1, rightIndex)];
    const addCost = 1 + costs[at(leftIndex, rightIndex + 1)];

    if (
      pairCost <= removeCost + epsilon &&
      pairCost <= addCost + epsilon
    ) {
      rows.push(changedRow(removed[leftIndex], added[rightIndex]));
      leftIndex += 1;
      rightIndex += 1;
    } else if (removeCost <= addCost + epsilon) {
      rows.push(changedRow(removed[leftIndex], undefined));
      leftIndex += 1;
    } else {
      rows.push(changedRow(undefined, added[rightIndex]));
      rightIndex += 1;
    }
  }

  return finishChangedRows(rows, removed, added, leftIndex, rightIndex);
}

export function buildRows(
  leftText: string,
  rightText: string,
  ignoreWhitespace: boolean,
) {
  const operations = buildLineOperations(leftText, rightText, ignoreWhitespace);
  const rows: DiffRow[] = [];
  let index = 0;

  while (index < operations.length) {
    const operation = operations[index];

    if (operation.kind === "same") {
      rows.push({
        kind: "same",
        left: { number: operation.leftNumber, text: operation.leftText },
        right: { number: operation.rightNumber, text: operation.rightText },
      });
      index += 1;
      continue;
    }

    const removed: RemovedOperation[] = [];
    const added: AddedOperation[] = [];

    while (index < operations.length && operations[index].kind !== "same") {
      const changed = operations[index];
      if (changed.kind === "removed") removed.push(changed);
      if (changed.kind === "added") added.push(changed);
      index += 1;
    }

    rows.push(...alignChangedRows(removed, added));
  }

  return rows;
}

const graphemeSegmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

export function splitGraphemes(text: string) {
  return graphemeSegmenter
    ? Array.from(graphemeSegmenter.segment(text), (part) => part.segment)
    : Array.from(text);
}

export function countText(text: string) {
  return {
    lines: splitLines(text).length,
    characters: splitGraphemes(text).length,
  };
}

function appendSegment(segments: Segment[], segment: Segment) {
  if (!segment.text) return;
  const previous = segments.at(-1);
  if (previous?.kind === segment.kind) previous.text += segment.text;
  else segments.push(segment);
}

function appendInlineEdits(
  edits: SequenceEdit[],
  left: string[],
  right: string[],
  leftSegments: Segment[],
  rightSegments: Segment[],
) {
  for (const edit of edits) {
    if (edit.kind === "same") {
      appendSegment(leftSegments, { kind: "same", text: left[edit.leftIndex] });
      appendSegment(rightSegments, { kind: "same", text: right[edit.rightIndex] });
    } else if (edit.kind === "removed") {
      appendSegment(leftSegments, { kind: "removed", text: left[edit.leftIndex] });
    } else {
      appendSegment(rightSegments, { kind: "added", text: right[edit.rightIndex] });
    }
  }
}

function appendPositionalInlineDiff(
  left: string[],
  right: string[],
  leftKeys: string[],
  rightKeys: string[],
  leftSegments: Segment[],
  rightSegments: Segment[],
) {
  for (let index = 0; index < left.length; index += 1) {
    if (leftKeys[index] === rightKeys[index]) {
      appendSegment(leftSegments, { kind: "same", text: left[index] });
      appendSegment(rightSegments, { kind: "same", text: right[index] });
    } else {
      appendSegment(leftSegments, { kind: "removed", text: left[index] });
      appendSegment(rightSegments, { kind: "added", text: right[index] });
    }
  }
}

export function inlineDiff(leftText: string, rightText: string) {
  const leftGraphemes = splitGraphemes(leftText);
  const rightGraphemes = splitGraphemes(rightText);
  const leftKeys = leftGraphemes.map((part) => part.normalize("NFC"));
  const rightKeys = rightGraphemes.map((part) => part.normalize("NFC"));
  let prefixLength = 0;

  while (
    prefixLength < leftGraphemes.length &&
    prefixLength < rightGraphemes.length &&
    leftKeys[prefixLength] === rightKeys[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < leftGraphemes.length - prefixLength &&
    suffixLength < rightGraphemes.length - prefixLength &&
    leftKeys[leftKeys.length - 1 - suffixLength] ===
      rightKeys[rightKeys.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const leftEnd = suffixLength ? leftGraphemes.length - suffixLength : leftGraphemes.length;
  const rightEnd = suffixLength
    ? rightGraphemes.length - suffixLength
    : rightGraphemes.length;
  const left = leftGraphemes.slice(prefixLength, leftEnd);
  const right = rightGraphemes.slice(prefixLength, rightEnd);
  const leftMiddleKeys = leftKeys.slice(prefixLength, leftEnd);
  const rightMiddleKeys = rightKeys.slice(prefixLength, rightEnd);
  const leftSegments: Segment[] = [];
  const rightSegments: Segment[] = [];

  appendSegment(leftSegments, {
    kind: "same",
    text: leftGraphemes.slice(0, prefixLength).join(""),
  });
  appendSegment(rightSegments, {
    kind: "same",
    text: rightGraphemes.slice(0, prefixLength).join(""),
  });

  if (!left.length || !right.length) {
    appendSegment(leftSegments, { kind: "removed", text: left.join("") });
    appendSegment(rightSegments, { kind: "added", text: right.join("") });
  } else if (left.length * right.length <= EXACT_INLINE_DIFF_CELL_LIMIT) {
    const table = Array.from(
      { length: left.length + 1 },
      () => new Uint32Array(right.length + 1),
    );

    for (let i = left.length - 1; i >= 0; i -= 1) {
      for (let j = right.length - 1; j >= 0; j -= 1) {
        table[i][j] =
          leftMiddleKeys[i] === rightMiddleKeys[j]
            ? table[i + 1][j + 1] + 1
            : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }

    let i = 0;
    let j = 0;

    while (i < left.length && j < right.length) {
      if (leftMiddleKeys[i] === rightMiddleKeys[j]) {
        appendSegment(leftSegments, { kind: "same", text: left[i] });
        appendSegment(rightSegments, { kind: "same", text: right[j] });
        i += 1;
        j += 1;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        appendSegment(leftSegments, { kind: "removed", text: left[i] });
        i += 1;
      } else {
        appendSegment(rightSegments, { kind: "added", text: right[j] });
        j += 1;
      }
    }

    while (i < left.length) {
      appendSegment(leftSegments, { kind: "removed", text: left[i] });
      i += 1;
    }
    while (j < right.length) {
      appendSegment(rightSegments, { kind: "added", text: right[j] });
      j += 1;
    }
  } else {
    const edits = hasCommonValue(leftMiddleKeys, rightMiddleKeys)
      ? boundedMyersDiff(
          leftMiddleKeys,
          rightMiddleKeys,
          MAX_INLINE_EDIT_DISTANCE,
        )
      : null;

    if (edits) {
      appendInlineEdits(edits, left, right, leftSegments, rightSegments);
    } else if (left.length === right.length) {
      appendPositionalInlineDiff(
        left,
        right,
        leftMiddleKeys,
        rightMiddleKeys,
        leftSegments,
        rightSegments,
      );
    } else {
      appendSegment(leftSegments, { kind: "removed", text: left.join("") });
      appendSegment(rightSegments, { kind: "added", text: right.join("") });
    }
  }

  appendSegment(leftSegments, {
    kind: "same",
    text: suffixLength ? leftGraphemes.slice(leftEnd).join("") : "",
  });
  appendSegment(rightSegments, {
    kind: "same",
    text: suffixLength ? rightGraphemes.slice(rightEnd).join("") : "",
  });

  return { left: leftSegments, right: rightSegments };
}
