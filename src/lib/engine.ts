import type {
  CancelResult,
  CreditsResult,
  Health,
  JobsResponse,
  Job,
  LogEntry,
  LogsResponse,
  MemoryStats,
  Metrics,
  PauseResult,
  PolicyResult,
  QueueState,
  Resources,
  SetCreditsRequest,
  SetPolicyRequest,
  SubmitJobRequest,
  SubmitResult,
  TenantCredit,
  TenantsResponse,
} from "./engine.types";

async function proxy(path: string, init?: RequestInit) {
  const res = await fetch(`/api/engine/${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`Engine proxy error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function getHealth(): Promise<Health> {
  return proxy("health");
}

export async function getJobs(tenantId?: string, limit = 200): Promise<Job[]> {
  const params = new URLSearchParams();
  if (tenantId) params.set("tenantId", tenantId);
  if (limit !== 200) params.set("limit", String(limit));
  const query = params.toString();
  const res: JobsResponse = await proxy(`jobs${query ? `?${query}` : ""}`);
  return res.jobs;
}

export async function getJob(id: number): Promise<Job> {
  return proxy(`jobs/${id}`);
}

export async function submitJob(job: SubmitJobRequest): Promise<SubmitResult> {
  return proxy("jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job),
  });
}

export async function cancelJob(id: number): Promise<CancelResult> {
  return proxy(`jobs/${id}`, { method: "DELETE" });
}

export async function getMetrics(): Promise<Metrics> {
  return proxy("metrics");
}

export async function getResources(): Promise<Resources> {
  return proxy("resources");
}

export async function getMemory(): Promise<MemoryStats> {
  return proxy("memory");
}

export async function getQueueState(): Promise<QueueState> {
  return proxy("scheduler/queues");
}

export async function setPolicy(req: SetPolicyRequest): Promise<PolicyResult> {
  return proxy("scheduler/policy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

export async function setCredits(req: SetCreditsRequest): Promise<CreditsResult> {
  return proxy("tenants/credits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

export async function getLogs(jobId?: number, limit = 100): Promise<LogEntry[]> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (jobId !== undefined) params.set("jobId", String(jobId));
  const res: LogsResponse = await proxy(`logs?${params.toString()}`);
  return res.logs;
}

export async function setEnginePaused(paused: boolean): Promise<PauseResult> {
  return proxy(`engine/${paused ? "pause" : "resume"}`, { method: "POST" });
}

export async function getTenantCredits(): Promise<TenantCredit[]> {
  const res: TenantsResponse = await proxy("tenants");
  return res.tenants;
}
