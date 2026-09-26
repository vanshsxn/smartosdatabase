import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { explainBilling } from "@/lib/billing-insights.functions";
import { setCredits } from "@/lib/engine";
import { jobsQuery, logsQuery, tenantCreditsQuery } from "@/lib/engine-queries";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/tenants")({
  head: () => ({
    meta: [
      { title: "Tenants | Smart Cloud Task Engine" },
      { name: "description", content: "Admin view of tenant credit pools, job history and AI billing explanations." },
      { property: "og:title", content: "Tenants | Smart Cloud Task Engine" },
      { property: "og:description", content: "Admin view of tenant credit pools, job history and AI billing explanations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TenantsPage,
});

function TenantsPage() {
  const { isAdmin, tenants } = useSession();
  const qc = useQueryClient();
  const credits = useQuery(tenantCreditsQuery);
  const jobs = useQuery(jobsQuery(""));
  const logs = useQuery(logsQuery(undefined, 500));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState("");
  const [notes, setNotes] = useState("");
  const [answer, setAnswer] = useState("");
  const explain = useServerFn(explainBilling);

  const save = useMutation({
    mutationFn: (v: { tenantId: string; credits: number }) => setCredits(v),
    onSuccess: (res) => {
      toast.success(`${res.tenantId} set to ${res.credits} credits`);
      qc.invalidateQueries({ queryKey: ["engine"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const balance = (id: string) => credits.data?.find((c) => c.tenantId === id)?.credits ?? 1000;

  const analyze = useMutation({
    mutationFn: async () => {
      const t = tenants.find((x) => x.id === selected);
      if (!t) throw new Error("Pick a tenant first.");
      const tJobs = (jobs.data ?? []).filter((j) => j.tenantId === t.id).slice(0, 150);
      const ids = new Set(tJobs.map((j) => j.id));
      const tLogs = (logs.data ?? [])
        .filter((l) => ids.has(l.jobId) || l.message.includes(t.id))
        .slice(-150)
        .map((l) => ({ ts: new Date(l.timestampMs).toISOString(), level: l.level, msg: l.message.slice(0, 500) }));
      return explain({
        data: {
          tenantId: t.id,
          tenantName: t.name,
          balance: balance(t.id),
          notes,
          jobs: tJobs.map((j) => ({
            id: j.id,
            name: j.name.slice(0, 200),
            type: j.type,
            status: j.status,
            priority: j.priority,
            requestedCores: j.requestedCores,
            requestedMemoryMb: j.requestedMemoryMb,
            cpuTimeUsedMs: j.cpuTimeUsedMs,
            creditsCharged: j.creditsCharged,
            workerId: j.workerId,
          })),
          logs: tLogs,
        },
      });
    },
    onSuccess: (r) => setAnswer(r.text),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) {
    return (
      <AppLayout title="Tenants">
        <Card>
          <CardContent className="p-6 text-muted-foreground">This page is only available to admins.</CardContent>
        </Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Tenants">
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Tenant credit pools</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Jobs</TableHead>
                  <TableHead>Credits used</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead className="text-right">Allocate credits</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">No tenant accounts yet.</TableCell>
                  </TableRow>
                )}
                {tenants.map((t) => {
                  const list = (jobs.data ?? []).filter((j) => j.tenantId === t.id);
                  const used = list.reduce((s, j) => s + (j.creditsCharged || 0), 0);
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="text-muted-foreground">{t.email}</TableCell>
                      <TableCell className="tabular-nums">{list.length}</TableCell>
                      <TableCell className="tabular-nums">{used.toFixed(2)}</TableCell>
                      <TableCell className="tabular-nums">{balance(t.id).toFixed(2)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Input
                            className="w-28"
                            type="number"
                            placeholder={String(balance(t.id).toFixed(0))}
                            value={drafts[t.id] ?? ""}
                            onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!drafts[t.id] || save.isPending}
                            onClick={() => save.mutate({ tenantId: t.id, credits: Number(drafts[t.id]) })}
                          >
                            Save
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> Explain unusual charges
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Pick a tenant. Its real jobs, charges and billing logs are sent to AI, which explains balance changes and
              flags anything unusual. Add context or a question below if you like.
            </p>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setAnswer("");
              }}
            >
              <option value="">Select a tenant…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {balance(t.id).toFixed(2)} credits
                </option>
              ))}
            </select>
            <Textarea
              placeholder="e.g. Tenant says their balance dropped 200 credits overnight — why?"
              value={notes}
              maxLength={4000}
              onChange={(e) => setNotes(e.target.value)}
            />
            <Button disabled={!selected || analyze.isPending} onClick={() => analyze.mutate()}>
              {analyze.isPending ? "Analyzing…" : "Explain charges"}
            </Button>
            {answer && (
              <div className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-4 text-sm leading-relaxed">
                {answer}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
