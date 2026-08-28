import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

import { useEngineStream } from "./engine-stream";
import { useSession } from "./session";
import { tenantName } from "./session";

export interface AlertRules {
  cpu_threshold: number;
  memory_threshold: number;
  credit_threshold: number;
  enabled: boolean;
}

export interface AlertEvent {
  id: string;
  tenant_id: string | null;
  kind: string;
  severity: string;
  message: string;
  value: number | null;
  threshold: number | null;
  created_at: string;
}

interface AlertsValue {
  rules: AlertRules;
  saveRules: (next: Partial<AlertRules>) => Promise<void>;
  events: AlertEvent[];
  refreshEvents: () => Promise<void>;
  saving: boolean;
}

const DEFAULT_RULES: AlertRules = {
  cpu_threshold: 85,
  memory_threshold: 85,
  credit_threshold: 150,
  enabled: true,
};

// Don't re-fire the same alert kind more often than this.
const COOLDOWN_MS = 60_000;

const AlertsContext = createContext<AlertsValue | null>(null);

export function AlertsProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const { snapshot } = useEngineStream();
  const [rules, setRules] = useState<AlertRules>(DEFAULT_RULES);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [saving, setSaving] = useState(false);
  const lastFired = useRef<Record<string, number>>({});

  const refreshEvents = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("alert_events")
      .select("id, tenant_id, kind, severity, message, value, threshold, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    setEvents((data ?? []) as AlertEvent[]);
  }, [user]);

  useEffect(() => {
    if (!user) {
      setEvents([]);
      setRules(DEFAULT_RULES);
      return;
    }
    void (async () => {
      const { data } = await supabase
        .from("alert_rules")
        .select("cpu_threshold, memory_threshold, credit_threshold, enabled")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) {
        setRules({
          cpu_threshold: Number(data.cpu_threshold),
          memory_threshold: Number(data.memory_threshold),
          credit_threshold: Number(data.credit_threshold),
          enabled: data.enabled,
        });
      } else {
        await supabase.from("alert_rules").insert({ user_id: user.id });
      }
      await refreshEvents();
    })();
  }, [user, refreshEvents]);

  const saveRules = useCallback(
    async (next: Partial<AlertRules>) => {
      if (!user) return;
      const merged = { ...rules, ...next };
      setRules(merged);
      setSaving(true);
      const { error } = await supabase
        .from("alert_rules")
        .upsert({ user_id: user.id, ...merged, updated_at: new Date().toISOString() });
      setSaving(false);
      if (error) toast.error("Could not save alert thresholds");
    },
    [rules, user],
  );

  const record = useCallback(
    async (
      kind: string,
      severity: "WARN" | "ERROR",
      message: string,
      value: number,
      threshold: number,
      tenantId?: string,
    ) => {
      const now = Date.now();
      if ((lastFired.current[kind] ?? 0) + COOLDOWN_MS > now) return;
      lastFired.current[kind] = now;

      if (severity === "ERROR") toast.error(message);
      else toast.warning(message);

      if (!user) return;
      const { error } = await supabase.from("alert_events").insert({
        user_id: user.id,
        tenant_id: tenantId ?? null,
        kind,
        severity,
        message,
        value,
        threshold,
      });
      if (!error) await refreshEvents();
    },
    [user, refreshEvents],
  );

  // Threshold evaluation runs on every streamed snapshot.
  useEffect(() => {
    if (!rules.enabled || !user || !snapshot?.online) return;
    const res = snapshot.resources;
    if (res) {
      if (res.cpuUtilization >= rules.cpu_threshold) {
        void record(
          "cpu",
          res.cpuUtilization >= 95 ? "ERROR" : "WARN",
          `CPU usage ${res.cpuUtilization.toFixed(1)}% exceeded the ${rules.cpu_threshold}% threshold`,
          res.cpuUtilization,
          rules.cpu_threshold,
        );
      }
      if (res.memoryUtilization >= rules.memory_threshold) {
        void record(
          "memory",
          res.memoryUtilization >= 95 ? "ERROR" : "WARN",
          `Memory usage ${res.memoryUtilization.toFixed(1)}% exceeded the ${rules.memory_threshold}% threshold`,
          res.memoryUtilization,
          rules.memory_threshold,
        );
      }
    }
    for (const tenant of snapshot.tenants ?? []) {
      if (tenant.credits <= rules.credit_threshold) {
        void record(
          `credits:${tenant.tenantId}`,
          tenant.credits <= 0 ? "ERROR" : "WARN",
          `${tenantName(tenant.tenantId)} has ${tenant.credits.toFixed(0)} credits left (threshold ${rules.credit_threshold})`,
          tenant.credits,
          rules.credit_threshold,
          tenant.tenantId,
        );
      }
    }
  }, [snapshot, rules, user, record]);

  const value = useMemo(
    () => ({ rules, saveRules, events, refreshEvents, saving }),
    [rules, saveRules, events, refreshEvents, saving],
  );

  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
}

export function useAlerts() {
  const ctx = useContext(AlertsContext);
  if (!ctx) throw new Error("useAlerts must be used inside AlertsProvider");
  return ctx;
}
