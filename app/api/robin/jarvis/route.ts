import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { setJarvisTemplate, updateJarvisLead } from "@/extension/robin/jarvis-domain";
import { readJarvisView, startJarvisDiscovery, stopJarvisDiscovery } from "@/lib/jarvis-discovery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = apiRoute(() => NextResponse.json(readJarvisView()));
export const POST = apiRoute(async (request) => {
  const body = await request.json();
  if (body?.action === "stop") {
    stopJarvisDiscovery();
    return NextResponse.json(readJarvisView());
  }
  if (body?.action === "template") {
    return NextResponse.json(setJarvisTemplate({ subject: body.subject, body: body.body }, body.dryRun === true));
  }
  if (body?.action !== "discover") throw new Error("Unknown action");
  return NextResponse.json({ run: startJarvisDiscovery(body.target) }, { status: 202 });
});
export const PATCH = apiRoute(async (request) => {
  const body = await request.json();
  if (typeof body?.id !== "string" || body.id.length > 100) throw new Error("Contact id is required");
  return NextResponse.json({ lead: updateJarvisLead(body.id, body.patch) });
});
