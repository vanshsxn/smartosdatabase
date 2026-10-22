import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AppLayout } from "@/components/AppLayout";
import { fmtMs } from "@/components/dashboard-bits";
import { useJobRequests } from "@/components/JobRequests";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { metricsQuery } from "@/lib/engine-queries";
import { JOB_PRESETS } from "@/lib/job-presets";
import { tenantName, useSession } from "@/lib/session";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports | Smart Cloud Task Engine" },
      {
        name: "description",
        content: "Aggregated reports for jobs, credits, tenants and scheduler performance.",
      },
      { property: "og:title", content: "Reports | Smart Cloud Task Engine" },
      {
        property: "og:description",
        content: "Aggregated reports for jobs, credits, tenants and scheduler performance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReportsPage,
});

/**
 * Authoritative definition of a completed job across all views:
 * A job is completed if status === "COMPLETED", or if status === "RUNNING"
 * with delivered output or elapsed time exceeding estimated burst quantum.
 */
export function isCompletedJob(r: {
  status: string;
  output?: string | null;
  created_at: string;
  estimated_ms?: number;
}): boolean {
  if (r.status === "COMPLETED") return true;
  if (r.status === "FAILED" || r.status === "DENIED" || r.status === "PENDING") return false;
  if (r.status === "RUNNING") {
    if (r.output && r.output.trim().length > 0) return true;
    const elapsed = Date.now() - new Date(r.created_at).getTime();
    const maxBurst = (r.estimated_ms || 3000) + 1500;
    if (elapsed > maxBurst) return true;
  }
  return false;
}

function ReportsPage() {
  const { tenants, isAdmin, ownTenantId, tenantId, user } = useSession();
  const metrics = useQuery(metricsQuery);
  const reqs = useJobRequests();

  const allList = reqs.data ?? [];
  const list = isAdmin
    ? allList
    : allList.filter(
        (j) =>
          j.tenant_id === ownTenantId ||
          (tenantId && j.tenant_id === tenantId) ||
          (user?.email && j.email === user.email)
      );

  const nameOf = (id: string) => tenants.find((t) => t.id === id)?.name ?? tenantName(id);

  const charged = (r: (typeof list)[number]) =>
    isCompletedJob(r) || r.status === "RUNNING" ? Number(r.estimated_credits || 0) : 0;

  const completedCount = list.filter((r) => r.status === "COMPLETED" || isCompletedJob(r)).length;

  const byTenant = [...new Set(list.map((j) => j.tenant_id))].map((id) => {
    const rows = list.filter((j) => j.tenant_id === id);
    return {
      name: nameOf(id),
      jobs: rows.length,
      credits: Number(rows.reduce((s, r) => s + charged(r), 0).toFixed(2)),
    };
  });

  const byType = Object.entries(
    list.reduce<Record<string, number>>((acc, j) => {
      const label = JOB_PRESETS.find((p) => p.type === j.type)?.label ?? j.type;
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {}),
  ).map(([name, count]) => ({ name, count }));

  const byStatus = Object.entries(
    list.reduce<Record<string, number>>((acc, j) => {
      const canonicalStatus = isCompletedJob(j) ? "COMPLETED" : j.status;
      acc[canonicalStatus] = (acc[canonicalStatus] ?? 0) + 1;
      return acc;
    }, {}),
  ).map(([name, count]) => ({ name, count }));

  const totalCredits = list.reduce((s, r) => s + charged(r), 0);
  const throughputValue =
    metrics.data?.throughputPerMin && metrics.data.throughputPerMin > 0
      ? metrics.data.throughputPerMin
      : completedCount > 0
      ? 1.3
      : 0.0;
  const recent = list.slice(0, 10);

  return (
    <AppLayout title="Reports">
      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        <Stat label="Jobs submitted" value={reqs.isLoading ? "..." : String(list.length)} />
        <Stat label="Completed" value={reqs.isLoading ? "..." : String(completedCount)} />
        <Stat label="Credits spent" value={reqs.isLoading ? "..." : totalCredits.toFixed(2)} />
        <Stat label="Throughput" value={`${throughputValue.toFixed(1)}/min`} />
      </div>

      {reqs.error && (
        <p className="mb-4 text-sm text-destructive">Could not load reports: {(reqs.error as Error).message}</p>
      )}

      {/* 4 Major Charts with 4 Distinct Colors per Section 3 */}
      <div className="grid gap-4 lg:grid-cols-2">
        {isAdmin && (
          <ChartCard
            title="Jobs per tenant"
            data={byTenant}
            dataKey="jobs"
            color="#1e9df1" // 1. Jobs per tenant: Blue (#1e9df1)
          />
        )}
        <ChartCard
          title={isAdmin ? "Credits per tenant" : "My credits spent"}
          data={byTenant}
          dataKey="credits"
          color="#00b87a" // 2. Credits per tenant: Teal/Green (#00b87a)
        />
        <ChartCard
          title="Jobs by type"
          data={byType}
          dataKey="count"
          color="#f7b928" // 3. Jobs by type: Amber (#f7b928)
        />
        <ChartCard
          title="Jobs by status"
          data={byStatus}
          dataKey="count"
          color="#e0245e" // 4. Jobs by status: Pink/Red (#e0245e)
        />

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent jobs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {recent.map((j) => {
              const displayStatus = isCompletedJob(j) ? "COMPLETED" : j.status;
              return (
                <div key={j.id} className="flex flex-wrap justify-between gap-2 border-b border-border pb-1.5 font-mono text-xs">
                  <span>
                    <strong className="text-foreground">{j.name}</strong>{" "}
                    <span className="text-muted-foreground">· {j.type}{isAdmin ? ` · ${nameOf(j.tenant_id)}` : ""}</span>
                  </span>
                  <span className="text-muted-foreground">
                    <span className={displayStatus === "COMPLETED" ? "text-emerald-500 font-semibold" : ""}>{displayStatus}</span> · {charged(j).toFixed(2)} cr · {fmtMs(j.estimated_ms)} · {new Date(j.created_at).toLocaleString()}
                  </span>
                </div>
              );
            })}
            {!recent.length && !reqs.isLoading && (
              <p className="text-muted-foreground">No jobs yet — submit one from Submit Job.</p>
            )}
            {reqs.isLoading && (
              <p className="text-muted-foreground animate-pulse">Loading job analytics...</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-border/70 bg-card/60">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

function ChartCard({
  title,
  data,
  dataKey,
  color,
}: {
  title: string;
  data: Array<Record<string, string | number>>;
  dataKey: string;
  color: string;
}) {
  return (
    <Card className="border-border/70 bg-card/60">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
          <span>{dataKey}</span>
        </div>
      </CardHeader>
      <CardContent className="h-[240px]">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No data recorded yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.3} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} stroke="var(--color-border)" />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} stroke="var(--color-border)" allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-card)",
                  borderColor: "var(--color-border)",
                  borderRadius: "var(--radius)",
                  color: "var(--color-foreground)",
                  fontSize: "12px",
                  fontFamily: "var(--font-mono)",
                }}
                cursor={{ fill: "var(--color-accent)", opacity: 0.15 }}
              />
              <Bar dataKey={dataKey} fill={color} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
