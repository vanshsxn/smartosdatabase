import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { AppLayout } from "@/components/AppLayout";
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
import { useAlerts } from "@/lib/alerts";
import { jobsQuery, logsQuery } from "@/lib/engine-queries";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const searchSchema = z.object({ jobId: z.coerce.number().optional() });

export const Route = createFileRoute("/logs")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Execution Logs | Smart Cloud Task Engine" },
      {
        name: "description",
        content: "Filterable execution log viewer for runtime events and job termination reasons.",
      },
      { property: "og:title", content: "Execution Logs | Smart Cloud Task Engine" },
      {
        property: "og:description",
        content: "Filterable execution log viewer for runtime events and job termination reasons.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LogsPage,
});

const LEVEL_TONE: Record<string, string> = {
  ERROR: "text-destructive",
  WARN: "text-warning",
  INFO: "text-success",
  DEBUG: "text-muted-foreground",
};

function LogsPage() {
  const { jobId } = Route.useSearch();
  const navigate = useNavigate({ from: "/logs" });
  const { tenantId } = useSession();
  const jobs = useQuery(jobsQuery(tenantId));
  const logs = useQuery(logsQuery(jobId, 400));
  const { events, refreshEvents } = useAlerts();
  const [level, setLevel] = useState("ALL");
  const [source, setSource] = useState("ALL");
  const [term, setTerm] = useState("");

  const entries = (logs.data ?? []).filter((l) => {
    if (level !== "ALL" && l.level !== level) return false;
    if (source !== "ALL" && l.source !== source) return false;
    if (term && !l.message.toLowerCase().includes(term.toLowerCase())) return false;
    return true;
  });

  const sources = Array.from(new Set((logs.data ?? []).map((l) => l.source))).sort();

  return (
    <AppLayout title="Execution Logs">
      <Card>
        <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">
            {jobId ? `Job #${jobId}` : "All jobs"} · {entries.length} events
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Select
              value={jobId ? String(jobId) : "all"}
              onValueChange={(v) =>
                navigate({ search: v === "all" ? {} : { jobId: Number(v) }, replace: true })
              }
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Job" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All jobs</SelectItem>
                {(jobs.data ?? []).map((j) => (
                  <SelectItem key={j.id} value={String(j.id)}>
                    #{j.id} · {j.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["ALL", "DEBUG", "INFO", "WARN", "ERROR"].map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All sources</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="w-52"
              placeholder="Search message"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            <Button variant="outline" onClick={() => logs.refetch()}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-[65vh] overflow-auto rounded-md border border-border bg-card/40 p-3 font-mono text-xs leading-relaxed">
            {entries.length ? (
              entries.map((l, i) => (
                <div key={`${l.timestampMs}-${i}`} className="flex gap-3 py-0.5">
                  <span className="shrink-0 text-muted-foreground">
                    {new Date(l.timestampMs).toLocaleTimeString([], { hour12: false })}
                  </span>
                  <span className={cn("w-12 shrink-0", LEVEL_TONE[l.level])}>{l.level}</span>
                  <span className="w-20 shrink-0 text-primary">{l.source}</span>
                  <span className="w-16 shrink-0 text-muted-foreground">
                    {l.jobId >= 0 ? `#${l.jobId}` : "—"}
                  </span>
                  <span className="min-w-0 break-words">{l.message}</span>
                </div>
              ))
            ) : (
              <p className="py-8 text-center text-muted-foreground">No log entries</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Alert events · {events.length}</CardTitle>
          <Button variant="outline" onClick={() => void refreshEvents()}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <div className="max-h-[40vh] overflow-auto rounded-md border border-border bg-card/40">
            {events.length ? (
              <ul className="divide-y divide-border text-sm">
                {events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleString()}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px]",
                        e.severity === "ERROR"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-warning/15 text-warning",
                      )}
                    >
                      {e.severity}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-primary">{e.kind}</span>
                    <span className="min-w-0 break-words">{e.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No alert events yet</p>
            )}
          </div>
        </CardContent>
      </Card>
    </AppLayout>
  );
}
