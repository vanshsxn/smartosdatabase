import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Github, LogOut } from "lucide-react";
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
import {
  completeGithubConnection,
  disconnectGithub,
  fetchGithubProfile,
  fetchGithubRepos,
  startGithubConnect,
} from "@/server/github";

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

function waitForOAuthCompletion(popup: Window) {
  return new Promise<string | null>((resolve, reject) => {
    let poll: number | undefined;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      if (poll !== undefined) window.clearInterval(poll);
    };
    const onMessage = (event: MessageEvent) => {
      const type = event.data?.type;
      if (
        event.origin !== window.location.origin ||
        event.source !== popup ||
        event.data?.connectorId !== "github" ||
        (type !== "appUserConnectorOAuthComplete" && type !== "appUserConnectorOAuthFailed")
      ) return;
      cleanup();
      if (type === "appUserConnectorOAuthComplete") {
        resolve(typeof event.data?.code === "string" ? event.data.code : null);
        return;
      }
      popup.close();
      reject(new Error("GitHub connection failed."));
    };
    window.addEventListener("message", onMessage);
    poll = window.setInterval(() => {
      if (!popup.closed) return;
      cleanup();
      reject(new Error("OAuth window closed before completion."));
    }, 500);
  });
}

function DeploymentsPage() {
  const [repo, setRepo] = useState("");
  const [active, setActive] = useState("");
  const qc = useQueryClient();
  const send = useServerFn(requestJob);
  const startConnect = useServerFn(startGithubConnect);
  const completeConnect = useServerFn(completeGithubConnection);
  const getProfile = useServerFn(fetchGithubProfile);
  const getRepos = useServerFn(fetchGithubRepos);
  const doDisconnect = useServerFn(disconnectGithub);
  const { snapshot } = useEngineStream();

  const profile = useQuery({
    queryKey: ["gh-profile"],
    queryFn: () => getProfile(),
    retry: false,
  });

  const repos = useQuery({
    queryKey: ["gh-repos"],
    enabled: profile.data?.connected === true,
    queryFn: () => getRepos(),
  });

  const connect = useMutation({
    mutationFn: async () => {
      const popup = window.open("", "lovable-oauth", "width=600,height=720");
      if (!popup) throw new Error("Popup blocked. Allow popups and try again.");
      let code: string | null;
      try {
        const { authorizationUrl } = await startConnect();
        const completion = waitForOAuthCompletion(popup);
        popup.location.href = authorizationUrl;
        code = await completion;
      } catch (error) {
        popup.close();
        throw error;
      }
      if (code) await completeConnect({ data: { code } });
    },
    onSuccess: () => {
      toast.success("Connected to GitHub");
      qc.invalidateQueries({ queryKey: ["gh-profile"] });
      qc.invalidateQueries({ queryKey: ["gh-repos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnect = useMutation({
    mutationFn: () => doDisconnect(),
    onSuccess: () => {
      toast.success("Disconnected from GitHub");
      qc.invalidateQueries({ queryKey: ["gh-profile"] });
      qc.invalidateQueries({ queryKey: ["gh-repos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

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

  const ghConnected = profile.data?.connected === true;

  return (
    <AppLayout title="GitHub Deployments">
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Your GitHub account</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {profile.isPending && <p className="text-sm text-muted-foreground">Checking connection…</p>}
            {profile.error && (
              <p className="text-sm text-muted-foreground">{(profile.error as Error).message}</p>
            )}
            {!profile.isPending && !ghConnected && !profile.error && (
              <div className="space-y-2">
                {profile.data?.reconnectRequired && (
                  <p className="text-sm text-muted-foreground">Your GitHub access needs to be renewed.</p>
                )}
                <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
                  <Github className="mr-2 h-4 w-4" />
                  {profile.data?.reconnectRequired ? "Reconnect GitHub" : "Sign in with GitHub"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Connect your own GitHub account to see your repositories here and build them on the engine.
                </p>
              </div>
            )}
            {ghConnected && profile.data.connected && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <img src={profile.data.profile.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
                  <div>
                    <p className="text-sm font-medium">{profile.data.profile.name ?? profile.data.profile.login}</p>
                    <p className="text-xs text-muted-foreground">@{profile.data.profile.login}</p>
                  </div>
                  <Button variant="outline" size="sm" className="ml-auto" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
                    <LogOut className="mr-1 h-3 w-3" /> Disconnect
                  </Button>
                </div>
                {repos.data?.connected && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Your repositories</p>
                    {repos.data.repos.length === 0 && <p className="text-sm text-muted-foreground">No repositories found.</p>}
                    {repos.data.repos.map((r) => (
                      <div key={r.fullName} className="flex flex-wrap items-center gap-2 rounded border border-border p-2 text-sm">
                        <a href={r.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{r.fullName}</a>
                        {r.private && <Badge variant="outline">private</Badge>}
                        <span className="text-xs text-muted-foreground">updated {new Date(r.updatedAt).toLocaleDateString()}</span>
                        <Button size="sm" variant="outline" className="ml-auto" onClick={() => { setRepo(r.fullName); setActive(r.fullName); }}>
                          View runs
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
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
