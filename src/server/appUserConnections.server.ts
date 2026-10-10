// Server-only helpers to persist each app user's encrypted connector key.
// Uses the caller's own authenticated client — RLS limits rows to the owner.
import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptConnectionKey, encryptConnectionKey } from "@/server/connectionKeyCrypto";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function saveConnectionKeyForUser(
  db: SupabaseClient<any, any, any>,
  userId: string,
  connectorId: string,
  connectionAPIKey: string,
) {
  const { error } = await db.from("app_user_connections").upsert(
    {
      user_id: userId,
      connector_id: connectorId,
      connection_key_ciphertext: encryptConnectionKey(connectionAPIKey),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,connector_id" },
  );
  if (error) throw error;
}

export async function getConnectionKeyForUser(
  db: SupabaseClient<any, any, any>,
  userId: string,
  connectorId: string,
) {
  const { data, error } = await db
    .from("app_user_connections")
    .select("connection_key_ciphertext")
    .eq("user_id", userId)
    .eq("connector_id", connectorId)
    .maybeSingle();
  if (error) throw error;
  return data ? decryptConnectionKey(data.connection_key_ciphertext) : null;
}

export async function deleteConnectionKeyForUser(
  db: SupabaseClient<any, any, any>,
  userId: string,
  connectorId: string,
) {
  const { error } = await db
    .from("app_user_connections")
    .delete()
    .eq("user_id", userId)
    .eq("connector_id", connectorId);
  if (error) throw error;
}
