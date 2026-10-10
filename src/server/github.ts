import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import {
  appUserReconnectRequired,
  authorizeAppUserOAuth,
  callAsAppUser,
  disconnectAppUser,
  exchangeAppUserOAuthCode,
} from "@/integrations/lovable/appUserConnector";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  deleteConnectionKeyForUser,
  getConnectionKeyForUser,
  saveConnectionKeyForUser,
} from "@/server/appUserConnections.server";

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
const CONNECTOR_ID = "github";
export const GITHUB_SCOPES = ["read:user", "repo"];

function clientKey(): string {
  const key = process.env.GITHUB_APP_USER_CONNECTOR_CLIENT_API_KEY;
  if (!key) {
    throw new Error(
      "GitHub sign-in is only available on the Lovable-hosted site (smarttaskrunner.lovable.app).",
    );
  }
  return key;
}

export const startGithubConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const request = getRequest();
    if (!request) throw new Error("OAuth must start from an app request.");
    const url = new URL(request.url);
    const sandboxHost =
      url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
    const returnUrl = new URL(
      "/api/oauth/github/return",
      sandboxHost ? `https://${sandboxHost}` : url.origin,
    ).toString();

    const connectionAPIKey = await getConnectionKeyForUser(
      context.supabase,
      context.userId,
      CONNECTOR_ID,
    );

    const { authorizationUrl } = await authorizeAppUserOAuth({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectorId: CONNECTOR_ID,
      appUserId: context.userId,
      clientAPIKey: clientKey(),
      returnUrl,
      connectionAPIKey: connectionAPIKey ?? undefined,
      credentialsConfiguration: { scopes: GITHUB_SCOPES },
    });
    return { authorizationUrl };
  });

export const completeGithubConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string }) => input)
  .handler(async ({ data, context }) => {
    const { connectionAPIKey, connectorId } = await exchangeAppUserOAuthCode(
      GATEWAY_BASE_URL,
      data.code,
    );
    if (connectorId !== CONNECTOR_ID) {
      throw new Error("OAuth completion returned the wrong connector");
    }
    await saveConnectionKeyForUser(context.supabase, context.userId, connectorId, connectionAPIKey);
    return { ok: true };
  });

async function githubCall(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
  path: string,
): Promise<{ connected: boolean; reconnectRequired?: boolean; data?: unknown }> {
  const connectionAPIKey = await getConnectionKeyForUser(db, userId, CONNECTOR_ID);
  if (!connectionAPIKey) return { connected: false };
  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey,
    connectorId: CONNECTOR_ID,
    path,
    init: { method: "GET", headers: { Accept: "application/vnd.github+json" } },
    requiredScopes: GITHUB_SCOPES,
  });
  if (await appUserReconnectRequired(res)) return { connected: false, reconnectRequired: true };
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub request failed [${res.status}]: ${body.slice(0, 300)}`);
  }
  return { connected: true, data: await res.json() };
}

export const fetchGithubProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const r = await githubCall(context.supabase, context.userId, "/user");
    if (!r.connected) return { connected: false as const, reconnectRequired: r.reconnectRequired };
    const u = r.data as { login: string; avatar_url: string; name: string | null };
    return {
      connected: true as const,
      profile: { login: u.login, avatarUrl: u.avatar_url, name: u.name },
    };
  });

export const fetchGithubRepos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const r = await githubCall(
      context.supabase,
      context.userId,
      "/user/repos?per_page=30&sort=updated",
    );
    if (!r.connected) return { connected: false as const, reconnectRequired: r.reconnectRequired };
    const repos = (r.data as Array<Record<string, unknown>>).map((repo) => ({
      fullName: repo.full_name as string,
      private: Boolean(repo.private),
      description: (repo.description as string | null) ?? null,
      defaultBranch: (repo.default_branch as string) ?? "main",
      updatedAt: repo.updated_at as string,
      url: repo.html_url as string,
    }));
    return { connected: true as const, repos };
  });

export const disconnectGithub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const connectionAPIKey = await getConnectionKeyForUser(
      context.supabase,
      context.userId,
      CONNECTOR_ID,
    );
    if (connectionAPIKey) {
      await disconnectAppUser({
        gatewayBaseUrl: GATEWAY_BASE_URL,
        connectionAPIKey,
        connectorId: CONNECTOR_ID,
      });
      await deleteConnectionKeyForUser(context.supabase, context.userId, CONNECTOR_ID);
    }
    return { ok: true };
  });
