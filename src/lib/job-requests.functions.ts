import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { JOB_PRESETS, estimateCredits, isAutoApproved, resourcesFor } from "./job-presets";

const DEFAULT_CREDITS = 100;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function balanceOf(tenantId: string): Promise<number> {
  const db = await admin();
  const { data } = await db.from("tenant_credits").select("balance").eq("tenant_id", tenantId).maybeSingle();
  if (data) return Number(data.balance);
  await db.from("tenant_credits").insert({ tenant_id: tenantId, balance: DEFAULT_CREDITS });
  return DEFAULT_CREDITS;
}

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (data !== true) throw new Error("Admins only");
}

/** User submits a job request. Denied immediately if credits are too low. */
export const requestJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        name: z.string().trim().min(1).max(80),
        type: z.string().max(40),
        priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
        input: z.string().max(40000).optional(),
        repo: z.string().max(140).optional(),
        runId: z.string().max(40).optional(),
        sha: z.string().max(60).optional(),
        branch: z.string().max(120).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const preset = JOB_PRESETS.find((p) => p.type === data.type);
    if (!preset) throw new Error("Unknown job type");
    if (preset.ai && !data.repo && !data.input?.trim()) throw new Error("Please enter a prompt or upload a file for this job.");
    const { data: profile } = await context.supabase
      .from("profiles").select("tenant_id, email").eq("id", context.userId).maybeSingle();
    const tenantId = profile?.tenant_id ?? `tenant-${context.userId.replace(/-/g, "").slice(0, 10)}`;
    const plan = resourcesFor(data.type, data.priority);
    const est = Math.round(estimateCredits(data.type, data.priority) * 100) / 100;
    const balance = await balanceOf(tenantId);
    if (balance < est)
      throw new Error(`Insufficient credits: you have ${balance.toFixed(2)} but this job needs ${est.toFixed(2)}. Ask the admin for more credits.`);

    const db = await admin();
    const { data: row, error } = await db
      .from("job_requests")
      .insert({
        user_id: context.userId, tenant_id: tenantId, email: profile?.email ?? null,
        name: data.name, type: data.type, priority: data.priority,
        cores: plan.requestedCores, memory_mb: plan.requestedMemoryMb, estimated_ms: plan.estimatedMs,
        estimated_credits: est, input: data.input ?? null,
      })
      .select("id").single();
    if (error) throw new Error(error.message);
    if (data.repo) {
      await db.from("github_deployments").insert({
        user_id: context.userId, tenant_id: tenantId, repo_full_name: data.repo,
        branch: data.branch ?? null, commit_sha: data.sha ?? null, run_id: data.runId ?? null,
        status: "PENDING_APPROVAL", request_id: row.id,
      });
    }
    if (isAutoApproved(data.type, data.priority)) {
      const { data: req } = await db.from("job_requests").select("*").eq("id", row.id).single();
      const r = await executeRequest(req, "Auto-approved (small job)");
      return { id: row.id as string, estimated: est, auto: true, status: r.status };
    }
    return { id: row.id as string, estimated: est, auto: false, status: "PENDING" };
  });

/** Admin approves (charges credits, runs on the engine) or denies a request. */
export const decideJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), approve: z.boolean(), reason: z.string().max(300).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const db = await admin();
    const { data: req } = await db.from("job_requests").select("*").eq("id", data.id).maybeSingle();
    if (!req) throw new Error("Request not found");
    if (req.status !== "PENDING") throw new Error(`Already ${req.status.toLowerCase()}`);
    const now = new Date().toISOString();

    if (!data.approve) {
      await db.from("job_requests").update({ status: "DENIED", reason: data.reason || "Denied by admin", decided_at: now }).eq("id", req.id);
      await db.from("github_deployments").update({ status: "DENIED" }).eq("request_id", req.id);
      return { status: "DENIED" };
    }

    return executeRequest(req);
  });


