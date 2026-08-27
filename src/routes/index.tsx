import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Cpu,
  Database,
  HardDrive,
  Layers,
  LayoutDashboard,
  List,
  Play,
  RefreshCw,
  Server,
  Settings,
  Trash2,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import {
  cancelJob,
  getHealth,
  getJobs,
  getLogs,
  getMemory,
  getMetrics,
  getQueueState,
  getResources,
  setCredits,
  setPolicy,
  submitJob,
} from "@/lib/engine";
import type { Job, JobPriority, LogEntry, MemoryBlock, QueueLevel, SchedulingDecision } from "@/lib/engine.types";

const REFETCH_INTERVAL = 2000;

const healthQueryOptions = {
  queryKey: ["engine", "health"],
  queryFn: getHealth,
  refetchInterval: REFETCH_INTERVAL,
  retry: false,
};

const jobsQueryOptions = {
  queryKey: ["engine", "jobs"],
  queryFn: () => getJobs(),
  refetchInterval: REFETCH_INTERVAL,
  enabled: typeof window !== "undefined",
};

const metricsQueryOptions = {
  queryKey: ["engine", "metrics"],
  queryFn: getMetrics,
  refetchInterval: REFETCH_INTERVAL,
  enabled: typeof window !== "undefined",
};

const resourcesQueryOptions = {
  queryKey: ["engine", "resources"],
  queryFn: getResources,
  refetchInterval: REFETCH_INTERVAL,
  enabled: typeof window !== "undefined",
};

const memoryQueryOptions = {
  queryKey: ["engine", "memory"],
  queryFn: getMemory,
  refetchInterval: REFETCH_INTERVAL,
  enabled: typeof window !== "undefined",
};

const queuesQueryOptions = {
  queryKey: ["engine", "queues"],
  queryFn: getQueueState,
  refetchInterval: REFETCH_INTERVAL,
  enabled: typeof window !== "undefined",
};

const logsQueryOptions = {
  queryKey: ["engine", "logs"],
  queryFn: () => getLogs(undefined, 50),
  refetchInterval: REFETCH_INTERVAL,
  enabled: typeof window !== "undefined",
};

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MV CloudCore Dashboard" },
      { name: "description", content: "Monitor and control the MV CloudCore scheduling engine." },
      { property: "og:title", content: "MV CloudCore Dashboard" },
      { property: "og:description", content: "Monitor and control the MV CloudCore scheduling engine." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
  pendingComponent: DashboardSkeleton,
});

function DashboardSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex items-center gap-2 text-muted-foreground">
        <RefreshCw className="h-5 w-5 animate-spin" />
        <span>Loading dashboard...</span>
      </div>
    </div>
  );
}

