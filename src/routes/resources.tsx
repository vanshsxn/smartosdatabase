import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppLayout } from "@/components/AppLayout";
import { Gauge, StatCard } from "@/components/dashboard-bits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { memoryQuery, resourcesQuery } from "@/lib/engine-queries";
import { useUsageHistory } from "@/lib/useUsageHistory";

export const Route = createFileRoute("/resources")({
  head: () => ({
    meta: [
      { title: "Resources | Smart Cloud Task Engine" },
      {
        name: "description",
        content: "Live core, memory block and thread pool utilisation for the scheduling engine.",
      },
      { property: "og:title", content: "Resources | Smart Cloud Task Engine" },
      {
        property: "og:description",
        content: "Live core, memory block and thread pool utilisation for the scheduling engine.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ResourcesPage,
});

function ResourcesPage() {
  const resources = useQuery(resourcesQuery);
  const memory = useQuery(memoryQuery);
  const history = useUsageHistory();
  const r = resources.data;
  const m = memory.data;

  return (
    <AppLayout title="Resources">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Cores in use" value={`${r?.usedCores ?? 0} / ${r?.totalCores ?? 0}`} />
        <StatCard
          label="Memory in use"
          value={`${r?.usedMemoryMb ?? 0} / ${r?.totalMemoryMb ?? 0} MB`}
        />
        <StatCard label="Active allocations" value={String(r?.activeAllocations ?? 0)} />
        <StatCard
          label="Thread pool"
          value={`${r?.threadPoolActive ?? 0} / ${r?.threadPoolWorkers ?? 0}`}
          hint={`${r?.threadPoolQueued ?? 0} queued · ${r?.threadPoolCompleted ?? 0} done`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Utilisation</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-around py-4">
            <Gauge label="CPU" value={r?.cpuUtilization ?? 0} />
            <Gauge label="Memory" value={r?.memoryUtilization ?? 0} />
            <Gauge label="Fragmentation" value={(m?.fragmentation ?? 0) * 100} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">CPU &amp; memory over time</CardTitle>
          </CardHeader>
          <CardContent className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="currentColor" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="currentColor" />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="cpu"
                  name="CPU %"
                  stroke="var(--color-primary)"
                  fill="var(--color-primary)"
                  fillOpacity={0.18}
                />
                <Area
                  type="monotone"
                  dataKey="memory"
                  name="Memory %"
                  stroke="var(--color-info)"
                  fill="var(--color-info)"
                  fillOpacity={0.18}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Memory blocks · {m?.usedBlocks ?? 0} used / {m?.freeBlocks ?? 0} free
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex h-6 w-full overflow-hidden rounded-md border border-border">
            {(m?.blocks ?? []).map((b, i) => (
              <div
                key={i}
                title={`${b.free ? "free" : b.ownerName} · ${b.sizeMb} MB`}
                className={b.free ? "bg-muted" : "bg-primary"}
                style={{ width: `${(b.sizeMb / Math.max(1, m?.totalMb ?? 1)) * 100}%` }}
              />
            ))}
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Base</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Owner job</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(m?.blocks ?? []).map((b, i) => (
                  <TableRow key={i}>
                    <TableCell className="tabular-nums">{b.base} MB</TableCell>
                    <TableCell className="tabular-nums">{b.sizeMb} MB</TableCell>
                    <TableCell className={b.free ? "text-muted-foreground" : "text-success"}>
                      {b.free ? "Free" : "Allocated"}
                    </TableCell>
                    <TableCell>
                      {b.free ? "—" : `#${b.ownerJobId} ${b.ownerName}`}
                    </TableCell>
                  </TableRow>
                ))}
                {!m?.blocks.length && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No memory blocks reported
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </AppLayout>
  );
}
