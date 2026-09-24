import { createFileRoute } from "@tanstack/react-router";
import { resolveEngineUrl } from "@/lib/engine-env.server";
import { resolveCaller } from "@/lib/engine-auth.server";

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
        guarded(request, params._splat ?? ""),

      POST: ({ request, params }) =>
        guarded(request, params._splat ?? ""),

      PUT: ({ request, params }) =>
        guarded(request, params._splat ?? ""),

      PATCH: ({ request, params }) =>
        guarded(request, params._splat ?? ""),

      DELETE: ({ request, params }) =>
        guarded(request, params._splat ?? ""),
    },
  },
});

const REQUEST_TIMEOUT_MS = 15_000;

const ADMIN_ONLY = ["engine/pause", "engine/resume", "scheduler/policy", "tenants/credits"];
const deny = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

// Tenant isolation: every call is tied to the signed-in account. Admins see
// everything; tenants only see and act on their own jobs, logs and credits.
async function guarded(request: Request, splat: string) {
  const path = splat.replace(/^\/+/, "");
  if (path === "health") return proxyToEngine(request, path);

  const caller = await resolveCaller(request);
  if (!caller) return deny(401, "Sign in required");
  if (caller.isAdmin) return proxyToEngine(request, path);

  const method = request.method;
  if (method !== "GET" && ADMIN_ONLY.includes(path)) return deny(403, "Admin only");

  const url = new URL(request.url);

  if (path === "jobs" && method === "GET") {
    url.searchParams.set("tenantId", caller.tenantId);
    return proxyToEngine(new Request(url, request), path);
  }

  if (path === "jobs" && method === "POST") {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    body["tenantId"] = caller.tenantId;
    body["userId"] = caller.email || caller.userId;
    return proxyToEngine(
      new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      path,
    );
  }

  if (/^jobs\/\d+$/.test(path)) {
    const res = await proxyToEngine(new Request(url, { method: "GET" }), path);
    if (!res.ok) return res;
    const job = (await res.json()) as { tenantId?: string };
    if (job.tenantId !== caller.tenantId) return deny(404, "Job not found");
    if (method === "GET") return Response.json(job, { headers: { "cache-control": "no-store" } });
    return proxyToEngine(request, path);
  }

  if (path === "tenants" && method === "GET") {
    const res = await proxyToEngine(request, path);
    if (!res.ok) return res;
    const data = (await res.json()) as { tenants?: { tenantId: string; credits: number }[] };
    const own = (data.tenants ?? []).filter((t) => t.tenantId === caller.tenantId);
    if (!own.length) own.push({ tenantId: caller.tenantId, credits: 1000 });
    return Response.json({ tenants: own }, { headers: { "cache-control": "no-store" } });
  }

  if (path === "logs" && method === "GET") {
    const jobsUrl = new URL(url);
    jobsUrl.search = `?tenantId=${encodeURIComponent(caller.tenantId)}&limit=1000`;
    const [logsRes, jobsRes] = await Promise.all([
      proxyToEngine(request, path),
      proxyToEngine(new Request(jobsUrl, { method: "GET" }), "jobs"),
    ]);
    if (!logsRes.ok) return logsRes;
    const logs = (await logsRes.json()) as { logs?: { jobId: number }[] };
    const jobs = jobsRes.ok ? ((await jobsRes.json()) as { jobs?: { id: number }[] }) : { jobs: [] };
    const ids = new Set((jobs.jobs ?? []).map((j) => j.id));
    return Response.json(
      { logs: (logs.logs ?? []).filter((l) => ids.has(l.jobId)) },
      { headers: { "cache-control": "no-store" } },
    );
  }

  if (method !== "GET") return deny(403, "Not allowed for tenant accounts");
  // Node-wide telemetry (metrics, resources, memory, queues) is shared.
  return proxyToEngine(request, path);
}

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