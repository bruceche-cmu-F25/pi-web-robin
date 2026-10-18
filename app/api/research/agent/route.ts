import { NextResponse } from "next/server";
import { cancelResearchRun, readResearchConversation } from "@/extension/robin/research-domain";
import { paperText, PaperError } from "@/extension/robin/papers-domain";
import { apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { getRpcSession } from "@/lib/rpc-manager";
import { runResearchTask } from "@/lib/research-agent";

export const dynamic = "force-dynamic";
export const maxDuration = 660;
export const GET = apiRoute(async (req) => {
  const state = readResearchConversation(new URL(req.url).searchParams.get("project") || undefined);
  // A dead process cannot hold the UI forever. The durable turn lease still fences a retry.
  const stale = !!state.run && Date.now() - Date.parse(state.run.startedAt) >= 12 * 60_000;
  return NextResponse.json({ ...state, run: stale ? null : state.run });
});
export const POST = apiRoute(async (req) => {
  try {
    const body = await parseJsonWithinLimit<{ question: unknown; locale?: unknown; paperId?: unknown; projectId?: unknown }>(req, 50_000);
    const result = await runResearchTask({ question: paperText(body?.question, 10_000, true), locale: body?.locale, signal: req.signal,
      paperId: body?.paperId === undefined ? undefined : paperText(body.paperId, 100, true),
      projectId: body?.projectId === undefined ? undefined : paperText(body.projectId, 100, true) });
    return NextResponse.json({ reply: result.reply, sessionId: result.sessionId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof PaperError ? error.status : error instanceof RequestBodyTooLargeError ? 413 : error instanceof SyntaxError ? 400 : 500 });
  }
});
export const DELETE = apiRoute(async () => {
  const run = cancelResearchRun();
  if (run?.sessionId) void getRpcSession(run.sessionId)?.send({ type: "abort" }).catch(() => {});
  return NextResponse.json({ stopped: !!run });
});
