// Server-only env shim: in the deployed worker runtime, server-side
// SUPABASE_* vars may not be populated, while the VITE_* build-time values
// are always inlined. Backfill process.env so generated Supabase clients
// and auth middleware can read them.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined;

if (url && !process.env["SUPABASE_URL"]) process.env["SUPABASE_URL"] = url;
if (key && !process.env["SUPABASE_PUBLISHABLE_KEY"]) process.env["SUPABASE_PUBLISHABLE_KEY"] = key;
if (projectId && !process.env["SUPABASE_PROJECT_ID"]) process.env["SUPABASE_PROJECT_ID"] = projectId;

export {};
