import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import type { CoreJarvisSegment } from "@/extension/robin/jarvis-shape";
import { readJarvisView, startJarvisDiscovery, stopJarvisDiscovery } from "@/lib/jarvis-discovery";
import { startJarvisRescore, stopJarvisRescore } from "@/lib/jarvis-rescore";
import { startJarvisWebsiteEnrichment, stopJarvisWebsiteEnrichment } from "@/lib/jarvis-website-enrichment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = apiRoute(async (request) => {
  const body = await request.json();
  if (body?.action === "rescore") return NextResponse.json({ rescore: startJarvisRescore() }, { status: 202 });
  if (body?.action === "stop-rescore") {
    stopJarvisRescore();
    return NextResponse.json(readJarvisView());
  }
  if (body?.action === "website-enrich") return NextResponse.json({ websiteRun: startJarvisWebsiteEnrichment() }, { status: 202 });
  if (body?.action === "stop-website-enrich") {
    stopJarvisWebsiteEnrichment();
    return NextResponse.json(readJarvisView());
  }
  if (body?.action === "stop") {
    stopJarvisDiscovery();
    return NextResponse.json(readJarvisView());
  }
  if (body?.action !== "discover") throw new Error("Unknown research action");
  return NextResponse.json({ run: startJarvisDiscovery(body.target, body.focus as CoreJarvisSegment | undefined, body.wide === true, body.channelFocus) }, { status: 202 });
});