function Dashboard() {
  const queryClient = useQueryClient();

  const { data: health, isError: healthError } = useQuery(healthQueryOptions);
  const { data: jobs = [] } = useQuery(jobsQueryOptions);
  const { data: metrics } = useQuery(metricsQueryOptions);
  const { data: resources } = useQuery(resourcesQueryOptions);
  const { data: memory } = useQuery(memoryQueryOptions);
  const { data: queues } = useQuery(queuesQueryOptions);
  const { data: logs = [] } = useQuery(logsQueryOptions);

  const submitMutation = useMutation({
    mutationFn: submitJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["engine"] }),
  });

  const cancelMutation = useMutation({
    mutationFn: cancelJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["engine"] }),
  });

  const policyMutation = useMutation({
    mutationFn: setPolicy,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["engine"] }),
  });

  const creditsMutation = useMutation({
    mutationFn: setCredits,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["engine"] }),
  });

  const engineConnected = !!health && !healthError;

  return (
    <div className="min-h-screen bg-background pb-12">
      <header className="border-b bg-card/50 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <LayoutDashboard className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-none tracking-tight">MV CloudCore</h1>
              <p className="text-xs text-muted-foreground">Engine dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge connected={engineConnected} policy={health?.policy} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["engine"] })}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {healthError && (
          <Alert variant="error">
            <AlertCircle className="h-4 w-4" />
            <span>Engine is not reachable. Make sure the engine is running on port 9090 or set ENGINE_URL.</span>
          </Alert>
        )}

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Running Jobs"
            value={metrics?.running ?? 0}
            icon={<Play className="h-4 w-4 text-emerald-500" />}
          />
          <MetricCard
            title="Queued Jobs"
            value={metrics?.queued ?? 0}
            icon={<Layers className="h-4 w-4 text-amber-500" />}
          />
          <MetricCard
            title="Completed"
            value={metrics?.completed ?? 0}
            icon={<CheckCircle2 className="h-4 w-4 text-blue-500" />}
          />
          <MetricCard
            title="Failed / Cancelled"
            value={`${metrics?.failed ?? 0} / ${metrics?.cancelled ?? 0}`}
            icon={<XCircle className="h-4 w-4 text-destructive" />}
          />
        </section>

        <Tabs defaultValue="jobs" className="space-y-4">
          <TabsList>
            <TabsTrigger value="jobs"><List className="mr-2 h-4 w-4" /> Jobs</TabsTrigger>
            <TabsTrigger value="resources"><Server className="mr-2 h-4 w-4" /> Resources</TabsTrigger>
            <TabsTrigger value="memory"><HardDrive className="mr-2 h-4 w-4" /> Memory</TabsTrigger>
            <TabsTrigger value="queues"><Layers className="mr-2 h-4 w-4" /> Queues</TabsTrigger>
            <TabsTrigger value="logs"><Activity className="mr-2 h-4 w-4" /> Logs</TabsTrigger>
            <TabsTrigger value="settings"><Settings className="mr-2 h-4 w-4" /> Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="jobs" className="space-y-4">
            <SubmitJobCard onSubmit={(job) => submitMutation.mutate(job)} />
            <JobsTable jobs={jobs} onCancel={(id) => cancelMutation.mutate(id)} />
          </TabsContent>

          <TabsContent value="resources" className="space-y-4">
            <ResourcesCards resources={resources} metrics={metrics} />
          </TabsContent>

          <TabsContent value="memory" className="space-y-4">
            <MemorySection memory={memory} />
          </TabsContent>

          <TabsContent value="queues" className="space-y-4">
            <QueuesSection queues={queues} />
          </TabsContent>

          <TabsContent value="logs" className="space-y-4">
            <LogsSection logs={logs} />
          </TabsContent>

          <TabsContent value="settings" className="space-y-4">
            <SettingsSection
              currentPolicy={health?.policy ?? "MLFQ"}
              onSetPolicy={(policy) => policyMutation.mutate({ policy })}
              onSetCredits={(tenantId, credits) => creditsMutation.mutate({ tenantId, credits })}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function StatusBadge({ connected, policy }: { connected: boolean; policy?: string | undefined }) {
  return (
    <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-sm">
      <span className={cn("h-2 w-2 rounded-full", connected ? "bg-emerald-500" : "bg-destructive")} />
      <span className="text-muted-foreground">{connected ? "Engine online" : "Engine offline"}</span>
      {policy && (
        <>
          <Separator orientation="vertical" className="h-4" />
          <span className="font-medium">{policy}</span>
        </>
      )}
    </div>
  );
}

function Alert({ variant, children }: { variant?: "error" | "info"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-4 py-3 text-sm",
        variant === "error"
          ? "border-destructive/20 bg-destructive/10 text-destructive"
          : "border-blue-500/20 bg-blue-500/10 text-blue-600"
      )}
    >
      {children}
    </div>
  );
}

