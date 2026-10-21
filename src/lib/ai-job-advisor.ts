import type { JobPriority } from "./engine.types";
import { JOB_PRESETS } from "./job-presets";

export interface PriorityRecommendation {
  suggestedPriority: JobPriority;
  confidence: number;
  explanation: string;
  factors: string[];
  modelType: string;
}

export interface JobRuntimeEstimate {
  cpuBurstMs: number;
  queueDelayMs: number;
  totalDurationMs: number;
  uncertaintyRangeMs: [number, number];
  explanation: string;
  factors: string[];
  method: string;
  timestamp: number;
}

/**
 * Predicts optimal job priority based on workload demand, payload size,
 * resource requirements, and current queue saturation.
 */
export function getPriorityRecommendation(params: {
  jobType: string;
  input?: string;
  requestedCores?: number;
  requestedMemoryMb?: number;
  currentQueueDepth?: number;
  userUrgency?: "normal" | "urgent";
}): PriorityRecommendation {
  const {
    jobType,
    input = "",
    requestedCores = 1,
    requestedMemoryMb = 512,
    currentQueueDepth = 0,
    userUrgency = "normal",
  } = params;

  const preset = JOB_PRESETS.find((p) => p.type === jobType);
  const inputLength = input.trim().length;
  const factors: string[] = [];

  let score = 50; // Base baseline score (0-100)

  // 1. Workload characteristics
  if (jobType === "AI_CODE_REVIEW" || jobType === "AI_SUMMARIZE") {
    score += 15;
    factors.push("Interactive user-facing AI workload");
  } else if (jobType === "AI_DATA_INSIGHTS" || jobType === "AI_TRANSLATE") {
    score += 10;
    factors.push("Structured data analysis task");
  } else if (jobType === "REPORT" || jobType === "BUILD") {
    score -= 10;
    factors.push("Batch/compute-heavy background processing");
  }

  // 2. Input payload size
  if (inputLength > 10000) {
    score += 15;
    factors.push(`Large payload (${Math.round(inputLength / 1024)} KB) requiring sustained CPU allocation`);
  } else if (inputLength > 2000) {
    score += 8;
    factors.push("Moderate payload size");
  } else if (inputLength > 0 && inputLength < 200) {
    score -= 5;
    factors.push("Short interactive query");
  }

  // 3. Resource footprint
  if (requestedCores >= 4 || requestedMemoryMb >= 2048) {
    score += 12;
    factors.push(`High resource demand (${requestedCores} cores, ${requestedMemoryMb} MB RAM)`);
  } else if (requestedCores === 1 && requestedMemoryMb <= 512) {
    factors.push("Lightweight single-core footprint");
  }

  // 4. Current queue congestion
  if (currentQueueDepth > 3) {
    score += 10;
    factors.push(`Queue currently holds ${currentQueueDepth} processes; elevated priority prevents demotion delay`);
  }

  // 5. User-declared urgency
  if (userUrgency === "urgent") {
    score += 25;
    factors.push("User explicitly marked as high urgency");
  }

  let suggestedPriority: JobPriority = "MEDIUM";
  let confidence = 0.85;

  if (score >= 80) {
    suggestedPriority = "CRITICAL";
    confidence = 0.92;
  } else if (score >= 65) {
    suggestedPriority = "HIGH";
    confidence = 0.88;
  } else if (score <= 35) {
    suggestedPriority = "LOW";
    confidence = 0.82;
  } else {
    suggestedPriority = "MEDIUM";
    confidence = 0.86;
  }

  const explanations: Record<JobPriority, string> = {
    CRITICAL: `Recommended CRITICAL because this task involves high resource footprint with elevated queue depth. Immediate L0 admission avoids starvation.`,
    HIGH: `Recommended HIGH because this is an interactive workload with significant payload that benefits from early time quantum bursts.`,
    MEDIUM: `Recommended MEDIUM (Standard policy): Balanced resource utilization suitable for standard MLFQ round-robin scheduling.`,
    LOW: `Recommended LOW: Batch-oriented workload that can yield CPU time to interactive processes without degrading overall throughput.`,
  };

  return {
    suggestedPriority,
    confidence,
    explanation: explanations[suggestedPriority],
    factors,
    modelType: "Heuristic Priority Scoring Engine (v2.1)",
  };
}

