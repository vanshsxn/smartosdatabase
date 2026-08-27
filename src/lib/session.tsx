import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

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
  email: string;
  name: string;
  initials: string;
}

interface SessionValue {
  user: SessionUser | null;
  tenantId: string; // "" means all tenants
  ready: boolean;
  signIn: (email: string) => void;
  signOut: () => void;
  setTenantId: (id: string) => void;
}

const STORAGE_USER = "mvcc.user";
const STORAGE_TENANT = "mvcc.tenant";

const SessionContext = createContext<SessionValue | null>(null);

function toUser(email: string): SessionUser {
  const handle = email.split("@")[0] ?? "operator";
  const parts = handle.split(/[._-]+/).filter(Boolean);
  const name = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ") || "Operator";
  const initials = (parts[0]?.[0] ?? "o") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "p");
  return { email, name, initials: initials.toUpperCase() };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [tenantId, setTenantIdState] = useState<string>("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_USER);
      if (raw) setUser(JSON.parse(raw) as SessionUser);
      setTenantIdState(localStorage.getItem(STORAGE_TENANT) ?? "");
    } catch {
      /* ignore corrupt storage */
    }
    setReady(true);
  }, []);

  const signIn = useCallback((email: string) => {
    const next = toUser(email);
    localStorage.setItem(STORAGE_USER, JSON.stringify(next));
    setUser(next);
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(STORAGE_USER);
    setUser(null);
  }, []);

  const setTenantId = useCallback((id: string) => {
    localStorage.setItem(STORAGE_TENANT, id);
    setTenantIdState(id);
  }, []);

  const value = useMemo(
    () => ({ user, tenantId, ready, signIn, signOut, setTenantId }),
    [user, tenantId, ready, signIn, signOut, setTenantId],
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
