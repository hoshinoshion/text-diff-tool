import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const locale = await readFile(new URL("../lib/locale.ts", import.meta.url), "utf8");
const requestLocale = await readFile(
  new URL("../lib/request-locale.ts", import.meta.url),
  "utf8",
);
const localeProvider = await readFile(
  new URL("../app/locale-provider.tsx", import.meta.url),
  "utf8",
);
const favicon = await readFile(
  new URL("../public/favicon.svg", import.meta.url),
  "utf8",
);

test("server-renders the browser or cookie language", () => {
  assert.match(layout, /title:\s*"Text Diff Tool"/);
  assert.match(layout, /title:\s*"文本对比工具"/);
  assert.match(layout, /generateMetadata/);
  assert.match(layout, /<html lang=\{locale\} data-theme=\{theme \?\? undefined\}>/);
  assert.match(layout, /<LocaleProvider initialLocale=\{locale\}>/);
  assert.match(requestLocale, /cookies\(\)/);
  assert.match(requestLocale, /headers\(\)/);
  assert.match(requestLocale, /accept-language/);
  assert.match(localeProvider, /createContext<Locale>/);
  assert.match(page, /useInitialLocale\(\)/);
  assert.match(page, /useCallback\(\(\) => initialLocale/);
  assert.match(page, /useSyncExternalStore\(/);
});

test("detects Chinese browser language and remembers manual selection", () => {
  assert.match(
    page,
    /navigator\.language\.toLowerCase\(\)\.startsWith\("zh"\)\s*\?\s*"zh-CN"\s*:\s*"en"/,
  );
  assert.match(page, /localStorage\.getItem\(LANGUAGE_STORAGE_KEY\)/);
  assert.match(page, /localStorage\.setItem\(LANGUAGE_STORAGE_KEY, nextLocale\)/);
  assert.match(page, /document\.cookie = `\$\{LANGUAGE_COOKIE_KEY\}=\$\{nextLocale\}/);
  assert.match(locale, /LANGUAGE_COOKIE_KEY = "text-diff-tool-language"/);
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
