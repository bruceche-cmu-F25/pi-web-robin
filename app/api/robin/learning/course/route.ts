import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { learningCourse, saveCourseRecord } from "@/extension/robin/learning-roadmap-domain";
import { ObsidianError } from "@/extension/robin/obsidian-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to access learning course" }, {
    status: error instanceof ObsidianError ? error.status : 500, headers,
  });
}
export const GET = apiRoute(async () => {
  try { return NextResponse.json(learningCourse(), { headers }); }
  catch (error) { return failure(error); }
});
export const PATCH = apiRoute(async (request) => {
  let input: unknown;
  try { input = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers }); }
  try { return NextResponse.json({ record: saveCourseRecord(input) }, { headers }); }
  catch (error) { return failure(error); }
});
