// Server endpoint that returns plain HTML — not a React component.
// The OAuth popup posts its one-time code to the opener, which exchanges it.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/oauth/github/return")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const connectorId = url.searchParams.get("connector_id") ?? "";
        const code = url.searchParams.get("code") ?? "";
        const success = url.searchParams.get("success") === "true";
        const offlineAccessAllowed = url.searchParams.get("offline_access_allowed");
        const error = url.searchParams.get("error");

        const result =
          success && offlineAccessAllowed === "false"
            ? { success: true, connectorId, code: null }
            : success && code
              ? { success: true, connectorId, code }
              : {
                  success: false,
                  connectorId,
                  error: error ?? (success ? "Missing code" : "OAuth failed"),
                };

        const escapeHtml = (str: string) =>
          str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
        const safeJson = JSON.stringify(result).replace(/<\//g, "<\\/");

        const html = `<!DOCTYPE html>
<html>
<head><title>Finishing connection…</title></head>
<body>
  <p>${result.success ? "Connection complete, closing…" : "Failed: " + escapeHtml(result.error ?? "Unknown error")}</p>
  <script>
    const result = ${safeJson};
    const type = result.success ? "appUserConnectorOAuthComplete" : "appUserConnectorOAuthFailed";
    const message = { type, connectorId: result.connectorId, code: result.code ?? null };
    if (window.opener && window.opener !== window) {
      window.opener.postMessage(message, window.location.origin);
    }
    window.close();
  </script>
</body>
</html>`;

        return new Response(html, { headers: { "Content-Type": "text/html" } });
      },
    },
  },
});
