import { NextResponse } from "next/server";
import { attachMailReport } from "@/extension/robin/mail-domain";
import {
  ASSISTANT_SESSION_KINDS,
  clearAssistantSession,
  type AssistantSessionKind,
} from "@/extension/robin/assistant-sessions";
import { runAssistantTurn, resolveMode } from "@/lib/robin-assistant";
import { validateAgentImages } from "@/lib/image-attachments";
import { apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";
// The scoring mode walks a whole batch of postings in one turn.
export const maxDuration = 360;

export const POST = apiRoute(async (req) => {
  try {
    const body = await req.json() as {
      message?: unknown;
      readOnly?: unknown;
      mode?: unknown;
      images?: unknown;
    };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const imageError = body.images === undefined ? null : validateAgentImages(body.images);
    if (imageError) {
      return NextResponse.json({ error: imageError }, { status: 400 });
    }
    const images = (body.images ?? []) as Array<{ type: "image"; data: string; mimeType: string }>;
    if (!message && images.length === 0) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const mode = resolveMode(body);
    const { reply, usedTools, sessionId } = await runAssistantTurn(mode, message, images);
    // The mail-review turn is also run by the Telegram bridge; its report must
    // reach the dashboard's review store, not just the chat that asked for it.
    if (mode === "mail") attachMailReport(reply);
    return NextResponse.json({ reply, usedTools, sessionId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});

/**
 * Start a mode's conversation over.
 *
 * The remembered session id is dropped, so the next turn opens a fresh one. The
 * session file stays where it is — this is "new conversation", not "delete the
 * transcript", and the old one is still worth being able to read.
 *
 * Dashboard and Telegram share a conversation until 30 minutes of inactivity
 * or a local date change. This remains the explicit way to reset it sooner;
 * the monthly retention sweep handles old Robin transcripts separately.
 */
export const DELETE = apiRoute(async (req) => {
  try {
    const body = await req.json().catch(() => ({})) as { mode?: unknown };
    const mode = typeof body.mode === "string" ? body.mode : "default";
    if (!ASSISTANT_SESSION_KINDS.includes(mode as AssistantSessionKind)) {
      return NextResponse.json(
        { error: `mode must be one of: ${ASSISTANT_SESSION_KINDS.join(", ")}` },
        { status: 400 },
      );
    }
    const cleared = clearAssistantSession(mode as AssistantSessionKind);
    return NextResponse.json({ cleared, mode });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});
