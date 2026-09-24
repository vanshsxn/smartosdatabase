import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { AppLayout } from "@/components/AppLayout";
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
import { submitJob } from "@/lib/engine";
import type { JobPriority } from "@/lib/engine.types";
import { useSession } from "@/lib/session";
import { JOB_PRESETS, estimateCredits, resourcesFor } from "@/lib/job-presets";

export const Route = createFileRoute("/submit")({
  head: () => ({
    meta: [
      { title: "Submit Job | Smart Cloud Task Engine" },
      {
        name: "description",
        content: "Submit a compute job with priority, core, memory and burst requirements.",
      },
      { property: "og:title", content: "Submit Job | Smart Cloud Task Engine" },
      {
        property: "og:description",
        content: "Submit a compute job with priority, core, memory and burst requirements.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SubmitPage,
});

function SubmitPage() {
  const { tenants } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [type, setType] = useState(JOB_PRESETS[0]!.type);
  const [name, setName] = useState(JOB_PRESETS[0]!.defaultName);
  const [priority, setPriority] = useState<JobPriority>("MEDIUM");
  const preset = JOB_PRESETS.find((p) => p.type === type) ?? JOB_PRESETS[0]!;
  const plan = resourcesFor(type, priority);

  const submit = useMutation({
    // Tenant and user are attached on the server from the signed-in account.
    mutationFn: () => submitJob({ name, type, priority, ...plan }),
    onSuccess: (res) => {
      if (!res.accepted) {
        toast.error(res.message);
        return;
      }
      toast.success(`Job #${res.jobId} queued`);
      qc.invalidateQueries({ queryKey: ["engine"] });
      navigate({ to: "/jobs" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppLayout title="Submit Job">
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">New job for {tenants[0]?.name ?? "your workspace"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit.mutate();
            }}
          >
            <Field label="Job type">
              <Select
                value={type}
                onValueChange={(v) => {
                  setType(v);
                  setName(JOB_PRESETS.find((p) => p.type === v)?.defaultName ?? name);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JOB_PRESETS.map((p) => (
                    <SelectItem key={p.type} value={p.type}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Job name">
              <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
            </Field>
            <Field label="Priority">
              <Select value={priority} onValueChange={(v) => setPriority(v as JobPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" className="w-full" disabled={submit.isPending}>
                {submit.isPending ? "Submitting…" : "Run job"}
              </Button>
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm sm:col-span-2">
              <p className="text-muted-foreground">{preset.description}</p>
              <p className="mt-2">
                System allocation: <b>{plan.requestedCores} cores</b> · <b>{plan.requestedMemoryMb} MB</b> ·
                about <b>{(plan.estimatedMs / 1000).toFixed(0)} s</b> CPU · est.{" "}
                <b>{estimateCredits(type, priority).toFixed(2)} credits</b>
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </AppLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
