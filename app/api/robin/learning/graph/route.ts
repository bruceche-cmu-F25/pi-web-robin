import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { learningGraphCatalog, learningGraphNote } from "@/extension/robin/learning-graph-domain";
import { ObsidianError } from "@/extension/robin/obsidian-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
export const GET = apiRoute(async (request) => {
  try {
    const params = new URL(request.url).searchParams;
    const vaultId = params.get("vaultId");
    if (!vaultId) throw new ObsidianError("Choose a registered vault");
    return NextResponse.json(params.has("path") ? await learningGraphNote(vaultId, params.get("path")!) : await learningGraphCatalog(vaultId), { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read roadmap" }, {
      status: error instanceof ObsidianError ? error.status : 500, headers,
    });
  }
});
