import { NextResponse } from "next/server";
import { getPaper, PaperError, paperText } from "@/extension/robin/papers-domain";
import { apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { runResearchTask } from "@/lib/research-agent";

export const dynamic = "force-dynamic";
export const maxDuration = 660;
export const POST = apiRoute(async (req) => {
  try {
    const body = await parseJsonWithinLimit<{ id: unknown; revision: unknown; question: unknown; locale?: unknown }>(req, 50_000);
    const id = paperText(body?.id, 100, true);
    if (getPaper(id).revision !== body.revision) throw new PaperError("Paper changed; reload before asking the agent", 409);
    const result = await runResearchTask({ paperId: id, question: paperText(body.question, 10_000, true), locale: body.locale, signal: req.signal });
    return NextResponse.json({ paper: result.paper });
  } catch (error) {
    const saved = error as { reply?: string; sessionId?: string } | null;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), reply: saved?.reply, sessionId: saved?.sessionId }, {
      status: error instanceof PaperError ? error.status : error instanceof RequestBodyTooLargeError ? 413 : error instanceof SyntaxError ? 400 : 500,
    });
  }
});
