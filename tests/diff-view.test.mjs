import assert from "node:assert/strict";
import test from "node:test";

const { buildRows } = await import("../lib/diff.ts");
const { buildDisplayItems } = await import("../lib/diff-view.ts");

const lines = (count, change) =>
  Array.from({ length: count }, (_, index) =>
    index === change ? `changed ${index}` : `line ${index}`,
  ).join("\n");

function describe(items) {
  return items.map((item) =>
    item.type === "row" ? item.index : `fold ${item.start}-${item.end}`,
  );
}

test("folds unchanged runs but keeps context around each change", () => {
  const rows = buildRows(lines(30, -1), lines(30, 15), "none");
  const items = buildDisplayItems(rows, true, new Set());

  assert.deepEqual(describe(items), [
    "fold 0-12",
    12, 13, 14, 15, 16, 17, 18,
    "fold 19-30",
  ]);
});

test("shows every row when folding is off or the fold is expanded", () => {
  const rows = buildRows(lines(30, -1), lines(30, 15), "none");
  assert.equal(buildDisplayItems(rows, false, new Set()).length, 30);

  const folded = buildDisplayItems(rows, true, new Set());
  const first = folded.find((item) => item.type === "fold");
  const expanded = buildDisplayItems(rows, true, new Set([first.key]));
  assert.deepEqual(describe(expanded).slice(0, 13), [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  ]);
  assert.equal(expanded.filter((item) => item.type === "fold").length, 1);
});

test("does not fold runs that are barely longer than the context", () => {
  const rows = buildRows(lines(10, -1), lines(10, 0).replace("line 9", "x"), "none");
  const items = buildDisplayItems(rows, true, new Set());
  assert.equal(items.every((item) => item.type === "row"), true);
});
