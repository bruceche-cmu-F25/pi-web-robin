import { NextResponse } from "next/server";
import { appendResearchNote, getResearchProject, readResearchObjective, saveResearchObjective } from "@/extension/robin/research-domain";
import { PaperError } from "@/extension/robin/papers-domain";
import { captureResearchMessage, readResearchCaptures } from "@/extension/robin/research-capture-domain";
import { apiError, apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";

export const dynamic = "force-dynamic";
/** A project's focus and notebook; without ?project= the researcher's current project. */
const project = (req: Request) => new URL(req.url).searchParams.get("project") || undefined;
const failure = (error: unknown) => apiError(error, error instanceof RequestBodyTooLargeError ? 413 : error instanceof PaperError ? error.status : error instanceof SyntaxError ? 400 : 500);
export const GET = apiRoute(async (req) => {
  try {
    const notes = readResearchObjective(project(req));
    const captures = new URL(req.url).searchParams.get("captures") === "1" ? readResearchCaptures(getResearchProject(project(req)).id) : undefined;
    return NextResponse.json({ ...notes, ...(captures ? { captureState: captures } : {}) });
  }
  catch (error) { return failure(error); }
});
export const PATCH = apiRoute(async (req) => {
  try {
    const body = await parseJsonWithinLimit<{ text?: unknown; messageId?: unknown; vaultId?: unknown }>(req, 420_000);
    if (body?.messageId !== undefined) {
      const id = getResearchProject(project(req)).id;
      const capture = captureResearchMessage(id, body.messageId, body.vaultId);
      return NextResponse.json({ ...readResearchObjective(id), capture, captureState: readResearchCaptures(id) });
    }
    return NextResponse.json(appendResearchNote(body?.text, project(req)));
  } catch (error) { return failure(error); }
});
export const PUT = apiRoute(async (req) => {
  try { return NextResponse.json(saveResearchObjective(await parseJsonWithinLimit(req, 450_000), project(req))); }
  catch (error) { return failure(error); }
});
