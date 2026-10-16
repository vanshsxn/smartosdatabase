import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useEngineStream } from "@/lib/engine-stream";
import type { Job } from "@/lib/engine.types";
import { decideJob } from "@/lib/job-requests.functions";
import { tenantName } from "@/lib/session";

export interface JobRequestRow {
  id: string;
  tenant_id: string;
  email: string | null;
  name: string;
  type: string;
  priority: string;
  cores: number;
  memory_mb: number;
  estimated_ms?: number;
  estimated_credits: number;
  status: string;
  engine_job_id: number | null;
  output: string | null;
  reason: string | null;
  created_at: string;
}

export function useJobRequests(status?: string) {
  return useQuery({
    queryKey: ["job-requests", status ?? "all"],
    refetchInterval: 3000,
    queryFn: async () => {
      const selectFields = "id, tenant_id, email, name, type, priority, cores, memory_mb, estimated_ms, estimated_credits, status, engine_job_id, output, reason, created_at";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any[] | null = null;
      let q = supabase
        .from("job_requests")
        .select(selectFields)
        .order("created_at", { ascending: false })
        .limit(200);
      if (status) q = q.eq("status", status);

      const res = await q;
      if (!res.error && res.data) {
        data = res.data;
      } else {
        // Fallback: If primary query fails (e.g. payload too large due to legacy base64 data),
        // query WITHOUT output so jobs are ALWAYS displayed and NEVER disappear!
        let fallbackQ = supabase
          .from("job_requests")
          .select("id, tenant_id, email, name, type, priority, cores, memory_mb, estimated_ms, estimated_credits, status, engine_job_id, reason, created_at")
          .order("created_at", { ascending: false })
          .limit(200);
        if (status) fallbackQ = fallbackQ.eq("status", status);
        const fallbackRes = await fallbackQ;
        if (fallbackRes.error) {
          throw fallbackRes.error;
        }
        data = fallbackRes.data;
      }

      const rows = ((data ?? []) as unknown as JobRequestRow[]).map((r) => {
        if (r.status === "RUNNING") {
          const elapsed = Date.now() - new Date(r.created_at).getTime();
          const maxBurst = (r.estimated_ms || 3000) + 1500;
          if (r.output || elapsed > maxBurst) {
            return { ...r, status: "COMPLETED" };
          }
        }
        return r;
      });
      return rows;
    },
  });
}

const tone: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING: "outline", RUNNING: "default", COMPLETED: "secondary", DENIED: "destructive", FAILED: "destructive",
};

export function JobRequestList({ admin = false }: { admin?: boolean }) {
  const rows = useJobRequests();
  const { snapshot } = useEngineStream();
  const qc = useQueryClient();
  const decide = useServerFn(decideJob);
  const act = useMutation({
    mutationFn: (v: { id: string; approve: boolean }) => decide({ data: v }),
    onSuccess: (r) => {
      toast.success(`Request ${r.status.toLowerCase()}`);
      qc.invalidateQueries({ queryKey: ["job-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (rows.isError) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
        Failed to load job requests: {(rows.error as Error)?.message || "Unknown error"}
      </div>
    );
  }

  if (rows.isLoading && !rows.data?.length) {
    return <p className="text-sm text-muted-foreground animate-pulse">Loading jobs…</p>;
  }

  if (!rows.data?.length) return <p className="text-sm text-muted-foreground">No job requests yet.</p>;

  return (
    <div className="space-y-3">
      {rows.data.map((r) => {
        const job = r.engine_job_id ? snapshot?.jobs.find((j) => j.id === r.engine_job_id) : undefined;
        const outputStr =
          typeof r.output === "string"
            ? r.output
            : r.output != null
            ? JSON.stringify(r.output, null, 2)
            : null;

        const isImage =
          !!outputStr &&
          (outputStr.startsWith("data:image") ||
            outputStr.startsWith("http://") ||
            outputStr.startsWith("https://"));

        return (
          <div key={r.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.name}</span>
              <Badge variant="outline">{r.type}</Badge>
              <Badge variant={tone[r.status] ?? "outline"}>{job && r.status === "RUNNING" ? job.status : r.status}</Badge>
              {admin && <span className="text-xs text-muted-foreground">{tenantName(r.tenant_id)} · {r.email}</span>}
              <span className="ml-auto text-xs text-muted-foreground">
                {r.cores} cores · {r.memory_mb} MB · {Number(r.estimated_credits).toFixed(2)} credits
              </span>
              {admin && r.status === "PENDING" && (
                <div className="flex gap-1">
                  <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, approve: true })}>
                    <Check className="h-4 w-4" /> Allow
                  </Button>
                  <Button size="sm" variant="destructive" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, approve: false })}>
                    <X className="h-4 w-4" /> Deny
                  </Button>
                </div>
              )}
            </div>
            {r.status === "PENDING" && !admin && (
              <p className="mt-1 text-xs text-muted-foreground">Waiting for admin approval…</p>
            )}
            {r.reason && <p className="mt-1 text-xs text-destructive">{r.reason}</p>}
            {job && <LiveJob job={job} />}
            {isImage ? (
              <div className="mt-2 space-y-1.5">
                <img
                  src={outputStr}
                  alt={r.name}
                  className="max-h-96 w-full max-w-lg rounded-lg border border-border object-contain bg-black/40 shadow-sm"
                  loading="lazy"
                />
                <a
                  href={outputStr}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-[11px] text-primary hover:underline font-medium"
                >
                  View full image ↗
                </a>
              </div>
            ) : outputStr ? (
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs font-mono">{outputStr}</pre>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Live progress + CPU time chart for one engine job, like a cloud console. */
export function LiveJob({ job }: { job: Job }) {
  const pct = job.estimatedMs ? Math.min(100, ((job.estimatedMs - job.remainingMs) / job.estimatedMs) * 100) : 0;
  const done = job.status === "COMPLETED";
  const [points, setPoints] = useState<{ t: number; progress: number; cpu: number }[]>([]);
  const start = useRef(Date.now());
  useEffect(() => {
    setPoints((p) => {
      const t = Math.round((Date.now() - start.current) / 1000);
      const next = { t, progress: Math.round(done ? 100 : pct), cpu: Math.round(job.cpuTimeUsedMs / 100) / 10 };
      if (p.length && p[p.length - 1]!.progress === next.progress && p[p.length - 1]!.cpu === next.cpu) return p;
      return [...p.slice(-60), next];
    });
  }, [job.remainingMs, job.cpuTimeUsedMs, job.status, pct, done]);
  const exec = job.completedAtMs && job.submittedAtMs ? job.completedAtMs - job.submittedAtMs : Date.now() - job.submittedAtMs;
  return (
    <div className="mt-2 space-y-2">
      <Progress value={done ? 100 : pct} />
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-5">
        <span>Engine job #{job.id}</span>
        <span>Worker {job.workerId != null && job.workerId >= 0 ? `#${job.workerId + 1}` : "—"}</span>
        <span>Queue level {job.queueLevel}</span>
        <span>CPU time {(job.cpuTimeUsedMs / 1000).toFixed(1)} s</span>
        <span>Run time {(exec / 1000).toFixed(1)} s</span>
      </div>
      {points.length > 1 && (
        <div className="h-24">
          <ResponsiveContainer>
            <AreaChart data={points}>
              <XAxis dataKey="t" hide />
              <YAxis hide domain={[0, 100]} />
              <Tooltip />
              <Area dataKey="progress" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" name="Progress %" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
