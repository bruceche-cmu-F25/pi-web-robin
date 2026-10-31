import { isLoopbackHost } from "@/lib/open-in-file-manager";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { readMacSnapshot } from "@/extension/robin/mac-system-domain";
import { macCleanup, MacCleanupError } from "@/extension/robin/mac-cleanup-domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
function guard(request: Request) {
  // Same host policy as Open in Finder; proxy.ts still owns password authentication.
  // Loopback Host is a usability fence, not proof of the peer address. Keep the server's local bind.
  if (!isApiRequestAllowed(request) || !isLoopbackHost(request.headers.get("host"))) return json({ error: "Open this tool on the host Mac via localhost" }, 403);
  return null;
}
export async function GET(request: Request) {
  const denied = guard(request); if (denied) return denied;
  return json(await readMacSnapshot());
}
export async function POST(request: Request) {
  const denied = guard(request); if (denied) return denied;
  if (process.platform !== "darwin" || process.getuid?.() === 0) return json({ error: "Requires macOS and a non-root user" }, 403);
  if (!hasJsonContentType(request)) return json({ error: "JSON required" }, 415);
  if (Number(request.headers.get("content-length")) > 4096) return json({ error: "Request too large" }, 413);
  try {
    const text = await request.text();
    if (text.length > 4096) return json({ error: "Request too large" }, 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request" }, 400);
    const action = (body as { action?: unknown }).action;
    if (action === "scan") return json(await macCleanup.scan(request.signal));
    if (action === "trash") return json(await macCleanup.trash(body));
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    if (error instanceof MacCleanupError) return json({ error: error.message }, error.status);
    return json({ error: "Disk operation could not complete. Check permissions and rescan; no permanent deletion is performed." }, 500);
  }
}
