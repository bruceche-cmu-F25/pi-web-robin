import { NextResponse } from "next/server";
import { getPaper, PaperError, paperText } from "@/extension/robin/papers-domain";
import { apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { startResearchTask } from "@/lib/research-agent";

export const dynamic = "force-dynamic";
export const maxDuration = 660;
export const POST = apiRoute(async (req) => {
  try {
    const body = await parseJsonWithinLimit<{ id: unknown; revision: unknown; question: unknown; locale?: unknown }>(req, 50_000);
    const id = paperText(body?.id, 100, true);
    if (getPaper(id).revision !== body.revision) throw new PaperError("Paper changed; reload before asking the agent", 409);
    const run = startResearchTask({ paperId: id, question: paperText(body.question, 10_000, true), locale: body.locale });
    return NextResponse.json({ run }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, {
      status: error instanceof PaperError ? error.status : error instanceof RequestBodyTooLargeError ? 413 : error instanceof SyntaxError ? 400 : 500,
    });
  }
});
