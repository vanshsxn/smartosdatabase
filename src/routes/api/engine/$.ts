import { createFileRoute } from "@tanstack/react-router";

/**
 * Server-side proxy: browser -> /api/engine/* -> C++ engine (ENGINE_URL).
 * ENGINE_URL is read inside the handler (Cloudflare injects env at request
 * time) and is never exposed to client-side JavaScript.
 */
export const Route = createFileRoute("/api/engine/$")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "access-control-allow-headers": "Content-Type, Authorization, Accept",
            "access-control-max-age": "86400",
          },
        }),
      GET: ({ request, params }) => proxyToEngine(request, params._splat ?? ""),
      POST: ({ request, params }) => proxyToEngine(request, params._splat ?? ""),
      PUT: ({ request, params }) => proxyToEngine(request, params._splat ?? ""),
      PATCH: ({ request, params }) => proxyToEngine(request, params._splat ?? ""),
      DELETE: ({ request, params }) => proxyToEngine(request, params._splat ?? ""),
    },
  },
});

const REQUEST_TIMEOUT_MS = 15_000;

/** Resolve the engine base URL. Localhost is only allowed in dev. */
function resolveEngineUrl(): { url?: string; error?: string } {
  const raw = (process.env["ENGINE_URL"] ?? "").trim();
  const isDev = process.env["NODE_ENV"] !== "production";

  if (!raw) {
    if (isDev) return { url: "http://127.0.0.1:9090" };
    return {
      error:
        "ENGINE_URL is not configured. Set ENGINE_URL to the public HTTPS URL of the C++ engine in the Cloudflare Workers environment variables for this deployment.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { error: `ENGINE_URL is not a valid absolute URL: ${raw}` };
  }

  const host = parsed.hostname;
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1";
  if (isLocal && !isDev) {
    return {
      error:
        "ENGINE_URL points at localhost, which is unreachable from Cloudflare Workers. Set it to the public HTTPS URL of the separately deployed C++ engine.",
    };
  }

  return { url: raw.replace(/\/$/, "") };
}

async function proxyToEngine(request: Request, splat: string) {
  const { url: engineUrl, error } = resolveEngineUrl();
  if (!engineUrl) {
    return Response.json({ error }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  // Only the query string is needed; avoid parsing a possibly relative URL.
  const search = request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";

  // /api/engine/health -> /health ; everything else -> /api/<splat>
  const path = splat.replace(/^\/+/, "");
  const enginePath = path === "health" ? "/health" : path ? `/api/${path}` : "/api";
  const target = `${engineUrl}${enginePath}${search}`;

  const headers = new Headers();
  for (const name of ["content-type", "accept", "authorization"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const hasBody = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  const body = hasBody ? await request.arrayBuffer() : undefined;

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  try {
    const engineRes = await fetch(target, {
      method: request.method,
      headers,
      body: body && body.byteLength > 0 ? body : null,
      redirect: "manual", // never follow redirects -> no proxy loops
      signal: timeout,
    });

    const responseHeaders = new Headers({ "cache-control": "no-store" });
    for (const name of ["content-type", "location"]) {
      const value = engineRes.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }

    return new Response(engineRes.body, {
      status: engineRes.status,
      statusText: engineRes.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "engine unreachable";
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return Response.json(
      {
        error: timedOut
          ? "Timed out waiting for the task engine"
          : "The task engine is unreachable",
        detail: message,
        target: enginePath,
      },
      { status: timedOut ? 504 : 502, headers: { "cache-control": "no-store" } },
    );
  }
}
