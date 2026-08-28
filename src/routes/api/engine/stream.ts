import { createFileRoute } from "@tanstack/react-router";

// Server-push telemetry stream. The dashboard opens a single persistent
// connection and the server pushes an engine snapshot every tick, so the
// charts update continuously without client polling.
export const Route = createFileRoute("/api/engine/stream")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const engineUrl = (process.env["ENGINE_URL"] ?? "http://127.0.0.1:9090").replace(/\/$/, "");
        const encoder = new TextEncoder();
        const intervalMs = 1000;

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            let closed = false;
            const close = () => {
              if (closed) return;
              closed = true;
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            };

            request.signal.addEventListener("abort", close);

            const send = (event: string, payload: unknown) => {
              if (closed) return;
              try {
                controller.enqueue(
                  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
                );
              } catch {
                closed = true;
              }
            };

            const fetchJson = async (path: string) => {
              const res = await fetch(`${engineUrl}${path}`, { headers: { accept: "application/json" } });
              if (!res.ok) throw new Error(`${path} -> ${res.status}`);
              return res.json();
            };

            const tick = async () => {
              try {
                const [health, metrics, resources, jobs, tenants] = await Promise.all([
                  fetchJson("/health"),
                  fetchJson("/api/metrics"),
                  fetchJson("/api/resources"),
                  fetchJson("/api/jobs?limit=200"),
                  fetchJson("/api/tenants").catch(() => ({ tenants: [] })),
                ]);
                send("snapshot", {
                  ts: Date.now(),
                  online: true,
                  health,
                  metrics,
                  resources,
                  jobs: jobs?.jobs ?? [],
                  tenants: tenants?.tenants ?? [],
                });
              } catch (err) {
                send("snapshot", {
                  ts: Date.now(),
                  online: false,
                  error: err instanceof Error ? err.message : "engine unreachable",
                  jobs: [],
                  tenants: [],
                });
              }
            };

            await tick();
            while (!closed) {
              await new Promise((r) => setTimeout(r, intervalMs));
              if (closed) break;
              await tick();
            }
            close();
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          },
        });
      },
    },
  },
});
