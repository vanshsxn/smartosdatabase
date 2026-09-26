import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  tenantId: z.string().min(1).max(200),
  tenantName: z.string().max(200),
  balance: z.number(),
  notes: z.string().max(4000).default(""),
  jobs: z
    .array(
      z.object({
        id: z.number(),
        name: z.string().max(200),
        type: z.string().max(50),
        status: z.string().max(50),
        priority: z.string().max(50).optional(),
        requestedCores: z.number().optional(),
        requestedMemoryMb: z.number().optional(),
        cpuTimeUsedMs: z.number().optional(),
        creditsCharged: z.number().optional(),
        workerId: z.number().optional(),
      }),
    )
    .max(200),
  logs: z.array(z.object({ ts: z.string().max(60), level: z.string().max(20), msg: z.string().max(500) })).max(200),
});

export const explainBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (isAdmin !== true) throw new Error("Only admins can run billing explanations.");

    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI is not configured.");

    const prompt = `Tenant: ${data.tenantName} (${data.tenantId})
Current credit balance: ${data.balance.toFixed(3)}
Billing formula: credits = cores*0.5*seconds + memoryGB*0.25*seconds, charged per executed CPU slice.

Admin notes / question:
${data.notes || "(none)"}

Jobs (JSON):
${JSON.stringify(data.jobs)}

Billing / runtime log lines:
${data.logs.map((l) => `${l.ts} [${l.level}] ${l.msg}`).join("\n")}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: {
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "fetch",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        stream: true,
        store: false,
        reasoning: { effort: "low" },
        instructions:
          "You are a cloud billing analyst. Using only the data given, explain the tenant's balance changes and flag unusual charges (outliers, unexpectedly expensive jobs, failed jobs that still cost credits, rapid depletion). Reply in concise Markdown with sections: Summary, Unusual charges, Balance changes, Recommendations. Cite job IDs. Never invent numbers. Keep it under 350 words.",
        input: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("AI is busy right now, please try again shortly.");
      if (res.status === 402) throw new Error("AI credits are used up for this workspace.");
      throw new Error(`AI request failed (${res.status}) ${body.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const f of frames) {
        const line = f.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        try {
          const ev = JSON.parse(line.slice(5).trim());
          if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
          if (ev.type === "response.failed" || ev.type === "error") throw new Error("AI response failed.");
        } catch (e) {
          if (e instanceof Error && e.message === "AI response failed.") throw e;
        }
      }
    }
    return { text: text.trim() || "The model returned no explanation." };
  });
