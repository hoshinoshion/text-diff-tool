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
