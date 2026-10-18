import { NextResponse } from "next/server";
import { addPaper, addPaperToProject, getPaper, listPapers, paperProjects, PaperError, paperText, removePaperFromProject, updatePaper } from "@/extension/robin/papers-domain";
import { getResearchProject } from "@/extension/robin/research-domain";
import { apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";

export const dynamic = "force-dynamic";

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, {
    status: error instanceof PaperError ? error.status : error instanceof RequestBodyTooLargeError ? 413 : 400,
  });
}
export const GET = apiRoute(async (req) => {
  try {
    const params = new URL(req.url).searchParams;
    const id = params.get("id");
    if (id) return NextResponse.json({ paper: getPaper(id) });
    const project = params.get("project");
    return NextResponse.json({ papers: listPapers().filter((paper) => !project || paperProjects(paper).includes(project)).map(({ id, url, pdfUrl, title, authors, year, status, tags, updatedAt, exports, access, analysis, source, abstract, projectIds }) => ({
      id, url, title, authors, year, status, tags, updatedAt, archived: exports.some((item) => item.archive), needsPdf: !!access, hasAnalysis: !!analysis && !analysis.outdated,
      projectIds: paperProjects({ projectIds }), downloadLinks: access ? [...new Set([...access.links, pdfUrl].filter(Boolean))].slice(0, 4) : undefined,
      coverage: source ? source.truncated || source.kind === "pasted" ? "excerpt" : "pdf" : abstract ? "abstract" : "none",
    })) });
  } catch (error) { return failure(error); }
});
export const POST = apiRoute(async (req) => {
  try { return NextResponse.json({ paper: addPaper(await parseJsonWithinLimit(req, 150_000), new URL(req.url).searchParams.get("project") || undefined) }); }
  catch (error) { return failure(error); }
});
export const PATCH = apiRoute(async (req) => {
  try {
    const body = await parseJsonWithinLimit<{ id: unknown; revision: unknown; patch: unknown; addToProject?: unknown; removeFromProject?: unknown }>(req, 220_000);
    if (body.addToProject !== undefined) return NextResponse.json({ paper: addPaperToProject(paperText(body.id, 100, true), getResearchProject(paperText(body.addToProject, 100, true)).id) });
    if (body.removeFromProject !== undefined) return NextResponse.json({ paper: removePaperFromProject(paperText(body.id, 100, true), paperText(body.removeFromProject, 100, true)) });
    return NextResponse.json({ paper: updatePaper(paperText(body.id, 100, true), body.revision, body.patch) });
  } catch (error) { return failure(error); }
});
