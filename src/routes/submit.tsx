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

function getAcceptedFileExtensions(jobType: string): string {
  switch (jobType) {
    case "AI_SUMMARIZE":
      return ".docx,.doc,.pptx,.ppt,.pdf,.txt,.md,.csv,.tsv,README";
    case "AI_CODE_REVIEW":
      return ".html,.java,.py,.c,.cpp,.h,.hpp,.js,.jsx,.ts,.tsx,.xml,.json,.css,.go,.rs,.php,.sql,.sh,.yaml,.yml";
    case "AI_TRANSLATE":
      return ".pdf,.txt,.docx,.doc,.pptx,.ppt,.md";
    case "REPORT":
      return ".pptx,.ppt,.docx,.doc,.pdf,.txt,.md,.csv,.json,.html,.java,.py,.js,.ts";
    case "AI_DATA_INSIGHTS":
      return ".csv,.tsv,.txt,.json";
    default:
      return ".txt,.md,.csv,.json,.js,.ts,.py,.java,.cpp,.c,.go,.html,.css,.xml,.pdf,.docx,.doc,.pptx,.ppt";
  }
}

function getFileTypeHint(jobType: string): string {
  switch (jobType) {
    case "AI_SUMMARIZE":
      return "Word (.docx, .doc), PPT (.pptx, .ppt), PDF (.pdf), CSV, README (.md), TXT";
    case "AI_CODE_REVIEW":
      return "Coding files: Java, Python, C, C++, HTML, JS/TS, XML, CSS, Go, Rust, SQL, Shell";
    case "AI_TRANSLATE":
      return "PDF (.pdf), TXT (.txt), Word (.docx, .doc), PPT (.pptx, .ppt), Markdown (.md)";
    case "REPORT":
      return "PPT (.pptx), Word (.docx), PDF (.pdf), Code files, TXT, README, CSV";
    case "AI_DATA_INSIGHTS":
      return "CSV (.csv), TSV (.tsv), JSON (.json), TXT (.txt)";
    default:
      return "Text, PDF, Word, PPT, Code, or CSV files";
  }
}

async function extractFileContent(f: File): Promise<string> {
  const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();

  // 1. Text / Code files / CSV / Markdown
  if (
    [
      ".txt", ".md", ".csv", ".tsv", ".json", ".js", ".jsx", ".ts", ".tsx",
      ".py", ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".go", ".rs",
      ".php", ".html", ".css", ".xml", ".sql", ".sh", ".yaml", ".yml",
    ].includes(ext) ||
    f.name.toUpperCase().includes("README")
  ) {
    return await f.text();
  }

  // 2. Word documents (.docx) & PowerPoint presentations (.pptx)
  if (ext === ".docx" || ext === ".pptx") {
    try {
      const buffer = await f.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const view = new DataView(buffer);
      let pos = 0;
      let textContent = "";
      const targets = ext === ".docx" ? ["document.xml"] : ["slide", "presentation.xml"];

      while (pos < bytes.length - 30) {
        if (view.getUint32(pos, true) !== 0x04034b50) {
          pos++;
          continue;
        }
        const compression = view.getUint16(pos + 8, true);
        const compSize = view.getUint32(pos + 18, true);
        const nameLen = view.getUint16(pos + 26, true);
        const extraLen = view.getUint16(pos + 28, true);
        const nameBytes = bytes.slice(pos + 30, pos + 30 + nameLen);
        const fileName = new TextDecoder().decode(nameBytes);
        const dataStart = pos + 30 + nameLen + extraLen;
        const dataEnd = dataStart + compSize;

        if (targets.some((t) => fileName.includes(t)) && dataEnd <= bytes.length) {
          try {
            const rawData = bytes.slice(dataStart, dataEnd);
            let xml = "";
            if (compression === 0) {
              xml = new TextDecoder().decode(rawData);
            } else if (compression === 8 && typeof DecompressionStream !== "undefined") {
              const ds = new DecompressionStream("deflate-raw");
              xml = await new Response(new Response(rawData).body.pipeThrough(ds)).text();
            }
            const matches =
              xml.match(/<[^>]+:t[^>]*>([^<]+)<\/[^>]+:t>/g) || xml.match(/<t[^>]*>([^<]+)<\/t>/g) || [];
            const extracted = matches
              .map((m) => m.replace(/<[^>]+>/g, "").trim())
              .filter(Boolean)
              .join(" ");
            if (extracted) {
              textContent += (textContent ? "\n\n" : "") + extracted;
            }
          } catch {
            // Continue parsing other zip blocks
          }
        }
        pos = dataEnd > pos ? dataEnd : pos + 1;
      }

      if (textContent.trim()) {
        return `[Document: ${f.name}]\n\n${textContent.trim()}`;
      }
    } catch {
      // Fallback below
    }
  }

  // 3. PDF Files (.pdf)
  if (ext === ".pdf") {
    try {
      const buffer = await f.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const b64 = btoa(binary);

      const rawText = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      const textMatches = rawText.match(/\(([^()]{3,})\)\s*T[jJ]/g) || [];
      const extractedPreview = textMatches
        .map((m) => m.replace(/^\(/, "").replace(/\)\s*T[jJ]$/, "").trim())
        .filter((t) => t.length > 2)
        .slice(0, 50)
        .join(" ");

      return `[PDF Document: ${f.name} (${(f.size / 1024).toFixed(1)} KB)]\n${
        extractedPreview ? `Preview: ${extractedPreview}\n\n` : ""
      }data:application/pdf;base64,${b64}`;
    } catch {
      // Fallback
    }
  }

  // 4. Fallback for binary / legacy formats (.doc, .ppt, etc.): extract printable strings
  try {
    const raw = await f.text();
    const clean = raw.replace(/[^\x20-\x7E\t\n\r]/g, " ").replace(/\s{2,}/g, " ").trim();
    if (clean.length > 30) {
      return `[File: ${f.name}]\n\n${clean.slice(0, 35000)}`;
    }
  } catch {
    // Fallback
  }

  return `[File: ${f.name}]`;
}

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
    if (f.size > 10 * 1024 * 1024) {
      toast.error("File too large (max 10 MB).");
      return;
    }
    const toastId = toast.loading(`Extracting content from ${f.name}…`);
    try {
      const content = await extractFileContent(f);
      setInput(content.slice(0, 38000));
      toast.success(`${f.name} loaded successfully!`, { id: toastId });
    } catch (e) {
      toast.error(`Could not read file: ${(e as Error).message}`, { id: toastId });
    }
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
                  {!preset.ai.image && (
                    <div className="space-y-1.5">
                      <Input
                        type="file"
                        accept={getAcceptedFileExtensions(type)}
                        onChange={(e) => onFile(e.target.files?.[0])}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Supported: <span className="text-foreground/80 font-medium">{getFileTypeHint(type)}</span>
                      </p>
                    </div>
                  )}
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
