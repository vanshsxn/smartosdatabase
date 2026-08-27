import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Pause, Play } from "lucide-react";
import { toast } from "sonner";

import { AppLayout } from "@/components/AppLayout";
import { fmtMs } from "@/components/dashboard-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setEnginePaused, setPolicy } from "@/lib/engine";
import { healthQuery, metricsQuery, queuesQuery } from "@/lib/engine-queries";

export const Route = createFileRoute("/scheduler")({
  head: () => ({
    meta: [
      { title: "Scheduler | Smart Cloud Task Engine" },
      {
        name: "description",
        content: "Switch between MLFQ and adaptive scheduling, pause the dispatcher and inspect queues.",
      },
      { property: "og:title", content: "Scheduler | Smart Cloud Task Engine" },
      {
        property: "og:description",
        content: "Switch between MLFQ and adaptive scheduling, pause the dispatcher and inspect queues.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SchedulerPage,
});

function SchedulerPage() {
  const qc = useQueryClient();
  const health = useQuery(healthQuery);
  const metrics = useQuery(metricsQuery);
  const queues = useQuery(queuesQuery);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["engine"] });

  const policy = useMutation({
    mutationFn: (p: string) => setPolicy({ policy: p }),
    onSuccess: (res) => {
      toast.success(`Policy set to ${res.policy}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pause = useMutation({
    mutationFn: (p: boolean) => setEnginePaused(p),
    onSuccess: (res) => {
      toast.success(res.paused ? "Dispatcher paused" : "Dispatcher resumed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const paused = health.data?.paused ?? false;

  return (
    <AppLayout title="Scheduler">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Engine controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Scheduling policy</Label>
              <Select
                value={metrics.data?.policy ?? "MLFQ"}
                onValueChange={(v) => policy.mutate(v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MLFQ">MLFQ (multi-level feedback queue)</SelectItem>
                  <SelectItem value="ADAPTIVE">Adaptive (priority + resource + credit)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              variant={paused ? "default" : "outline"}
              disabled={pause.isPending}
              onClick={() => pause.mutate(!paused)}
            >
              {paused ? (
                <>
                  <Play className="mr-2 h-4 w-4" /> Resume dispatcher
                </>
              ) : (
                <>
                  <Pause className="mr-2 h-4 w-4" /> Pause dispatcher
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              Pausing freezes dispatching; running slices finish and queued jobs stay in place, so
              you can compare waiting times across policies.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Queue levels</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(queues.data?.levels ?? []).map((lvl) => (
              <div key={lvl.level} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Level {lvl.level}</span>
                  <span className="text-muted-foreground">
                    quantum {lvl.quantumMs} ms · {lvl.jobIds.length} jobs
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {lvl.jobIds.length ? (
                    lvl.jobIds.map((id) => (
                      <span
                        key={id}
                        className="rounded bg-primary/15 px-2 py-0.5 text-xs text-primary tabular-nums"
                      >
                        #{id}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">empty</span>
                  )}
                </div>
              </div>
            ))}
            {!queues.data?.levels.length && (
              <p className="text-sm text-muted-foreground">No queue data available.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Policy impact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Metric label="Avg waiting" value={fmtMs(metrics.data?.avgWaitingMs ?? 0)} />
            <Metric label="Avg turnaround" value={fmtMs(metrics.data?.avgTurnaroundMs ?? 0)} />
            <Metric label="Avg response" value={fmtMs(metrics.data?.avgResponseMs ?? 0)} />
            <Metric
              label="CPU utilisation"
              value={`${(metrics.data?.cpuUtilization ?? 0).toFixed(1)}%`}
            />
            <Metric label="Context switches" value={String(metrics.data?.contextSwitches ?? 0)} />
            <Metric label="Preemptions" value={String(metrics.data?.preemptions ?? 0)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent scheduling decisions</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[320px] space-y-2 overflow-auto text-sm">
            {(queues.data?.decisions ?? []).map((d, i) => (
              <div key={i} className="rounded-md border border-border px-3 py-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    Job #{d.jobId} · level {d.queueLevel}
                  </span>
                  <span>score {d.score.toFixed(2)}</span>
                </div>
                <p className="mt-1">{d.reason}</p>
              </div>
            ))}
            {!queues.data?.decisions.length && (
              <p className="text-muted-foreground">No decisions recorded yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
