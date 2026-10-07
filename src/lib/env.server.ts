// Server-only environment shim for Cloudflare / Nitro.
// Uses VITE_* values when available and falls back to
// Cloudflare/runtime environment variables.

const viteUrl = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const viteKey = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined;
const viteProjectId = import.meta.env["VITE_SUPABASE_PROJECT_ID"] as string | undefined;

if (typeof process !== "undefined" && process.env) {
  if (viteUrl) {
    process.env["SUPABASE_URL"] = viteUrl;
  }

  if (viteKey) {
    process.env["SUPABASE_PUBLISHABLE_KEY"] = viteKey;
  }

  if (viteProjectId) {
    process.env["SUPABASE_PROJECT_ID"] = viteProjectId;
  }
}

export {};