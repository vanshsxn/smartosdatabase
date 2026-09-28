import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { AppLayout } from "@/components/AppLayout";
import { JobRequestList } from "@/components/JobRequests";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { JobPriority } from "@/lib/engine.types";
import { JOB_PRESETS, estimateCredits, resourcesFor } from "@/lib/job-presets";
import { requestJob } from "@/lib/job-requests.functions";

export const Route = createFileRoute("/submit")({
  head: () => ({
    meta: [
      { title: "Submit Job | Smart Cloud Task Engine" },
      { name: "description", content: "Submit real compute and AI jobs, then watch them run live." },
      { property: "og:title", content: "Submit Job | Smart Cloud Task Engine" },
      { property: "og:description", content: "Submit real compute and AI jobs, then watch them run live." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SubmitPage,
});

function SubmitPage() {
  const qc = useQueryClient();
  const send = useServerFn(requestJob);
  const [type, setType] = useState(JOB_PRESETS[0]!.type);
  const [name, setName] = useState(JOB_PRESETS[0]!.defaultName);
  const [priority, setPriority] = useState<JobPriority>("MEDIUM");
  const [input, setInput] = useState("");
  const preset = JOB_PRESETS.find((p) => p.type === type) ?? JOB_PRESETS[0]!;
  const plan = resourcesFor(type, priority);

  const submit = useMutation({
    mutationFn: () => send({ data: { name, type, priority, input: preset.ai ? input : undefined } }),
    onSuccess: (r) => {
      toast.success(`Request sent (${r.estimated.toFixed(2)} credits). Waiting for admin approval.`);
      setInput("");
      qc.invalidateQueries({ queryKey: ["job-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onFile = async (f?: File) => {
    if (!f) return;
    if (f.size > 40000) {
      toast.error("File too large (max 40 KB of text).");
      return;
    }
    setInput(await f.text());
  };

  return (
    <AppLayout title="Submit Job">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">New job</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}>
              <Field label="Job type">
                <Select value={type} onValueChange={(v) => { setType(v); setName(JOB_PRESETS.find((p) => p.type === v)?.defaultName ?? name); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JOB_PRESETS.map((p) => <SelectItem key={p.type} value={p.type}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Job name">
                <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
              </Field>
              <Field label="Priority">
                <Select value={priority} onValueChange={(v) => setPriority(v as JobPriority)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex items-end">
                <Button type="submit" className="w-full" disabled={submit.isPending}>
                  {submit.isPending ? "Sending…" : "Submit for approval"}
                </Button>
              </div>
              {preset.ai && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>{preset.ai.inputLabel}</Label>
                  <Input type="file" accept=".txt,.md,.csv,.json,.js,.ts,.py,.java,.cpp,.c,.go,.html,.css" onChange={(e) => onFile(e.target.files?.[0])} />
                  <Textarea rows={8} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Paste text or upload a file" maxLength={40000} />
                </div>
              )}
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm sm:col-span-2">
                <p className="text-muted-foreground">{preset.description}</p>
                <p className="mt-2">
                  System allocation: <b>{plan.requestedCores} cores</b> · <b>{plan.requestedMemoryMb} MB</b> · about{" "}
                  <b>{(plan.estimatedMs / 1000).toFixed(0)} s</b> · est. <b>{estimateCredits(type, priority).toFixed(2)} credits</b>
                </p>
              </div>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">My jobs (live)</CardTitle></CardHeader>
          <CardContent><JobRequestList /></CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
