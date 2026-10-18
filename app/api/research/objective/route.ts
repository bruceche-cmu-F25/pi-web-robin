import { NextResponse } from "next/server";
import { appendResearchNote, readResearchObjective, saveResearchObjective } from "@/extension/robin/research-domain";
import { PaperError } from "@/extension/robin/papers-domain";
import { apiError, apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";

export const dynamic = "force-dynamic";
/** A project's focus and notebook; without ?project= the researcher's current project. */
const project = (req: Request) => new URL(req.url).searchParams.get("project") || undefined;
const failure = (error: unknown) => apiError(error, error instanceof RequestBodyTooLargeError ? 413 : error instanceof PaperError ? error.status : 500);
export const GET = apiRoute(async (req) => {
  try { return NextResponse.json(readResearchObjective(project(req))); }
  catch (error) { return failure(error); }
});
export const PATCH = apiRoute(async (req) => {
  try {
    const body = await parseJsonWithinLimit<{ text?: unknown }>(req, 420_000);
    return NextResponse.json(appendResearchNote(body?.text, project(req)));
  } catch (error) { return failure(error); }
});
export const PUT = apiRoute(async (req) => {
  try { return NextResponse.json(saveResearchObjective(await req.json(), project(req))); }
  catch (error) { return failure(error); }
});
