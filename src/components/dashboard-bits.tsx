import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { JobStatus } from "@/lib/engine.types";

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = "primary",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon: ReactNode;
  tone?: "primary" | "success" | "warning" | "destructive" | "info";
}) {
  const tones: Record<string, string> = {
    primary: "bg-primary/15 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    destructive: "bg-destructive/15 text-destructive",
    info: "bg-info/15 text-info",
  };
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
          {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
        </div>
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", tones[tone])}>
          {icon}
        </span>
      </CardContent>
    </Card>
  );
}

export function Gauge({
  value,
  label,
  detail,
  color = "var(--color-chart-1)",
}: {
  value: number;
  label: string;
  detail: string;
  color?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const radius = 46;
  const circumference = Math.PI * radius;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 110 62" className="h-[76px] w-[120px]">
        <path
          d={`M 9 55 A ${radius} ${radius} 0 0 1 101 55`}
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d={`M 9 55 A ${radius} ${radius} 0 0 1 101 55`}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
        />
        <text
          x="55"
          y="52"
          textAnchor="middle"
          className="fill-foreground text-[18px] font-semibold"
        >
          {pct.toFixed(0)}%
        </text>
      </svg>
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  RUNNING: "text-success",
  COMPLETED: "text-primary",
  QUEUED: "text-warning",
  PENDING: "text-warning",
  FAILED: "text-destructive",
  CANCELLED: "text-destructive",
  READY: "text-warning",
};

export function StatusText({ status }: { status: JobStatus | string }) {
  return <span className={cn("font-medium", STATUS_TONE[status] ?? "")}>{status}</span>;
}

const PRIORITY_TONE: Record<string, string> = {
  CRITICAL: "text-destructive",
  HIGH: "text-destructive",
  MEDIUM: "text-warning",
  LOW: "text-success",
};

export function PriorityText({ priority }: { priority: string }) {
  return <span className={cn("font-medium", PRIORITY_TONE[priority] ?? "")}>{priority}</span>;
}

export function fmtMs(ms: number) {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function fmtTime(ms: number) {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function EngineOffline() {
  return (
    <Card>
      <CardContent className="p-6 text-sm text-muted-foreground">
        Engine is unreachable. Start the MV CloudCore engine (default{" "}
        <code className="text-foreground">http://127.0.0.1:9090</code>) to see live data.
      </CardContent>
    </Card>
  );
}
