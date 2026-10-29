[简体中文](README.zh-CN.md)

# Text Diff Tool

A fast, privacy-friendly, side-by-side text comparison tool that runs entirely in the browser. Paste the original and revised text to see aligned line-level changes and precise inline highlights in real time.

Production URL: [diff.hoshinoshion.com](https://diff.hoshinoshion.com)

## Features

- Side-by-side editing with real-time comparison
- Reliable alignment for added, removed, and modified lines
- Word-level inline highlighting for English and other spaced languages, character-level for Chinese and Japanese
- Handles long documents, repeated lines, blank lines, trailing newlines, and Unicode text
- Large inputs are compared in a Web Worker, so typing never waits for the diff
- Unchanged lines collapse around each change (automatic for long results, with a switch)
- Two whitespace options: ignore changes in the amount of whitespace (`git diff -b`) or ignore all whitespace (`git diff -w`)
- Optional line wrapping
- A single unified column on narrow screens
- Light and dark themes that follow the system or a manual choice
- Synchronized editor heights, vertical scrolling, and result-pane horizontal scrolling
- English and Simplified Chinese interface
- Automatic browser-language detection with a persistent manual language switch
- Fully local text processing: pasted content is never uploaded, and the Content Security Policy blocks connections to every other origin except Cloudflare Web Analytics

## Requirements

- Node.js 22.13 or later
- npm

## Local development

```bash
npm ci
npm run dev
```

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
```

The test suite includes deterministic fuzz tests for random insertions, deletions, replacements, repeated content, Unicode text, and very long strings. Its random seeds are fixed so failures can be reproduced.

## Deploy to Cloudflare Workers

This project uses [vinext](https://github.com/cloudflare/vinext) and is ready to deploy to Cloudflare Workers.

```bash
npx wrangler login
npm run deploy -- --name text-diff-tool
```

For automated deployments, Cloudflare authentication can also be provided through `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

The app does not require a database, server-side secrets, or application environment variables. If the Worker is connected to this repository through Workers Builds, every push to `main` deploys automatically.

After the Worker is deployed, add `diff.hoshinoshion.com` as a custom domain in the Worker's settings. Cloudflare will create the required DNS record and provision TLS automatically when the zone is managed by the same account.

## License

[MIT](LICENSE)
