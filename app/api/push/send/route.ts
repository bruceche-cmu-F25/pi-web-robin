import { isApiRequestAllowed } from "@/lib/request-security";
import { parsePushNotification, pushSubscriptionCount, sendPushNotification, PushNotificationConflictError } from "@/lib/web-push";

export const dynamic = "force-dynamic";

// The proxy enforces the same web-password/Basic-auth gate as other API routes.
export async function GET(req: Request): Promise<Response> {
  if (!isApiRequestAllowed(req)) return Response.json({ error: "Untrusted request" }, { status: 403 });
  return Response.json({ subscriptions: await pushSubscriptionCount() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request): Promise<Response> {
  if (!isApiRequestAllowed(req)) return Response.json({ error: "Untrusted request" }, { status: 403 });
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "JSON body required" }, { status: 415 });
  }
  let notification;
  try {
    const text = await req.text();
    if (text.length > 16_384) return Response.json({ error: "Notification too large" }, { status: 413 });
    notification = parsePushNotification(JSON.parse(text));
  } catch {
    return Response.json({ error: "Invalid notification: supply id, title, body, a local url, and optional ttl (1–86400)" }, { status: 400 });
  }
  try {
    const result = await sendPushNotification(notification);
    // No successful acceptance is not delivery. Callers must not consume a slot/job.
    return Response.json(result, { status: result.accepted > 0 ? 200 : 503 });
  } catch (error) {
    if (error instanceof PushNotificationConflictError) return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
