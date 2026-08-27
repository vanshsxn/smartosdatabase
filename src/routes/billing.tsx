import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Coins, Receipt, Wallet } from "lucide-react";

import { AppLayout } from "@/components/AppLayout";
import { StatCard, fmtMs, fmtTime } from "@/components/dashboard-bits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { jobsQuery, tenantCreditsQuery } from "@/lib/engine-queries";
import { tenantName, useSession } from "@/lib/session";

export const Route = createFileRoute("/billing")({
  head: () => ({
    meta: [
      { title: "Billing | Smart Cloud Task Engine" },
      {
        name: "description",
        content: "Job costs, remaining credits and per-tenant billing and audit entries.",
      },
      { property: "og:title", content: "Billing | Smart Cloud Task Engine" },
      {
        property: "og:description",
        content: "Job costs, remaining credits and per-tenant billing and audit entries.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BillingPage,
});

function BillingPage() {
  const { tenantId } = useSession();
  const jobs = useQuery(jobsQuery(tenantId));
  const credits = useQuery(tenantCreditsQuery);

  const rows = (jobs.data ?? []).filter((j) => j.creditsCharged > 0 || j.estimatedCredits > 0);
  const charged = rows.reduce((s, j) => s + (j.creditsCharged || 0), 0);
  const pending = rows.reduce(
    (s, j) => s + (j.creditsCharged ? 0 : j.estimatedCredits || 0),
    0,
  );
  const balance = tenantId
    ? (credits.data?.find((c) => c.tenantId === tenantId)?.credits ?? 1000)
    : (credits.data ?? []).reduce((s, c) => s + c.credits, 0);

  return (
    <AppLayout title="Billing">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Credits charged"
          value={charged.toFixed(2)}
          icon={<Receipt className="h-5 w-5" />}
        />
        <StatCard
          label="Pending estimate"
          value={pending.toFixed(2)}
          tone="warning"
          icon={<Coins className="h-5 w-5" />}
        />
        <StatCard
          label={tenantId ? `${tenantName(tenantId)} balance` : "Total balance"}
          value={balance.toFixed(2)}
          tone="success"
          icon={<Wallet className="h-5 w-5" />}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Billing &amp; audit entries</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>CPU time</TableHead>
                <TableHead>Cores</TableHead>
                <TableHead>Memory</TableHead>
                <TableHead>Charged</TableHead>
                <TableHead>Completed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((j) => (
                <TableRow key={j.id}>
                  <TableCell>
                    #{j.id} · {j.name}
                  </TableCell>
                  <TableCell>{tenantName(j.tenantId)}</TableCell>
                  <TableCell className="text-muted-foreground">{j.status}</TableCell>
                  <TableCell>{fmtMs(j.cpuTimeUsedMs)}</TableCell>
                  <TableCell className="tabular-nums">{j.requestedCores}</TableCell>
                  <TableCell className="tabular-nums">{j.requestedMemoryMb} MB</TableCell>
                  <TableCell className="tabular-nums">
                    {(j.creditsCharged || j.estimatedCredits).toFixed(2)}
                    {j.creditsCharged ? "" : " (est)"}
                  </TableCell>
                  <TableCell>{fmtTime(j.completedAtMs)}</TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    No billable activity yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppLayout>
  );
}
