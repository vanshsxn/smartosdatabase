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
      let q = supabase.from("job_requests").select("*").order("created_at", { ascending: false }).limit(50);
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as JobRequestRow[];
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

  if (!rows.data?.length) return <p className="text-sm text-muted-foreground">No job requests yet.</p>;
  return (
    <div className="space-y-3">
      {rows.data.map((r) => {
        const job = r.engine_job_id ? snapshot?.jobs.find((j) => j.id === r.engine_job_id) : undefined;
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
            {r.output?.startsWith("data:image") ? (
              <img src={r.output} alt={r.name} className="mt-2 max-h-96 rounded border border-border" />
            ) : r.output && (
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs">{r.output}</pre>
            )}
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
