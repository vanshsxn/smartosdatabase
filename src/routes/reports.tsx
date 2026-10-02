import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AppLayout } from "@/components/AppLayout";
import { fmtMs } from "@/components/dashboard-bits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { metricsQuery } from "@/lib/engine-queries";
import { JOB_PRESETS } from "@/lib/job-presets";
import { useSession } from "@/lib/session";

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
  const { tenants, isAdmin } = useSession();
  const metrics = useQuery(metricsQuery);
  const reqs = useQuery({
    queryKey: ["reports-requests"],
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_requests")
        .select("id, tenant_id, email, name, type, status, estimated_credits, estimated_ms, created_at, decided_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
  const list = reqs.data ?? [];
  const nameOf = (id: string) => tenants.find((t) => t.id === id)?.name ?? id;
  const charged = (r: (typeof list)[number]) =>
    ["RUNNING", "COMPLETED"].includes(r.status) ? Number(r.estimated_credits) : 0;

  const byTenant = [...new Set(list.map((j) => j.tenant_id))].map((id) => {
    const rows = list.filter((j) => j.tenant_id === id);
    return { name: nameOf(id), jobs: rows.length, credits: Number(rows.reduce((s, r) => s + charged(r), 0).toFixed(2)) };
  });
  const byType = Object.entries(
    list.reduce<Record<string, number>>((acc, j) => {
      const label = JOB_PRESETS.find((p) => p.type === j.type)?.label ?? j.type;
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {}),
  ).map(([name, count]) => ({ name, count }));
  const byStatus = Object.entries(
    list.reduce<Record<string, number>>((acc, j) => ((acc[j.status] = (acc[j.status] ?? 0) + 1), acc), {}),
  ).map(([name, count]) => ({ name, count }));
  const totalCredits = list.reduce((s, r) => s + charged(r), 0);
  const recent = list.slice(0, 10);

  return (
    <AppLayout title="Reports">
      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        <Stat label="Jobs submitted" value={String(list.length)} />
        <Stat label="Completed" value={String(list.filter((r) => r.status === "COMPLETED").length)} />
        <Stat label="Credits spent" value={totalCredits.toFixed(2)} />
        <Stat label="Throughput" value={`${(metrics.data?.throughputPerMin ?? 0).toFixed(1)}/min`} />
      </div>
      {reqs.error && <p className="mb-4 text-sm text-destructive">Could not load reports: {(reqs.error as Error).message}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {isAdmin && <ChartCard title="Jobs per tenant" data={byTenant} dataKey="jobs" />}
        <ChartCard title={isAdmin ? "Credits per tenant" : "My credits spent"} data={byTenant} dataKey="credits" />
        <ChartCard title="Jobs by type" data={byType} dataKey="count" />
        <ChartCard title="Jobs by status" data={byStatus} dataKey="count" />
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent jobs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {recent.map((j) => (
              <div key={j.id} className="flex flex-wrap justify-between gap-2 border-b border-border pb-1.5">
                <span>
                  {j.name} <span className="text-muted-foreground">· {j.type}{isAdmin ? ` · ${nameOf(j.tenant_id)}` : ""}</span>
                </span>
                <span className="text-muted-foreground">
                  {j.status} · {charged(j).toFixed(2)} cr · {fmtMs(j.estimated_ms)} · {new Date(j.created_at).toLocaleString()}
                </span>
              </div>
            ))}
            {!recent.length && <p className="text-muted-foreground">No jobs yet — submit one from Submit Job.</p>}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
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
