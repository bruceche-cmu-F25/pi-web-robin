import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { weeklyView, setWeeklyPreferences, setWeeklyRead } from "@/extension/robin/ai-weekly-domain";
import { startWeeklyGeneration } from "@/lib/ai-weekly-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Read-only: opening the page never starts a paid research turn. */
export const GET = apiRoute((req) => NextResponse.json(weeklyView(new URL(req.url).searchParams.get("week") ?? undefined)));
export const POST = apiRoute(async (req) => {
  const body = await req.json();
  if (!body || body.action !== "generate") throw new Error("Unknown weekly action");
  const started = startWeeklyGeneration();
  return NextResponse.json({ started, ...weeklyView() }, { status: started ? 202 : 200 });
});
export const PATCH = apiRoute(async (req) => {
  const body = await req.json();
  if (body?.action === "preferences") setWeeklyPreferences(body.preferences);
  else if (body?.action === "read") setWeeklyRead(body.week, body.date, body.read);
  else throw new Error("Unknown weekly action");
  return NextResponse.json(weeklyView());
});
