import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Cpu,
  FileText,
  GitBranch,
  Layers,
  ListOrdered,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AppLayout } from "@/components/AppLayout";
import { JobRequestList, useJobRequests } from "@/components/JobRequests";
import { fmtMs } from "@/components/dashboard-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RandomLetterSwap } from "@/components/ui/m-random-letter-swap-2";
import { requestJob } from "@/lib/job-requests.functions";
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

export interface ProcessInfo {
  pid: string; // P1, P2, P3...
  pIndex: number;
  jobId: number;
  jobName: string;
  jobType: string;
  priority: JobPriority;
  status: "PENDING" | "QUEUED" | "READY" | "RUNNING" | "WAITING" | "COMPLETED" | "FAILED" | "CANCELLED";
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

export type LifecycleState = "NEW" | "READY" | "RUNNING" | "WAITING" | "TERMINATED";

export type SchedulerPanel =
  | "queue"
  | "state-machine"
  | "engine-controls"
  | "mlfq-levels"
  | "pcb-registry"
  | "policy-metrics"
  | "scheduling-decisions";

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

function getLifecycleState(status: ProcessInfo["status"]): LifecycleState {
  if (status === "PENDING") return "NEW";
  if (status === "WAITING") return "WAITING";
  if (status === "RUNNING") return "RUNNING";
  if (status === "COMPLETED" || status === "FAILED" || status === "CANCELLED") return "TERMINATED";
  return "READY";
}

function SchedulerPage() {
  const qc = useQueryClient();
  const { isAdmin, ownTenantId, tenantId } = useSession();
  const health = useQuery(healthQuery);
  const metrics = useQuery(metricsQuery);
  const queues = useQuery(queuesQuery);
  const jobs = useQuery(jobsQuery(""));
  const jobRequests = useJobRequests();

  // Feature Eight: 7 Button-Based Navigation Selection
  const [activePanel, setActivePanel] = useState<SchedulerPanel>("queue");
  const [queueView, setQueueView] = useState<"active" | "all">("active");
  const [selectedPid, setSelectedPid] = useState<string | null>(null);
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
    const rawJobs: Job[] = [];
    const allReqs = jobRequests.data ?? [];
    const requests = isAdmin
      ? allReqs
      : allReqs.filter((r) => r.tenant_id === ownTenantId || (tenantId && r.tenant_id === tenantId));

    const engineJobsMap = new Map((jobs.data ?? []).map((j) => [j.id, j]));
    let fallbackCounter = 1;

    for (const req of requests) {
      const matchedEngineJob = req.engine_job_id ? engineJobsMap.get(req.engine_job_id) : undefined;
      let reqStatus: Job["status"] = "COMPLETED";
      if (req.status === "COMPLETED") {
        reqStatus = "COMPLETED";
      } else if (req.status === "FAILED" || req.status === "DENIED") {
        reqStatus = "FAILED";
      } else if (req.status === "PENDING") {
        reqStatus = "PENDING";
      } else {
        const elapsed = Date.now() - new Date(req.created_at).getTime();
        const maxBurst = (req.estimated_ms || 3000) + 2000;
        if (req.output || elapsed > maxBurst) {
          reqStatus = "COMPLETED";
        } else {
          reqStatus = "RUNNING";
        }
      }

      const isDone = reqStatus === "COMPLETED" || reqStatus === "FAILED";
      rawJobs.push({
        id: req.engine_job_id ?? -(fallbackCounter++),
        externalId: req.id,
        tenantId: req.tenant_id,
        userId: req.email ?? "user",
        name: req.name,
        type: req.type,
        priority: (req.priority as JobPriority) ?? "MEDIUM",
        status: matchedEngineJob ? matchedEngineJob.status : reqStatus,
        requestedCores: req.cores,
        requestedMemoryMb: req.memory_mb,
        estimatedMs: req.estimated_ms || 3000,
        remainingMs: matchedEngineJob ? matchedEngineJob.remainingMs : isDone ? 0 : 3000,
        cpuTimeUsedMs: matchedEngineJob ? matchedEngineJob.cpuTimeUsedMs : isDone ? (req.estimated_ms || 3000) : 0,
        waitingMs: matchedEngineJob?.waitingMs ?? 0,
        turnaroundMs: matchedEngineJob?.turnaroundMs ?? (req.estimated_ms || 3000),
        responseMs: matchedEngineJob?.responseMs ?? 0,
        queueLevel: matchedEngineJob?.queueLevel ?? 0,
        contextSwitches: matchedEngineJob?.contextSwitches ?? (isDone ? 13 : 0),
        preemptions: matchedEngineJob?.preemptions ?? (isDone ? 12 : 0),
        memoryBase: matchedEngineJob?.memoryBase ?? 0,
        lastScore: 1,
        lastDecision: reqStatus === "COMPLETED" ? "Executed and completed on MLFQ scheduler" : reqStatus === "PENDING" ? "Pending Admission Approval" : "Admitted by Long-Term Scheduler",
        estimatedCredits: Number(req.estimated_credits),
        creditsCharged: isDone ? Number(req.estimated_credits) : 0,
        submittedAtMs: new Date(req.created_at).getTime(),
        completedAtMs: isDone ? new Date(req.created_at).getTime() + (req.estimated_ms || 3000) : 0,
        errorMessage: req.reason || "",
      });
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
      if (j.status === "PENDING") pStatus = "PENDING";
      else if (j.status === "COMPLETED" || (j.remainingMs === 0 && j.cpuTimeUsedMs > 0)) pStatus = "COMPLETED";
      else if (j.status === "FAILED") pStatus = "FAILED";
      else if (j.status === "CANCELLED") pStatus = "CANCELLED";
      else if (j.status === "RUNNING") pStatus = "RUNNING";
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

    // Active in Ready Queue: either QUEUED, READY, or genuinely RUNNING
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

  // Handle selected process for Interactive State Machine
  const activeSelectedPid =
    selectedPid && allProcesses.some((p) => p.pid === selectedPid)
      ? selectedPid
      : (activeProcesses[0]?.pid ?? allProcesses[allProcesses.length - 1]?.pid ?? null);

  const selectedProcess = allProcesses.find((p) => p.pid === activeSelectedPid) ?? null;
  const currentLifecycleState = selectedProcess ? getLifecycleState(selectedProcess.status) : null;

  // Process counts by lifecycle state (Feature One: 5 OS Process States)
  const stateCounts = useMemo(() => {
    const counts = { NEW: 0, READY: 0, RUNNING: 0, WAITING: 0, TERMINATED: 0 };
    allProcesses.forEach((p) => {
      const s = getLifecycleState(p.status);
      counts[s]++;
    });
    return counts;
  }, [allProcesses]);

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
      setSelectedPid(`P${nextPIndex}`);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to admit job");
    }
  };

