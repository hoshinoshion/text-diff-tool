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
  assert.match(page, /ref=\{side === "left" \? leftDiffPane : rightDiffPane\}/);
  assert.match(
    page,
    /side === "left" \? rightDiffPane\.current : leftDiffPane\.current/,
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
  assert.match(page, /t\.changedLines\(changedRows\)/);
  assert.doesNotMatch(page, /\{changedRows\} 处变化/);
  assert.match(page, /toast\.error\(t\.copyFailure/);
});

test("wraps the controls cleanly on narrow screens", () => {
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /\.compare-options\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(css, /\.segmented\s*\{[^}]*width:\s*100%/s);
  assert.match(cssRule(".changes-heading"), /flex-wrap:\s*wrap/);
  assert.match(cssRule(".view-options"), /flex-wrap:\s*wrap/);
});

test("offers the three whitespace modes as one segmented control", () => {
  assert.match(page, /const WHITESPACE_MODES: readonly WhitespaceMode\[\] = \["none", "amount", "all"\]/);
  assert.match(page, /aria-pressed=\{whitespace === mode\}/);
  assert.match(page, /onClick=\{\(\) => setWhitespace\(mode\)\}/);
});

test("switches to a single unified column on narrow screens", () => {
  assert.match(page, /const NARROW_SCREEN_QUERY = "\(max-width: 760px\)"/);
  assert.match(page, /unified=\{narrowScreen\}/);
  assert.match(cssRule(".unified-line"), /grid-template-columns:\s*38px 38px 20px/);
  assert.match(cssRule(".unified-line-removed .line-marker"), /var\(--removed-text\)/);
});

test("folds unchanged lines automatically for long results and on request", () => {
  assert.match(page, /foldPreference \?\? rows\.length > AUTO_FOLD_ROW_THRESHOLD/);
  assert.match(page, /buildDisplayItems\(rows, foldUnchanged, expandedFolds\)/);
  assert.match(cssRule(".diff-fold-row"), /grid-column:\s*1 \/ -1/);
});

test("defines dark colors for the system setting and for a manual choice", () => {
  assert.match(css, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/);
  assert.match(css, /:root\[data-theme="dark"\]\s*\{/);
  assert.match(css, /@custom-variant dark/);
  const rules = css.slice(css.indexOf("body {"));
  assert.doesNotMatch(
    rules,
    /#[0-9a-f]{3,6}\b/i,
    "component rules should use color tokens",
  );
});
