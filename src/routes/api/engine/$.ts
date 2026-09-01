import { createFileRoute } from "@tanstack/react-router";
import { resolveEngineUrl } from "@/lib/engine-env.server";

export const Route = createFileRoute("/api/engine/$")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods":
              "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers":
              "Content-Type, Authorization, Accept",
            "Access-Control-Max-Age": "86400",
          },
        }),

      GET: ({ request, params }) =>
        proxyToEngine(request, params._splat ?? ""),

      POST: ({ request, params }) =>
        proxyToEngine(request, params._splat ?? ""),

      PUT: ({ request, params }) =>
        proxyToEngine(request, params._splat ?? ""),

      PATCH: ({ request, params }) =>
        proxyToEngine(request, params._splat ?? ""),

      DELETE: ({ request, params }) =>
        proxyToEngine(request, params._splat ?? ""),
    },
  },
});

const REQUEST_TIMEOUT_MS = 15_000;

async function proxyToEngine(request: Request, splat: string) {
  const { url: engineUrl, error } = await resolveEngineUrl();

  if (!engineUrl) {
    return Response.json(
      {
        error: error ?? "ENGINE_URL is not configured",
      },
      {
        status: 503,
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  }

  const path = splat.replace(/^\/+/, "");

  // IMPORTANT:
  // /api/engine/health -> C++ /health
  // /api/engine/jobs -> C++ /api/jobs
  const enginePath =
    path === "health"
      ? "/health"
      : path
        ? `/api/${path}`
        : "/api";

  const incomingUrl = new URL(request.url);
  const target = `${engineUrl}${enginePath}${incomingUrl.search}`;

  const headers = new Headers();

  for (const name of [
    "content-type",
    "accept",
    "authorization",
  ]) {
    const value = request.headers.get(name);

    if (value) {
      headers.set(name, value);
    }
  }

  const hasBody =
    !["GET", "HEAD", "OPTIONS"].includes(request.method);

  const body = hasBody
    ? await request.arrayBuffer()
    : undefined;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );

    let engineRes: Response;

    try {
      engineRes = await fetch(target, {
        method: request.method,
        headers,
        body: body && body.byteLength > 0 ? body : null,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseHeaders = new Headers();

    for (const name of [
      "content-type",
      "cache-control",
      "location",
    ]) {
      const value = engineRes.headers.get(name);

      if (value) {
        responseHeaders.set(name, value);
      }
    }

    responseHeaders.set("cache-control", "no-store");

    return new Response(engineRes.body, {
      status: engineRes.status,
      statusText: engineRes.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "engine unreachable";

    const timedOut =
      err instanceof Error &&
      err.name === "AbortError";

    return Response.json(
      {
        error: timedOut
          ? "Timed out waiting for the C++ engine"
          : "The C++ engine is unreachable",
        detail: message,
        target: target,
      },
      {
        status: timedOut ? 504 : 502,
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  }
}