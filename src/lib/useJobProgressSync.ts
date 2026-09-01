import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { jobsQuery } from "./engine-queries";
import { jobPercent, recordJobSnapshots } from "./progress";
import { useSession } from "./session";
import type { Job } from "./engine.types";

/**
 * Watches the live engine job list and persists a progress row whenever a job
 * transitions state (PENDING/QUEUED/RUNNING/COMPLETED/FAILED/CANCELLED) or
 * advances by at least 10% while running. No synthetic data is written.
 */
export function useJobProgressSync(enabled = true) {
  const { user, tenantId } = useSession();
  const seen = useRef(new Map<string, { state: string; bucket: number }>());
  const inFlight = useRef(false);

  const jobs = useQuery({
    ...jobsQuery(tenantId),
    enabled: enabled && typeof window !== "undefined" && Boolean(user),
  });

  useEffect(() => {
    const list = jobs.data;
    if (!user || !list || inFlight.current) return;

    const changed: Job[] = [];
    for (const job of list) {
      const key = job.externalId || String(job.id);
      const bucket = Math.floor(jobPercent(job) / 10);
      const prev = seen.current.get(key);
      if (!prev || prev.state !== job.status || bucket > prev.bucket) {
        changed.push(job);
        seen.current.set(key, { state: job.status, bucket });
      }
    }
    if (!changed.length) return;

    inFlight.current = true;
    void recordJobSnapshots(user.id, changed)
      .catch(() => undefined)
      .finally(() => {
        inFlight.current = false;
      });
  }, [jobs.data, user]);

  return jobs;
}
