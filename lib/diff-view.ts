import type { DiffRow } from "@/lib/diff";

/** Unchanged lines kept visible on each side of a change when folding. */
export const FOLD_CONTEXT_LINES = 3;
/** Results with more rows than this fold unchanged lines by default. */
export const AUTO_FOLD_ROW_THRESHOLD = 100;
const MIN_FOLDED_LINES = 4;

export type DisplayItem =
  | { type: "row"; index: number }
  | { type: "fold"; key: string; start: number; end: number };

function foldKey(row: DiffRow) {
  return `${row.left?.number ?? 0}:${row.right?.number ?? 0}`;
}

/**
 * Lists the rows to show, replacing long runs of unchanged rows with fold
 * markers that keep a few lines of context around each change.
 */
export function buildDisplayItems(
  rows: DiffRow[],
  fold: boolean,
  expandedFolds: ReadonlySet<string>,
  context = FOLD_CONTEXT_LINES,
) {
  const items: DisplayItem[] = [];
  const pushRows = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) {
      items.push({ type: "row", index });
    }
  };
  let index = 0;

  while (index < rows.length) {
    if (!fold || rows[index].kind !== "same") {
      items.push({ type: "row", index });
      index += 1;
      continue;
    }

    let end = index;
    while (end < rows.length && rows[end].kind === "same") end += 1;

    const hiddenStart = index === 0 ? 0 : index + context;
    const hiddenEnd = end === rows.length ? end : end - context;
    const key =
      hiddenStart < rows.length ? foldKey(rows[hiddenStart]) : "";

    if (hiddenEnd - hiddenStart >= MIN_FOLDED_LINES && !expandedFolds.has(key)) {
      pushRows(index, hiddenStart);
      items.push({ type: "fold", key, start: hiddenStart, end: hiddenEnd });
      pushRows(hiddenEnd, end);
    } else {
      pushRows(index, end);
    }

    index = end;
  }

  return items;
}
