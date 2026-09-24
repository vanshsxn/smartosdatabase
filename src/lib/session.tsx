import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { supabase } from "@/integrations/supabase/client";

export interface Tenant {
  id: string;
  name: string;
  email: string;
}

// Registry of known tenants (the caller's own, or all of them for admins),
// filled from the database so labels never depend on hard-coded tenants.
const registry = new Map<string, Tenant>();

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  initials: string;
}

interface SessionValue {
  user: SessionUser | null;
  session: Session | null;
  tenantId: string; // admin: "" means all tenants; tenant accounts: always their own
  ownTenantId: string;
  isAdmin: boolean;
  tenants: Tenant[];
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
  const [ownTenantId, setOwnTenantId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);

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

  // Load profile, role and the tenant list for the signed-in user.
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) {
      setIsAdmin(false);
      setOwnTenantId("");
      setTenants([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [{ data: profile }, { data: admin }] = await Promise.all([
        supabase.from("profiles").select("display_name, tenant_id, email").eq("id", uid).maybeSingle(),
        supabase.rpc("has_role", { _user_id: uid, _role: "admin" }),
      ]);
      if (cancelled) return;
      const adminFlag = admin === true;
      const own = profile?.tenant_id ?? `tenant-${uid.replace(/-/g, "").slice(0, 10)}`;
      setIsAdmin(adminFlag);
      setOwnTenantId(own);
      if (session?.user) setUser(toUser(session.user, profile?.display_name));

      let list: Tenant[] = [];
      if (adminFlag) {
        const { data: all } = await supabase
          .from("profiles")
          .select("tenant_id, email, display_name")
          .order("created_at");
        list = (all ?? [])
          .filter((p) => p.tenant_id !== own)
          .map((p) => ({ id: p.tenant_id, email: p.email ?? "", name: p.display_name || p.email || p.tenant_id }));
        setTenantIdState("");
      } else {
        list = [{ id: own, email: profile?.email ?? "", name: profile?.display_name || "My workspace" }];
        setTenantIdState(own);
      }
      if (cancelled) return;
      registry.clear();
      list.forEach((t) => registry.set(t.id, t));
      setTenants(list);
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
      // Only admins can switch tenants; tenant accounts stay on their own.
      if (isAdmin) setTenantIdState(id);
    },
    [isAdmin],
  );

  const value = useMemo(
    () => ({ user, session, tenantId, ownTenantId, isAdmin, tenants, ready, signOut, setTenantId }),
    [user, session, tenantId, ownTenantId, isAdmin, tenants, ready, signOut, setTenantId],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

export function tenantName(id: string) {
  if (!id) return "Unassigned";
  if (id === "tenant-admin") return "Admin";
  return registry.get(id)?.name ?? id;
}
