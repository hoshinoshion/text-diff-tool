/// <reference types="vite/client" />
/** Cloudflare Worker entry point. */
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Besides Cloudflare Web Analytics, which Cloudflare injects into the page,
// the page never contacts another origin, so pasted text cannot be sent
// anywhere. Next.js streams its payload in inline scripts, which keeps
// 'unsafe-inline' necessary.
const CLOUDFLARE_ANALYTICS_SCRIPT = "https://static.cloudflareinsights.com";
const CLOUDFLARE_ANALYTICS_ENDPOINT = "https://cloudflareinsights.com";
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${CLOUDFLARE_ANALYTICS_SCRIPT}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ${CLOUDFLARE_ANALYTICS_ENDPOINT}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

function withSecurityHeaders(response: Response) {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    secured.headers.set(name, value);
  }

  if (secured.headers.get("content-type")?.startsWith("text/html")) {
    // The page varies by the language and theme cookies, so browsers may keep
    // it (which also allows the back/forward cache) but must revalidate it.
    secured.headers.set("Cache-Control", "private, no-cache");
    secured.headers.append("Vary", "Cookie, Accept-Language");
  }

  return secured;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const response = await handler.fetch(request, env, ctx);
    // The Vite dev server needs inline module scripts and a WebSocket that
    // this policy would block.
    return import.meta.env.PROD ? withSecurityHeaders(response) : response;
  },
};

export default worker;
