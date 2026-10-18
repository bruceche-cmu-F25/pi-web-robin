import { NextResponse } from "next/server";
import { listPapers, paperProjects, PaperError, paperText } from "@/extension/robin/papers-domain";
import { createResearchProject, listResearchProjects, readResearchConversation, setActiveResearchProject, updateResearchProject } from "@/extension/robin/research-domain";
import { apiError, apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";

export const dynamic = "force-dynamic";
const failure = (error: unknown) => apiError(error, error instanceof RequestBodyTooLargeError ? 413 : error instanceof PaperError ? error.status : 500);

/** Projects with the counts a switcher needs; notebook bodies stay behind /api/research/objective. */
export const GET = apiRoute(async () => {
  try {
    const { activeId, projects } = listResearchProjects();
    const papers = listPapers();
    return NextResponse.json({ activeId, projects: projects.map(({ note, ...project }) => {
      const mine = papers.filter((paper) => paperProjects(paper).includes(project.id));
      return { ...project, hasNotes: !!note.trim(), papers: mine.length, needsPdf: mine.filter((paper) => paper.access).length,
        read: mine.filter((paper) => paper.analysis && !paper.analysis.outdated).length, messages: readResearchConversation(project.id).messages.length };
    }) });
  } catch (error) { return failure(error); }
});
export const POST = apiRoute(async (req) => {
  try { return NextResponse.json({ project: createResearchProject(await parseJsonWithinLimit(req, 60_000)) }); }
  catch (error) { return failure(error); }
});
export const PATCH = apiRoute(async (req) => {
  try {
    const body = await parseJsonWithinLimit<{ id: unknown; patch: unknown }>(req, 60_000);
    return NextResponse.json({ project: updateResearchProject(paperText(body?.id, 100, true), body.patch) });
  } catch (error) { return failure(error); }
});
/** Remember the project the researcher is working in, across devices. */
export const PUT = apiRoute(async (req) => {
  try {
    const body = await parseJsonWithinLimit<{ activeId: unknown }>(req, 1000);
    setActiveResearchProject(paperText(body?.activeId, 100, true));
    return NextResponse.json({ activeId: body.activeId });
  } catch (error) { return failure(error); }
});
