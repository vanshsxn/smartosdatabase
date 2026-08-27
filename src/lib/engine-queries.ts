import { queryOptions } from "@tanstack/react-query";

import {
  getHealth,
  getJobs,
  getLogs,
  getMemory,
  getMetrics,
  getQueueState,
  getResources,
  getTenantCredits,
} from "./engine";

const clientOnly = typeof window !== "undefined";

export const healthQuery = queryOptions({
  queryKey: ["engine", "health"],
  queryFn: getHealth,
  refetchInterval: 3000,
  enabled: clientOnly,
  retry: false,
});

export const metricsQuery = queryOptions({
  queryKey: ["engine", "metrics"],
  queryFn: getMetrics,
  refetchInterval: 2000,
  enabled: clientOnly,
  retry: false,
});

export const resourcesQuery = queryOptions({
  queryKey: ["engine", "resources"],
  queryFn: getResources,
  refetchInterval: 2000,
  enabled: clientOnly,
  retry: false,
});

export const memoryQuery = queryOptions({
  queryKey: ["engine", "memory"],
  queryFn: getMemory,
  refetchInterval: 2000,
  enabled: clientOnly,
  retry: false,
});

export const queuesQuery = queryOptions({
  queryKey: ["engine", "queues"],
  queryFn: getQueueState,
  refetchInterval: 2000,
  enabled: clientOnly,
  retry: false,
});

export const tenantCreditsQuery = queryOptions({
  queryKey: ["engine", "tenants"],
  queryFn: getTenantCredits,
  refetchInterval: 5000,
  enabled: clientOnly,
  retry: false,
});

export function jobsQuery(tenantId: string) {
  return queryOptions({
    queryKey: ["engine", "jobs", tenantId],
    queryFn: () => getJobs(tenantId || undefined, 200),
    refetchInterval: 2000,
    enabled: clientOnly,
    retry: false,
  });
}

export function logsQuery(jobId?: number, limit = 200) {
  return queryOptions({
    queryKey: ["engine", "logs", jobId ?? "all", limit],
    queryFn: () => getLogs(jobId, limit),
    refetchInterval: 2000,
    enabled: clientOnly,
    retry: false,
  });
}
