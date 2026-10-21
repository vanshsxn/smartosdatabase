import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Database, HardDrive, RefreshCw, Table as TableIcon } from "lucide-react";
import { useState } from "react";

import { AppLayout } from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAlerts } from "@/lib/alerts";
import { healthQuery, resourcesQuery } from "@/lib/engine-queries";
import { tenantName, useSession } from "@/lib/session";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings & Database | Smart Cloud Task Engine" },
      {
        name: "description",
        content: "Session, default tenant, live PostgreSQL database inspector and engine connection settings.",
      },
      { property: "og:title", content: "Settings & Database | Smart Cloud Task Engine" },
      {
        property: "og:description",
        content: "Session, default tenant, live PostgreSQL database inspector and engine connection settings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, ownTenantId, isAdmin, signOut } = useSession();
  const health = useQuery(healthQuery);
  const resources = useQuery(resourcesQuery);
  const { rules, saveRules, saving } = useAlerts();

  // Live Database Table Inspector
  const [selectedTable, setSelectedTable] = useState("job_requests");

  const dbData = useQuery({
    queryKey: ["db-inspector", selectedTable],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error, count } = await (supabase.from(selectedTable as any) as any)
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        // Fallback without created_at sort if column missing
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fallback = await (supabase.from(selectedTable as any) as any)
          .select("*", { count: "exact" })
          .limit(50);
        if (fallback.error) throw fallback.error;
        return { rows: (fallback.data ?? []) as Record<string, any>[], count: fallback.count ?? 0 };
      }
      return { rows: (data ?? []) as Record<string, any>[], count: count ?? 0 };
    },
    refetchInterval: 5000,
  });

  const columns = dbData.data?.rows?.length ? Object.keys(dbData.data.rows[0]) : [];

  return (
    <AppLayout title="Settings & Database">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Session</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Row label="Signed in as" value={user?.email ?? "Not signed in"} />
            <Row label="Account type" value={isAdmin ? "Administrator (all tenants)" : "Tenant"} />
            <Row label="Tenant" value={`${tenantName(ownTenantId)} (${ownTenantId})`} />
            <Button variant="outline" onClick={signOut}>
              Sign out
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Engine</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Status" value={health.data ? health.data.status : "unreachable"} />
            <Row label="Paused" value={health.data?.paused ? "yes" : "no"} />
            <Row label="Policy" value={health.data?.policy ?? "—"} />
            <Row label="Workers" value={String(health.data?.workers ?? 0)} />
            <Row label="Cores" value={String(resources.data?.totalCores ?? 0)} />
            <Row label="Memory" value={`${resources.data?.totalMemoryMb ?? 0} MB`} />
            <p className="pt-2 text-xs text-muted-foreground">
              The dashboard talks to the engine through <code>/api/engine/*</code>; change the
              target with the <code>ENGINE_URL</code> environment variable.
            </p>
          </CardContent>
        </Card>

        {/* Live Database Explorer */}
        <Card className="lg:col-span-2 border-primary/30">
          <CardHeader className="pb-3 border-b border-border/50">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="h-4 w-4 text-primary" />
                  <span>PostgreSQL Database Explorer (Live Supabase Tables)</span>
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Direct live connection to PostgreSQL project <code>rxujfojaqahjsbpjhnyu</code>. View stored rows, timestamps, and payloads.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Select value={selectedTable} onValueChange={setSelectedTable}>
                  <SelectTrigger className="w-48 h-8 text-xs font-mono">
                    <SelectValue placeholder="Select Table" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="job_requests">public.job_requests</SelectItem>
                    <SelectItem value="tenant_credits">public.tenant_credits</SelectItem>
                    <SelectItem value="profiles">public.profiles</SelectItem>
                    <SelectItem value="github_deployments">public.github_deployments</SelectItem>
                    <SelectItem value="alert_events">public.alert_events</SelectItem>
                    <SelectItem value="alert_rules">public.alert_rules</SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 text-xs"
                  onClick={() => dbData.refetch()}
                  disabled={dbData.isFetching}
                >
                  <RefreshCw className={`h-3 w-3 ${dbData.isFetching ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5 font-mono">
                <TableIcon className="h-3.5 w-3.5 text-primary" />
                Table: <strong>{selectedTable}</strong>
              </span>
              <Badge variant="outline" className="font-mono text-xs">
                {dbData.data?.count ?? 0} total records
              </Badge>
            </div>

            {dbData.isLoading && (
              <p className="text-xs text-muted-foreground py-8 text-center animate-pulse">
                Fetching rows directly from PostgreSQL...
              </p>
            )}

            {dbData.error && (
              <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                Error querying table: {(dbData.error as Error).message}
              </div>
            )}

            {!dbData.isLoading && !dbData.error && dbData.data?.rows.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-8 text-center">
                <p className="text-sm font-medium text-foreground">No records found in {selectedTable}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Submit a job or perform an action to populate this table in the database.
                </p>
              </div>
            )}

            {!dbData.isLoading && !dbData.error && (dbData.data?.rows.length ?? 0) > 0 && (
              <div className="rounded-md border border-border overflow-hidden">
                <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                  <Table className="text-xs font-mono">
                    <TableHeader className="bg-muted/50 sticky top-0">
                      <TableRow>
                        {columns.map((col) => (
                          <TableHead key={col} className="whitespace-nowrap px-3 py-2 text-foreground font-semibold">
                            {col}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dbData.data!.rows.map((row, idx) => (
                        <TableRow key={row.id ?? idx} className="hover:bg-muted/30">
                          {columns.map((col) => {
                            const val = row[col];
                            let rendered = String(val ?? "NULL");
                            if (typeof val === "object" && val !== null) {
                              rendered = JSON.stringify(val);
                            }
                            const isLong = rendered.length > 50;
                            return (
                              <TableCell key={col} className="px-3 py-2 max-w-[260px] truncate" title={rendered}>
                                {col === "status" ? (
                                  <Badge variant="outline" className="text-[10px] py-0 px-1 font-semibold">
                                    {rendered}
                                  </Badge>
                                ) : isLong ? (
                                  <span className="text-muted-foreground">{rendered.slice(0, 45)}…</span>
                                ) : val === null ? (
                                  <span className="text-muted-foreground/50 italic">NULL</span>
                                ) : (
                                  rendered
                                )}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Alert Thresholds */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Alert thresholds</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <Label>Alerting enabled</Label>
                <p className="text-xs text-muted-foreground">
                  Fire notifications and record alert events when a threshold is breached.
                </p>
              </div>
              <Switch
                checked={rules.enabled}
                onCheckedChange={(v) => void saveRules({ enabled: v })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <ThresholdField
                id="cpu"
                label="CPU usage (%)"
                value={rules.cpu_threshold}
                onCommit={(n) => void saveRules({ cpu_threshold: n })}
              />
              <ThresholdField
                id="memory"
                label="Memory usage (%)"
                value={rules.memory_threshold}
                onCommit={(n) => void saveRules({ memory_threshold: n })}
              />
              <ThresholdField
                id="credits"
                label="Credit depletion (credits left)"
                value={rules.credit_threshold}
                onCommit={(n) => void saveRules({ credit_threshold: n })}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {saving ? "Saving…" : "Changes save automatically. Alerts appear in Execution Logs."}
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function ThresholdField({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (n: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={0}
        defaultValue={value}
        key={`${id}-${value}`}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n !== value) onCommit(n);
        }}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-border pb-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
