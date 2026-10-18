import { NextResponse } from "next/server";
import { archivePaper, getPaper, PaperError, paperMarkdown, paperText } from "@/extension/robin/papers-domain";
import { ObsidianError } from "@/extension/robin/obsidian-domain";
import { listResearchProjects } from "@/extension/robin/research-domain";
import { apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";

export const dynamic = "force-dynamic";
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, {
    status: error instanceof PaperError || error instanceof ObsidianError ? error.status : 500,
  });
}
const projectNames = () => Object.fromEntries(listResearchProjects().projects.map((project) => [project.id, project.name]));
export const GET = apiRoute(async (req) => {
  try {
    const paper = getPaper(new URL(req.url).searchParams.get("id") ?? "");
    return NextResponse.json({ content: paperMarkdown(paper, new URL(req.url).searchParams.get("discussion") !== "false", projectNames()), revision: paper.revision, title: paper.title });
  } catch (error) { return failure(error); }
});
export const POST = apiRoute(async (req) => {
  try {
    const body = await parseJsonWithinLimit<{ id: unknown; revision: unknown; vaultId: unknown; confirmed: unknown; includeDiscussion?: unknown }>(req, 5000);
    if (body.includeDiscussion !== undefined && typeof body.includeDiscussion !== "boolean") throw new PaperError("Invalid discussion option");
    const archive = archivePaper(paperText(body.id, 100, true), { revision: body.revision, vaultId: paperText(body.vaultId, 64, true), confirmed: body.confirmed, includeDiscussion: body.includeDiscussion as boolean | undefined, projectNames: projectNames() });
    return NextResponse.json({ archive, paper: getPaper(body.id as string) });
  } catch (error) { return failure(error); }
});
