import { NextResponse } from "next/server";
import { searchPapers } from "@/extension/robin/paper-sources";
import { PaperError } from "@/extension/robin/papers-domain";
import { apiRoute } from "@/lib/api-route";
import { discoverPapers, type DiscoveryInput } from "@/extension/robin/paper-discovery-domain";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";

export const dynamic = "force-dynamic";

/** Candidate discovery only: no model turn, library insertion or notebook write. */
export const POST = apiRoute(async (req) => {
  try {
    const input = await parseJsonWithinLimit<DiscoveryInput>(req, 8_000);
    return NextResponse.json(await discoverPapers(input, req.signal), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof PaperError ? error.status : error instanceof RequestBodyTooLargeError ? 413 : 502 });
  }
});
export const GET = apiRoute(async (req) => {
  try {
    const params = new URL(req.url).searchParams;
    return NextResponse.json(await searchPapers(params.get("q") ?? "", params.get("sort") === "newest" ? "submittedDate" : "relevance", req.signal));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof PaperError ? error.status : 502 });
  }
});
