import { NextResponse } from "next/server";
import { clearNoteAttachments, listNoteAttachments, readNoteAttachmentFile } from "@/extension/robin/note-attachments";
import { createNotionPage, searchNotion, type NotionAttachmentFile } from "@/extension/robin/notion-domain";
import { deleteNoteDraft } from "@/extension/robin/notes-domain";
import { clearNotesAgentSession } from "@/extension/robin/notes-agent-state";
import { cancelNoteFinalize } from "@/lib/note-finalize-jobs";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  try {
    const url = new URL(req.url);
    const pages = await searchNotion(url.searchParams.get("query") ?? "", 500);
    return NextResponse.json({ pages });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });

  try {
    const body = await req.json() as {
      parentPageId?: unknown;
      title?: unknown;
      content?: unknown;
      confirmed?: unknown;
      draftId?: unknown;
    };
    if (body.confirmed !== true) {
      return NextResponse.json({ error: "Confirm the destination and note before archiving" }, { status: 400 });
    }
    if (typeof body.parentPageId !== "string" || typeof body.title !== "string" || typeof body.content !== "string") {
      return NextResponse.json({ error: "parentPageId, title, and content are required" }, { status: 400 });
    }
    const draftId = typeof body.draftId === "string" ? body.draftId : "";
    // The draft's files are read from its own store, never from the request.
    const files: NotionAttachmentFile[] = draftId
      ? listNoteAttachments(draftId).flatMap((attachment) => {
        const file = readNoteAttachmentFile(draftId, attachment.id);
        return file ? [{ id: attachment.id, name: attachment.name, kind: attachment.kind, mimeType: attachment.mimeType, bytes: file.bytes }] : [];
      })
      : [];
    const page = await createNotionPage(body.parentPageId, body.title, body.content, files);
    if (draftId) {
      deleteNoteDraft(draftId);
      clearNotesAgentSession(draftId);
      cancelNoteFinalize(draftId);
      clearNoteAttachments(draftId);
    }
    return NextResponse.json({ page: { ...page, parentId: body.parentPageId } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