function MetricCard({ title, value, icon }: { title: string; value: string | number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function SubmitJobCard({ onSubmit }: { onSubmit: (job: { name: string; priority: JobPriority; requestedCores: number; requestedMemoryMb: number; estimatedMs: number; tenantId: string; userId: string }) => void }) {
  const [name, setName] = useState("demo-job");
  const [priority, setPriority] = useState<JobPriority>("MEDIUM");
  const [cores, setCores] = useState(1);
  const [memoryMb, setMemoryMb] = useState(256);
  const [estimatedMs, setEstimatedMs] = useState(1000);
  const [tenantId, setTenantId] = useState("tenant-a");
  const [userId, setUserId] = useState("user-1");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      priority,
      requestedCores: cores,
      requestedMemoryMb: memoryMb,
      estimatedMs,
      tenantId,
      userId,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Play className="h-4 w-4" /> Submit Job
        </CardTitle>
        <CardDescription>Create a new job and send it to the engine.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="priority">Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as JobPriority)}>
              <SelectTrigger id="priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LOW">LOW</SelectItem>
                <SelectItem value="MEDIUM">MEDIUM</SelectItem>
                <SelectItem value="HIGH">HIGH</SelectItem>
                <SelectItem value="CRITICAL">CRITICAL</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cores">Cores</Label>
            <Input id="cores" type="number" min={1} value={cores} onChange={(e) => setCores(Number(e.target.value))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="memory">Memory (MB)</Label>
            <Input id="memory" type="number" min={1} value={memoryMb} onChange={(e) => setMemoryMb(Number(e.target.value))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="estimated">Estimated (ms)</Label>
            <Input id="estimated" type="number" min={1} value={estimatedMs} onChange={(e) => setEstimatedMs(Number(e.target.value))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tenant">Tenant</Label>
            <Input id="tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="user">User</Label>
            <Input id="user" value={userId} onChange={(e) => setUserId(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button type="submit" className="w-full">
              Submit Job
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function JobsTable({ jobs, onCancel }: { jobs: Job[]; onCancel: (id: number) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <List className="h-4 w-4" /> Jobs ({jobs.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Cores</TableHead>
                <TableHead>Memory</TableHead>
                <TableHead>Remaining</TableHead>
                <TableHead>Queue</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    No jobs yet.
                  </TableCell>
                </TableRow>
              )}
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-mono text-xs">{job.id}</TableCell>
                  <TableCell className="font-medium">{job.name}</TableCell>
                  <TableCell><StatusBadgeForJob status={job.status} /></TableCell>
                  <TableCell>{job.priority}</TableCell>
                  <TableCell>{job.requestedCores}</TableCell>
                  <TableCell>{job.requestedMemoryMb} MB</TableCell>
                  <TableCell>{job.remainingMs} ms</TableCell>
                  <TableCell>L{job.queueLevel}</TableCell>
                  <TableCell className="text-right">
                    {(job.status === "PENDING" || job.status === "QUEUED" || job.status === "RUNNING") && (
                      <Button variant="ghost" size="icon" onClick={() => onCancel(job.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadgeForJob({ status }: { status: Job["status"] }) {
  const variantMap: Record<Job["status"], string> = {
    PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    QUEUED: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    RUNNING: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    COMPLETED: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    FAILED: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    CANCELLED: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  };
  return <Badge className={cn("font-medium", variantMap[status])}>{status}</Badge>;
}

function ResourcesCards({ resources, metrics }: { resources?: Awaited<ReturnType<typeof getResources>> | undefined; metrics?: Awaited<ReturnType<typeof getMetrics>> | undefined }) {
  if (!resources) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="h-4 w-4" /> CPU
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ResourceBar used={resources.usedCores} total={resources.totalCores} label="Cores" />
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div><div className="text-muted-foreground">Total</div><div className="font-semibold">{resources.totalCores}</div></div>
            <div><div className="text-muted-foreground">Used</div><div className="font-semibold">{resources.usedCores}</div></div>
            <div><div className="text-muted-foreground">Free</div><div className="font-semibold">{resources.freeCores}</div></div>
          </div>
          <div className="text-sm"><span className="text-muted-foreground">Utilization:</span> <span className="font-semibold">{(resources.cpuUtilization * 100).toFixed(1)}%</span></div>
          {metrics && <div className="text-sm"><span className="text-muted-foreground">Throughput:</span> <span className="font-semibold">{metrics.throughputPerMin.toFixed(1)}/min</span></div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" /> Memory
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ResourceBar used={resources.usedMemoryMb} total={resources.totalMemoryMb} label="Memory (MB)" />
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div><div className="text-muted-foreground">Total</div><div className="font-semibold">{resources.totalMemoryMb} MB</div></div>
            <div><div className="text-muted-foreground">Used</div><div className="font-semibold">{resources.usedMemoryMb} MB</div></div>
            <div><div className="text-muted-foreground">Free</div><div className="font-semibold">{resources.freeMemoryMb} MB</div></div>
          </div>
          <div className="text-sm"><span className="text-muted-foreground">Utilization:</span> <span className="font-semibold">{(resources.memoryUtilization * 100).toFixed(1)}%</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="h-4 w-4" /> Thread Pool
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><div className="text-muted-foreground">Workers</div><div className="font-semibold">{resources.threadPoolWorkers}</div></div>
            <div><div className="text-muted-foreground">Active</div><div className="font-semibold">{resources.threadPoolActive}</div></div>
            <div><div className="text-muted-foreground">Queued</div><div className="font-semibold">{resources.threadPoolQueued}</div></div>
            <div><div className="text-muted-foreground">Completed</div><div className="font-semibold">{resources.threadPoolCompleted}</div></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" /> Scheduler Metrics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <MetricRow label="Avg waiting" value={metrics ? `${metrics.avgWaitingMs.toFixed(1)} ms` : "—"} />
          <MetricRow label="Avg turnaround" value={metrics ? `${metrics.avgTurnaroundMs.toFixed(1)} ms` : "—"} />
          <MetricRow label="Avg response" value={metrics ? `${metrics.avgResponseMs.toFixed(1)} ms` : "—"} />
          <MetricRow label="Context switches" value={metrics?.contextSwitches ?? 0} />
          <MetricRow label="Preemptions" value={metrics?.preemptions ?? 0} />
        </CardContent>
      </Card>
    </div>
  );
}

function ResourceBar({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{used} / {total}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function MemorySection({ memory }: { memory?: Awaited<ReturnType<typeof getMemory>> | undefined }) {
  if (!memory) return null;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HardDrive className="h-4 w-4" /> Memory Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <MetricCard title="Total" value={`${memory.totalMb} MB`} icon={<HardDrive className="h-4 w-4" />} />
          <MetricCard title="Used" value={`${memory.usedMb} MB`} icon={<Database className="h-4 w-4" />} />
          <MetricCard title="Free" value={`${memory.freeMb} MB`} icon={<CheckCircle2 className="h-4 w-4" />} />
          <MetricCard title="Largest Free" value={`${memory.largestFreeMb} MB`} icon={<Layers className="h-4 w-4" />} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Memory Blocks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Base</TableHead>
                  <TableHead>Size (MB)</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Owner Job</TableHead>
                  <TableHead>Owner Name</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memory.blocks.map((block: MemoryBlock, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="font-mono text-xs">{block.base}</TableCell>
                    <TableCell>{block.sizeMb}</TableCell>
                    <TableCell>
                      <Badge className={block.free ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}>
                        {block.free ? "Free" : "Allocated"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{block.ownerJobId || "—"}</TableCell>
                    <TableCell>{block.ownerName || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function QueuesSection({ queues }: { queues?: Awaited<ReturnType<typeof getQueueState>> | undefined }) {
  if (!queues) return null;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Queue Levels</CardTitle>
          <CardDescription>Current scheduler policy: {queues.policy}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {queues.levels.map((level: QueueLevel) => (
              <Card key={level.level} className="border bg-muted/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Level {level.level}</CardTitle>
                  <CardDescription>Quantum: {level.quantumMs} ms</CardDescription>
                </CardHeader>
                <CardContent>
                  {level.jobIds.length === 0 ? (
                    <span className="text-sm text-muted-foreground">Empty</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {level.jobIds.map((id) => (
                        <Badge key={id} variant="secondary" className="font-mono">
                          {id}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Scheduling Decisions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job ID</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Policy</TableHead>
                  <TableHead>Queue</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queues.decisions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">No recent decisions.</TableCell>
                  </TableRow>
                )}
                {queues.decisions.map((decision: SchedulingDecision, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="font-mono text-xs">{decision.jobId}</TableCell>
                    <TableCell>{decision.score.toFixed(3)}</TableCell>
                    <TableCell>{decision.policy}</TableCell>
                    <TableCell>L{decision.queueLevel}</TableCell>
                    <TableCell className="max-w-xs truncate">{decision.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LogsSection({ logs }: { logs: LogEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent Logs</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-[500px] overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs">
          {logs.length === 0 && <div className="text-muted-foreground">No logs available.</div>}
          {logs.map((log, idx) => (
            <div key={idx} className="flex gap-3 py-1">
              <span className="shrink-0 text-muted-foreground">{new Date(log.timestampMs).toLocaleTimeString()}</span>
              <Badge className={cn("shrink-0", logLevelClass(log.level))}>{log.level}</Badge>
              <span className="shrink-0 text-muted-foreground">{log.source}</span>
              <span className="text-muted-foreground">[job:{log.jobId ?? "—"}]</span>
              <span>{log.message}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function logLevelClass(level: string) {
  switch (level.toUpperCase()) {
    case "ERROR": return "bg-red-100 text-red-700";
    case "WARN": return "bg-amber-100 text-amber-700";
    case "INFO": return "bg-blue-100 text-blue-700";
    case "DEBUG": return "bg-slate-100 text-slate-700";
    default: return "bg-muted text-muted-foreground";
  }
}

function SettingsSection({
  currentPolicy,
  onSetPolicy,
  onSetCredits,
}: {
  currentPolicy: string;
  onSetPolicy: (policy: string) => void;
  onSetCredits: (tenantId: string, credits: number) => void;
}) {
  const [policy, setPolicy] = useState(currentPolicy);
  const [tenantId, setTenantId] = useState("tenant-a");
  const [credits, setCredits] = useState(100);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduler Policy</CardTitle>
          <CardDescription>Switch the active scheduling algorithm.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={policy} onValueChange={setPolicy}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MLFQ">MLFQ</SelectItem>
              <SelectItem value="ADAPTIVE">ADAPTIVE</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => onSetPolicy(policy)} className="w-full">
            Apply Policy
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tenant Credits</CardTitle>
          <CardDescription>Top up a tenant credit balance.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="credit-tenant">Tenant</Label>
            <Input id="credit-tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="credit-amount">Credits</Label>
            <Input id="credit-amount" type="number" value={credits} onChange={(e) => setCredits(Number(e.target.value))} />
          </div>
          <Button onClick={() => onSetCredits(tenantId, credits)} className="w-full">
            Set Credits
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
