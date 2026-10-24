import { NextResponse } from "next/server";
import { acceptWeek, CAPTURE_PREAMBLE, captureMessage, parseCaptureReply, plannerBoard, plannerContext, previewWeek, saveCapture, settleFocus } from "@/extension/robin/planner-domain";
import { runScopedAssistantTurn } from "@/lib/robin-assistant";
import { apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";
export const maxDuration = 90;
export const GET = apiRoute(async () => NextResponse.json(plannerBoard(await plannerContext())));
export const POST = apiRoute(async (req) => {
  const body = await req.json();
  if (!body || typeof body !== "object") throw new Error("Expected a planner request");
  if (body.action === "capture") {
    const ids = saveCapture(body.capture, body.requestId);
    return NextResponse.json({ ids });
  }
  if (body.action === "settle") {
    settleFocus({ ...body, action: body.operation });
    return NextResponse.json({ success: true });
  }
  if (!["extract", "preview", "accept"].includes(body.action)) throw new Error("Unknown planner action");
  const context = await plannerContext();
  if (body.action === "accept") {
    acceptWeek(context, body.proposal);
    return NextResponse.json({ success: true });
  }
  if (body.action === "preview") return NextResponse.json(previewWeek(context, body));
  if (typeof body.note !== "string" || !body.note.trim() || body.note.length > 5000) throw new Error("Describe your week in 1–5000 characters");
  const result = await runScopedAssistantTurn({
    remembered: null, remember: () => {}, oneShot: true, toolNames: [],
    preamble: CAPTURE_PREAMBLE, message: captureMessage(context, body.note), signal: req.signal, timeoutMs: 75_000,
  });
  return NextResponse.json({ capture: parseCaptureReply(result.reply, context) });
});
