import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { AppLayout } from "@/components/AppLayout";
import { PriorityText, StatusText, fmtMs, fmtTime } from "@/components/dashboard-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cancelJob } from "@/lib/engine";
import { jobsQuery } from "@/lib/engine-queries";
import { tenantName, useSession } from "@/lib/session";

export const Route = createFileRoute("/jobs")({
  head: () => ({
    meta: [
      { title: "All Jobs | Smart Cloud Task Engine" },
      {
        name: "description",
        content: "Tenant-scoped job history with status, priority, credits and cancel controls.",
      },
      { property: "og:title", content: "All Jobs | Smart Cloud Task Engine" },
      {
        property: "og:description",
        content: "Tenant-scoped job history with status, priority, credits and cancel controls.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: JobsPage,
});

function JobsPage() {
  const { tenantId } = useSession();
  const qc = useQueryClient();
  const jobs = useQuery(jobsQuery(tenantId));
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");

  const cancel = useMutation({
    mutationFn: (id: number) => cancelJob(id),
    onSuccess: (res) => {
      toast[res.cancelled ? "success" : "error"](res.message);
      qc.invalidateQueries({ queryKey: ["engine"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (jobs.data ?? []).filter((j) => {
    const matchStatus = status === "ALL" || j.status === status;
    const term = search.trim().toLowerCase();
    const matchTerm =
      !term ||
      j.name.toLowerCase().includes(term) ||
      String(j.id).includes(term) ||
      j.type.toLowerCase().includes(term);
    return matchStatus && matchTerm;
  });

  return (
    <AppLayout title="All Jobs">
      <Card>
        <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">
            {tenantId ? `${tenantName(tenantId)} jobs` : "All tenants"} · {rows.length}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Search name, id or type"
              className="w-56"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["ALL", "QUEUED", "RUNNING", "COMPLETED", "CANCELLED", "FAILED"].map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>CPU / RAM</TableHead>
                <TableHead>Waited</TableHead>
                <TableHead>CPU time</TableHead>
                <TableHead>Credits</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((j) => {
                const active = j.status === "QUEUED" || j.status === "RUNNING";
                return (
                  <TableRow key={j.id}>
                    <TableCell className="tabular-nums">{j.id}</TableCell>
                    <TableCell>{j.name}</TableCell>
                    <TableCell>{tenantName(j.tenantId)}</TableCell>
                    <TableCell className="text-muted-foreground">{j.type}</TableCell>
                    <TableCell>
                      <PriorityText priority={j.priority} />
                    </TableCell>
                    <TableCell>
                      <StatusText status={j.status} />
                    </TableCell>
                    <TableCell>
                      {j.requestedCores} core / {j.requestedMemoryMb} MB
                    </TableCell>
                    <TableCell>{fmtMs(j.waitingMs)}</TableCell>
                    <TableCell>{fmtMs(j.cpuTimeUsedMs)}</TableCell>
                    <TableCell className="tabular-nums">
                      {(j.creditsCharged || j.estimatedCredits || 0).toFixed(2)}
                    </TableCell>
                    <TableCell>{fmtTime(j.submittedAtMs)}</TableCell>
                    <TableCell className="space-x-2 text-right whitespace-nowrap">
                      <Link
                        to="/logs"
                        search={{ jobId: j.id }}
                        className="text-sm text-primary hover:underline"
                      >
                        Logs
                      </Link>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!active || cancel.isPending}
                        onClick={() => cancel.mutate(j.id)}
                      >
                        Cancel
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-muted-foreground">
                    No jobs match the current filters
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