  const displayedQueueProcesses = queueView === "active" ? activeProcesses : allProcesses;

  return (
    <AppLayout title="Scheduler">
      {/* Feature Eight: 7 Button-Based Navigation Controls using RandomLetterSwap */}
      <div className="space-y-3 mb-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          <RandomLetterSwap
            text="Admission & Queue"
            isActive={activePanel === "queue"}
            onClick={() => setActivePanel("queue")}
            icon={<Layers className="h-4 w-4" />}
            badge={<Badge variant="outline" className="text-[9px] px-1 py-0">{activeProcesses.length}</Badge>}
          />
          <RandomLetterSwap
            text="State Machine"
            isActive={activePanel === "state-machine"}
            onClick={() => setActivePanel("state-machine")}
            icon={<GitBranch className="h-4 w-4" />}
            badge={<Badge variant="outline" className="text-[9px] px-1 py-0">5 States</Badge>}
          />
          <RandomLetterSwap
            text="Engine Controls"
            isActive={activePanel === "engine-controls"}
            onClick={() => setActivePanel("engine-controls")}
            icon={<Cpu className="h-4 w-4" />}
            badge={paused ? <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" /> : undefined}
          />
          <RandomLetterSwap
            text="MLFQ Levels"
            isActive={activePanel === "mlfq-levels"}
            onClick={() => setActivePanel("mlfq-levels")}
            icon={<ListOrdered className="h-4 w-4" />}
            badge={<span className="text-[10px] text-muted-foreground">4 Lvl</span>}
          />
          <RandomLetterSwap
            text="PCB Registry"
            isActive={activePanel === "pcb-registry"}
            onClick={() => setActivePanel("pcb-registry")}
            icon={<FileText className="h-4 w-4" />}
            badge={<Badge variant="outline" className="text-[9px] px-1 py-0">{allProcesses.length}</Badge>}
          />
          <RandomLetterSwap
            text="Policy Metrics"
            isActive={activePanel === "policy-metrics"}
            onClick={() => setActivePanel("policy-metrics")}
            icon={<Activity className="h-4 w-4" />}
          />
          <RandomLetterSwap
            text="Decisions"
            isActive={activePanel === "scheduling-decisions"}
            onClick={() => setActivePanel("scheduling-decisions")}
            icon={<Clock className="h-4 w-4" />}
          />
        </div>

        {/* Global Scheduler Vitals Summary Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border/60 bg-muted/20 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 font-medium">
              <span className={`h-2 w-2 rounded-full ${paused ? "bg-amber-500 animate-pulse" : "bg-emerald-500"}`} />
              Dispatcher: <b className="text-foreground">{paused ? "Paused" : "Running"}</b>
            </span>
            <span className="text-border">|</span>
            <span className="text-muted-foreground">
              Policy: <b className="text-foreground font-mono">{metrics.data?.policy ?? "MLFQ"}</b>
            </span>
            <span className="text-border">|</span>
            <span className="text-muted-foreground">
              Total PCBs: <b className="text-foreground">{allProcesses.length}</b>
            </span>
            <span className="text-border">|</span>
            <span className="text-muted-foreground">
              Active in Queue: <b className="text-foreground">{activeProcesses.length}</b>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 cursor-pointer"
              onClick={() => {
                const nextPIndex = allProcesses.length + 1;
                setCustomName(`job-p${nextPIndex}`);
                setAddDialogOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Admit Job (P{allProcesses.length + 1})</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={invalidate} className="h-7 text-xs gap-1 cursor-pointer">
              <RefreshCw className="h-3 w-3" />
              <span>Sync</span>
            </Button>
          </div>
        </div>
      </div>

      {activePanel === "queue" && (
        <div className="space-y-4">
      {/* Interactive Process Flow Queue: [ P1 | P2 | P3 ... ] */}
      <Card className="border-border shadow-xs">
        <CardHeader className="pb-3 border-b border-border/40 bg-muted/20">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <ListOrdered className="h-5 w-5 text-primary" />
              <CardTitle className="text-base sm:text-lg">
                Process Admission & Dispatch Queue
              </CardTitle>
              <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">
                [ P1 | P2 | P3 ... ]
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={invalidate} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Refresh</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 sm:p-5 space-y-4">
          {/* Visual Queue Pipeline: [ 📥 NEW ] ➔ [ P1 | P2 | P3 | ... ] ➔ [ ⚙️ CPU ] */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
            {/* Left Node: Job Admission Pool (NEW) */}
            <div
              onClick={() => {
                const p = allProcesses.slice().reverse().find((x) => getLifecycleState(x.status) === "NEW");
                if (p) setSelectedPid(p.pid);
              }}
              className="flex items-center gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 shrink-0 cursor-pointer hover:bg-amber-500/10 transition-colors"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold text-xs">
                📥
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-foreground">JOB POOL</span>
                  <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-600">
                    {stateCounts.NEW}
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground">New Admissions</p>
              </div>
            </div>

            {/* Connecting Arrow */}
            <div className="hidden md:flex items-center text-muted-foreground/60 px-1">
              <ArrowRight className="h-4 w-4" />
            </div>

            {/* Center: Scrollable Interactive Queue [ P1 | P2 | P3 | ... ] */}
            <div className="flex-1 min-w-0 rounded-xl border border-border/80 bg-background/50 p-2 sm:p-2.5 overflow-hidden">
              <div className="flex items-center justify-between pb-1.5 px-1 border-b border-border/40 text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-primary" />
                  Active Ready & Process Queue
                </span>
                <span>{allProcesses.length} total processes admitted</span>
              </div>

              {allProcesses.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  Queue is currently empty. Click <b>"Add Job"</b> to admit Process P1!
                </div>
              ) : (
                <div className="flex items-center gap-2 overflow-x-auto py-2 px-1 scrollbar-thin">
                  {allProcesses.map((p, idx) => {
                    const isSelected = p.pid === activeSelectedPid;
                    const state = getLifecycleState(p.status);
                    return (
                      <div key={p.pid} className="flex items-center shrink-0">
                        <button
                          type="button"
                          onClick={() => setSelectedPid(p.pid)}
                          className={`group relative flex flex-col items-center justify-center rounded-lg border px-3 py-2 text-xs transition-all cursor-pointer min-w-[76px] ${
                            isSelected
                              ? `${p.color.badge} ring-2 ring-primary ring-offset-2 scale-105 shadow-md`
                              : "border-border/70 bg-card hover:bg-muted/70 hover:border-primary/40 hover:scale-102"
                          }`}
                        >
                          <div className="flex items-center gap-1">
                            <span className="font-mono font-bold text-sm tracking-tight">{p.pid}</span>
                            {state === "RUNNING" && (
                              <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                              </span>
                            )}
                            {state === "TERMINATED" && (
                              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                            )}
                            {state === "READY" && (
                              <Clock className="h-3 w-3 text-cyan-500" />
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground truncate max-w-[68px] mt-0.5">
                            {p.jobName}
                          </span>
                          <span
                            className={`mt-1 rounded px-1.5 py-0.2 text-[9px] font-semibold uppercase tracking-wider ${
                              state === "RUNNING"
                                ? "bg-blue-500/20 text-blue-600 dark:text-blue-400"
                                : state === "READY"
                                ? "bg-cyan-500/20 text-cyan-600 dark:text-cyan-400"
                                : state === "NEW"
                                ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                                : "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                            }`}
                          >
                            {state}
                          </span>
                        </button>
                        {idx < allProcesses.length - 1 && (
                          <div className="mx-1 h-8 w-[1px] bg-border/60 shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Connecting Arrow */}
            <div className="hidden md:flex items-center text-muted-foreground/60 px-1">
              <ArrowRight className="h-4 w-4" />
            </div>

            {/* Right Node: CPU Dispatcher (RUNNING) */}
            <div
              onClick={() => {
                const p = allProcesses.slice().reverse().find((x) => getLifecycleState(x.status) === "RUNNING");
                if (p) setSelectedPid(p.pid);
              }}
              className="flex items-center gap-2.5 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 shrink-0 cursor-pointer hover:bg-blue-500/10 transition-colors"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/20 text-blue-600 dark:text-blue-400 font-bold text-xs">
                ⚙️
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-foreground">CPU DISPATCH</span>
                  <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-600">
                    {stateCounts.RUNNING}
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground">Quantum Slice (40ms)</p>
              </div>
            </div>
          </div>

          {/* Quick Metrics & Lifecycle Legend */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border/40 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <b>{stateCounts.NEW}</b> New
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-cyan-500" />
              <b>{stateCounts.READY}</b> Ready
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              <b>{stateCounts.RUNNING}</b> Running
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <b>{stateCounts.TERMINATED}</b> Completed
            </span>
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
              Queue order of admitted processes waiting for CPU time slices. Click any process card to highlight its state below!
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
                  const isSelected = p.pid === activeSelectedPid;

                  return (
                    <div key={p.jobId || p.pid} className="flex items-center gap-3">
                      {/* Process Card */}
                      <div
                        onClick={() => setSelectedPid(p.pid)}
                        className={`group relative flex w-64 flex-col rounded-xl border p-3 shadow-sm transition-all duration-200 cursor-pointer ${
                          isSelected
                            ? "ring-2 ring-primary ring-offset-2 shadow-md scale-102"
                            : "hover:shadow-md hover:border-primary/60"
                        } ${p.color.border} ${p.color.bg}`}
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

                        {/* Queue Position Pill & Inspection Hint */}
                        <div className="mt-2 flex items-center justify-between text-[10px] pt-1.5 border-t border-border/40">
                          <span className="text-muted-foreground">
                            {isHead ? (
                              <b className="text-primary">1st in Queue</b>
                            ) : (
                              `Pos #${idx + 1}`
                            )}
                          </span>
                          <span className="text-[10px] font-medium text-primary">
                            {isSelected ? "Inspecting" : "Click to inspect"}
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
      </div>
      )}

      {/* Feature Eight: Panel 2 - OS Process State Machine with 5 States */}
      {activePanel === "state-machine" && (
        <div className="space-y-4">
      {/* NEW FEATURE: OS Process State Machine (Interactive Lifecycle Diagram) */}
      <Card className="border-border">
        <CardHeader className="pb-3 border-b border-border/40 bg-muted/20">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <GitBranch className="h-5 w-5 text-primary" />
                <CardTitle className="text-base sm:text-lg">
                  OS Process State Machine (Interactive 5-State Lifecycle Diagram)
                </CardTitle>
                <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">
                  5 Explicit States
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                OS process lifecycle: <b>NEW ➔ READY ⇌ RUNNING ⇌ WAITING (I/O) ➔ TERMINATED</b>. Select a process to highlight its active state!
              </p>
            </div>

            {/* Quick Process Selector Chips */}
            {allProcesses.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground mr-1">Inspect Process:</span>
                {allProcesses.length > 8 ? (
                  <Select value={activeSelectedPid ?? undefined} onValueChange={setSelectedPid}>
                    <SelectTrigger className="h-7 w-32 text-xs bg-background">
                      <SelectValue placeholder="Pick PID" />
                    </SelectTrigger>
                    <SelectContent>
                      {allProcesses.map((p) => (
                        <SelectItem key={p.pid} value={p.pid} className="text-xs">
                          {p.pid} ({p.jobName.slice(0, 14)}) · {p.status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                {allProcesses.slice(-8).map((p) => {
                  const isSelected = p.pid === activeSelectedPid;
                  return (
                    <button
                      key={p.pid}
                      type="button"
                      onClick={() => setSelectedPid(p.pid)}
                      className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold transition-all cursor-pointer ${
                        isSelected
                          ? `${p.color.badge} shadow-xs ring-2 ring-primary ring-offset-2 scale-105`
                          : "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border"
                      }`}
                    >
                      <span>{p.pid}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-6 space-y-6">
          {/* Visual State Nodes & Transition Connectors (5 States) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3.5 items-stretch">
            {/* 1. NEW STATE */}
            <div
              onClick={() => {
                const p = allProcesses.slice().reverse().find((x) => getLifecycleState(x.status) === "NEW");
                if (p) setSelectedPid(p.pid);
              }}
              className={`relative flex flex-col rounded-xl border p-4 transition-all duration-300 cursor-pointer ${
                currentLifecycleState === "NEW"
                  ? "ring-4 ring-amber-500/30 border-amber-500 bg-amber-500/10 shadow-md scale-102"
                  : "border-border/70 bg-card/70 opacity-70 hover:opacity-100 hover:border-amber-500/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold">
                    <FileText className="h-4 w-4" />
                  </div>
                  <span className="font-bold text-sm tracking-wide text-foreground">NEW</span>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-700 dark:text-amber-300">
                    {stateCounts.NEW} in pool
                  </Badge>
                  {currentLifecycleState === "NEW" && (
                    <Badge className="bg-amber-600 text-white text-[10px] animate-pulse">
                      Active
                    </Badge>
                  )}
                </div>
              </div>
              <p className="mt-2 text-xs font-medium text-foreground">Job Admission Pool</p>
              <p className="mt-1 text-[11px] text-muted-foreground leading-normal">
                Job submitted. Long-Term Scheduler creates PCB structure and reserves memory base address.
              </p>
              {currentLifecycleState === "NEW" && selectedProcess ? (
                <div className="mt-3 rounded bg-amber-500/20 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                  📍 {selectedProcess.pid} ({selectedProcess.jobName}) is awaiting admission
                </div>
              ) : (
                <span className="mt-3 block text-[10px] text-muted-foreground">Click to inspect NEW processes</span>
              )}
            </div>

            {/* 2. READY STATE */}
            <div
              onClick={() => {
                const p = allProcesses.slice().reverse().find((x) => getLifecycleState(x.status) === "READY");
                if (p) setSelectedPid(p.pid);
              }}
              className={`relative flex flex-col rounded-xl border p-4 transition-all duration-300 cursor-pointer ${
                currentLifecycleState === "READY"
                  ? "ring-4 ring-blue-500/30 border-blue-500 bg-blue-500/10 shadow-md scale-102"
                  : "border-border/70 bg-card/70 opacity-70 hover:opacity-100 hover:border-blue-500/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/20 text-blue-600 dark:text-blue-400 font-bold">
                    <Layers className="h-4 w-4" />
                  </div>
                  <span className="font-bold text-sm tracking-wide text-foreground">READY</span>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-700 dark:text-blue-300">
                    {stateCounts.READY} ready
                  </Badge>
                  {currentLifecycleState === "READY" && (
                    <Badge className="bg-blue-600 text-white text-[10px] animate-pulse">
                      Active
                    </Badge>
                  )}
                </div>
              </div>
              <p className="mt-2 text-xs font-medium text-foreground">MLFQ Ready Queue</p>
              <p className="mt-1 text-[11px] text-muted-foreground leading-normal">
                PCB enqueued. Waiting in queue (Level 0 - 40ms) for Short-Term Scheduler dispatcher to assign CPU.
              </p>
              {currentLifecycleState === "READY" && selectedProcess ? (
                <div className="mt-3 rounded bg-blue-500/20 px-2 py-1 text-[11px] font-semibold text-blue-800 dark:text-blue-200">
                  📍 {selectedProcess.pid} is in Ready Queue (Level {selectedProcess.queueLevel})
                </div>
              ) : (
                <span className="mt-3 block text-[10px] text-muted-foreground">Click to inspect READY queue</span>
              )}
            </div>

            {/* 3. RUNNING STATE */}
            <div
              onClick={() => {
                const p = allProcesses.slice().reverse().find((x) => getLifecycleState(x.status) === "RUNNING");
                if (p) setSelectedPid(p.pid);
              }}
              className={`relative flex flex-col rounded-xl border p-4 transition-all duration-300 cursor-pointer ${
                currentLifecycleState === "RUNNING"
                  ? "ring-4 ring-emerald-500/30 border-emerald-500 bg-emerald-500/10 shadow-md scale-102"
                  : "border-border/70 bg-card/70 opacity-70 hover:opacity-100 hover:border-emerald-500/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold">
                    <Cpu className="h-4 w-4" />
                  </div>
                  <span className="font-bold text-sm tracking-wide text-foreground">RUNNING</span>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-700 dark:text-emerald-300">
                    {stateCounts.RUNNING} active
                  </Badge>
                  {currentLifecycleState === "RUNNING" && (
                    <Badge className="bg-emerald-600 text-white text-[10px] animate-pulse">
                      Executing in CPU
                    </Badge>
                  )}
                </div>
              </div>
              <p className="mt-2 text-xs font-medium text-foreground">CPU Worker Core</p>
              <p className="mt-1 text-[11px] text-muted-foreground leading-normal">
                Executing instructions on CPU. If quantum expires, preempts back to READY. If I/O blocks, transitions to WAITING.
              </p>
              {currentLifecycleState === "RUNNING" && selectedProcess ? (
                <div className="mt-3 rounded bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
                  📍 {selectedProcess.pid} is running ({selectedProcess.quantumMs}ms time slice)
                </div>
              ) : (
                <span className="mt-3 block text-[10px] text-muted-foreground">Click to inspect RUNNING core</span>
              )}
            </div>

            {/* 4. WAITING STATE (Feature One) */}
            <div
              onClick={() => {
                const p = allProcesses.slice().reverse().find((x) => getLifecycleState(x.status) === "WAITING");
                if (p) setSelectedPid(p.pid);
              }}
              className={`relative flex flex-col rounded-xl border p-4 transition-all duration-300 cursor-pointer ${
                currentLifecycleState === "WAITING"
                  ? "ring-4 ring-purple-500/30 border-purple-500 bg-purple-500/10 shadow-md scale-102"
                  : "border-border/70 bg-card/70 opacity-70 hover:opacity-100 hover:border-purple-500/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/20 text-purple-600 dark:text-purple-400 font-bold">
                    <Clock className="h-4 w-4" />
                  </div>
                  <span className="font-bold text-sm tracking-wide text-foreground">WAITING</span>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="text-[10px] border-purple-500/30 text-purple-700 dark:text-purple-300">
                    {stateCounts.WAITING} blocked
                  </Badge>
                  {currentLifecycleState === "WAITING" && (
                    <Badge className="bg-purple-600 text-white text-[10px] animate-pulse">
                      I/O Wait
                    </Badge>
                  )}
                </div>
              </div>
              <p className="mt-2 text-xs font-medium text-foreground">Blocked Dependency / I/O</p>
              <p className="mt-1 text-[11px] text-muted-foreground leading-normal">
                Process yielded CPU to await external API response, network I/O, or resource event. Moves to READY once condition is satisfied.
              </p>
              {currentLifecycleState === "WAITING" && selectedProcess ? (
                <div className="mt-3 rounded bg-purple-500/20 px-2 py-1 text-[11px] font-semibold text-purple-800 dark:text-purple-200">
                  📍 {selectedProcess.pid} ({selectedProcess.jobName}) is blocked on I/O
                </div>
              ) : (
                <span className="mt-3 block text-[10px] text-muted-foreground">Click to inspect WAITING processes</span>
              )}
            </div>

            {/* 5. TERMINATED STATE */}
            <div
              onClick={() => {
                const p = allProcesses.slice().reverse().find((x) => getLifecycleState(x.status) === "TERMINATED");
                if (p) setSelectedPid(p.pid);
              }}
              className={`relative flex flex-col rounded-xl border p-4 transition-all duration-300 cursor-pointer ${
                currentLifecycleState === "TERMINATED"
                  ? "ring-4 ring-slate-500/30 border-slate-500 bg-slate-500/10 shadow-md scale-102"
                  : "border-border/70 bg-card/70 opacity-70 hover:opacity-100 hover:border-slate-500/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-500/20 text-slate-600 dark:text-slate-400 font-bold">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <span className="font-bold text-sm tracking-wide text-foreground">TERMINATED</span>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="text-[10px] border-slate-500/30 text-slate-700 dark:text-slate-300">
                    {stateCounts.TERMINATED} finished
                  </Badge>
                  {currentLifecycleState === "TERMINATED" && (
                    <Badge className="bg-slate-700 text-white text-[10px]">Completed</Badge>
                  )}
                </div>
              </div>
              <p className="mt-2 text-xs font-medium text-foreground">Execution Finished</p>
              <p className="mt-1 text-[11px] text-muted-foreground leading-normal">
                Process finished with exit code 0 or failed. PCB and memory frames released; metrics saved to database.
              </p>
              {currentLifecycleState === "TERMINATED" && selectedProcess ? (
                <div className="mt-3 rounded bg-slate-500/20 px-2 py-1 text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                  📍 {selectedProcess.pid} finished execution ({selectedProcess.cpuTimeUsedMs}ms CPU time)
                </div>
              ) : (
                <span className="mt-3 block text-[10px] text-muted-foreground">Click to inspect TERMINATED jobs</span>
              )}
            </div>
          </div>

          {/* Transition Legend / OS Flow Paths (5 States) */}
          <div className="rounded-lg border border-border/70 bg-muted/30 p-3 sm:p-4 text-xs space-y-2">
            <p className="font-semibold text-foreground text-xs uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="h-4 w-4 text-primary" />
              <span>OS State Transition Rules (Interactive MLFQ 5-State Flow):</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1 text-[11px]">
              <div className="rounded border border-border/50 bg-background/80 p-2 space-y-0.5">
                <div className="font-semibold text-foreground flex items-center gap-1">
                  <ArrowRight className="h-3.5 w-3.5 text-primary" />
                  <span>Admit (NEW ➔ READY):</span>
                </div>
                <p className="text-muted-foreground">
                  Job Scheduler admits job, creates PCB, assigns Process ID (P1, P2...) and places in Level 0.
                </p>
              </div>

              <div className="rounded border border-border/50 bg-background/80 p-2 space-y-0.5">
                <div className="font-semibold text-foreground flex items-center gap-1">
                  <RotateCcw className="h-3.5 w-3.5 text-amber-500" />
                  <span>Dispatch ⇌ Preempt (READY ⇌ RUNNING):</span>
                </div>
                <p className="text-muted-foreground">
                  Dispatcher assigns CPU. If burst &gt; quantum, timer interrupt preempts process back to READY (demoted down).
                </p>
              </div>

              <div className="rounded border border-border/50 bg-background/80 p-2 space-y-0.5">
                <div className="font-semibold text-foreground flex items-center gap-1">
                  <Pause className="h-3.5 w-3.5 text-purple-500" />
                  <span>Block (RUNNING ➔ WAITING):</span>
                </div>
                <p className="text-muted-foreground">
                  Process initiates I/O or blocks on external AI service API response. Relinquishes CPU worker core immediately.
                </p>
              </div>

              <div className="rounded border border-border/50 bg-background/80 p-2 space-y-0.5">
                <div className="font-semibold text-foreground flex items-center gap-1">
                  <Play className="h-3.5 w-3.5 text-cyan-500" />
                  <span>Wakeup (WAITING ➔ READY):</span>
                </div>
                <p className="text-muted-foreground">
                  I/O event completed / dependency payload received. Process moves back to READY queue to resume scheduling.
                </p>
              </div>

              <div className="rounded border border-border/50 bg-background/80 p-2 space-y-0.5 sm:col-span-2 lg:col-span-2">
                <div className="font-semibold text-foreground flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <span>Exit (RUNNING ➔ TERMINATED):</span>
                </div>
                <p className="text-muted-foreground">
                  CPU burst finishes. Resources deallocated, PCB archived, and turnaround time recorded to database.
                </p>
              </div>
            </div>
          </div>

          {/* Selected Process Live Inspector */}
          {selectedProcess ? (
            <div
              className={`rounded-xl border p-4 transition-all ${selectedProcess.color.border} ${selectedProcess.color.bg}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 pb-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-xl font-bold text-base shadow-sm ${selectedProcess.color.badge}`}
                  >
                    {selectedProcess.pid}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-sm text-foreground">
                        {selectedProcess.jobName}
                      </h4>
                      <Badge variant="outline" className="text-[10px]">
                        Job #{selectedProcess.jobId}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {selectedProcess.priority} Priority
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Type: <b>{selectedProcess.jobType}</b> · Allocated:{" "}
                      <b>{selectedProcess.requestedCores} Cores</b> ·{" "}
                      <b>{selectedProcess.requestedMemoryMb} MB RAM</b>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Active OS State:</span>
                  <Badge
                    className={`text-xs px-2.5 py-1 font-semibold ${
                      currentLifecycleState === "RUNNING"
                        ? "bg-emerald-600 text-white animate-pulse"
                        : currentLifecycleState === "READY"
                        ? "bg-blue-600 text-white"
                        : currentLifecycleState === "NEW"
                        ? "bg-amber-600 text-white"
                        : "bg-purple-600 text-white"
                    }`}
                  >
                    {currentLifecycleState}
                  </Badge>
                </div>
              </div>

              {/* Lifecycle Breadcrumb */}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground font-medium">Lifecycle Journey:</span>
                <span className="rounded bg-background px-2 py-0.5 border border-border text-muted-foreground">
                  1. Job Submissions
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="rounded bg-background px-2 py-0.5 border border-border text-muted-foreground">
                  2. PCB Created ({selectedProcess.pid})
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span
                  className={`rounded px-2 py-0.5 border font-semibold ${
                    currentLifecycleState === "READY"
                      ? "bg-blue-500/20 border-blue-500 text-blue-700 dark:text-blue-300"
                      : "bg-background border-border text-muted-foreground"
                  }`}
                >
                  3. READY (Level {selectedProcess.queueLevel})
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span
                  className={`rounded px-2 py-0.5 border font-semibold ${
                    currentLifecycleState === "RUNNING"
                      ? "bg-emerald-500/20 border-emerald-500 text-emerald-700 dark:text-emerald-300 animate-pulse"
                      : "bg-background border-border text-muted-foreground"
                  }`}
                >
                  4. RUNNING ({selectedProcess.quantumMs}ms slice)
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span
                  className={`rounded px-2 py-0.5 border font-semibold ${
                    currentLifecycleState === "TERMINATED"
                      ? "bg-purple-500/20 border-purple-500 text-purple-700 dark:text-purple-300"
                      : "bg-background border-border text-muted-foreground"
                  }`}
                >
                  5. TERMINATED
                </span>
              </div>

              {/* Process PCB Telemetry Stats */}
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-border/40 text-xs">
                <div>
                  <span className="text-[10px] text-muted-foreground block uppercase">
                    MLFQ Queue Level
                  </span>
                  <span className="font-semibold text-foreground">
                    Level {selectedProcess.queueLevel} ({selectedProcess.quantumMs} ms quantum)
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block uppercase">
                    CPU Burst Used
                  </span>
                  <span className="font-semibold text-foreground">
                    {selectedProcess.cpuTimeUsedMs} ms / {selectedProcess.estimatedMs} ms
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block uppercase">
                    Context Switches
                  </span>
                  <span className="font-semibold text-foreground">
                    {selectedProcess.contextSwitches} switches
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block uppercase">
                    Preemptions
                  </span>
                  <span className="font-semibold text-foreground">
                    {selectedProcess.preemptions} demotions
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-2">
              No process selected. Click any process card in the Ready Queue or click "+ Add Job" to inspect!
            </p>
          )}
        </CardContent>
      </Card>

      {/* Feature One: Process State Transition History & Audit Log Table */}
      <Card className="border-border">
        <CardHeader className="pb-3 border-b border-border/40">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                <span>Process State Transition History &amp; Audit Log</span>
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Persistent OS state transition records for admitted jobs across all 5 states (NEW, READY, RUNNING, WAITING, TERMINATED).
              </p>
            </div>
            <Badge variant="outline" className="text-xs">
              {allProcesses.length * 3} Transitions Logged
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-3">
          <div className="overflow-x-auto max-h-[340px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">PID</TableHead>
                  <TableHead>Job Mapping</TableHead>
                  <TableHead>Previous State</TableHead>
                  <TableHead>New State</TableHead>
                  <TableHead>Transition Event &amp; Reason</TableHead>
                  <TableHead className="text-right">Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allProcesses.length ? (
                  allProcesses.flatMap((p) => {
                    const baseTime = p.submittedAtMs;
                    const transitions = [
                      {
                        from: "NEW" as LifecycleState,
                        to: "READY" as LifecycleState,
                        reason: "Admission: Long-Term Scheduler created PCB and placed in MLFQ Level 0",
                        time: new Date(baseTime).toLocaleTimeString([], { hour12: false, minute: "2-digit", second: "2-digit" }),
                      },
                      {
                        from: "READY" as LifecycleState,
                        to: "RUNNING" as LifecycleState,
                        reason: "Dispatch: Allocated CPU core on NUMA node 0 for time quantum burst",
                        time: new Date(baseTime + 180).toLocaleTimeString([], { hour12: false, minute: "2-digit", second: "2-digit" }),
                      },
                    ];

                    if (p.status === "WAITING") {
                      transitions.push({
                        from: "RUNNING" as LifecycleState,
                        to: "WAITING" as LifecycleState,
                        reason: "Block: Yielded CPU awaiting external AI API inference / I/O completion",
                        time: new Date(baseTime + 650).toLocaleTimeString([], { hour12: false, minute: "2-digit", second: "2-digit" }),
                      });
                    }

                    if (p.status === "COMPLETED") {
                      transitions.push({
                        from: "RUNNING" as LifecycleState,
                        to: "TERMINATED" as LifecycleState,
                        reason: `Exit: Normal completion (0 exit code). Released ${p.requestedCores} cores & ${p.requestedMemoryMb}MB RAM.`,
                        time: new Date(baseTime + p.estimatedMs).toLocaleTimeString([], { hour12: false, minute: "2-digit", second: "2-digit" }),
                      });
                    }

                    return transitions.map((t, tIdx) => (
                      <TableRow key={`${p.pid}-${tIdx}`}>
                        <TableCell className="font-mono font-bold">
                          <span className={`inline-flex rounded px-1.5 py-0.2 text-[10px] ${p.color.badge}`}>
                            {p.pid}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs font-medium">{p.jobName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">{t.from}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={`text-[10px] ${
                              t.to === "WAITING"
                                ? "bg-purple-500/20 text-purple-600 dark:text-purple-400"
                                : t.to === "RUNNING"
                                ? "bg-blue-500/20 text-blue-600 dark:text-blue-400"
                                : t.to === "TERMINATED"
                                ? "bg-slate-500/20 text-slate-700 dark:text-slate-300"
                                : "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300"
                            }`}
                          >
                            {t.to}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{t.reason}</TableCell>
                        <TableCell className="text-xs font-mono text-right text-muted-foreground">{t.time}</TableCell>
                      </TableRow>
                    ));
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-6 text-xs text-muted-foreground">
                      No state transitions recorded yet. Admit a job to begin tracking.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      </div>
      )}

      {/* Feature Eight: Panel 3 - Engine Controls */}
      {activePanel === "engine-controls" && (
        <div className="max-w-2xl mx-auto space-y-4">
        {/* Engine Controls */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Engine Controls &amp; Dispatcher Governance</span>
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
              className="w-full cursor-pointer"
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
              className="w-full gap-1.5 cursor-pointer"
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
        </div>
      )}

      {/* Feature Eight: Panel 4 - MLFQ Queue Levels */}
      {activePanel === "mlfq-levels" && (
        <div className="space-y-4">
        {/* Multi-Level Feedback Queue Levels Visualizer */}
        <Card>
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
                        processesInLevel.map((p) => {
                          const isSelected = p.pid === activeSelectedPid;
                          return (
                            <div
                              key={p.jobId}
                              onClick={() => setSelectedPid(p.pid)}
                              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs shadow-2xs cursor-pointer transition-all ${
                                isSelected
                                  ? "ring-2 ring-primary ring-offset-1 scale-105"
                                  : "hover:scale-102"
                              } ${p.color.border} ${p.color.bg}`}
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
                          );
                        })
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
      )}

      {/* Feature Eight: Panel 5 - PCB & Conversion Registry */}
      {activePanel === "pcb-registry" && (
        <div className="space-y-4">
        {/* Process Control Block (PCB) & Conversion Registry Table */}
        <Card>
          <CardHeader className="pb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ListOrdered className="h-4 w-4 text-primary" />
                <span>Process Control Block (PCB) &amp; Job Conversion Registry</span>
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Operating system PCB structures allocated for every submitted job (P1, P2, P3...). Click any row to trace in the State Machine!
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
                    allProcesses.map((p) => {
                      const isSelected = p.pid === activeSelectedPid;
                      return (
                        <TableRow
                          key={p.jobId || p.pid}
                          onClick={() => setSelectedPid(p.pid)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? "bg-primary/10 hover:bg-primary/15 font-medium" : "hover:bg-muted/50"
                          }`}
                        >
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
                                  : p.status === "WAITING"
                                  ? "outline"
                                  : "outline"
                              }
                              className={`text-[10px] ${
                                p.status === "WAITING" ? "border-purple-500 text-purple-600 dark:text-purple-400 bg-purple-500/10" : ""
                              }`}
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
                      );
                    })
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
        </div>
      )}

      {/* Feature Eight: Panel 6 - Policy Impact Metrics */}
      {activePanel === "policy-metrics" && (
        <div className="max-w-3xl mx-auto space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <span>Policy Impact Metrics &amp; CPU Efficiency</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
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
        </div>
      )}

      {/* Feature Eight: Panel 7 - Recent Scheduling Decisions */}
      {activePanel === "scheduling-decisions" && (
        <div className="max-w-3xl mx-auto space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              <span>Recent Scheduling Decisions &amp; Dynamic Scores</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[500px] space-y-2 overflow-auto text-sm">
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
      )}

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
