import { createFileRoute } from "@tanstack/react-router";

// Lets other deployments of this app (e.g. a Cloudflare copy without the AI key)
// run AI steps here. Only signed-in users of this app's database are accepted.
export const Route = createFileRoute("/api/ai-relay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { resolveCaller } = await import("@/lib/engine-auth.server");
        const caller = await resolveCaller(request);
        if (!caller) return Response.json({ error: "Sign in required" }, { status: 401 });
        if (!process.env["LOVABLE_API_KEY"]) return Response.json({ error: "AI is not configured" }, { status: 500 });
        const b = (await request.json().catch(() => null)) as { kind?: string; instructions?: string; input?: string } | null;
        if (!b || typeof b.input !== "string" || !b.input.trim()) return Response.json({ error: "Missing input" }, { status: 400 });
        const input = b.input.slice(0, 40000);
        try {
          const { runAi, runImage } = await import("@/lib/job-requests.functions");
          const output = b.kind === "image"
            ? await runImage(input.slice(0, 4000))
            : await runAi(String(b.instructions ?? "Respond helpfully.").slice(0, 4000), input);
          return Response.json({ output });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "AI failed" }, { status: 502 });
        }
      },
    },
  },
});
