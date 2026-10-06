import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { setJarvisDaily, setJarvisFollowUpTemplate, setJarvisOutbox, setJarvisSocialTemplate, setJarvisTemplate } from "@/extension/robin/jarvis-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = apiRoute(async (request) => {
  const body = await request.json();
  if (body?.action === "daily") return NextResponse.json({ daily: setJarvisDaily({ enabled: body.enabled, count: body.count, hour: body.hour }) });
  if (body?.action === "outbox") return NextResponse.json({ outbox: setJarvisOutbox({ enabled: body.enabled, dailyLimit: body.dailyLimit, startAt: body.startAt }) });
  if (body?.action === "social-template") return NextResponse.json({ template: setJarvisSocialTemplate(body.platform, body.body) });
  if (body?.action === "follow-up-template") return NextResponse.json({ followUpTemplate: setJarvisFollowUpTemplate(body.body) });
  if (body?.action === "template") return NextResponse.json(setJarvisTemplate({ subject: body.subject, body: body.body }, body.dryRun === true));
  throw new Error("Unknown preference action");
});
