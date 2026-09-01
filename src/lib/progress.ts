import { supabase } from "@/integrations/supabase/client";
import type { Job } from "./engine.types";

export interface WalkthroughStep {
  key: string;
  title: string;
  description: string;
  href: string;
}

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    key: "signup",
    title: "Create your account",
    description: "Sign up with email and password — you're signed in right away.",
    href: "/login",
  },
  {
    key: "tenant",
    title: "Pick a tenant",
    description: "Choose the tenant your jobs are billed against from the sidebar selector.",
    href: "/tenants",
  },
  {
    key: "submit",
    title: "Submit your first job",
    description: "Pick a job type, request cores and memory, then send it to the engine.",
    href: "/submit",
  },
  {
    key: "charts",
    title: "Watch live charts",
    description: "Follow CPU and memory usage on the dashboard while the job runs.",
    href: "/",
  },
  {
    key: "logs",
    title: "Inspect logs and alerts",
    description: "Review runtime events, termination reasons and threshold alerts.",
    href: "/logs",
  },
];

export interface WalkthroughRow {
  step_key: string;
  completed: boolean;
  note: string | null;
  completed_at: string | null;
}

export interface JobProgressRow {
  id: string;
  job_id: string;
  job_name: string | null;
  job_type: string | null;
  tenant_id: string | null;
  state: string;
  percent: number;
  cpu_usage: number | null;
  memory_mb: number | null;
  message: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchWalkthrough(): Promise<WalkthroughRow[]> {
  const { data, error } = await supabase
    .from("walkthrough_progress")
    .select("step_key, completed, note, completed_at");
  if (error) throw error;
  return data ?? [];
}

export async function setWalkthroughStep(
  userId: string,
  stepKey: string,
  completed: boolean,
) {
  const { error } = await supabase.from("walkthrough_progress").upsert(
    {
      user_id: userId,
      step_key: stepKey,
      completed,
      completed_at: completed ? new Date().toISOString() : null,
    },
    { onConflict: "user_id,step_key" },
  );
  if (error) throw error;
}

export async function fetchJobProgress(limit = 200): Promise<JobProgressRow[]> {
  const { data, error } = await supabase
    .from("job_progress")
    .select(
      "id, job_id, job_name, job_type, tenant_id, state, percent, cpu_usage, memory_mb, message, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as JobProgressRow[];
}

export function jobPercent(job: Job): number {
  if (job.status === "COMPLETED") return 100;
  if (job.status === "CANCELLED" || job.status === "FAILED") {
    return job.estimatedMs > 0
      ? Math.min(100, Math.round(((job.estimatedMs - job.remainingMs) / job.estimatedMs) * 100))
      : 0;
  }
  if (job.estimatedMs <= 0) return 0;
  const done = job.estimatedMs - job.remainingMs;
  return Math.max(0, Math.min(100, Math.round((done / job.estimatedMs) * 100)));
}

/** Records a progress snapshot for each job in the current engine listing. */
export async function recordJobSnapshots(userId: string, jobs: Job[]) {
  if (!jobs.length) return 0;
  const rows = jobs.map((job) => ({
    user_id: userId,
    tenant_id: job.tenantId || null,
    job_id: job.externalId || String(job.id),
    job_name: job.name || null,
    job_type: job.type || null,
    state: job.status,
    percent: jobPercent(job),
    cpu_usage: job.requestedCores,
    memory_mb: job.requestedMemoryMb,
    message: job.errorMessage || job.lastDecision || null,
  }));
  const { error } = await supabase.from("job_progress").insert(rows);
  if (error) throw error;
  return rows.length;
}
