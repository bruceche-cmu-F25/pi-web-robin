import { NextResponse } from "next/server";
import { searchPapers } from "@/extension/robin/paper-sources";
import { PaperError } from "@/extension/robin/papers-domain";
import { apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";
export const GET = apiRoute(async (req) => {
  try {
    const params = new URL(req.url).searchParams;
    return NextResponse.json(await searchPapers(params.get("q") ?? "", params.get("sort") === "newest" ? "submittedDate" : "relevance", req.signal));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof PaperError ? error.status : 502 });
  }
});
