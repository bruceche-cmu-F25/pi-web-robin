import { NextResponse } from "next/server";
import { cancelResearchRun, readResearchSession, listResearchProjects, GENERAL_PROJECT_ID } from "@/extension/robin/research-domain";
import { paperText, PaperError } from "@/extension/robin/papers-domain";
import { apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { getRpcSession } from "@/lib/rpc-manager";
import { startResearchTask } from "@/lib/research-agent";

export const dynamic = "force-dynamic";
export const maxDuration = 660;
export const GET = apiRoute(async (req) => {
  try {
    const params = new URL(req.url).searchParams;
    const state = readResearchSession(params.get("project") || listResearchProjects().activeId || GENERAL_PROJECT_ID,
      params.get("conversation") || undefined, params.get("paper") || undefined);
    // A dead process cannot hold the UI forever. The durable turn lease still fences a retry.
    const stale = !!state.run && Date.now() - Date.parse(state.run.startedAt) >= 12 * 60_000;
    return NextResponse.json({ ...state, run: stale ? null : state.run });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof PaperError ? error.status : 500 });
  }
});
export const POST = apiRoute(async (req) => {
  try {
    const body = await parseJsonWithinLimit<{ question: unknown; locale?: unknown; paperId?: unknown; projectId?: unknown; conversationId?: unknown }>(req, 50_000);
    const run = startResearchTask({ question: paperText(body?.question, 10_000, true), locale: body?.locale,
      paperId: body?.paperId === undefined ? undefined : paperText(body.paperId, 100, true),
      projectId: body?.projectId === undefined ? undefined : paperText(body.projectId, 100, true),
      conversationId: body?.conversationId === undefined ? undefined : paperText(body.conversationId, 300, true) });
    return NextResponse.json({ run }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof PaperError ? error.status : error instanceof RequestBodyTooLargeError ? 413 : error instanceof SyntaxError ? 400 : 500 });
  }
});
export const DELETE = apiRoute(async (req) => {
  try {
    const run = cancelResearchRun(new URL(req.url).searchParams.get("run") || undefined);
    if (run?.sessionId) void getRpcSession(run.sessionId)?.send({ type: "abort" }).catch(() => {});
    return NextResponse.json({ stopped: !!run });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof PaperError ? error.status : 500 });
  }
});
