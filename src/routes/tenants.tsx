import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { setCredits } from "@/lib/engine";
import { jobsQuery, tenantCreditsQuery } from "@/lib/engine-queries";
import { TENANTS } from "@/lib/session";

export const Route = createFileRoute("/tenants")({
  head: () => ({
    meta: [
      { title: "Tenants | Smart Cloud Task Engine" },
      { name: "description", content: "Tenant credit pools, plans and per-tenant job activity." },
      { property: "og:title", content: "Tenants | Smart Cloud Task Engine" },
      {
        property: "og:description",
        content: "Tenant credit pools, plans and per-tenant job activity.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TenantsPage,
});

function TenantsPage() {
  const qc = useQueryClient();
  const credits = useQuery(tenantCreditsQuery);
  const jobs = useQuery(jobsQuery(""));
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (v: { tenantId: string; credits: number }) => setCredits(v),
    onSuccess: (res) => {
      toast.success(`${res.tenantId} set to ${res.credits} credits`);
      qc.invalidateQueries({ queryKey: ["engine"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const balance = (id: string) =>
    credits.data?.find((c) => c.tenantId === id)?.credits ?? 1000;

  return (
    <AppLayout title="Tenants">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Tenant credit pools</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Jobs</TableHead>
                <TableHead>Credits used</TableHead>
                <TableHead>Balance</TableHead>
                <TableHead className="text-right">Set balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {TENANTS.map((t) => {
                const list = (jobs.data ?? []).filter((j) => j.tenantId === t.id);
                const used = list.reduce((s, j) => s + (j.creditsCharged || 0), 0);
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-muted-foreground">{t.plan}</TableCell>
                    <TableCell className="tabular-nums">{list.length}</TableCell>
                    <TableCell className="tabular-nums">{used.toFixed(2)}</TableCell>
                    <TableCell className="tabular-nums">{balance(t.id).toFixed(2)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Input
                          className="w-28"
                          type="number"
                          placeholder={String(balance(t.id))}
                          value={drafts[t.id] ?? ""}
                          onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!drafts[t.id] || save.isPending}
                          onClick={() =>
                            save.mutate({ tenantId: t.id, credits: Number(drafts[t.id]) })
                          }
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
    </AppLayout>
  );
}
