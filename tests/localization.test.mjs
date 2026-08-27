import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const favicon = await readFile(
  new URL("../public/favicon.svg", import.meta.url),
  "utf8",
);

test("uses English as the server-rendered default", () => {
  assert.match(layout, /title:\s*"Text Diff Tool"/);
  assert.match(layout, /<html lang="en">/);
  assert.match(page, /function getServerLocale\(\): Locale \{\s*return "en"/);
  assert.match(page, /useSyncExternalStore\(/);
});

test("detects Chinese browser language and remembers manual selection", () => {
  assert.match(
    page,
    /navigator\.language\.toLowerCase\(\)\.startsWith\("zh"\)\s*\?\s*"zh-CN"\s*:\s*"en"/,
  );
  assert.match(page, /localStorage\.getItem\(LANGUAGE_STORAGE_KEY\)/);
  assert.match(page, /localStorage\.setItem\(LANGUAGE_STORAGE_KEY, nextLocale\)/);
  assert.match(page, /selectLanguage\("en"\)/);
  assert.match(page, /selectLanguage\("zh-CN"\)/);
  assert.match(page, /aria-pressed=\{locale === "en"\}/);
  assert.match(page, /aria-pressed=\{locale === "zh-CN"\}/);
});

test("updates document language and metadata after a language change", () => {
  assert.match(page, /document\.documentElement\.lang = locale/);
  assert.match(page, /document\.title = t\.title/);
  assert.match(page, /meta\[name="description"\]/);
});

test("uses the blue header mark as the favicon", () => {
  assert.match(favicon, /<linearGradient id="brand"/);
  assert.match(favicon, /#4169E1/);
  assert.match(favicon, /#2948B8/);
  assert.match(favicon, /stroke="white"/);
});
