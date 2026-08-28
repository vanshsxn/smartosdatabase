import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { Health, Job, Metrics, Resources, TenantCredit } from "./engine.types";

export interface EngineSnapshot {
  ts: number;
  online: boolean;
  error?: string;
  health?: Health;
  metrics?: Metrics;
  resources?: Resources;
  jobs: Job[];
  tenants: TenantCredit[];
}

export interface UsagePoint {
  t: number;
  label: string;
  cpu: number;
  memory: number;
  throughput: number;
  running: number;
  queued: number;
  /** Per-job CPU share (%) keyed by `job-<id>`. */
  jobCpu: Record<string, number>;
  /** Per-job memory share (%) keyed by `job-<id>`. */
  jobMemory: Record<string, number>;
}

interface StreamValue {
  snapshot: EngineSnapshot | null;
  history: UsagePoint[];
  connected: boolean;
}

const MAX_POINTS = 90;

const StreamContext = createContext<StreamValue>({
  snapshot: null,
  history: [],
  connected: false,
});

export function EngineStreamProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [history, setHistory] = useState<UsagePoint[]>([]);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      const es = new EventSource("/api/engine/stream");
      sourceRef.current = es;

      es.addEventListener("open", () => setConnected(true));

      es.addEventListener("snapshot", (event) => {
        try {
          const snap = JSON.parse((event as MessageEvent<string>).data) as EngineSnapshot;
          setSnapshot(snap);
          setConnected(true);
          if (!snap.online || !snap.resources || !snap.metrics) return;

          const totalCores = snap.resources.totalCores || 1;
          const totalMemory = snap.resources.totalMemoryMb || 1;
          const jobCpu: Record<string, number> = {};
          const jobMemory: Record<string, number> = {};
          for (const job of snap.jobs) {
            if (job.status !== "RUNNING") continue;
            jobCpu[`job-${job.id}`] = Number(((job.requestedCores / totalCores) * 100).toFixed(1));
            jobMemory[`job-${job.id}`] = Number(
              ((job.requestedMemoryMb / totalMemory) * 100).toFixed(1),
            );
          }

          const point: UsagePoint = {
            t: snap.ts,
            label: new Date(snap.ts).toLocaleTimeString([], {
              minute: "2-digit",
              second: "2-digit",
            }),
            cpu: Number(snap.resources.cpuUtilization.toFixed(1)),
            memory: Number(snap.resources.memoryUtilization.toFixed(1)),
            throughput: Number(snap.metrics.throughputPerMin.toFixed(2)),
            running: snap.metrics.running,
            queued: snap.metrics.queued,
            jobCpu,
            jobMemory,
          };
          setHistory((prev) => [...prev, point].slice(-MAX_POINTS));
        } catch {
          /* ignore malformed frame */
        }
      });

      es.addEventListener("error", () => {
        setConnected(false);
        es.close();
        sourceRef.current = null;
        retry = setTimeout(connect, 3000);
      });
    };

    connect();

    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, []);

  const value = useMemo(
    () => ({ snapshot, history, connected }),
    [snapshot, history, connected],
  );

  return <StreamContext.Provider value={value}>{children}</StreamContext.Provider>;
}

export function useEngineStream() {
  return useContext(StreamContext);
}
