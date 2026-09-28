import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { AppLayout } from "@/components/AppLayout";
import { LiveJob } from "@/components/JobRequests";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useEngineStream } from "@/lib/engine-stream";
import { requestJob } from "@/lib/job-requests.functions";

export const Route = createFileRoute("/deployments")({
  head: () => ({
    meta: [
      { title: "GitHub Deployments | Smart Cloud Task Engine" },
      { name: "description", content: "Build GitHub projects on the engine and see CPU, memory, worker and run time per deployment." },
      { property: "og:title", content: "GitHub Deployments | Smart Cloud Task Engine" },
      { property: "og:description", content: "Real resource allocation for every GitHub build and deployment." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DeploymentsPage,
});

interface Run { id: number; name: string; head_branch: string; head_sha: string; status: string; conclusion: string | null; created_at: string; html_url: string }

function DeploymentsPage() {
  const [repo, setRepo] = useState("");
  const [active, setActive] = useState("");
  const qc = useQueryClient();
  const send = useServerFn(requestJob);
  const { snapshot } = useEngineStream();

  const runs = useQuery({
    queryKey: ["gh-runs", active],
    enabled: Boolean(active),
    queryFn: async () => {
      const r = await fetch(`https://api.github.com/repos/${active}/actions/runs?per_page=10`);
      if (!r.ok) throw new Error(r.status === 404 ? "Repository not found (must be public)" : `GitHub error ${r.status}`);
      return ((await r.json()).workflow_runs ?? []) as Run[];
    },
  });

  const deps = useQuery({
    queryKey: ["gh-deployments"],
    refetchInterval: 3000,
    queryFn: async () => {
      const { data, error } = await supabase.from("github_deployments").select("*").order("created_at", { ascending: false }).limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const deploy = useMutation({
    mutationFn: (run?: Run) =>
      send({ data: { name: `${active.split("/")[1]}${run ? `@${run.head_sha.slice(0, 7)}` : ""}`, type: "BUILD", priority: "HIGH", repo: active, runId: run ? String(run.id) : undefined, sha: run?.head_sha, branch: run?.head_branch } }),
    onSuccess: () => { toast.success("Build requested — waiting for admin approval"); qc.invalidateQueries({ queryKey: ["gh-deployments"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppLayout title="GitHub Deployments">
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Connect a public repository</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setActive(repo.trim().replace(/^https?:\/\/github.com\//, "").replace(/\/$/, "")); }}>
              <Input placeholder="owner/repo, e.g. vercel/next.js" value={repo} onChange={(e) => setRepo(e.target.value)} />
              <Button type="submit">Load</Button>
              {active && <Button type="button" variant="outline" disabled={deploy.isPending} onClick={() => deploy.mutate(undefined)}>Build latest</Button>}
            </form>
            {runs.error && <p className="text-sm text-destructive">{(runs.error as Error).message}</p>}
            {runs.data?.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded border border-border p-2 text-sm">
                <a href={r.html_url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{r.name}</a>
                <Badge variant="outline">{r.head_branch}</Badge>
                <span className="text-xs text-muted-foreground">{r.head_sha.slice(0, 7)} · {r.conclusion ?? r.status} · {new Date(r.created_at).toLocaleString()}</span>
                <Button size="sm" className="ml-auto" disabled={deploy.isPending} onClick={() => deploy.mutate(r)}>Build on engine</Button>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Deployment resource allocation</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {!deps.data?.length && <p className="text-sm text-muted-foreground">No deployments yet.</p>}
            {deps.data?.map((d) => {
              const job = d.job_id ? snapshot?.jobs.find((j) => j.id === Number(d.job_id)) : undefined;
              return (
                <div key={d.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{d.repo_full_name}</span>
                    {d.branch && <Badge variant="outline">{d.branch}</Badge>}
                    <Badge>{job ? (job.status === "COMPLETED" ? "DEPLOYED" : job.status) : d.status}</Badge>
                  </div>
                  {job && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      CPU allocated {job.requestedCores} cores · Memory {job.requestedMemoryMb} MB · Priority {job.priority}
                    </p>
                  )}
                  {job ? <LiveJob job={job} /> : d.job_id ? <p className="text-xs text-muted-foreground">Engine job #{d.job_id} finished and left the live window.</p> : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
