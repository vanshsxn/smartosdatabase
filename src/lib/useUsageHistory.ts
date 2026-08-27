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

const MAX_POINTS = 60;

export function useUsageHistory(sample: Omit<UsageSample, "t" | "label"> | null) {
  const [history, setHistory] = useState<UsageSample[]>([]);
  const last = useRef<string>("");

  useEffect(() => {
    if (!sample) return;
    const key = JSON.stringify(sample);
    if (key === last.current) return;
    last.current = key;
    const now = Date.now();
    const label = new Date(now).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" });
    setHistory((prev) => [...prev, { ...sample, t: now, label }].slice(-MAX_POINTS));
  }, [sample]);

  return history;
}
