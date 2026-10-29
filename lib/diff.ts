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

export type WhitespaceMode = "none" | "amount" | "all";

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

export function normalizeLine(line: string, whitespace: WhitespaceMode) {
  const normalized = line.normalize("NFC");
  // "amount" matches `git diff -b`: runs of whitespace compare equal and
  // trailing whitespace is ignored. "all" matches `git diff -w`.
  if (whitespace === "amount") return normalized.replace(/\s+/g, " ").trimEnd();
  if (whitespace === "all") return normalized.replace(/\s+/g, "");
  return normalized;
}

// Spreading a large array into push() overflows the call stack.
function appendAll<T>(target: T[], items: T[]) {
  for (const item of items) target.push(item);
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
    appendAll(
      operations,
      exactLineDiffRange(
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
  whitespace: WhitespaceMode,
) {
  const left = splitLines(leftText);
  const right = splitLines(rightText);
  const leftNormalized = left.map((line) => normalizeLine(line, whitespace));
  const rightNormalized = right.map((line) => normalizeLine(line, whitespace));
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
  whitespace: WhitespaceMode,
) {
  const operations = buildLineOperations(leftText, rightText, whitespace);
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

    appendAll(rows, alignChangedRows(removed, added));
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
    characters: countGraphemes(text),
  };
}

function countGraphemes(text: string) {
  // In ASCII text only CR LF forms a multi-character grapheme, so skip the
  // much slower segmenter for it.
  if (/^[\x00-\x7f]*$/.test(text)) {
    return text.length - (text.match(/\r\n/g)?.length ?? 0);
  }
  return splitGraphemes(text).length;
}

function appendSegment(segments: Segment[], segment: Segment) {
  if (!segment.text) return;
  const previous = segments.at(-1);
  if (previous?.kind === segment.kind) previous.text += segment.text;
  else segments.push(segment);
}

function diffSequence(
  left: string[],
  right: string[],
  maximumDistance = MAX_INLINE_EDIT_DISTANCE,
) {
  const edits: SequenceEdit[] = [];
  let prefixLength = 0;

  while (
    prefixLength < left.length &&
    prefixLength < right.length &&
    left[prefixLength] === right[prefixLength]
  ) {
    edits.push({ kind: "same", leftIndex: prefixLength, rightIndex: prefixLength });
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < left.length - prefixLength &&
    suffixLength < right.length - prefixLength &&
    left[left.length - 1 - suffixLength] === right[right.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const leftEnd = left.length - suffixLength;
  const rightEnd = right.length - suffixLength;
  const leftLength = leftEnd - prefixLength;
  const rightLength = rightEnd - prefixLength;

  if (!leftLength || !rightLength) {
    for (let index = prefixLength; index < leftEnd; index += 1) {
      edits.push({ kind: "removed", leftIndex: index });
    }
    for (let index = prefixLength; index < rightEnd; index += 1) {
      edits.push({ kind: "added", rightIndex: index });
    }
  } else if (leftLength * rightLength <= EXACT_INLINE_DIFF_CELL_LIMIT) {
    const table = Array.from(
      { length: leftLength + 1 },
      () => new Uint32Array(rightLength + 1),
    );

    for (let i = leftLength - 1; i >= 0; i -= 1) {
      for (let j = rightLength - 1; j >= 0; j -= 1) {
        table[i][j] =
          left[prefixLength + i] === right[prefixLength + j]
            ? table[i + 1][j + 1] + 1
            : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }

    let i = 0;
    let j = 0;

    while (i < leftLength && j < rightLength) {
      if (left[prefixLength + i] === right[prefixLength + j]) {
        edits.push({
          kind: "same",
          leftIndex: prefixLength + i,
          rightIndex: prefixLength + j,
        });
        i += 1;
        j += 1;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        edits.push({ kind: "removed", leftIndex: prefixLength + i });
        i += 1;
      } else {
        edits.push({ kind: "added", rightIndex: prefixLength + j });
        j += 1;
      }
    }

    for (; i < leftLength; i += 1) {
      edits.push({ kind: "removed", leftIndex: prefixLength + i });
    }
    for (; j < rightLength; j += 1) {
      edits.push({ kind: "added", rightIndex: prefixLength + j });
    }
  } else {
    const leftMiddle = left.slice(prefixLength, leftEnd);
    const rightMiddle = right.slice(prefixLength, rightEnd);
    const middleEdits = hasCommonValue(leftMiddle, rightMiddle)
      ? boundedMyersDiff(leftMiddle, rightMiddle, maximumDistance)
      : null;

    if (middleEdits) {
      for (const edit of middleEdits) {
        if (edit.kind === "same") {
          edits.push({
            kind: "same",
            leftIndex: prefixLength + edit.leftIndex,
            rightIndex: prefixLength + edit.rightIndex,
          });
        } else if (edit.kind === "removed") {
          edits.push({ kind: "removed", leftIndex: prefixLength + edit.leftIndex });
        } else {
          edits.push({ kind: "added", rightIndex: prefixLength + edit.rightIndex });
        }
      }
    } else if (leftLength === rightLength) {
      for (let index = prefixLength; index < leftEnd; index += 1) {
        if (left[index] === right[index]) {
          edits.push({ kind: "same", leftIndex: index, rightIndex: index });
        } else {
          edits.push({ kind: "removed", leftIndex: index });
          edits.push({ kind: "added", rightIndex: index });
        }
      }
    } else {
      for (let index = prefixLength; index < leftEnd; index += 1) {
        edits.push({ kind: "removed", leftIndex: index });
      }
      for (let index = prefixLength; index < rightEnd; index += 1) {
        edits.push({ kind: "added", rightIndex: index });
      }
    }
  }

  for (let offset = suffixLength; offset > 0; offset -= 1) {
    edits.push({
      kind: "same",
      leftIndex: left.length - offset,
      rightIndex: right.length - offset,
    });
  }

  return edits;
}

export type InlineSegments = { left: Segment[]; right: Segment[] };

/** Character-level diff of two strings, using graphemes as the unit. */
export function graphemeDiff(leftText: string, rightText: string): InlineSegments {
  const leftGraphemes = splitGraphemes(leftText);
  const rightGraphemes = splitGraphemes(rightText);
  const edits = diffSequence(
    leftGraphemes.map((part) => part.normalize("NFC")),
    rightGraphemes.map((part) => part.normalize("NFC")),
  );
  const left: Segment[] = [];
  const right: Segment[] = [];

  for (const edit of edits) {
    if (edit.kind === "same") {
      appendSegment(left, { kind: "same", text: leftGraphemes[edit.leftIndex] });
      appendSegment(right, { kind: "same", text: rightGraphemes[edit.rightIndex] });
    } else if (edit.kind === "removed") {
      appendSegment(left, { kind: "removed", text: leftGraphemes[edit.leftIndex] });
    } else {
      appendSegment(right, { kind: "added", text: rightGraphemes[edit.rightIndex] });
    }
  }

  return { left, right };
}

export type Token = { kind: "space" | "word" | "other"; text: string };

const WHITESPACE_PATTERN = /^\s+$/u;
const WORD_PATTERN = /^[\p{L}\p{M}\p{N}_]+$/u;
// Scripts written without spaces between words compare one character at a time.
const UNSPACED_SCRIPT_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}]/u;

/**
 * Splits a line into words, whitespace runs, and single characters. Chinese
 * and Japanese characters and punctuation each become their own token.
 */
export function splitTokens(text: string) {
  const tokens: Token[] = [];

  for (const grapheme of splitGraphemes(text)) {
    const kind = WHITESPACE_PATTERN.test(grapheme)
      ? "space"
      : !UNSPACED_SCRIPT_PATTERN.test(grapheme) && WORD_PATTERN.test(grapheme)
        ? "word"
        : "other";
    const previous = tokens.at(-1);
    if (kind !== "other" && previous?.kind === kind) previous.text += grapheme;
    else tokens.push({ kind, text: grapheme });
  }

  return tokens;
}

// A replaced word is refined to characters only when most of it survives,
// such as "difference" → "differences", so unrelated words stay whole.
function sharesMostOfWord(leftText: string, rightText: string) {
  const left = splitGraphemes(leftText.normalize("NFC"));
  const right = splitGraphemes(rightText.normalize("NFC"));
  let prefixLength = 0;
  while (
    prefixLength < left.length &&
    prefixLength < right.length &&
    left[prefixLength] === right[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < left.length - prefixLength &&
    suffixLength < right.length - prefixLength &&
    left[left.length - 1 - suffixLength] === right[right.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return (prefixLength + suffixLength) * 2 >= Math.max(left.length, right.length);
}

/**
 * Highlights changes within a pair of lines word by word. Chinese and
 * Japanese text is compared character by character.
 */
export function inlineDiff(
  leftText: string,
  rightText: string,
  whitespace: WhitespaceMode = "none",
): InlineSegments {
  const leftTokens = splitTokens(leftText);
  const rightTokens = splitTokens(rightText);
  const tokenKey = (token: Token) =>
    token.kind === "space" && whitespace !== "none" ? " " : token.text.normalize("NFC");
  const edits = diffSequence(leftTokens.map(tokenKey), rightTokens.map(tokenKey));
  const left: Segment[] = [];
  const right: Segment[] = [];
  let removed: Token[] = [];
  let added: Token[] = [];

  const flushChange = () => {
    if (
      removed.length === 1 &&
      added.length === 1 &&
      removed[0].kind === "word" &&
      added[0].kind === "word" &&
      sharesMostOfWord(removed[0].text, added[0].text)
    ) {
      const refined = graphemeDiff(removed[0].text, added[0].text);
      for (const segment of refined.left) appendSegment(left, segment);
      for (const segment of refined.right) appendSegment(right, segment);
    } else {
      appendSegment(left, {
        kind: "removed",
        text: removed.map((token) => token.text).join(""),
      });
      appendSegment(right, {
        kind: "added",
        text: added.map((token) => token.text).join(""),
      });
    }
    removed = [];
    added = [];
  };

  for (const edit of edits) {
    if (edit.kind === "same") {
      flushChange();
      appendSegment(left, { kind: "same", text: leftTokens[edit.leftIndex].text });
      appendSegment(right, { kind: "same", text: rightTokens[edit.rightIndex].text });
    } else if (edit.kind === "removed") {
      removed.push(leftTokens[edit.leftIndex]);
    } else {
      added.push(rightTokens[edit.rightIndex]);
    }
  }
  flushChange();

  return { left, right };
}

export type TextCount = { lines: number; characters: number };

export type DetailedRow = DiffRow & { segments: InlineSegments | null };

export type DiffResult = {
  rows: DetailedRow[];
  removedLines: number;
  addedLines: number;
  changedRows: number;
  leftCount: TextCount;
  rightCount: TextCount;
};

/** Everything the result view needs, in one call that can run in a worker. */
export function computeDiff(
  leftText: string,
  rightText: string,
  whitespace: WhitespaceMode,
): DiffResult {
  let removedLines = 0;
  let addedLines = 0;
  let changedRows = 0;
  const rows = buildRows(leftText, rightText, whitespace).map(
    (row): DetailedRow => {
      if (row.kind === "changed") {
        changedRows += 1;
        if (row.left) removedLines += 1;
        if (row.right) addedLines += 1;
      }

      return {
        ...row,
        segments:
          row.kind === "changed" && row.left && row.right
            ? inlineDiff(row.left.text, row.right.text, whitespace)
            : null,
      };
    },
  );

  return {
    rows,
    removedLines,
    addedLines,
    changedRows,
    leftCount: countText(leftText),
    rightCount: countText(rightText),
  };
}
