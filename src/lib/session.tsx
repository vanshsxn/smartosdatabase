import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { supabase } from "@/integrations/supabase/client";

export interface Tenant {
  id: string;
  name: string;
  plan: string;
  totalCredits: number;
}

export const TENANTS: Tenant[] = [
  { id: "tenant-a", name: "Tenant A", plan: "Enterprise", totalCredits: 1000 },
  { id: "tenant-b", name: "Tenant B", plan: "Business", totalCredits: 1000 },
  { id: "tenant-c", name: "Tenant C", plan: "Business", totalCredits: 1000 },
  { id: "tenant-d", name: "Tenant D", plan: "Starter", totalCredits: 1000 },
];

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  initials: string;
}

interface SessionValue {
  user: SessionUser | null;
  session: Session | null;
  tenantId: string; // "" means all tenants
  ready: boolean;
  signOut: () => Promise<void>;
  setTenantId: (id: string) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

function toUser(authUser: User, displayName?: string | null): SessionUser {
  const email = authUser.email ?? "";
  const fallback = email.split("@")[0] ?? "operator";
  const raw = (displayName ||
    (authUser.user_metadata?.["display_name"] as string | undefined) ||
    (authUser.user_metadata?.["full_name"] as string | undefined) ||
    fallback) as string;
  const parts = raw.split(/[\s._-]+/).filter(Boolean);
  const name = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ") || "Operator";
  const initials = (parts[0]?.[0] ?? "o") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "p");
  return { id: authUser.id, email, name, initials: initials.toUpperCase() };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [tenantId, setTenantIdState] = useState<string>("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setUser(next?.user ? toUser(next.user) : null);
      if (!next?.user) setTenantIdState("");
      setReady(true);
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ? toUser(data.session.user) : null);
      setReady(true);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  // Load the persisted profile (display name + selected tenant) for the signed-in user.
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, tenant_id")
        .eq("id", uid)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setTenantIdState(data.tenant_id ?? "");
        if (session?.user) setUser(toUser(session.user, data.display_name));
      } else {
        await supabase.from("profiles").insert({
          id: uid,
          email: session?.user?.email ?? null,
          display_name: session?.user?.email?.split("@")[0] ?? null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
  }, []);

  const setTenantId = useCallback(
    (id: string) => {
      setTenantIdState(id);
      const uid = session?.user?.id;
      if (uid) {
        void supabase.from("profiles").update({ tenant_id: id }).eq("id", uid);
      }
    },
    [session],
  );

  const value = useMemo(
    () => ({ user, session, tenantId, ready, signOut, setTenantId }),
    [user, session, tenantId, ready, signOut, setTenantId],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

export function tenantName(id: string) {
  return TENANTS.find((t) => t.id === id)?.name ?? (id || "Unassigned");
}
