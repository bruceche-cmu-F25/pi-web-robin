import { NextResponse } from "next/server";
import { MindmapError } from "@/extension/robin/mindmap";
import { apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { proposeMindmap } from "@/lib/mindmap-agent";

export const dynamic = "force-dynamic";
export const maxDuration = 180;
export const POST = apiRoute(async (req) => {
  try { return NextResponse.json(await proposeMindmap(await parseJsonWithinLimit(req, 24_000), req.signal)); }
  catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Mind map generation failed" }, {
      status: error instanceof MindmapError ? error.status : error instanceof RequestBodyTooLargeError ? 413 : error instanceof SyntaxError ? 400 : error instanceof Error && error.name === "AbortError" ? 499 : 502,
    });
  }
});
