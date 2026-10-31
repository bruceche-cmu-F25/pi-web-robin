import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { roadmapCatalog, roadmapNote, saveRoadmapRecord } from "@/extension/robin/learning-roadmap-domain";
import { ObsidianError } from "@/extension/robin/obsidian-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to access learning roadmap" }, {
    status: error instanceof ObsidianError ? error.status : 500, headers,
  });
}
export const GET = apiRoute(async (request) => {
  try {
    const params = new URL(request.url).searchParams;
    const vaultId = params.get("vaultId");
    if (!vaultId) throw new ObsidianError("Choose a registered vault");
    return NextResponse.json(params.has("path") ? await roadmapNote(vaultId, params.get("path")!) : await roadmapCatalog(vaultId), { headers });
  } catch (error) { return failure(error); }
});
export const PATCH = apiRoute(async (request) => {
  let input: unknown;
  try { input = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers }); }
  try { return NextResponse.json({ record: await saveRoadmapRecord(input) }, { headers }); }
  catch (error) { return failure(error); }
});
