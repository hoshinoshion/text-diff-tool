import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

const env = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
};

async function requestPage(headers = {}) {
  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", ...headers },
    }),
    env,
    ctx,
  );
}

async function renderPage(headers = {}) {
  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", ...headers },
    }),
    env,
    ctx,
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  return response.text();
}

test("renders English when the browser does not request Chinese", async () => {
  const html = await renderPage();
  assert.match(html, /<html[^>]+lang=["']en["']/i);
  assert.match(html, /<title>Text Diff Tool<\/title>/i);
  assert.match(
    html,
    /<meta(?=[^>]*\bname=["']description["'])(?=[^>]*\bcontent=["']Compare two texts side by side in your browser and highlight additions, deletions, and changes\.["'])[^>]*>/i,
  );
  assert.doesNotMatch(html, /\bname=["']codex-preview["']/i);
});

test("server-renders Chinese for a Chinese browser", async () => {
  const html = await renderPage({
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  });

  assert.match(html, /<html[^>]+lang=["']zh-CN["']/i);
  assert.match(html, /<title>文本对比工具<\/title>/i);
  assert.match(
    html,
    /<meta(?=[^>]*\bname=["']description["'])(?=[^>]*\bcontent=["']在浏览器中并排比较两份文本，高亮显示新增、删除和修改的内容。["'])[^>]*>/i,
  );
  assert.match(html, />文本对比工具</);
  assert.doesNotMatch(html, /<html[^>]+lang=["']en["']/i);
});

test("manual language cookie overrides the browser language", async () => {
  const html = await renderPage({
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    cookie: "text-diff-tool-language=en",
  });

  assert.match(html, /<html[^>]+lang=["']en["']/i);
  assert.match(html, /<title>Text Diff Tool<\/title>/i);
});

test("sends security headers that keep pasted text in the browser", async () => {
  const response = await requestPage();
  const policy = response.headers.get("content-security-policy") ?? "";

  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /connect-src 'self' https:\/\/cloudflareinsights\.com;/);
  assert.match(policy, /script-src 'self' 'unsafe-inline' https:\/\/static\.cloudflareinsights\.com;/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cache-control"), "private, no-cache");
  assert.match(response.headers.get("vary") ?? "", /Cookie/);
});

test("renders sharing metadata and structured data", async () => {
  const html = await renderPage();

  assert.match(html, /<link[^>]+rel="canonical"[^>]+href="https:\/\/diff\.hoshinoshion\.com\/"/);
  assert.match(html, /<meta[^>]+property="og:image"[^>]+content="https:\/\/diff\.hoshinoshion\.com\/og-image\.png"/);
  assert.match(html, /<meta[^>]+name="twitter:card"[^>]+content="summary_large_image"/);
  assert.match(html, /<meta[^>]+name="theme-color"/);
  assert.match(html, /application\/ld\+json/);
});

test("server-renders the saved theme", async () => {
  assert.match(
    await renderPage({ cookie: "text-diff-tool-theme=dark" }),
    /<html[^>]+data-theme="dark"/,
  );
  assert.doesNotMatch(await renderPage(), /<html[^>]+data-theme=/);
});
