import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AppLayout } from "@/components/AppLayout";
import { fmtMs } from "@/components/dashboard-bits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { jobsQuery, metricsQuery } from "@/lib/engine-queries";
import { TENANTS, tenantName, useSession } from "@/lib/session";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports | Smart Cloud Task Engine" },
      {
        name: "description",
        content: "Throughput, latency and per-tenant workload reports for the scheduling engine.",
      },
      { property: "og:title", content: "Reports | Smart Cloud Task Engine" },
      {
        property: "og:description",
        content: "Throughput, latency and per-tenant workload reports for the scheduling engine.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const { tenantId } = useSession();
  const jobs = useQuery(jobsQuery(tenantId));
  const metrics = useQuery(metricsQuery);
  const list = jobs.data ?? [];

  const byTenant = TENANTS.map((t) => ({
    name: t.name,
    jobs: list.filter((j) => j.tenantId === t.id).length,
    credits: Number(
      list
        .filter((j) => j.tenantId === t.id)
        .reduce((s, j) => s + (j.creditsCharged || 0), 0)
        .toFixed(2),
    ),
  }));

  const byType = Object.entries(
    list.reduce<Record<string, number>>((acc, j) => {
      acc[j.type] = (acc[j.type] ?? 0) + 1;
      return acc;
    }, {}),
  ).map(([name, count]) => ({ name, count }));

  const slowest = [...list]
    .filter((j) => j.status === "COMPLETED")
    .sort((a, b) => b.waitingMs - a.waitingMs)
    .slice(0, 8);

  return (
    <AppLayout title="Reports">
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Jobs per tenant" data={byTenant} dataKey="jobs" />
        <ChartCard title="Credits per tenant" data={byTenant} dataKey="credits" />
        <ChartCard title="Jobs by type" data={byType} dataKey="count" />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Longest waiting completed jobs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {slowest.map((j) => (
              <div key={j.id} className="flex justify-between border-b border-border pb-1.5">
                <span>
                  #{j.id} {j.name}{" "}
                  <span className="text-muted-foreground">· {tenantName(j.tenantId)}</span>
                </span>
                <span className="font-medium">{fmtMs(j.waitingMs)}</span>
              </div>
            ))}
            {!slowest.length && <p className="text-muted-foreground">No completed jobs yet.</p>}
            <p className="pt-2 text-xs text-muted-foreground">
              Policy {metrics.data?.policy ?? "—"} · throughput{" "}
              {(metrics.data?.throughputPerMin ?? 0).toFixed(1)} jobs/min
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function ChartCard({
  title,
  data,
  dataKey,
}: {
  title: string;
  data: Array<Record<string, string | number>>;
  dataKey: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.4} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="currentColor" />
            <YAxis tick={{ fontSize: 11 }} stroke="currentColor" allowDecimals={false} />
            <Tooltip
              contentStyle={{
                background: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
              }}
            />
            <Bar dataKey={dataKey} fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
