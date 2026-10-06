import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
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
export const GET = apiRoute(() => {
  const state = readJarvisView();
  return NextResponse.json({ ...state, followUpTemplate: state.followUpTemplate ?? DEFAULT_JARVIS_FOLLOW_UP });
});
export const PATCH = apiRoute(async (request) => {
  const body = await request.json();
  if (typeof body?.id !== "string" || body.id.length > 100) throw new Error("Contact id is required");
  return NextResponse.json({ lead: updateJarvisLead(body.id, body.patch) });
});
