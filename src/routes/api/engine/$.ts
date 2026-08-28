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
  // Map /api/engine/health -> /health and everything else under /api.
  const enginePath = splat === "health" ? "/health" : splat ? `/api/${splat}` : "/api";
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
    if (request.method === "GET") {
      const fallback = getOfflineSnapshot(splat);
      if (fallback !== undefined) {
        return Response.json(fallback, {
          status: 200,
          headers: {
            "cache-control": "no-store",
            "x-engine-status": "offline",
          },
        });
      }
    }

    return Response.json(
      {
        error: "The scheduling engine is currently offline",
        detail: message,
      },
      { status: 503 },
    );
  }
}

function getOfflineSnapshot(splat: string): unknown | undefined {
  switch (splat) {
    case "health":
      return {
        status: "offline",
        engine: "MV CloudCore",
        policy: "—",
        workers: 0,
        paused: false,
        reachable: false,
      };
    case "jobs":
      return { jobs: [] };
    case "metrics":
      return {
        policy: "—",
        avgWaitingMs: 0,
        avgTurnaroundMs: 0,
        avgResponseMs: 0,
        cpuUtilization: 0,
        throughputPerMin: 0,
        contextSwitches: 0,
        preemptions: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        running: 0,
        queued: 0,
      };
    case "resources":
      return {
        totalCores: 0,
        usedCores: 0,
        freeCores: 0,
        cpuUtilization: 0,
        totalMemoryMb: 0,
        usedMemoryMb: 0,
        freeMemoryMb: 0,
        memoryUtilization: 0,
        activeAllocations: 0,
        fragmentation: 0,
        largestFreeMb: 0,
        threadPoolWorkers: 0,
        threadPoolActive: 0,
        threadPoolQueued: 0,
        threadPoolCompleted: 0,
      };
    case "memory":
      return {
        totalMb: 0,
        usedMb: 0,
        freeMb: 0,
        utilization: 0,
        fragmentation: 0,
        largestFreeMb: 0,
        freeBlocks: 0,
        usedBlocks: 0,
        allocationCount: 0,
        failedAllocations: 0,
        blocks: [],
      };
    case "scheduler/queues":
      return { policy: "—", levels: [], decisions: [] };
    case "tenants":
      return { tenants: [] };
    case "logs":
      return { logs: [] };
    default:
      return undefined;
  }
}