// deno-lint-ignore no-explicit-any
async function executeRequest(req: any, note?: string): Promise<{ status: string; reason?: string; engineJobId?: number | null }> {
  const db = await admin();
  const now = new Date().toISOString();
    const est = Number(req.estimated_credits);
    const balance = await balanceOf(req.tenant_id);
    if (balance < est) {
      await db.from("job_requests").update({ status: "DENIED", reason: `Insufficient credits (${balance.toFixed(2)} < ${est.toFixed(2)})`, decided_at: now }).eq("id", req.id);
      return { status: "DENIED" };
    }
    await db.from("tenant_credits").update({ balance: balance - est, updated_at: now }).eq("tenant_id", req.tenant_id);

    // Run on the C++ engine so CPU, memory, worker and run time are real.
    const { resolveEngineUrl } = await import("./engine-env.server");
    const { url } = await resolveEngineUrl();
    let engineJobId: number | null = null;
    let engineError = "";
    if (url) {
      try {
        const r = await fetch(`${url}/api/jobs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: req.name, type: req.type, priority: req.priority, tenantId: req.tenant_id,
            userId: req.email ?? req.user_id, requestedCores: req.cores,
            requestedMemoryMb: req.memory_mb, estimatedMs: req.estimated_ms,
          }),
        });
        const j = (await r.json()) as { accepted?: boolean; jobId?: number; message?: string };
        if (j.accepted && j.jobId) engineJobId = j.jobId;
        else engineError = j.message ?? `Engine returned ${r.status}`;
      } catch (e) {
        engineError = e instanceof Error ? e.message : "Engine unreachable";
      }
    } else engineError = "Engine not configured";

    if (!engineJobId && !JOB_PRESETS.find((p) => p.type === req.type)?.ai) {
      // Refund: nothing ran.
      await db.from("tenant_credits").update({ balance, updated_at: now }).eq("tenant_id", req.tenant_id);
      await db.from("job_requests").update({ status: "FAILED", reason: engineError, decided_at: now }).eq("id", req.id);
      return { status: "FAILED", reason: engineError };
    }

    await db.from("job_requests").update({ status: "RUNNING", engine_job_id: engineJobId, decided_at: now, reason: note ?? null }).eq("id", req.id);
    await db.from("github_deployments").update({ status: "BUILDING", job_id: engineJobId }).eq("request_id", req.id);

    const preset = JOB_PRESETS.find((p) => p.type === req.type);
    if (preset?.ai) {
      try {
        const output = preset.ai.image ? await runImage(req.input || req.name) : await runAi(preset.ai.instructions, req.input || `Job: ${req.name}`);
        await db.from("job_requests").update({ status: "COMPLETED", output }).eq("id", req.id);
        return { status: "COMPLETED" };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "AI failed";
        const cur = await balanceOf(req.tenant_id);
        await db.from("tenant_credits").update({ balance: cur + est, updated_at: new Date().toISOString() }).eq("tenant_id", req.tenant_id);
        await db.from("job_requests").update({ status: "FAILED", reason: `${msg} (credits refunded)` }).eq("id", req.id);
        return { status: "FAILED", reason: msg };
      }
    }
    return { status: "RUNNING", engineJobId };
}

/** Admin sets a tenant's credit balance. */
export const setTenantBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ tenantId: z.string().max(60), balance: z.number().min(0).max(1e7) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const db = await admin();
    const { error } = await db.from("tenant_credits").upsert({ tenant_id: data.tenantId, balance: data.balance, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return data;
  });

async function runAi(instructions: string, input: string): Promise<string> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "fetch", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-6-astra", stream: true, store: false, reasoning: { effort: "low" },
      instructions: instructions + " Keep it under 400 words.",
      input: [{ role: "user", content: input.slice(0, 40000) }],
    }),
  });
  if (!res.ok || !res.body) {
    if (res.status === 429) throw new Error("AI is busy right now, try again shortly.");
    if (res.status === 402) throw new Error("AI credits are used up for this workspace.");
    throw new Error(`AI request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const f of frames) {
      const line = f.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let ev: { type?: string; delta?: string };
      try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
      if (ev.type === "response.failed" || ev.type === "error") throw new Error("AI response failed.");
    }
  }
  return text.trim() || "The model returned no output.";
}

async function runImage(prompt: string): Promise<string> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "fetch", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3.1-flash-image",
      modalities: ["image", "text"],
      messages: [{ role: "user", content: prompt.slice(0, 4000) }],
    }),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error("AI is busy right now, try again shortly.");
    if (res.status === 402) throw new Error("AI credits are used up for this workspace.");
    throw new Error(`Image request failed (${res.status})`);
  }
  const j = (await res.json()) as { choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }> };
  const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("The model returned no image.");
  return url;
}
