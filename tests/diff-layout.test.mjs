import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
}

test("keeps no-wrap results in two fixed parallel panes", () => {
  const parallelRule = cssRule(".parallel-diff");
  const paneRule = cssRule(".diff-pane");
  const centerRule = cssRule(".diff-pane-group + .diff-pane-group");
  const contentRule = cssRule(".diff-pane-content");

  assert.match(parallelRule, /display:\s*grid/);
  assert.match(
    parallelRule,
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/,
  );
  assert.match(paneRule, /overflow-x:\s*auto/);
  assert.match(paneRule, /overflow-y:\s*hidden/);
  assert.match(centerRule, /border-left:/);
  assert.match(contentRule, /grid-template-columns:\s*minmax\(100%,\s*max-content\)/);
});

test("wires horizontal scrolling in both directions", () => {
  assert.match(page, /ref=\{leftDiffPane\}/);
  assert.match(page, /ref=\{rightDiffPane\}/);
  assert.match(
    page,
    /syncDiffScroll\(event\.currentTarget,\s*rightDiffPane\.current\)/,
  );
  assert.match(
    page,
    /syncDiffScroll\(event\.currentTarget,\s*leftDiffPane\.current\)/,
  );
  assert.match(page, /target\.scrollLeft\s*=\s*source\.scrollLeft/);
});

test("lets wrapped results expand with the page instead of adding vertical scrolling", () => {
  const scrollRule = cssRule(".diff-scroll");
  assert.match(scrollRule, /max-height:\s*none/);
  assert.match(scrollRule, /overflow:\s*visible/);
});

test("applies the same resized height to both editors", () => {
  const inlineHeight = /style=\{editorHeight \? \{ height: `\$\{editorHeight\}px` \} : undefined\}/g;
  assert.equal(page.match(inlineHeight)?.length, 2);
  assert.match(page, /observer\.observe\(left\)/);
  assert.match(page, /observer\.observe\(right\)/);
  assert.match(page, /preferredEditorHeight/);
  assert.match(page, /window\.addEventListener\("resize", handleViewportResize\)/);
});

test("labels the total as changed lines and reports clipboard failures", () => {
  assert.match(page, /\{changedRows\} 行差异/);
  assert.doesNotMatch(page, /\{changedRows\} 处变化/);
  assert.match(page, /toast\.error\("复制失败，请手动选择文本复制。"/);
});

test("wraps the controls cleanly on narrow screens", () => {
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /\.toolbar\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(css, /\.toolbar-options\s*\{[^}]*justify-content:\s*flex-end/s);
  assert.match(css, /\.diff-heading\s*\{[^}]*flex-wrap:\s*wrap/s);
});
