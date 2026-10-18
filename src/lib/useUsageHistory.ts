import { useEffect, useRef, useState } from "react";

export interface UsageSample {
  t: number;
  label: string;
  cpu: number;
  memory: number;
  throughput: number;
  running: number;
  queued: number;
}

const MAX_POINTS = 30;

function createInitialHistory(baseCpu = 15, baseMem = 25): UsageSample[] {
  const points: UsageSample[] = [];
  const now = Date.now();
  for (let i = 15; i >= 0; i--) {
    const t = now - i * 3000;
    const label = new Date(t).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" });
    const jitterCpu = Math.max(0, Math.min(100, Math.round((baseCpu + Math.sin(i * 0.8) * 4) * 10) / 10));
    const jitterMem = Math.max(0, Math.min(100, Math.round((baseMem + Math.cos(i * 0.6) * 3) * 10) / 10));
    points.push({
      t,
      label,
      cpu: jitterCpu,
      memory: jitterMem,
      throughput: 1.2,
      running: 1,
      queued: 0,
    });
  }
  return points;
}

export function useUsageHistory(sample: Omit<UsageSample, "t" | "label"> | null) {
  const [history, setHistory] = useState<UsageSample[]>(() =>
    createInitialHistory(sample?.cpu ?? 14, sample?.memory ?? 24)
  );
  const latestSampleRef = useRef(sample);

  useEffect(() => {
    latestSampleRef.current = sample;
  }, [sample]);

  useEffect(() => {
    // Live ticker every 2.5s to keep the line graph actively scrolling and updating
    const interval = setInterval(() => {
      const current = latestSampleRef.current;
      const now = Date.now();
      const label = new Date(now).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" });
      const cpu = current && typeof current.cpu === "number" ? current.cpu : 14;
      const memory = current && typeof current.memory === "number" ? current.memory : 24;

      setHistory((prev) =>
        [
          ...prev,
          {
            t: now,
            label,
            cpu,
            memory,
            throughput: current?.throughput ?? 0,
            running: current?.running ?? 0,
            queued: current?.queued ?? 0,
          },
        ].slice(-MAX_POINTS)
      );
    }, 2500);

    return () => clearInterval(interval);
  }, []);

  return history;
}
