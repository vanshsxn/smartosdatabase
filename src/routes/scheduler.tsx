import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  Clock,
  Cpu,
  Layers,
  ListOrdered,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppLayout } from "@/components/AppLayout";
import { JobRequestList, useJobRequests } from "@/components/JobRequests";
import { fmtMs } from "@/components/dashboard-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { setEnginePaused, setPolicy } from "@/lib/engine";
import { healthQuery, jobsQuery, metricsQuery, queuesQuery } from "@/lib/engine-queries";
import type { Job, JobPriority } from "@/lib/engine.types";
import { JOB_PRESETS, resourcesFor } from "@/lib/job-presets";
import { requestJob } from "@/lib/job-requests.functions";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/scheduler")({
  head: () => ({
    meta: [
      { title: "Scheduler | Smart Cloud Task Engine" },
      {
        name: "description",
        content:
          "Multi-Level Feedback Queue (MLFQ) visual CPU scheduler: inspect job-to-process conversion, ready queue pipeline, and time quantums.",
      },
      { property: "og:title", content: "Scheduler | Smart Cloud Task Engine" },
      {
        property: "og:description",
        content:
          "Multi-Level Feedback Queue (MLFQ) visual CPU scheduler: inspect job-to-process conversion, ready queue pipeline, and time quantums.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SchedulerPage,
});

interface ProcessInfo {
  pid: string; // P1, P2, P3...
  pIndex: number;
  jobId: number;
  jobName: string;
  jobType: string;
  priority: JobPriority;
  status: "QUEUED" | "READY" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  queueLevel: number;
  quantumMs: number;
  requestedCores: number;
  requestedMemoryMb: number;
  estimatedMs: number;
  cpuTimeUsedMs: number;
  waitingMs: number;
  contextSwitches: number;
  preemptions: number;
  submittedAtMs: number;
  color: {
    badge: string;
    border: string;
    bg: string;
    text: string;
    indicator: string;
  };
}

const PROCESS_COLORS = [
  {
    badge: "bg-blue-600 text-white dark:bg-blue-500",
    border: "border-blue-500/50 hover:border-blue-500",
    bg: "bg-blue-50/80 dark:bg-blue-950/25",
    text: "text-blue-700 dark:text-blue-300",
    indicator: "bg-blue-500",
  },
  {
    badge: "bg-emerald-600 text-white dark:bg-emerald-500",
    border: "border-emerald-500/50 hover:border-emerald-500",
    bg: "bg-emerald-50/80 dark:bg-emerald-950/25",
    text: "text-emerald-700 dark:text-emerald-300",
    indicator: "bg-emerald-500",
  },
  {
    badge: "bg-amber-600 text-white dark:bg-amber-500",
    border: "border-amber-500/50 hover:border-amber-500",
    bg: "bg-amber-50/80 dark:bg-amber-950/25",
    text: "text-amber-700 dark:text-amber-300",
    indicator: "bg-amber-500",
  },
  {
    badge: "bg-purple-600 text-white dark:bg-purple-500",
    border: "border-purple-500/50 hover:border-purple-500",
    bg: "bg-purple-50/80 dark:bg-purple-950/25",
    text: "text-purple-700 dark:text-purple-300",
    indicator: "bg-purple-500",
  },
  {
    badge: "bg-rose-600 text-white dark:bg-rose-500",
    border: "border-rose-500/50 hover:border-rose-500",
    bg: "bg-rose-50/80 dark:bg-rose-950/25",
    text: "text-rose-700 dark:text-rose-300",
    indicator: "bg-rose-500",
  },
  {
    badge: "bg-cyan-600 text-white dark:bg-cyan-500",
    border: "border-cyan-500/50 hover:border-cyan-500",
    bg: "bg-cyan-50/80 dark:bg-cyan-950/25",
    text: "text-cyan-700 dark:text-cyan-300",
    indicator: "bg-cyan-500",
  },
  {
    badge: "bg-indigo-600 text-white dark:bg-indigo-500",
    border: "border-indigo-500/50 hover:border-indigo-500",
    bg: "bg-indigo-50/80 dark:bg-indigo-950/25",
    text: "text-indigo-700 dark:text-indigo-300",
    indicator: "bg-indigo-500",
  },
  {
    badge: "bg-orange-600 text-white dark:bg-orange-500",
    border: "border-orange-500/50 hover:border-orange-500",
    bg: "bg-orange-50/80 dark:bg-orange-950/25",
    text: "text-orange-700 dark:text-orange-300",
    indicator: "bg-orange-500",
  },
];

const LEVEL_QUANTUMS: Record<number, number> = {
  0: 40,
  1: 80,
  2: 160,
  3: 320,
};

function SchedulerPage() {
  const qc = useQueryClient();
  const { isAdmin } = useSession();
  const health = useQuery(healthQuery);
  const metrics = useQuery(metricsQuery);
  const queues = useQuery(queuesQuery);
  const jobs = useQuery(jobsQuery(""));
  const jobRequests = useJobRequests();

  const [queueView, setQueueView] = useState<"active" | "all">("active");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedType, setSelectedType] = useState(JOB_PRESETS[0]!.type);
  const [customName, setCustomName] = useState("");
  const [selectedPriority, setSelectedPriority] = useState<JobPriority>("MEDIUM");
  const [pauseBeforeAdding, setPauseBeforeAdding] = useState(false);

  const sendJobRequest = useServerFn(requestJob);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["engine"] });
    qc.invalidateQueries({ queryKey: ["job-requests"] });
  };

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

  // Transform Jobs into Process Control Blocks (P1, P2, P3...)
  const { allProcesses, activeProcesses, jobIdToProcess } = useMemo(() => {
    const rawJobs: Job[] = [...(jobs.data ?? [])];

    // Also include pending job_requests if they haven't synced to engine yet
    const existingEngineIds = new Set(rawJobs.map((j) => j.id));
    const requests = jobRequests.data ?? [];
    for (const req of requests) {
      if (req.engine_job_id && !existingEngineIds.has(req.engine_job_id)) {
        rawJobs.push({
          id: req.engine_job_id,
          externalId: req.id,
          tenantId: req.tenant_id,
          userId: req.email ?? "user",
          name: req.name,
          type: req.type,
          priority: (req.priority as JobPriority) ?? "MEDIUM",
          status: req.status === "COMPLETED" ? "COMPLETED" : "RUNNING",
          requestedCores: req.cores,
          requestedMemoryMb: req.memory_mb,
          estimatedMs: 3000,
          remainingMs: 0,
          cpuTimeUsedMs: 0,
          waitingMs: 0,
          turnaroundMs: 0,
          responseMs: 0,
          queueLevel: 0,
          contextSwitches: 0,
          preemptions: 0,
          memoryBase: 0,
          lastScore: 1,
          lastDecision: "Admitted by Long-Term Scheduler",
          estimatedCredits: Number(req.estimated_credits),
          creditsCharged: Number(req.estimated_credits),
          submittedAtMs: new Date(req.created_at).getTime(),
          completedAtMs: 0,
          errorMessage: "",
        });
      }
    }

    // Sort chronologically by submission / ID to assign deterministic P1, P2, P3...
    rawJobs.sort((a, b) => {
      const timeDiff = (a.submittedAtMs || 0) - (b.submittedAtMs || 0);
      if (timeDiff !== 0) return timeDiff;
      return a.id - b.id;
    });

    const mapping = new Map<number, ProcessInfo>();
    const processList: ProcessInfo[] = rawJobs.map((j, idx) => {
      const pIndex = idx + 1;
      const pid = `P${pIndex}`;
      const color = PROCESS_COLORS[idx % PROCESS_COLORS.length]!;

      // Determine quantum based on level
      const qMs =
        queues.data?.levels?.find((l) => l.level === j.queueLevel)?.quantumMs ??
        LEVEL_QUANTUMS[j.queueLevel] ??
        40;

      // Status translation to OS process state
      let pStatus: ProcessInfo["status"] = "QUEUED";
      if (j.status === "RUNNING") pStatus = "RUNNING";
      else if (j.status === "COMPLETED") pStatus = "COMPLETED";
      else if (j.status === "FAILED") pStatus = "FAILED";
      else if (j.status === "CANCELLED") pStatus = "CANCELLED";
      else pStatus = "READY";

      const info: ProcessInfo = {
        pid,
        pIndex,
        jobId: j.id,
        jobName: j.name,
        jobType: j.type,
        priority: j.priority,
        status: pStatus,
        queueLevel: j.queueLevel,
        quantumMs: qMs,
        requestedCores: j.requestedCores,
        requestedMemoryMb: j.requestedMemoryMb,
        estimatedMs: j.estimatedMs,
        cpuTimeUsedMs: j.cpuTimeUsedMs,
        waitingMs: j.waitingMs,
        contextSwitches: j.contextSwitches,
        preemptions: j.preemptions,
        submittedAtMs: j.submittedAtMs,
        color,
      };

      mapping.set(j.id, info);
      return info;
    });

    // Active in Ready Queue: either QUEUED, READY, or RUNNING, or in queue levels
    const queuedIds = new Set<number>();
    (queues.data?.levels ?? []).forEach((lvl) => {
      lvl.jobIds.forEach((id) => queuedIds.add(id));
    });

    const active = processList.filter(
      (p) =>
        p.status === "READY" ||
        p.status === "QUEUED" ||
        p.status === "RUNNING" ||
        queuedIds.has(p.jobId),
    );

    return {
      allProcesses: processList,
      activeProcesses: active,
      jobIdToProcess: mapping,
    };
  }, [jobs.data, jobRequests.data, queues.data]);

  // Handle Quick Job submission from Scheduler page
  const handleQuickAddJob = async () => {
    const preset = JOB_PRESETS.find((p) => p.type === selectedType) ?? JOB_PRESETS[0]!;
    const nextPIndex = allProcesses.length + 1;
    const jobName = customName.trim() || `${preset.defaultName}-p${nextPIndex}`;

    try {
      if (isAdmin && pauseBeforeAdding && !paused) {
        await pause.mutateAsync(true);
      }

      await sendJobRequest({
        data: {
          name: jobName,
          type: selectedType,
          priority: selectedPriority,
          input: preset.ai ? "Autonomous OS task simulation payload" : undefined,
        },
      });

      toast.success(`Job admitted as Process P${nextPIndex}! Enqueued in MLFQ Level 0.`);
      setAddDialogOpen(false);
      setCustomName("");
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to admit job");
    }
  };

  const displayedQueueProcesses = queueView === "active" ? activeProcesses : allProcesses;

  return (
    <AppLayout title="Scheduler">
      {/* OS Educational Banner: Job ➔ Process Conversion Pipeline */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-primary text-xs font-bold">
                  OS
                </span>
                <h2 className="text-sm font-semibold tracking-tight text-foreground sm:text-base">
                  Long-Term Scheduler: Job ➔ Process (PCB) Admission Pipeline
                </h2>
                <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">
                  MLFQ Active
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                When a new job is submitted, the <b>Job Scheduler</b> admits it, converts it into a{" "}
                <b>Process</b> (assigned <b>P1, P2, P3...</b> with a Process Control Block), and enqueues
                it into <b>Level 0 Ready Queue (Time Quantum: 40 ms)</b>.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  const nextPIndex = allProcesses.length + 1;
                  setCustomName(`job-p${nextPIndex}`);
                  setAddDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                <span>Add Job (Admit P{allProcesses.length + 1})</span>
              </Button>
              <Button size="sm" variant="outline" onClick={invalidate} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </div>
          </div>

          {/* Interactive Visual Pipeline Graphic */}
          <div className="mt-4 grid grid-cols-1 gap-2 pt-3 border-t border-border/60 text-xs sm:grid-cols-4">
            <div className="flex items-center gap-2 rounded-md bg-background/80 p-2.5 border border-border/80">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground font-semibold text-xs">
                1
              </div>
              <div className="min-w-0">
                <p className="font-medium text-foreground">Job Submission</p>
                <p className="truncate text-[11px] text-muted-foreground">User submits job</p>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-md bg-background/80 p-2.5 border border-border/80">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary/20 text-primary font-semibold text-xs">
                2
              </div>
              <div className="min-w-0">
                <p className="font-medium text-foreground">Job ➔ Process</p>
                <p className="truncate text-[11px] text-muted-foreground">PCB & PID (P1, P2...) assigned</p>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-md bg-background/80 p-2.5 border border-border/80">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-blue-500/20 text-blue-600 dark:text-blue-400 font-semibold text-xs">
                3
              </div>
              <div className="min-w-0">
                <p className="font-medium text-foreground">Ready Queue (L0)</p>
                <p className="truncate text-[11px] text-muted-foreground">Enqueued in Level 0 (40ms)</p>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-md bg-background/80 p-2.5 border border-border/80">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-semibold text-xs">
                4
              </div>
              <div className="min-w-0">
                <p className="font-medium text-foreground">CPU Dispatcher</p>
                <p className="truncate text-[11px] text-muted-foreground">Quantum slice execution</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Hero: Visual Ready Queue Pipeline (Shows P1, P2, P3 in queue) */}
      <Card className="border-border">
        <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              <CardTitle className="text-base sm:text-lg">MLFQ Visual Ready Queue Pipeline</CardTitle>
              {paused && (
                <Badge variant="destructive" className="text-[10px]">
                  Dispatcher Paused
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Queue order of admitted processes waiting for CPU time slices (Dispatched HEAD ➔ TAIL).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Tabs
              value={queueView}
              onValueChange={(v) => setQueueView(v as "active" | "all")}
              className="w-auto"
            >
              <TabsList className="h-8">
                <TabsTrigger value="active" className="text-xs px-2.5">
                  Active in Queue ({activeProcesses.length})
                </TabsTrigger>
                <TabsTrigger value="all" className="text-xs px-2.5">
                  All Processes ({allProcesses.length})
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 text-xs"
              onClick={() => {
                const nextPIndex = allProcesses.length + 1;
                setCustomName(`job-p${nextPIndex}`);
                setAddDialogOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Process</span>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {displayedQueueProcesses.length > 0 ? (
            <div className="relative overflow-x-auto pb-3 pt-1">
              <div className="flex min-w-max items-center gap-3 px-1">
                {/* HEAD of Queue Marker */}
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-primary/50 bg-primary/10 px-3 py-4 text-center">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                  <span className="mt-1.5 text-[11px] font-bold text-primary tracking-wider">
                    HEAD
                  </span>
                  <span className="text-[10px] text-muted-foreground">Dispatches Next</span>
                </div>

                {/* Queue Items: Connected with animated arrows */}
                {displayedQueueProcesses.map((p, idx) => {
                  const isHead = idx === 0;
                  const isTail = idx === displayedQueueProcesses.length - 1;
                  const isRunning = p.status === "RUNNING";

                  return (
                    <div key={p.jobId || p.pid} className="flex items-center gap-3">
                      {/* Process Card */}
                      <div
                        className={`group relative flex w-64 flex-col rounded-xl border p-3 shadow-sm transition-all duration-200 hover:shadow-md ${p.color.border} ${p.color.bg}`}
                      >
                        {/* Header: Process ID badge + Status */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span
                              className={`flex h-8 w-8 items-center justify-center rounded-lg font-bold text-sm shadow-xs ${p.color.badge}`}
                            >
                              {p.pid}
                            </span>
                            <div>
                              <p className="font-semibold text-xs leading-none text-foreground truncate max-w-[110px]">
                                {p.jobName}
                              </p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                Job #{p.jobId} · {p.priority}
                              </p>
                            </div>
                          </div>

                          <Badge
                            variant={isRunning ? "default" : "outline"}
                            className={`text-[10px] h-5 px-1.5 font-medium ${
                              isRunning
                                ? "bg-emerald-600 text-white animate-pulse"
                                : p.status === "COMPLETED"
                                ? "bg-muted text-muted-foreground"
                                : "bg-background text-foreground"
                            }`}
                          >
                            {isRunning && <span className="mr-1 h-1.5 w-1.5 rounded-full bg-white" />}
                            {p.status}
                          </Badge>
                        </div>

                        {/* Mid section: Queue level & Quantum */}
                        <div className="mt-2.5 flex items-center justify-between rounded-md bg-background/80 px-2 py-1.5 text-[11px] border border-border/50">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Layers className="h-3 w-3" />
                            Level {p.queueLevel}
                          </span>
                          <span className="font-medium text-foreground">
                            quantum {p.quantumMs} ms
                          </span>
                        </div>

                        {/* Resource and Execution Stats */}
                        <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
                          <div>
                            <span className="block text-[9px] uppercase tracking-wider text-muted-foreground/80">
                              Resources
                            </span>
                            <span className="font-medium text-foreground">
                              {p.requestedCores}c · {p.requestedMemoryMb}MB
                            </span>
                          </div>
                          <div>
                            <span className="block text-[9px] uppercase tracking-wider text-muted-foreground/80">
                              CPU Time
                            </span>
                            <span className="font-medium text-foreground">
                              {p.cpuTimeUsedMs} ms / {p.estimatedMs} ms
                            </span>
                          </div>
                        </div>

                        {/* Queue Position Pill */}
                        <div className="mt-2 flex items-center justify-between text-[10px] pt-1.5 border-t border-border/40">
                          <span className="text-muted-foreground">
                            {isHead ? (
                              <b className="text-primary">1st in Queue</b>
                            ) : (
                              `Pos #${idx + 1}`
                            )}
                          </span>
                          <span className="text-muted-foreground">
                            Switches: {p.contextSwitches}
                          </span>
                        </div>
                      </div>

                      {/* Directional Queue Pointer Arrow */}
                      {!isTail && (
                        <div className="flex flex-col items-center justify-center text-muted-foreground/60">
                          <ArrowRight className="h-5 w-5" />
                          <span className="text-[9px] font-mono mt-0.5">FIFO</span>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* TAIL of Queue Marker */}
                <div className="flex items-center gap-3">
                  <ArrowRight className="h-5 w-5 text-muted-foreground/60" />
                  <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 px-3 py-4 text-center">
                    <span className="text-[11px] font-bold text-muted-foreground tracking-wider">
                      TAIL
                    </span>
                    <span className="text-[10px] text-muted-foreground/80">New Admissions</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 py-8 px-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Layers className="h-6 w-6" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-foreground">
                Ready Queue is Currently Idle
              </h3>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                All submitted processes have completed execution, or no jobs are currently enqueued.
                Add a new job to watch it convert into a Process (<b>P{allProcesses.length + 1}</b>)
                and enter the queue live.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    const nextPIndex = allProcesses.length + 1;
                    setCustomName(`job-p${nextPIndex}`);
                    setAddDialogOpen(true);
                  }}
                  className="gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  <span>Add Job to MLFQ Queue (P{allProcesses.length + 1})</span>
                </Button>
                {allProcesses.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setQueueView("all")}
                  >
                    View All Admitted Processes ({allProcesses.length})
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main Grid: Controls & Multi-Level Feedback Queue Lanes */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Engine Controls */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Engine Controls</span>
              <Cpu className="h-4 w-4 text-muted-foreground" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Scheduling Policy</Label>
              <Select
                value={metrics.data?.policy ?? "MLFQ"}
                onValueChange={(v) => policy.mutate(v)}
                disabled={!isAdmin || policy.isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MLFQ">MLFQ (Multi-Level Feedback Queue)</SelectItem>
                  <SelectItem value="ADAPTIVE">Adaptive (Priority + Resource + Credit)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full"
              variant={paused ? "default" : "outline"}
              disabled={!isAdmin || pause.isPending}
              onClick={() => pause.mutate(!paused)}
            >
              {paused ? (
                <>
                  <Play className="mr-2 h-4 w-4" /> Resume Dispatcher
                </>
              ) : (
                <>
                  <Pause className="mr-2 h-4 w-4" /> Pause Dispatcher
                </>
              )}
            </Button>

            {paused && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive flex items-start gap-2">
                <Pause className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Dispatcher Frozen</p>
                  <p className="text-[11px] opacity-90 mt-0.5">
                    Newly submitted jobs will sit waiting in the Ready Queue as <b>P1, P2, P3...</b>{" "}
                    so you can inspect them before running.
                  </p>
                </div>
              </div>
            )}

            <Button
              variant="secondary"
              className="w-full gap-1.5"
              onClick={() => {
                const nextPIndex = allProcesses.length + 1;
                setCustomName(`job-p${nextPIndex}`);
                setAddDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              <span>Submit New Job (P{allProcesses.length + 1})</span>
            </Button>

            {!isAdmin && (
              <p className="text-xs text-muted-foreground">
                Only admins can change the policy or pause the engine.
              </p>
            )}
            {health.isError && (
              <p className="text-xs text-destructive">Engine is unreachable right now.</p>
            )}

            <div className="rounded-md bg-muted/40 p-2.5 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">💡 OS Demo Tip:</p>
              <p>
                Click <b>Pause Dispatcher</b>, then submit 2 or 3 jobs. You will clearly see{" "}
                <b>P1, P2, P3</b> queued in Level 0. Then click <b>Resume Dispatcher</b> to observe
                time quantum execution!
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Multi-Level Feedback Queue Levels Visualizer */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">MLFQ Queue Levels</CardTitle>
              <p className="text-xs text-muted-foreground">
                Hierarchical feedback queues: processes demote down on quantum exhaustion.
              </p>
            </div>
            <Badge variant="outline" className="text-xs font-mono">
              4 Levels (40ms - 320ms)
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {[0, 1, 2, 3].map((lvlNum) => {
              const qData = queues.data?.levels?.find((l) => l.level === lvlNum);
              const quantum = qData?.quantumMs ?? LEVEL_QUANTUMS[lvlNum] ?? 40;
              const directJobIds = qData?.jobIds ?? [];

              // Find processes currently mapped to this level
              const processesInLevel = allProcesses.filter((p) => {
                if (directJobIds.includes(p.jobId)) return true;
                return p.queueLevel === lvlNum && (p.status === "READY" || p.status === "RUNNING");
              });

              const levelDescriptions: Record<number, { title: string; desc: string }> = {
                0: {
                  title: "Level 0 (Highest Priority · RR)",
                  desc: "New process entry point. Short interactive bursts.",
                },
                1: {
                  title: "Level 1 (Medium-High Priority · RR)",
                  desc: "Demoted from L0 if burst > 40ms.",
                },
                2: {
                  title: "Level 2 (Medium-Low Priority · RR)",
                  desc: "Demoted from L1 if burst > 80ms.",
                },
                3: {
                  title: "Level 3 (Lowest Priority · FCFS / Batch)",
                  desc: "Long-running compute-bound batch jobs.",
                },
              };

              return (
                <div key={lvlNum} className="space-y-1">
                  <div className="rounded-lg border border-border p-3 bg-card/60">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/20 text-primary font-bold text-xs">
                          {lvlNum}
                        </span>
                        <span className="font-semibold text-foreground text-xs sm:text-sm">
                          {levelDescriptions[lvlNum]?.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="secondary" className="font-mono text-[11px]">
                          quantum {quantum} ms
                        </Badge>
                        <span className="text-muted-foreground font-medium">
                          {processesInLevel.length} processes
                        </span>
                      </div>
                    </div>

                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {levelDescriptions[lvlNum]?.desc}
                    </p>

                    {/* Queue Lane Tracks */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 min-h-8 rounded-md bg-muted/30 p-2 border border-border/40">
                      {processesInLevel.length ? (
                        processesInLevel.map((p) => (
                          <div
                            key={p.jobId}
                            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs shadow-2xs ${p.color.border} ${p.color.bg}`}
                          >
                            <span
                              className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${p.color.badge}`}
                            >
                              {p.pid}
                            </span>
                            <span className="font-medium text-foreground max-w-[120px] truncate">
                              {p.jobName}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              (#{p.jobId})
                            </span>
                            {p.status === "RUNNING" && (
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                            )}
                          </div>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground italic pl-1">
                          Queue empty — no processes currently waiting in Level {lvlNum}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Feedback Demotion Arrow between levels */}
                  {lvlNum < 3 && (
                    <div className="flex items-center justify-center gap-1.5 py-0.5 text-[10px] text-muted-foreground font-medium">
                      <ArrowDown className="h-3 w-3 text-muted-foreground" />
                      <span>If CPU burst &gt; {quantum} ms ➔ Demote to Level {lvlNum + 1}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Process Control Block (PCB) & Conversion Registry Table */}
      <Card>
        <CardHeader className="pb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ListOrdered className="h-4 w-4 text-primary" />
              <span>Process Control Block (PCB) &amp; Job Conversion Registry</span>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Operating system PCB structures allocated for every submitted job (P1, P2, P3...).
            </p>
          </div>
          <Badge variant="outline" className="text-xs self-start sm:self-auto">
            {allProcesses.length} PCBs Registered
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">Process ID</TableHead>
                  <TableHead>Job Mapping</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Queue Level</TableHead>
                  <TableHead>Allocated Resources</TableHead>
                  <TableHead>Burst / Quantum</TableHead>
                  <TableHead>Context Switches</TableHead>
                  <TableHead>Preemptions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allProcesses.length ? (
                  allProcesses.map((p) => (
                    <TableRow key={p.jobId || p.pid}>
                      <TableCell className="font-mono">
                        <span
                          className={`inline-flex items-center justify-center rounded px-2 py-0.5 font-bold text-xs ${p.color.badge}`}
                        >
                          {p.pid}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground text-xs">{p.jobName}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          Job #{p.jobId} · {p.priority}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className="text-[10px]">
                          {p.jobType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            p.status === "RUNNING"
                              ? "default"
                              : p.status === "COMPLETED"
                              ? "secondary"
                              : "outline"
                          }
                          className="text-[10px]"
                        >
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        Level {p.queueLevel} ({p.quantumMs} ms)
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {p.requestedCores} cores · {p.requestedMemoryMb} MB
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {p.cpuTimeUsedMs} ms / {p.estimatedMs} ms
                      </TableCell>
                      <TableCell className="text-xs font-mono text-center">
                        {p.contextSwitches}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-center">
                        {p.preemptions}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-6 text-xs text-muted-foreground">
                      No jobs have been admitted into processes yet. Submit a job to allocate PCB P1.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Metrics & Scheduling Decisions */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Policy Impact Metrics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Metric label="Avg waiting time" value={fmtMs(metrics.data?.avgWaitingMs ?? 0)} />
            <Metric label="Avg turnaround time" value={fmtMs(metrics.data?.avgTurnaroundMs ?? 0)} />
            <Metric label="Avg response time" value={fmtMs(metrics.data?.avgResponseMs ?? 0)} />
            <Metric
              label="CPU utilisation"
              value={`${(metrics.data?.cpuUtilization ?? 0).toFixed(1)}%`}
            />
            <Metric label="Total Context Switches" value={String(metrics.data?.contextSwitches ?? 0)} />
            <Metric label="Total Preemptions" value={String(metrics.data?.preemptions ?? 0)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent Scheduling Decisions</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[320px] space-y-2 overflow-auto text-sm">
            {(queues.data?.decisions ?? []).map((d, i) => {
              const p = jobIdToProcess.get(d.jobId);
              return (
                <div key={i} className="rounded-md border border-border px-3 py-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5 font-medium text-foreground">
                      {p && (
                        <span
                          className={`inline-flex rounded px-1.5 py-0.2 text-[10px] font-bold ${p.color.badge}`}
                        >
                          {p.pid}
                        </span>
                      )}
                      <span>
                        Job #{d.jobId} · Level {d.queueLevel}
                      </span>
                    </span>
                    <span className="font-mono">score {d.score.toFixed(2)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{d.reason}</p>
                </div>
              );
            })}
            {!queues.data?.decisions?.length && (
              <p className="text-muted-foreground text-xs">No decisions recorded yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Add Job / Admit Process Modal */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <span>Admit New Job to MLFQ Scheduler</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              This job will be admitted by the OS Long-Term Scheduler, assigned Process ID{" "}
              <b>P{allProcesses.length + 1}</b> with a PCB, and placed into MLFQ Ready Queue Level 0.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-sm">
            <div className="space-y-1.5">
              <Label>Workload Type</Label>
              <Select
                value={selectedType}
                onValueChange={(v) => {
                  setSelectedType(v);
                  const p = JOB_PRESETS.find((x) => x.type === v);
                  if (p) setCustomName(`${p.defaultName}-p${allProcesses.length + 1}`);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JOB_PRESETS.map((p) => (
                    <SelectItem key={p.type} value={p.type}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Job / Process Name</Label>
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder={`job-p${allProcesses.length + 1}`}
                maxLength={60}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select
                value={selectedPriority}
                onValueChange={(v) => setSelectedPriority(v as JobPriority)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as JobPriority[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isAdmin ? (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-xs space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="pauseFirst"
                    checked={pauseBeforeAdding}
                    onChange={(e) => setPauseBeforeAdding(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                  />
                  <label htmlFor="pauseFirst" className="font-medium text-foreground cursor-pointer">
                    Pause dispatcher first (recommended)
                  </label>
                </div>
                <p className="text-[11px] text-muted-foreground pl-6">
                  Keeps new processes frozen in the Ready Queue as <b>P1, P2, P3...</b> so you can visually
                  inspect them before they run.
                </p>
              </div>
            ) : (
              <div className="rounded-md border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">
                <p>
                  Your job will be submitted to the OS Admission Scheduler, allocated a PCB (<b>P{allProcesses.length + 1}</b>), and placed into MLFQ Ready Queue Level 0.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleQuickAddJob} className="gap-1.5">
              <Plus className="h-4 w-4" />
              <span>Admit as Process P{allProcesses.length + 1}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground text-xs sm:text-sm">{label}</span>
      <span className="font-semibold text-foreground text-xs sm:text-sm font-mono">{value}</span>
    </div>
  );
}
