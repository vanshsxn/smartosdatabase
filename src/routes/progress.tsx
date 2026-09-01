import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppLayout } from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { jobsQuery } from "@/lib/engine-queries";
import {
  WALKTHROUGH_STEPS,
  fetchJobProgress,
  fetchWalkthrough,
  recordJobSnapshots,
  setWalkthroughStep,
} from "@/lib/progress";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/progress")({
  head: () => ({
    meta: [
      { title: "Progress | Smart Cloud Task Engine" },
      {
        name: "description",
        content:
          "Track onboarding walkthrough steps and per-job execution progress saved in your workspace.",
      },
      { property: "og:title", content: "Progress | Smart Cloud Task Engine" },
      {
        property: "og:description",
        content:
          "Track onboarding walkthrough steps and per-job execution progress saved in your workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProgressPage,
});

function ProgressPage() {
  const { user, tenantId } = useSession();
  const qc = useQueryClient();
  const [autoCapture, setAutoCapture] = useState(false);

  const walkthrough = useQuery({
    queryKey: ["progress", "walkthrough", user?.id],
    queryFn: fetchWalkthrough,
    enabled: Boolean(user),
  });

  const jobProgress = useQuery({
    queryKey: ["progress", "jobs", user?.id],
    queryFn: () => fetchJobProgress(300),
    enabled: Boolean(user),
    refetchInterval: autoCapture ? 10_000 : false,
  });

  const jobs = useQuery({ ...jobsQuery(tenantId), refetchInterval: autoCapture ? 10_000 : 5000 });

  const toggleStep = useMutation({
    mutationFn: async ({ key, completed }: { key: string; completed: boolean }) => {
      if (!user) throw new Error("Not signed in");
      await setWalkthroughStep(user.id, key, completed);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["progress", "walkthrough"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save step"),
  });

  const capture = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      return recordJobSnapshots(user.id, jobs.data ?? []);
    },
    onSuccess: (count) => {
      toast.success(`Recorded ${count} job progress snapshot${count === 1 ? "" : "s"}.`);
      void qc.invalidateQueries({ queryKey: ["progress", "jobs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Snapshot failed"),
  });

  const done = useMemo(() => {
    const map = new Map(walkthrough.data?.map((r) => [r.step_key, r.completed]) ?? []);
    return map;
  }, [walkthrough.data]);

  const completedCount = WALKTHROUGH_STEPS.filter((s) => done.get(s.key)).length;
  const pct = Math.round((completedCount / WALKTHROUGH_STEPS.length) * 100);

  const latestPerJob = useMemo(() => {
    const map = new Map<string, NonNullable<typeof jobProgress.data>[number]>();
    for (const row of jobProgress.data ?? []) {
      if (!map.has(row.job_id)) map.set(row.job_id, row);
    }
    return [...map.values()];
  }, [jobProgress.data]);

  return (
    <AppLayout title="Progress">
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Getting started walkthrough</CardTitle>
            <Badge variant="secondary">
              {completedCount}/{WALKTHROUGH_STEPS.length} complete
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={pct} />
            <ul className="space-y-2">
              {WALKTHROUGH_STEPS.map((step) => {
                const complete = Boolean(done.get(step.key));
                return (
                  <li
                    key={step.key}
                    className="flex items-start gap-3 rounded-lg border border-border p-3"
                  >
                    <button
                      type="button"
                      aria-label={complete ? `Mark ${step.title} incomplete` : `Mark ${step.title} complete`}
                      onClick={() => toggleStep.mutate({ key: step.key, completed: !complete })}
                      className="mt-0.5 text-primary"
                    >
                      {complete ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : (
                        <Circle className="h-5 w-5 text-muted-foreground" />
                      )}
                    </button>
                    <div className="flex-1 space-y-0.5">
                      <p className="text-sm font-medium">{step.title}</p>
                      <p className="text-xs text-muted-foreground">{step.description}</p>
                    </div>
                    <Button asChild size="sm" variant="ghost">
                      <Link to={step.href}>Open</Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Job progress history</CardTitle>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={autoCapture} onCheckedChange={setAutoCapture} />
                Auto refresh
              </label>
              <Button
                size="sm"
                onClick={() => capture.mutate()}
                disabled={capture.isPending || !(jobs.data?.length ?? 0)}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Capture snapshot
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {latestPerJob.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No progress recorded yet. Submit a job, then capture a snapshot.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Tenant</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="w-48">Progress</TableHead>
                    <TableHead>Recorded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {latestPerJob.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.job_name ?? row.job_id}</TableCell>
                      <TableCell className="text-muted-foreground">{row.job_type ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{row.tenant_id ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.state}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={Number(row.percent)} className="h-2" />
                          <span className="w-10 text-right text-xs text-muted-foreground">
                            {Math.round(Number(row.percent))}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(row.created_at).toLocaleTimeString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
