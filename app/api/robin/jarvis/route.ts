import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { jsonResponse } from "@/lib/json-response";
import { DEFAULT_JARVIS_FOLLOW_UP, updateJarvisLead } from "@/extension/robin/jarvis-domain";
import { readJarvisView } from "@/lib/jarvis-discovery";
import { startJarvisOutbox } from "@/lib/jarvis-outbox";
import { startJarvisDaily } from "@/lib/jarvis-daily";

// instrumentation starts the outbox at boot; this covers a server that loaded
// before the outbox existed. Both are idempotent.
startJarvisOutbox();
startJarvisDaily();

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = apiRoute((request) => {
  const state = readJarvisView({ deferTemplates: new URL(request.url).searchParams.get("view") === "compact" });
  return jsonResponse(request, { ...state, followUpTemplate: state.followUpTemplate ?? DEFAULT_JARVIS_FOLLOW_UP },
    { headers: { "Cache-Control": "no-store" } });
});
export const PATCH = apiRoute(async (request) => {
  const body = await request.json();
  if (typeof body?.id !== "string" || body.id.length > 100) throw new Error("Contact id is required");
  return NextResponse.json({ lead: updateJarvisLead(body.id, body.patch) });
});
