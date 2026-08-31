/**
 * Resolve the C++ engine base URL for server-side use.
 *
 * Priority:
 *  1. ENGINE_URL from the Cloudflare Worker runtime environment
 *     (per-request bindings, exposed via process.env with nodejs_compat,
 *      or via cloudflare:workers env when available).
 *  2. The deployed engine on Render (production-safe default).
 *
 * There is NO localhost fallback in production. A localhost ENGINE_URL is
 * only honored outside production (local development against a local engine).
 */

export const DEFAULT_ENGINE_URL = "https://mv-cloudcore-engine-1.onrender.com";

async function readRuntimeEnv(name: string): Promise<string | undefined> {
  // Cloudflare Workers with nodejs_compat populates process.env per request.
  const fromProcess = process.env[name];
  if (typeof fromProcess === "string" && fromProcess.trim() !== "") {
    return fromProcess.trim();
  }
  // Fall back to the Cloudflare workerd env object when running without
  // nodejs_compat process.env shimming.
  try {
    const mod = (await import("cloudflare:workers")) as {
      env?: Record<string, unknown>;
    };
    const value = mod.env?.[name];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  } catch {
    /* not running under workerd — ignore */
  }
  return undefined;
}

export async function resolveEngineUrl(): Promise<{ url?: string; error?: string }> {
  const isDev = process.env["NODE_ENV"] !== "production";
  const raw = await readRuntimeEnv("ENGINE_URL");

  if (!raw) {
    // No explicit configuration: use the deployed engine on Render.
    // (Localhost is never assumed — a local engine must be opted into by
    // setting ENGINE_URL=http://127.0.0.1:9090 in development.)
    return { url: DEFAULT_ENGINE_URL };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { error: `ENGINE_URL is not a valid absolute URL: ${raw}` };
  }

  const host = parsed.hostname;
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1";
  if (isLocal && !isDev) {
    return {
      error:
        "ENGINE_URL points at localhost, which is unreachable from Cloudflare Workers. Set it to the public HTTPS URL of the deployed C++ engine.",
    };
  }

  return { url: raw.replace(/\/$/, "") };
}
