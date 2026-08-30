import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2,
  FileText,
  Pause,
  Play,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { AppLayout } from "@/components/AppLayout";
import {
  EngineOffline,
  Gauge,
  PriorityText,
  StatCard,
  StatusText,
  fmtMs,
  fmtTime,
} from "@/components/dashboard-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { setEnginePaused } from "@/lib/engine";
import {
  healthQuery,
  jobsQuery,
  memoryQuery,
  metricsQuery,
  queuesQuery,
  resourcesQuery,
  tenantCreditsQuery,
} from "@/lib/engine-queries";
import { TENANTS, tenantName, useSession } from "@/lib/session";
import { useEngineStream } from "@/lib/engine-stream";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard | Smart Cloud Task Engine" },
      {
        name: "description",
        content:
          "Live scheduler dashboard: CPU and memory charts, job status, queues, tenants and throughput.",
      },
      { property: "og:title", content: "Dashboard | Smart Cloud Task Engine" },
      {
        property: "og:description",
        content:
          "Live scheduler dashboard: CPU and memory charts, job status, queues, tenants and throughput.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { tenantId } = useSession();
  const qc = useQueryClient();
  const health = useQuery(healthQuery);
  const metrics = useQuery(metricsQuery);
  const resources = useQuery(resourcesQuery);
  const memory = useQuery(memoryQuery);
  const queues = useQuery(queuesQuery);
  const jobs = useQuery(jobsQuery(tenantId));
  const credits = useQuery(tenantCreditsQuery);

  // Continuous updates come from the SSE stream (1 Hz), not from polling.
  const { history, snapshot } = useEngineStream();

  const pause = useMutation({
    mutationFn: (paused: boolean) => setEnginePaused(paused),
    onSuccess: (res) => {
      toast.success(res.paused ? "Engine paused" : "Engine resumed");
      qc.invalidateQueries({ queryKey: ["engine"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const m = snapshot?.metrics ?? metrics.data;
  const r = snapshot?.resources ?? resources.data;
  const streamJobs = snapshot?.jobs;
  const jobList =
    streamJobs && streamJobs.length
      ? tenantId
        ? streamJobs.filter((j) => j.tenantId === tenantId)
        : streamJobs
      : (jobs.data ?? []);
  const total = jobList.length;

  const statusData = m
    ? [
        { name: "Running", value: m.running, color: "var(--color-success)" },
        { name: "Completed", value: m.completed, color: "var(--color-primary)" },
        { name: "Waiting", value: m.queued, color: "var(--color-warning)" },
        { name: "Rejected", value: m.failed + m.cancelled, color: "var(--color-destructive)" },
      ].filter((d) => d.value > 0)
    : [];

  const perJob = jobList
    .filter((j) => j.status === "RUNNING" || j.status === "QUEUED")
    .slice(0, 8)
    .map((j) => ({
      name: `#${j.id}`,
      cpu: r ? (j.requestedCores / Math.max(1, r.totalCores)) * 100 : 0,
      memory: r ? (j.requestedMemoryMb / Math.max(1, r.totalMemoryMb)) * 100 : 0,
    }));

  const creditMap = new Map((credits.data ?? []).map((c) => [c.tenantId, c.credits]));
  const usedByTenant = new Map<string, number>();
  for (const j of jobList) {
    usedByTenant.set(j.tenantId, (usedByTenant.get(j.tenantId) ?? 0) + (j.creditsCharged || 0));
  }

  return (
    <AppLayout title="Dashboard">
      {health.isError || health.data?.reachable === false ? <EngineOffline /> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Total Jobs"
          value={total}
          sub={`${m?.queued ?? 0} in queue`}
          icon={<FileText className="h-5 w-5" />}
        />
        <StatCard
          label="Running Jobs"
          value={m?.running ?? 0}
          sub={`${health.data?.workers ?? 0} workers`}
          tone="success"
          icon={<Play className="h-5 w-5" />}
        />
        <StatCard
          label="Completed Jobs"
          value={m?.completed ?? 0}
          sub={`${(m?.throughputPerMin ?? 0).toFixed(1)} jobs/min`}
          tone="info"
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
        <StatCard
          label="Rejected Jobs"
          value={(m?.failed ?? 0) + (m?.cancelled ?? 0)}
          sub="failed + cancelled"
          tone="destructive"
          icon={<XCircle className="h-5 w-5" />}
        />
        <StatCard
          label="System Load"
          value={`${(r?.cpuUtilization ?? 0).toFixed(0)}%`}
          sub={health.data?.paused ? "Paused" : "Healthy"}
          tone="warning"
          icon={<TrendingUp className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">System Resource Usage</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap justify-around gap-4">
            <Gauge
              value={r?.cpuUtilization ?? 0}
              label="CPU Usage"
              detail={`${r?.usedCores ?? 0} / ${r?.totalCores ?? 0} Cores`}
              color="var(--color-chart-1)"
            />
            <Gauge
              value={r?.memoryUtilization ?? 0}
              label="RAM Usage"
              detail={`${(((r?.usedMemoryMb ?? 0) / 1024)).toFixed(1)} / ${(((r?.totalMemoryMb ?? 0) / 1024)).toFixed(0)} GB`}
              color="var(--color-chart-2)"
            />
            <Gauge
              value={memory.data?.utilization ?? 0}
              label="Memory Pool"
              detail={`${memory.data?.usedBlocks ?? 0} blocks used`}
              color="var(--color-chart-3)"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Scheduler Summary</CardTitle>
            <Button
              size="sm"
              variant={health.data?.paused ? "default" : "outline"}
              disabled={pause.isPending}
              onClick={() => pause.mutate(!health.data?.paused)}
            >
              {health.data?.paused ? (
                <>
                  <Play className="mr-1.5 h-3.5 w-3.5" /> Resume
                </>
              ) : (
                <>
                  <Pause className="mr-1.5 h-3.5 w-3.5" /> Pause
                </>
              )}
            </Button>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <Row label="Scheduler Type" value={m?.policy ?? "—"} />
            <Row
              label="Algorithm"
              value={
                m?.policy === "ADAPTIVE"
                  ? "Hybrid (Priority + Resource + Credit)"
                  : "Multi-Level Feedback Queue"
              }
            />
            <Row label="Context Switches" value={String(m?.contextSwitches ?? 0)} />
            <Row label="Preemptions" value={String(m?.preemptions ?? 0)} />
            <Row label="Avg. Waiting Time" value={fmtMs(m?.avgWaitingMs ?? 0)} />
            <Row label="Avg. Turnaround" value={fmtMs(m?.avgTurnaroundMs ?? 0)} />
            <Row label="Throughput" value={`${(m?.throughputPerMin ?? 0).toFixed(1)} jobs/min`} />
            <Row label="Queue Levels" value={String(queues.data?.levels.length ?? 0)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Job Status Distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-[240px]">
            {statusData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {statusData.map((d) => (
                      <Cell key={d.name} fill={d.color} stroke="transparent" />
                    ))}
                  </Pie>
                  <Legend verticalAlign="middle" align="right" layout="vertical" />
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="pt-16 text-center text-sm text-muted-foreground">No jobs yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              CPU &amp; RAM Usage <span className="text-muted-foreground">(live)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="label" tick={axisTick} minTickGap={30} />
                <YAxis domain={[0, 100]} unit="%" tick={axisTick} width={44} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="cpu"
                  name="CPU Usage (%)"
                  stroke="var(--color-chart-1)"
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="memory"
                  name="RAM Usage (%)"
                  stroke="var(--color-chart-2)"
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Job Throughput</CardTitle>
          </CardHeader>
          <CardContent className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="tp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-chart-3)" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="var(--color-chart-3)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="label" tick={axisTick} minTickGap={30} />
                <YAxis tick={axisTick} width={36} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="throughput"
                  name="Jobs/min"
                  stroke="var(--color-chart-3)"
                  fill="url(#tp)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Per-Job Resource Share (active jobs)</CardTitle>
        </CardHeader>
        <CardContent className="h-[220px]">
          {perJob.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perJob}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="name" tick={axisTick} />
                <YAxis unit="%" tick={axisTick} width={44} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Bar dataKey="cpu" name="CPU share (%)" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="memory" name="RAM share (%)" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="pt-16 text-center text-sm text-muted-foreground">No active jobs</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent Jobs</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job ID</TableHead>
                  <TableHead>Job Name</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>CPU</TableHead>
                  <TableHead>RAM</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobList.slice(0, 6).map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="tabular-nums">{j.id}</TableCell>
                    <TableCell>{j.name}</TableCell>
                    <TableCell>{tenantName(j.tenantId)}</TableCell>
                    <TableCell>
                      <PriorityText priority={j.priority} />
                    </TableCell>
                    <TableCell>
                      <StatusText status={j.status} />
                    </TableCell>
                    <TableCell>{j.requestedCores} core</TableCell>
                    <TableCell>{j.requestedMemoryMb} MB</TableCell>
                    <TableCell>{fmtTime(j.submittedAtMs)}</TableCell>
                  </TableRow>
                ))}
                {!jobList.length && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      No jobs submitted yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <div className="pt-3 text-center">
              <Link to="/jobs" className="text-sm text-primary hover:underline">
                View All Jobs →
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top Tenants</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Used</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TENANTS.map((t) => {
                  const totalCredits = creditMap.get(t.id) ?? t.totalCredits;
                  const used = Math.round(usedByTenant.get(t.id) ?? 0);
                  const remaining = Math.max(0, Math.round(totalCredits - used));
                  return (
                    <TableRow key={t.id}>
                      <TableCell>{t.name}</TableCell>
                      <TableCell className="tabular-nums">{used}</TableCell>
                      <TableCell className="tabular-nums">{Math.round(totalCredits)}</TableCell>
                      <TableCell className="text-right tabular-nums">{remaining}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="pt-3 text-center">
              <Link to="/tenants" className="text-sm text-primary hover:underline">
                View All Tenants →
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-primary">{value}</span>
    </div>
  );
}

export const tooltipStyle = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  color: "var(--color-popover-foreground)",
} as const;

export const axisTick = { fill: "var(--color-muted-foreground)", fontSize: 11 } as const;
