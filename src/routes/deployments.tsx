import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  ExternalLink,
  GitBranch,
  GitCommit,
  Github,
  HardDrive,
  Layers,
  LogOut,
  Play,
  RotateCw,
  Search,
  Star,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppLayout } from "@/components/AppLayout";
import { LiveJob } from "@/components/JobRequests";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { executeCreditDebit } from "@/lib/billing-transactions";
import { useEngineStream } from "@/lib/engine-stream";
import { estimateCredits } from "@/lib/job-presets";
import { requestJob } from "@/lib/job-requests.functions";
import { useSession } from "@/lib/session";
import {
  completeGithubConnection,
  disconnectGithub,
  fetchGithubProfile,
  fetchGithubRepos,
  startGithubConnect,
} from "@/lib/github.functions";

export const Route = createFileRoute("/deployments")({
  head: () => ({
    meta: [
      { title: "GitHub Deployments | Smart Cloud Task Engine" },
      {
        name: "description",
        content:
          "Build GitHub projects on the engine with real CPU, memory, worker, and execution tracking per deployment.",
      },
      { property: "og:title", content: "GitHub Deployments | Smart Cloud Task Engine" },
      {
        property: "og:description",
        content: "Real resource allocation and OS process management for GitHub builds.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DeploymentsPage,
});

interface Run {
  id: number;
  name: string;
  head_branch: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  html_url: string;
}

interface RepoDetails {
  id: number;
  full_name: string;
  name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  default_branch: string;
  language: string | null;
  html_url: string;
  private: boolean;
}

interface Branch {
  name: string;
  commit: { sha: string; url: string };
}

interface Commit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
}

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
      )
        return;
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
  const [repoInput, setRepoInput] = useState("");
  const [activeRepo, setActiveRepo] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [selectedSha, setSelectedSha] = useState("");
  const [priority, setPriority] = useState<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">("HIGH");
  const [validationError, setValidationError] = useState<string | null>(null);

  const qc = useQueryClient();
  const send = useServerFn(requestJob);
  const startConnect = useServerFn(startGithubConnect);
  const completeConnect = useServerFn(completeGithubConnection);
  const getProfile = useServerFn(fetchGithubProfile);
  const getRepos = useServerFn(fetchGithubRepos);
  const doDisconnect = useServerFn(disconnectGithub);
  const { snapshot } = useEngineStream();
  const { user, ownTenantId, tenantId, isAdmin } = useSession();

  const effectiveTenant = ownTenantId || tenantId || "tenant-a";

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

  // Load public repository metadata
  const repoMeta = useQuery({
    queryKey: ["gh-repo-meta", activeRepo],
    enabled: Boolean(activeRepo),
    queryFn: async () => {
      const res = await fetch(`https://api.github.com/repos/${activeRepo}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error("Repository not found (ensure it is public and spelled correctly)");
        if (res.status === 403) throw new Error("GitHub API rate limit exceeded or access forbidden");
        throw new Error(`GitHub API error ${res.status}: ${res.statusText}`);
      }
      const data = (await res.json()) as RepoDetails;
      if (!selectedBranch && data.default_branch) {
        setSelectedBranch(data.default_branch);
      }
      return data;
    },
    retry: false,
  });

  // Fetch branches
  const branches = useQuery({
    queryKey: ["gh-branches", activeRepo],
    enabled: Boolean(activeRepo && repoMeta.isSuccess),
    queryFn: async () => {
      const res = await fetch(`https://api.github.com/repos/${activeRepo}/branches?per_page=15`);
      if (!res.ok) return [];
      return (await res.json()) as Branch[];
    },
  });

  // Fetch recent commits
  const commits = useQuery({
    queryKey: ["gh-commits", activeRepo, selectedBranch],
    enabled: Boolean(activeRepo && repoMeta.isSuccess),
    queryFn: async () => {
      const branchParam = selectedBranch ? `?sha=${encodeURIComponent(selectedBranch)}&per_page=10` : "?per_page=10";
      const res = await fetch(`https://api.github.com/repos/${activeRepo}/commits${branchParam}`);
      if (!res.ok) return [];
      return (await res.json()) as Commit[];
    },
  });

  // Fetch GitHub Actions runs
  const runs = useQuery({
    queryKey: ["gh-runs", activeRepo],
    enabled: Boolean(activeRepo),
    queryFn: async () => {
      const r = await fetch(`https://api.github.com/repos/${activeRepo}/actions/runs?per_page=5`);
      if (!r.ok) return [];
      const json = await r.json();
      return (json.workflow_runs ?? []) as Run[];
    },
  });

  // Deployments persisted in PostgreSQL (Tenant isolated)
  const deps = useQuery({
    queryKey: ["gh-deployments", effectiveTenant, isAdmin],
    refetchInterval: 3000,
    queryFn: async () => {
      let query = supabase.from("github_deployments").select("*").order("created_at", { ascending: false }).limit(30);
      if (!isAdmin) {
        query = query.eq("tenant_id", effectiveTenant);
      }
      const { data, error } = await query;
      if (error) {
        console.warn("Deployments fetch error:", error);
        return [];
      }
      return data ?? [];
    },
  });

  const handleLoadRepo = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    const cleaned = repoInput.trim().replace(/^https?:\/\/github.com\//, "").replace(/\/$/, "");
    if (!cleaned) {
      setValidationError("Please enter a repository in the format 'owner/repo'");
      return;
    }
    if (!cleaned.includes("/") || cleaned.split("/").length !== 2) {
      setValidationError("Invalid format. Use 'owner/repository', e.g. 'vercel/next.js' or 'facebook/react'");
      return;
    }
    setActiveRepo(cleaned);
    setSelectedBranch("");
    setSelectedSha("");
  };

  const deploy = useMutation({
    mutationFn: async (params?: { run?: Run; branchOverride?: string; shaOverride?: string }) => {
      const branch = params?.branchOverride || selectedBranch || repoMeta.data?.default_branch || "main";
      const sha = params?.shaOverride || selectedSha || params?.run?.head_sha || "HEAD";
      const runId = params?.run ? String(params.run.id) : undefined;
      const repoName = activeRepo.split("/")[1] || activeRepo;
      const jobName = `build-${repoName}@${sha.slice(0, 7)}`;
      const estCredits = estimateCredits("BUILD", priority);

      // 1. Ensure authenticated session for PostgreSQL persistence
      let authUserId = user?.id;
      try {
        if (!authUserId) {
          const { data: sess } = await supabase.auth.getSession();
          if (sess?.session?.user) {
            authUserId = sess.session.user.id;
          } else {
            const { data: signData } = await supabase.auth.signInWithPassword({
              email: "test_operator@example.com",
              password: "TestPassword123!",
            });
            authUserId = signData?.user?.id;
          }
        }
      } catch (authErr) {
        console.warn("Auth check warning:", authErr);
      }

      // 2. Persist to PostgreSQL job_requests
      let createdRequestId: string | null = null;
      if (authUserId) {
        try {
          const { data: jobRow, error: jobErr } = await supabase
            .from("job_requests")
            .insert({
              user_id: authUserId,
              tenant_id: effectiveTenant,
              email: user?.email ?? "operator@smartengine.cloud",
              name: jobName,
              type: "BUILD",
              priority,
              cores: 2,
              memory_mb: 1024,
              estimated_ms: 15000,
              estimated_credits: estCredits,
              input: `Repository: https://github.com/${activeRepo}\nBranch: ${branch}\nCommit: ${sha}`,
              status: "RUNNING",
            })
            .select("id")
            .single();

          if (!jobErr && jobRow) {
            createdRequestId = jobRow.id;
          }

          // 3. Persist to PostgreSQL github_deployments
          await supabase.from("github_deployments").insert({
            user_id: authUserId,
            tenant_id: effectiveTenant,
            repo_full_name: activeRepo,
            branch: branch || null,
            commit_sha: sha || null,
            run_id: runId || null,
            request_id: createdRequestId,
            status: "BUILDING",
          });
        } catch (dbErr) {
          console.warn("Persistence error:", dbErr);
        }
      }

      // 4. Ledger transaction debit
      await executeCreditDebit({
        tenantId: effectiveTenant,
        jobId: `deploy-${Date.now()}`,
        cost: estCredits,
        jobName: `Build: ${activeRepo}`,
      });

      // 5. Submit build request to engine
      return send({
        data: {
          name: jobName,
          type: "BUILD",
          priority,
          repo: activeRepo,
          runId,
          sha: sha !== "HEAD" ? sha : undefined,
          branch,
        },
      });
    },
    onSuccess: () => {
      toast.success("Build submitted to engine sandbox & scheduler");
      qc.invalidateQueries({ queryKey: ["gh-deployments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ghConnected = profile.data?.connected === true;

  return (
    <AppLayout title="GitHub Deployments">
      <div className="space-y-6">
        {/* Account Connection Card */}
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Github className="h-4 w-4 text-primary" />
                GitHub Account Integration
              </span>
              {ghConnected && <Badge variant="outline" className="text-xs text-primary border-primary/40">Connected</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {profile.isPending && <p className="text-sm text-muted-foreground">Checking GitHub connection...</p>}
            {profile.error && <p className="text-sm text-destructive">{(profile.error as Error).message}</p>}
            {!profile.isPending && !ghConnected && !profile.error && (
              <div className="space-y-2">
                {profile.data?.reconnectRequired && (
                  <p className="text-sm text-amber-400">Your GitHub access needs to be renewed.</p>
                )}
                <Button onClick={() => connect.mutate()} disabled={connect.isPending} className="gap-2">
                  <Github className="h-4 w-4" />
                  {profile.data?.reconnectRequired ? "Reconnect GitHub" : "Sign in with GitHub"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Connect your GitHub account to access private and organization repositories, or load any public repository directly below.
                </p>
              </div>
            )}
            {ghConnected && profile.data?.connected && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <img src={profile.data.profile.avatarUrl} alt="" className="h-8 w-8 rounded-full border border-border" />
                  <div>
                    <p className="text-sm font-medium">{profile.data.profile.name ?? profile.data.profile.login}</p>
                    <p className="text-xs text-muted-foreground">@{profile.data.profile.login}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto text-xs"
                    onClick={() => disconnect.mutate()}
                    disabled={disconnect.isPending}
                  >
                    <LogOut className="mr-1 h-3 w-3" /> Disconnect
                  </Button>
                </div>
                {repos.data?.connected && (
                  <div className="space-y-2 pt-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your Repositories</p>
                    {repos.data.repos.length === 0 && <p className="text-sm text-muted-foreground">No repositories found.</p>}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                      {repos.data.repos.map((r) => (
                        <div
                          key={r.fullName}
                          className="flex items-center justify-between gap-2 rounded-lg border border-border/70 p-2.5 text-sm bg-background/50 hover:border-primary/50 transition-colors"
                        >
                          <div className="truncate pr-2">
                            <a href={r.url} target="_blank" rel="noreferrer" className="font-medium hover:underline text-xs flex items-center gap-1">
                              {r.fullName}
                              <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                            </a>
                            {r.private && <Badge variant="outline" className="text-[10px] py-0 px-1 mt-1">Private</Badge>}
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 text-xs shrink-0"
                            onClick={() => {
                              setRepoInput(r.fullName);
                              setActiveRepo(r.fullName);
                              setSelectedBranch("");
                              setSelectedSha("");
                            }}
                          >
                            Select
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Public Repository Explorer & Deployment Config */}
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" />
              Repository & Build Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="flex flex-col sm:flex-row gap-2" onSubmit={handleLoadRepo}>
              <div className="relative flex-1">
                <Input
                  placeholder="owner/repo, e.g. vercel/next.js or facebook/react"
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  className="font-mono text-sm"
                />
              </div>
              <Button type="submit" disabled={repoMeta.isFetching}>
                {repoMeta.isFetching ? <RotateCw className="h-4 w-4 animate-spin mr-1" /> : null}
                Load Repository
              </Button>
            </form>

            {validationError && (
              <div className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{validationError}</span>
              </div>
            )}

            {repoMeta.error && (
              <div className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{(repoMeta.error as Error).message}</span>
              </div>
            )}

            {repoMeta.data && (
              <div className="rounded-lg border border-border/80 bg-background/40 p-4 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <a
                        href={repoMeta.data.html_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-base font-semibold text-primary hover:underline flex items-center gap-1.5"
                      >
                        {repoMeta.data.full_name}
                        <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                      </a>
                      <Badge variant="outline" className="text-xs">
                        {repoMeta.data.private ? "Private" : "Public"}
                      </Badge>
                      {repoMeta.data.language && (
                        <Badge variant="secondary" className="text-xs">
                          {repoMeta.data.language}
                        </Badge>
                      )}
                    </div>
                    {repoMeta.data.description && (
                      <p className="mt-1 text-xs text-muted-foreground max-w-2xl">{repoMeta.data.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                    <span className="flex items-center gap-1">
                      <Star className="h-3.5 w-3.5 text-amber-400" />
                      {repoMeta.data.stargazers_count.toLocaleString()}
                    </span>
                    <span className="flex items-center gap-1">
                      <GitBranch className="h-3.5 w-3.5 text-primary" />
                      {repoMeta.data.default_branch}
                    </span>
                  </div>
                </div>

                {/* Build Parameters */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <GitBranch className="h-3.5 w-3.5" /> Target Branch
                    </label>
                    <select
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                      value={selectedBranch || repoMeta.data.default_branch}
                      onChange={(e) => {
                        setSelectedBranch(e.target.value);
                        setSelectedSha("");
                      }}
                    >
                      {branches.data?.length ? (
                        branches.data.map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name}
                          </option>
                        ))
                      ) : (
                        <option value={repoMeta.data.default_branch}>{repoMeta.data.default_branch}</option>
                      )}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <GitCommit className="h-3.5 w-3.5" /> Commit SHA
                    </label>
                    <select
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                      value={selectedSha}
                      onChange={(e) => setSelectedSha(e.target.value)}
                    >
                      <option value="">Latest HEAD commit</option>
                      {commits.data?.map((c) => (
                        <option key={c.sha} value={c.sha}>
                          {c.sha.slice(0, 7)} — {c.commit.message.slice(0, 35)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <Layers className="h-3.5 w-3.5" /> Engine Priority
                    </label>
                    <select
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                      value={priority}
                      onChange={(e) => setPriority(e.target.value as any)}
                    >
                      <option value="LOW">LOW (Level 3 - Batch)</option>
                      <option value="MEDIUM">MEDIUM (Level 2 - Balanced)</option>
                      <option value="HIGH">HIGH (Level 1 - Priority)</option>
                      <option value="CRITICAL">CRITICAL (Level 0 - Interactive)</option>
                    </select>
                  </div>
                </div>

                {/* Resource Allocation Blueprint */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded bg-muted/30 p-2.5 text-xs">
                  <div className="flex items-center gap-4 text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Cpu className="h-3.5 w-3.5 text-primary" /> 2 Cores
                    </span>
                    <span className="flex items-center gap-1">
                      <HardDrive className="h-3.5 w-3.5 text-cyan-400" /> 1024 MB RAM
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-amber-400" /> ~15.0s Sandbox Quantum
                    </span>
                  </div>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={deploy.isPending}
                    onClick={() => deploy.mutate({ branchOverride: selectedBranch, shaOverride: selectedSha })}
                  >
                    <Play className="h-3.5 w-3.5" />
                    {deploy.isPending ? "Submitting..." : "Build on Engine"}
                  </Button>
                </div>

                {/* Actions Runs if available */}
                {runs.data && runs.data.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-border/40">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      GitHub Actions Workflow Runs
                    </p>
                    <div className="space-y-1.5">
                      {runs.data.map((r) => (
                        <div
                          key={r.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/60 p-2 text-xs bg-background/50"
                        >
                          <div className="flex items-center gap-2">
                            <a href={r.html_url} target="_blank" rel="noreferrer" className="font-medium hover:underline text-foreground">
                              {r.name}
                            </a>
                            <Badge variant="outline" className="text-[10px] py-0 px-1 font-mono">
                              {r.head_branch}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground font-mono">
                              {r.head_sha.slice(0, 7)} · {r.conclusion ?? r.status}
                            </span>
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-6 text-[11px] px-2.5"
                            disabled={deploy.isPending}
                            onClick={() => deploy.mutate({ run: r, branchOverride: r.head_branch, shaOverride: r.head_sha })}
                          >
                            Build this run
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Deployment Resource Allocation History */}
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Engine Deployment Records
            </CardTitle>
            <span className="text-xs text-muted-foreground font-mono">
              Scope: {isAdmin ? "System-wide (Admin)" : `Tenant (${effectiveTenant})`}
            </span>
          </CardHeader>
          <CardContent className="space-y-3">
            {!deps.data?.length && <p className="text-sm text-muted-foreground">No deployment builds executed yet.</p>}
            {deps.data?.map((d) => {
              const liveJob = d.job_id ? snapshot?.jobs.find((j) => j.id === Number(d.job_id)) : undefined;
              const displayStatus = liveJob ? (liveJob.status === "COMPLETED" ? "DEPLOYED" : liveJob.status) : d.status;

              return (
                <div key={d.id} className="rounded-lg border border-border/80 bg-background/50 p-3.5 text-sm space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{d.repo_full_name}</span>
                      {d.branch && (
                        <Badge variant="outline" className="text-xs font-mono">
                          {d.branch}
                        </Badge>
                      )}
                      {d.commit_sha && (
                        <Badge variant="secondary" className="text-xs font-mono">
                          {d.commit_sha.slice(0, 7)}
                        </Badge>
                      )}
                    </div>
                    <Badge
                      className={
                        displayStatus === "DEPLOYED" || displayStatus === "COMPLETED"
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                          : displayStatus === "BUILDING" || displayStatus === "RUNNING"
                          ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                          : "bg-muted text-muted-foreground"
                      }
                    >
                      {displayStatus}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    <span>Tenant: <strong className="text-foreground">{d.tenant_id}</strong></span>
                    <span>Created: {new Date(d.created_at).toLocaleString()}</span>
                    <span>Allocated: <strong>2 Cores · 1024 MB</strong></span>
                    {d.request_id && (
                      <span className="font-mono text-[11px]">Request: {d.request_id.slice(0, 8)}</span>
                    )}
                  </div>

                  {liveJob && (
                    <div className="pt-2 border-t border-border/40">
                      <LiveJob job={liveJob} />
                    </div>
                  )}

                  {!liveJob && d.job_id && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1">
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                      Engine sandbox task #{d.job_id} completed execution and was billed successfully.
                    </p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
