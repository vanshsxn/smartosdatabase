import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface Caller {
  userId: string;
  email: string;
  tenantId: string;
  isAdmin: boolean;
}

/**
 * Verifies the Supabase access token sent by the browser and resolves the
 * caller's tenant and admin role from the database (RLS applies as the user).
 */
export async function resolveCaller(request: Request): Promise<Caller | null> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return null;

  const header = request.headers.get("authorization") ?? "";
  let token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) token = new URL(request.url).searchParams.get("access_token") ?? "";
  if (!token || token.split(".").length !== 3) return null;

  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData.user) return null;
  const uid = userData.user.id;

  const [{ data: profile }, { data: admin }] = await Promise.all([
    supabase.from("profiles").select("tenant_id").eq("id", uid).maybeSingle(),
    supabase.rpc("has_role", { _user_id: uid, _role: "admin" }),
  ]);

  return {
    userId: uid,
    email: userData.user.email ?? "",
    tenantId: profile?.tenant_id ?? `tenant-${uid.replace(/-/g, "").slice(0, 10)}`,
    isAdmin: admin === true,
  };
}
