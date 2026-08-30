import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAlerts } from "@/lib/alerts";
import { healthQuery, resourcesQuery } from "@/lib/engine-queries";
import { TENANTS, useSession } from "@/lib/session";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings | Smart Cloud Task Engine" },
      {
        name: "description",
        content: "Session, default tenant and engine connection settings for the dashboard.",
      },
      { property: "og:title", content: "Settings | Smart Cloud Task Engine" },
      {
        property: "og:description",
        content: "Session, default tenant and engine connection settings for the dashboard.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, tenantId, setTenantId, signOut } = useSession();
  const health = useQuery(healthQuery);
  const resources = useQuery(resourcesQuery);
  const { rules, saveRules, saving } = useAlerts();

  return (
    <AppLayout title="Settings">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Session</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Row label="Signed in as" value={user?.email ?? "Not signed in"} />
            <div className="space-y-1.5">
              <Label>Default tenant</Label>
              <Select value={tenantId || "all"} onValueChange={(v) => setTenantId(v === "all" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tenants</SelectItem>
                  {TENANTS.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
