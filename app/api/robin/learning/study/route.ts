import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { readStudyPlan, savePythonReviewCheck, saveStudySessions, saveStudyWeek } from "@/extension/robin/study-plan-domain";

export const dynamic = "force-dynamic";
export const GET = apiRoute(async () => NextResponse.json(readStudyPlan(), { headers: { "Cache-Control": "no-store" } }));
export const PATCH = apiRoute(async (req) => {
  try {
    const body = await req.json();
    const week = saveStudyWeek(body.date, body.week, body.expected);
    return NextResponse.json({ week });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof Error && error.message.startsWith("Study plan changed") ? 409 : 400 }); }
});
export const POST = apiRoute(async (req) => {
  try {
    const body = await req.json();
    return NextResponse.json({ progress: savePythonReviewCheck(body.date, body.checked, body.expected) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof Error && error.message.startsWith("Review changed") ? 409 : 400 }); }
});
export const PUT = apiRoute(async (req) => {
  try { return NextResponse.json({ sessions: saveStudySessions((await req.json()).sessions) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
});
