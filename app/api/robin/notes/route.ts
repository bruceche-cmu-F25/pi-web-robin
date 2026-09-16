import { NextResponse } from "next/server";
import { createNoteDraft, deleteNoteDraft, readNoteDrafts, updateNoteDraft } from "@/extension/robin/notes-domain";
import { clearNotesAgentSession } from "@/extension/robin/notes-agent-state";
import { clearNoteAttachments } from "@/extension/robin/note-attachments";
import { cancelNoteFinalize } from "@/lib/note-finalize-jobs";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const MAX_TITLE = 200;
const MAX_NOTE = 100_000;

function denied(req: Request): NextResponse | null {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (req.method !== "GET" && !hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}

function text(value: unknown, limit: number): string | null {
  if (typeof value !== "string" || value.length > limit) return null;
  return value;
}

export function GET(req: Request) {
  const blocked = denied(req);
  if (blocked) return blocked;
  return NextResponse.json({ drafts: readNoteDrafts() });
}

export async function POST(req: Request) {
  const blocked = denied(req);
  if (blocked) return blocked;
  try {
    const body = await req.json() as { title?: unknown; text?: unknown; notionParentId?: unknown };
    const title = text(body.title, MAX_TITLE);
    const note = text(body.text ?? "", MAX_NOTE);
    const notionParentId = text(body.notionParentId ?? "", 64);
    if (title === null || note === null || notionParentId === null) {
      return NextResponse.json({ error: "Invalid note draft" }, { status: 400 });
    }
    return NextResponse.json({ draft: createNoteDraft({ title, text: note, notionParentId }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const blocked = denied(req);
  if (blocked) return blocked;
  try {
    const body = await req.json() as { id?: unknown; title?: unknown; text?: unknown; notionParentId?: unknown };
    if (typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const patch: { title?: string; text?: string; notionParentId?: string } = {};
    if (body.title !== undefined) {
      const value = text(body.title, MAX_TITLE);
      if (value === null) return NextResponse.json({ error: "Invalid title" }, { status: 400 });
      patch.title = value;
    }
    if (body.text !== undefined) {
      const value = text(body.text, MAX_NOTE);
      if (value === null) return NextResponse.json({ error: "Invalid note" }, { status: 400 });
      patch.text = value;
    }
    if (body.notionParentId !== undefined) {
      const value = text(body.notionParentId, 64);
      if (value === null) return NextResponse.json({ error: "Invalid Notion parent" }, { status: 400 });
      patch.notionParentId = value;
    }
    const draft = updateNoteDraft(body.id, patch);
    return draft
      ? NextResponse.json({ draft })
      : NextResponse.json({ error: "Draft not found" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const blocked = denied(req);
  if (blocked) return blocked;
  try {
    const body = await req.json() as { id?: unknown };
    if (typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const deleted = deleteNoteDraft(body.id);
    if (deleted) {
      clearNotesAgentSession(body.id);
      cancelNoteFinalize(body.id);
      clearNoteAttachments(body.id);
    }
    return deleted
      ? NextResponse.json({ deleted: true })
      : NextResponse.json({ error: "Draft not found" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
