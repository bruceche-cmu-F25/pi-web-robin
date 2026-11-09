import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { runBriefDeliveryTick } from "@/lib/brief-delivery-runner";
import { briefDeliveryReceipts, briefLatestScheduledRun } from "@/extension/robin/brief-delivery-domain";
import { briefSchedule } from "@/extension/robin/brief-schedule";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
export const GET = apiRoute(() => NextResponse.json({ schedule: briefSchedule() ?? null, receipts: briefDeliveryReceipts(), run: briefLatestScheduledRun() }, { headers }));
export const POST = apiRoute(async req => {
  const body = await req.json();
  if (!body || typeof body.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.day)) throw new Error("A local day is required");
  // Browser consent for a manual preview cannot enable scheduling or delivery. Deployment gate wins.
  return NextResponse.json(await runBriefDeliveryTick(body.day, req.signal), { headers });
});