/**
 * Accurately estimates wall-clock completion time, distinguishing CPU execution
 * burst from expected MLFQ ready queue waiting delay.
 */
export function getJobRuntimeEstimate(params: {
  jobType: string;
  input?: string;
  requestedCores?: number;
  requestedMemoryMb?: number;
  queueDepth?: number;
  activeWorkers?: number;
}): JobRuntimeEstimate {
  const {
    jobType,
    input = "",
    requestedCores = 1,
    requestedMemoryMb = 512,
    queueDepth = 0,
    activeWorkers = 4,
  } = params;

  const preset = JOB_PRESETS.find((p) => p.type === jobType);
  const inputLen = input.trim().length;
  const factors: string[] = [];

  // 1. Base CPU execution estimate (in milliseconds)
  let baseCpuMs = 2200;

  if (jobType === "IMAGE_GEN") {
    baseCpuMs = 3800;
    factors.push("Neural diffusion model generation (~3.8s)");
  } else if (jobType === "AI_CODE_REVIEW") {
    baseCpuMs = 2600 + Math.min(3000, Math.round(inputLen * 0.15));
    factors.push("Static AST parsing & language model inspection");
  } else if (jobType === "AI_SUMMARIZE") {
    baseCpuMs = 2400 + Math.min(2500, Math.round(inputLen * 0.12));
    factors.push("Semantic chunking and text abstraction");
  } else if (jobType === "AI_TRANSLATE") {
    baseCpuMs = 2100 + Math.min(2000, Math.round(inputLen * 0.1));
    factors.push("Cross-lingual translation synthesis");
  } else if (jobType === "AI_DATA_INSIGHTS") {
    baseCpuMs = 2000 + Math.min(2500, Math.round(inputLen * 0.08));
    factors.push("Tabular data analysis & aggregation");
  } else if (jobType === "REPORT") {
    baseCpuMs = 1800;
    factors.push("Document formatting & PDF generation");
  } else if (jobType === "BUILD") {
    baseCpuMs = 3200;
    factors.push("Dependency compilation and bundle build");
  }

  // Multi-core execution speedup factor (Amdahl's law approximation)
  const coreSpeedup = 1 + (requestedCores - 1) * 0.25;
  const cpuBurstMs = Math.round(baseCpuMs / coreSpeedup);
  factors.push(`${requestedCores} CPU core(s) allocated (${coreSpeedup.toFixed(2)}x compute scaling)`);

  // 2. Queue waiting delay estimate (in milliseconds)
  // Each waiting job in queue adds ~350ms per active worker concurrency
  const effectiveWorkers = Math.max(1, activeWorkers);
  const queueDelayMs = Math.round((queueDepth * 600) / effectiveWorkers);
  if (queueDepth > 0) {
    factors.push(`Queue delay: ${queueDepth} process(es) ahead in ready queue (~${queueDelayMs} ms wait)`);
  } else {
    factors.push("Queue idle: Immediate dispatcher allocation expected");
  }

  // 3. Total Wall-clock Duration
  const totalDurationMs = cpuBurstMs + queueDelayMs;

  // 4. Uncertainty range (±15% variance based on system load)
  const uncertaintyRangeMs: [number, number] = [
    Math.round(totalDurationMs * 0.85),
    Math.round(totalDurationMs * 1.2),
  ];

  const explanation = `Estimated ${(totalDurationMs / 1000).toFixed(1)}s total wall-clock time: ${(cpuBurstMs / 1000).toFixed(1)}s CPU compute burst + ${(queueDelayMs / 1000).toFixed(1)}s estimated queue wait across ${effectiveWorkers} workers.`;

  return {
    cpuBurstMs,
    queueDelayMs,
    totalDurationMs,
    uncertaintyRangeMs,
    explanation,
    factors,
    method: "Statistical MLFQ Workload Predictor",
    timestamp: Date.now(),
  };
}

