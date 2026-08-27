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
import { TENANTS, useSession } from "@/lib/session";

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
  const { tenantId, user } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [name, setName] = useState("image-processing");
  const [type, setType] = useState("COMPUTE");
  const [priority, setPriority] = useState<JobPriority>("MEDIUM");
  const [tenant, setTenant] = useState(tenantId || "tenant-a");
  const [cores, setCores] = useState(2);
  const [memory, setMemory] = useState(512);
  const [burst, setBurst] = useState(3000);

  const submit = useMutation({
    mutationFn: () =>
      submitJob({
        name,
        type,
        priority,
        tenantId: tenant,
        userId: user?.email ?? "operator",
        requestedCores: cores,
        requestedMemoryMb: memory,
        estimatedMs: burst,
      }),
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
          <CardTitle className="text-base">New job request</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit.mutate();
            }}
          >
            <Field label="Job name">
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Job type">
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["COMPUTE", "IO", "BATCH", "ML_TRAINING", "REPORT"].map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <Field label="Tenant">
              <Select value={tenant} onValueChange={setTenant}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TENANTS.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Requested cores">
              <Input
                type="number"
                min={1}
                max={64}
                value={cores}
                onChange={(e) => setCores(Number(e.target.value))}
              />
            </Field>
            <Field label="Requested memory (MB)">
              <Input
                type="number"
                min={64}
                step={64}
                value={memory}
                onChange={(e) => setMemory(Number(e.target.value))}
              />
            </Field>
            <Field label="Estimated burst (ms)">
              <Input
                type="number"
                min={100}
                step={100}
                value={burst}
                onChange={(e) => setBurst(Number(e.target.value))}
              />
            </Field>
            <div className="flex items-end">
              <Button type="submit" className="w-full" disabled={submit.isPending}>
                {submit.isPending ? "Submitting…" : "Submit job"}
              </Button>
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
