export const DEFAULT_ENGINE_URL =
  "https://mv-cloudcore-engine-1.onrender.com";

export async function resolveEngineUrl(): Promise<{
  url?: string;
  error?: string;
}> {
  const raw = (process.env["ENGINE_URL"] ?? "").trim();

  const isDev =
    process.env["NODE_ENV"] !== "production";

  if (!raw) {
    return {
      url: DEFAULT_ENGINE_URL,
    };
  }

  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    return {
      error: `ENGINE_URL is not a valid absolute URL: ${raw}`,
    };
  }

  const isLocal =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "0.0.0.0" ||
    parsed.hostname === "::1";

  if (isLocal && !isDev) {
    return {
      error:
        "ENGINE_URL points to localhost, which cannot be reached from Cloudflare Workers.",
    };
  }

  return {
    url: raw.replace(/\/$/, ""),
  };
}