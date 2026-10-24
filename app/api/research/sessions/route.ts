import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { paperText, PaperError } from "@/extension/robin/papers-domain";
import { createResearchSession, listResearchSessions, updateResearchSession } from "@/extension/robin/research-domain";

export const dynamic = "force-dynamic";
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) },
    { status: error instanceof PaperError ? error.status : error instanceof RequestBodyTooLargeError ? 413 : error instanceof SyntaxError ? 400 : 500 });
}
export const GET = apiRoute(async (req) => {
  try {
    const projectId = paperText(new URL(req.url).searchParams.get("project"), 100, true);
    return NextResponse.json(listResearchSessions(projectId));
  } catch (error) { return failure(error); }
});
export const POST = apiRoute(async (req) => {
  try {
    const body = await parseJsonWithinLimit<{ projectId?: unknown; title?: unknown; paperId?: unknown; ensure?: unknown }>(req, 5000);
    const conversation = createResearchSession(paperText(body?.projectId, 100, true), { title: body?.title, paperId: body?.paperId, ensure: body?.ensure });
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) { return failure(error); }
});
export const PATCH = apiRoute(async (req) => {
  try {
    const body = await parseJsonWithinLimit<{ projectId?: unknown; id?: unknown; revision?: unknown; patch: { title?: unknown; archived?: unknown } }>(req, 5000);
    const conversation = updateResearchSession(paperText(body?.projectId, 100, true), paperText(body?.id, 300, true), body?.revision, body?.patch);
    return NextResponse.json({ conversation });
  } catch (error) { return failure(error); }
});
