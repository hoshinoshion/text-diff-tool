[简体中文](README.zh-CN.md)

# Text Diff Tool

A fast, privacy-friendly, side-by-side text comparison tool that runs entirely in the browser. Paste the original and revised text to see aligned line-level changes and precise inline highlights in real time.

Production URL: [diff.hoshinoshion.com](https://diff.hoshinoshion.com)

## Features

- Side-by-side editing with real-time comparison
- Reliable alignment for added, removed, and modified lines
- Character-level inline highlighting
- Handles long documents, repeated lines, blank lines, trailing newlines, and Unicode text
- Optional whitespace-insensitive comparison
- Optional line wrapping
- Synchronized editor heights, vertical scrolling, and result-pane horizontal scrolling
- English and Simplified Chinese interface
- Automatic browser-language detection with a persistent manual language switch
- Fully local text processing: pasted content is never uploaded

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

The app does not require a database, server-side secrets, or application environment variables. The public repository intentionally excludes the current hosting environment's `.openai/hosting.json`; it is not needed for a standard Cloudflare Workers deployment.

After the Worker is deployed, add `diff.hoshinoshion.com` as a custom domain in the Worker's settings. Cloudflare will create the required DNS record and provision TLS automatically when the zone is managed by the same account.

## License

[MIT](LICENSE)
