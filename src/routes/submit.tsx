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
import { JOB_PRESETS, estimateCredits, isAutoApproved, resourcesFor } from "@/lib/job-presets";
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

const LANGUAGE_OPTIONS = [
  { label: "Auto-Detect", value: "autodetect" },
  { label: "English", value: "English" },
  { label: "Hindi (हिंदी)", value: "Hindi" },
  { label: "Spanish (Español)", value: "Spanish" },
  { label: "French (Français)", value: "French" },
  { label: "German (Deutsch)", value: "German" },
  { label: "Japanese (日本語)", value: "Japanese" },
  { label: "Chinese (中文)", value: "Chinese" },
  { label: "Russian (Русский)", value: "Russian" },
  { label: "Arabic (العربية)", value: "Arabic" },
];

function SubmitPage() {
  const qc = useQueryClient();
  const send = useServerFn(requestJob);
  const [type, setType] = useState(JOB_PRESETS[0]!.type);
  const [name, setName] = useState(JOB_PRESETS[0]!.defaultName);
  const [priority, setPriority] = useState<JobPriority>("MEDIUM");
  const [input, setInput] = useState("");
  const [sourceLang, setSourceLang] = useState("autodetect");
  const [targetLang, setTargetLang] = useState("Hindi");
  const preset = JOB_PRESETS.find((p) => p.type === type) ?? JOB_PRESETS[0]!;
  const plan = resourcesFor(type, priority);

  const submit = useMutation({
    mutationFn: () => {
      let formattedInput = input;
      if (type === "AI_TRANSLATE" && input.trim()) {
        formattedInput = `[Source: ${sourceLang} | Target: ${targetLang}]\n${input.trim()}`;
      }
      return send({ data: { name, type, priority, input: preset.ai ? formattedInput : undefined } });
    },
    onSuccess: (r) => {
      if (r.auto) {
        if (r.status === "COMPLETED") {
          toast.success(`Small job ran automatically (${r.estimated.toFixed(2)} credits) — completed.`);
        } else if (r.status === "RUNNING") {
          toast.success(`Small job admitted to MLFQ scheduler (${r.estimated.toFixed(2)} credits) — running.`);
        } else if (r.status === "FAILED") {
          toast.error(`Job failed (${r.estimated.toFixed(2)} credits refunded).`);
        } else {
          toast.success(`Small job processed (${r.estimated.toFixed(2)} credits) — ${r.status.toLowerCase()}.`);
        }
      } else {
        toast.success(`Request sent (${r.estimated.toFixed(2)} credits). Waiting for admin approval.`);
      }
      setInput("");
      qc.invalidateQueries({ queryKey: ["job-requests"] });
      qc.invalidateQueries({ queryKey: ["engine"] });
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
                  {submit.isPending ? "Running…" : isAutoApproved(type, priority) ? "Run job" : "Submit for approval"}
                </Button>
              </div>
              {type === "AI_TRANSLATE" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:col-span-2 p-3 rounded-lg border border-primary/20 bg-primary/5">
                  <Field label="Source Language">
                    <Select value={sourceLang} onValueChange={setSourceLang}>
                      <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LANGUAGE_OPTIONS.map((l) => (
                          <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Target Language">
                    <Select value={targetLang} onValueChange={setTargetLang}>
                      <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LANGUAGE_OPTIONS.filter((l) => l.value !== "autodetect").map((l) => (
                          <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              )}
              {preset.ai && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>
                    {type === "AI_TRANSLATE"
                      ? `Text to translate (${sourceLang} ➔ ${targetLang})`
                      : preset.ai.inputLabel}
                  </Label>
                  {!preset.ai.image && <Input type="file" accept=".txt,.md,.csv,.json,.js,.ts,.py,.java,.cpp,.c,.go,.html,.css" onChange={(e) => onFile(e.target.files?.[0])} />}
                  <Textarea
                    rows={type === "AI_TRANSLATE" ? 6 : 8}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={
                      preset.ai.image
                        ? "e.g. A futuristic data center at sunset, isometric style"
                        : type === "AI_TRANSLATE"
                        ? "Enter or paste the text you want translated here..."
                        : "Type, paste text or upload a file"
                    }
                    maxLength={40000}
                  />
                </div>
              )}
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm sm:col-span-2">
                <p className="text-muted-foreground">{preset.description}</p>
                <p className="mt-2">
                  System allocation: <b>{plan.requestedCores} cores</b> · <b>{plan.requestedMemoryMb} MB</b> · about{" "}
                  <b>{(plan.estimatedMs / 1000).toFixed(0)} s</b> · est. <b>{estimateCredits(type, priority).toFixed(2)} credits</b>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isAutoApproved(type, priority) ? "Small job — runs immediately, no admin approval needed." : "Larger job — an admin must approve it before it runs."}
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
