import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { runAssistantTurn } from "@/lib/robin-assistant";
import { companionPrompt, companionReply, parseCompanionRequest } from "@/extension/robin/companion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 100;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/** Continuous ASR is NOT authority to execute. This route cannot choose another tool scope. */
export const POST = apiRoute(async request => {
  let input;
  try { input = parseCompanionRequest(await parseJsonWithinLimit(request, 240_000)); }
  catch (error) {
    return NextResponse.json({ code: "request" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400, headers });
  }
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(95_000)]);
    const result = await runAssistantTurn("readOnly", companionPrompt(input), [], undefined, signal);
    signal.throwIfAborted();
    return NextResponse.json(companionReply(result.reply, result.sessionId, result.usedTools), { headers });
  } catch {
    // No provider messages, keys or invented completion. No retry/fallback to a write mode.
    return NextResponse.json({ code: request.signal.aborted ? "cancelled" : "unconfirmed" }, { status: 503, headers });
  }
}, { json: false });
