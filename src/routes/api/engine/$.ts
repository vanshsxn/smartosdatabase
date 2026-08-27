import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/engine/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        return proxyToEngine(request, params._splat ?? "");
      },
      POST: async ({ request, params }) => {
        return proxyToEngine(request, params._splat ?? "");
      },
      PUT: async ({ request, params }) => {
        return proxyToEngine(request, params._splat ?? "");
      },
      PATCH: async ({ request, params }) => {
        return proxyToEngine(request, params._splat ?? "");
      },
      DELETE: async ({ request, params }) => {
        return proxyToEngine(request, params._splat ?? "");
      },
    },
  },
});

async function proxyToEngine(request: Request, splat: string) {
  const engineUrl = process.env["ENGINE_URL"] ?? "http://127.0.0.1:9090";

  // In some server environments request.url may be a relative path.
  const absoluteUrl = URL.canParse(request.url)
    ? request.url
    : `http://${request.headers.get("host") ?? "localhost"}${request.url}`;
  const url = new URL(absoluteUrl);
  // The engine's API lives under /api, so map /api/engine/jobs -> /api/jobs.
  const enginePath = splat ? `/api/${splat}` : "/api";
  const target = `${engineUrl.replace(/\/$/, "")}${enginePath}${url.search}`;

  const headers = new Headers();
  const forward = ["content-type", "accept", "authorization"];
  for (const name of forward) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const body = ["GET", "HEAD"].includes(request.method) ? undefined : request.body;

  try {
    const engineRes = await fetch(target, {
      method: request.method,
      headers,
      body,
      // @ts-expect-error duplex is required for streaming bodies in Node fetch
      duplex: body ? "half" : undefined,
    });

    const responseHeaders = new Headers();
    const copy = ["content-type", "cache-control"];
    for (const name of copy) {
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
    return Response.json({ error: message }, { status: 503 });
  }
}
