# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Requires Node.js 22.13 or later.

```bash
npm run dev        # Vite dev server
npm run lint
npm run typecheck
npm test           # builds first, then runs every tests/*.test.mjs
```

To run one test file or one test, build once and then call `node --test` directly. Only `tests/rendered-html.test.mjs` needs `dist/`, because it imports the built Worker from `dist/server/index.js`.

```bash
node --test tests/diff-engine.test.mjs
node --test --test-name-pattern="whitespace" tests/diff-engine.test.mjs
```

## Deployment

The Worker is connected to this repository through Cloudflare Workers Builds, so every push to `main` deploys to https://diff.hoshinoshion.com. The dashboard runs:

- build command: `npm test`
- deploy command: `npm run deploy -- --name text-diff-tool --skip-build`

A failing test therefore blocks deployment. Keep the `build`, `test` and `deploy` scripts compatible with these commands.

## Architecture

This is a single-page text diff tool built on vinext, which provides the Next.js App Router API on top of Vite, and deployed to Cloudflare Workers. All diffing happens in the browser.

### Request path and headers

`worker/index.ts` wraps the vinext handler. In production builds only, it adds the security headers. The Content Security Policy allows only the page's own origin plus Cloudflare Web Analytics, which Cloudflare injects into the page. Any new external origin, such as a font or CDN, must be added to that policy or it will be blocked. `'unsafe-inline'` scripts are required because Next.js streams its RSC payload in inline scripts.

### Locale and theme

Both are rendered on the server so the page doesn't flicker on load:

- `lib/request-locale.ts` reads the cookies and `Accept-Language`.
- `app/layout.tsx` sets `<html lang>` and `data-theme`, then passes the initial values to the client through `app/locale-provider.tsx` and `app/theme-provider.tsx`.
- `app/page.tsx` reads them with `useSyncExternalStore`, using the context value as the server snapshot to avoid hydration mismatches.

The UI strings live in the `translations` object in `app/page.tsx`. The page title and description also appear in `metadataByLocale` in `app/layout.tsx`. Both have `en` and `zh-CN` entries, and both must stay in sync.

### Diff pipeline (`lib/diff.ts`)

1. **`buildLineOperations`** compares normalized lines: NFC, plus the whitespace modes `none`, `amount` (like `git diff -b`) and `all` (like `git diff -w`). It trims the common prefix and suffix, then picks a method by size:
   - exact LCS when the table fits under `EXACT_LINE_DIFF_CELL_LIMIT`;
   - otherwise unique-line anchors (patience-style) with recursion between them;
   - otherwise a bounded Myers diff, falling back to all-removed/all-added.
2. **`buildRows`** groups each run of removed and added lines and aligns them into side-by-side `DiffRow`s by line similarity (`alignChangedRows`). The alignment uses a full DP for small runs, then a banded DP, then a greedy pass.
3. **`inlineDiff`** highlights changes within each paired row:
   - Tokens come from `splitTokens`: words, whitespace runs, and single characters for Han, Kana and punctuation.
   - When a single word mostly survives a change, the highlight is refined to individual graphemes with `graphemeDiff`.
4. **`computeDiff`** bundles the rows, inline segments, statistics and character counts. This is what the UI and the worker consume.

The size limits at the top of `lib/diff.ts` keep huge inputs tractable. Don't use `array.push(...items)` on results: spreading more than about 120k items overflows the call stack. Use the `appendAll` helper instead.

### Keeping the UI responsive

- **Inline or worker.** `app/use-diff.ts` calls `computeDiff` during render when the input is 20k characters or less, so server rendering and the first paint include the result. Larger inputs go to `lib/diff.worker.ts`:
  - requests are debounced;
  - a worker still busy with an outdated request is terminated;
  - if a Web Worker is unavailable or fails, the diff runs on the main thread instead.

  The worker file uses relative imports only.
- **Folding.** `lib/diff-view.ts` turns rows into display items, replacing long unchanged runs with fold markers. Folding turns on automatically above `AUTO_FOLD_ROW_THRESHOLD` rows.
- **Rendering.** `app/page.tsx` renders the display items in batches of `RENDER_BATCH_SIZE` through the memoized `DiffTable`, so a keystroke doesn't re-render the result.
- **Narrow screens.** Screens up to 760px wide (`NARROW_SCREEN_QUERY`) get a single unified column instead of side-by-side panes.

### Styling

`app/globals.css` uses plain class names and color tokens:

- Light values are defined on `:root`.
- Dark values appear twice: once inside `@media (prefers-color-scheme: dark)` for `:root:not([data-theme="light"])`, and once for `:root[data-theme="dark"]`. Update both blocks together.
- Component rules must use tokens. A test fails if a hex color appears outside the token blocks.
- The Tailwind `dark:` variant is redefined in the same file to follow these rules.

Only `sonner` remains from shadcn in `components/ui/`. It is vendored, and some lint rules are relaxed for it. The page's own controls are plain buttons styled in `app/globals.css`.

## Tests

The tests use `node:test`.

- **Loading TypeScript.** Test files load `.ts` modules through Vite's `ssrLoadModule`, because Node 22.13 can't strip types. Each such file needs its own HMR port (24679, 24680, …).
- **Source-text tests.** `tests/diff-layout.test.mjs` and `tests/localization.test.mjs` assert on the source text of `app/page.tsx`, `app/layout.tsx` and `app/globals.css` with regexes. Renaming identifiers or classes they mention breaks them, so update them along with the code.
- **Fuzz tests.** The fuzz tests in `tests/diff-engine.test.mjs` use fixed seeds, so their failures reproduce.
