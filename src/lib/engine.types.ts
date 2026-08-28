export type JobPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type JobStatus = "PENDING" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface Job {
  id: number;
  externalId: string;
  tenantId: string;
  userId: string;
  name: string;
  type: string;
  priority: JobPriority;
  status: JobStatus;
  requestedCores: number;
  requestedMemoryMb: number;
  estimatedMs: number;
  remainingMs: number;
  cpuTimeUsedMs: number;
  waitingMs: number;
  turnaroundMs: number;
  responseMs: number;
  queueLevel: number;
  contextSwitches: number;
  preemptions: number;
  memoryBase: number;
  lastScore: number;
  lastDecision: string;
  estimatedCredits: number;
  creditsCharged: number;
  submittedAtMs: number;
  completedAtMs: number;
  errorMessage: string;
}

export interface JobsResponse {
  jobs: Job[];
}

export interface Metrics {
  policy: string;
  avgWaitingMs: number;
  avgTurnaroundMs: number;
  avgResponseMs: number;
  cpuUtilization: number;
  throughputPerMin: number;
  contextSwitches: number;
  preemptions: number;
  completed: number;
  failed: number;
  cancelled: number;
  running: number;
  queued: number;
}

export interface Resources {
  totalCores: number;
  usedCores: number;
  freeCores: number;
  cpuUtilization: number;
  totalMemoryMb: number;
  usedMemoryMb: number;
  freeMemoryMb: number;
  memoryUtilization: number;
  activeAllocations: number;
  fragmentation: number;
  largestFreeMb: number;
  threadPoolWorkers: number;
  threadPoolActive: number;
  threadPoolQueued: number;
  threadPoolCompleted: number;
}

export interface MemoryBlock {
  base: number;
  sizeMb: number;
  free: boolean;
  ownerJobId: number;
  ownerName: string;
}

export interface MemoryStats {
  totalMb: number;
  usedMb: number;
  freeMb: number;
  utilization: number;
  fragmentation: number;
  largestFreeMb: number;
  freeBlocks: number;
  usedBlocks: number;
  allocationCount: number;
  failedAllocations: number;
  blocks: MemoryBlock[];
}

export interface QueueLevel {
  level: number;
  quantumMs: number;
  jobIds: number[];
}

export interface SchedulingDecision {
  jobId: number;
  score: number;
  policy: string;
  queueLevel: number;
  reason: string;
}

export interface QueueState {
  policy: string;
  levels: QueueLevel[];
  decisions: SchedulingDecision[];
}

export interface Health {
  status: string;
  engine: string;
  policy: string;
  workers: number;
  paused?: boolean;
  reachable?: boolean;
}

export interface TenantCredit {
  tenantId: string;
  credits: number;
}

export interface TenantsResponse {
  tenants: TenantCredit[];
}

export interface PauseResult {
  paused: boolean;
}

export interface LogEntry {
  timestampMs: number;
  level: string;
  source: string;
  jobId: number;
  message: string;
}

export interface LogsResponse {
  logs: LogEntry[];
}

export interface SubmitResult {
  accepted: boolean;
  jobId: number;
  message: string;
}

export interface CancelResult {
  cancelled: boolean;
  message: string;
}

export interface PolicyResult {
  policy: string;
}

export interface CreditsResult {
  tenantId: string;
  credits: number;
}

export interface SubmitJobRequest {
  externalId?: string;
  tenantId?: string;
  userId?: string;
  name?: string;
  type?: string;
  priority?: JobPriority;
  requestedCores?: number;
  requestedMemoryMb?: number;
  estimatedMs?: number;
}

export interface SetPolicyRequest {
  policy: string;
}

export interface SetCreditsRequest {
  tenantId: string;
  credits: number;
}
