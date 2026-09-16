import { NextResponse } from "next/server";
import {
  MAX_NOTE_ATTACHMENT_BYTES,
  addNoteAttachment,
  listNoteAttachments,
  readNoteAttachmentFile,
  removeNoteAttachment,
} from "@/extension/robin/note-attachments";
import { readNoteDrafts } from "@/extension/robin/notes-domain";
import { parseFormDataWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isBase64ImageWithinLimits, MAX_ATTACHED_IMAGE_BYTES } from "@/lib/image-attachments";
import { extractPdfText, hasPdfHeader, renderPdfPages } from "@/lib/pdf-render";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per PDF, for the model; the whole file still goes to Notion. */
const MAX_TEXT_CHARS = 60_000;
/** A scan is read from its first pages only. */
const SCANNED_PAGES = 5;
const SCANNED_PDF_TEXT_CHARS = 200;

function denied(req: Request): NextResponse | null {
  return isApiRequestAllowed(req) ? null : NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
}

/** `?draftId=` lists a draft's files; adding `&id=` serves one, for previews. */
export function GET(req: Request) {
  const blocked = denied(req);
  if (blocked) return blocked;
  const url = new URL(req.url);
  const draftId = url.searchParams.get("draftId") ?? "";
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ attachments: listNoteAttachments(draftId) });
  const file = readNoteAttachmentFile(draftId, id);
  if (!file) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.attachment.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.attachment.name)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(req: Request) {
  const blocked = denied(req);
  if (blocked) return blocked;
  try {
    const form = await parseFormDataWithinLimit(req, MAX_NOTE_ATTACHMENT_BYTES + 12 * 1024 * 1024);
    const draftId = form.get("draftId");
    const file = form.get("file");
    if (typeof draftId !== "string" || !readNoteDrafts().some((draft) => draft.id === draftId)) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    if (!file || typeof file === "string") return NextResponse.json({ error: "Select a file" }, { status: 400 });
    if (file.size > MAX_NOTE_ATTACHMENT_BYTES) {
      return NextResponse.json({ error: "Attachments must be 20MB or smaller" }, { status: 413 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (hasPdfHeader(bytes)) {
      const extracted = await extractPdfText(bytes, MAX_TEXT_CHARS);
      const scanned = extracted.text.replace(/--- page \d+ ---/g, "").trim().length < SCANNED_PDF_TEXT_CHARS;
      const rendered = scanned ? await renderPdfPages(bytes, SCANNED_PAGES) : null;
      const attachment = addNoteAttachment(draftId, {
        name: file.name || "document.pdf",
        kind: "pdf",
        mimeType: "application/pdf",
        bytes,
        ...(scanned ? {} : { text: extracted.text }),
        pages: extracted.pages,
        truncated: scanned ? Boolean(rendered?.truncated) : extracted.truncated,
        modelImages: (rendered?.images ?? []).map((image) => ({ bytes: Buffer.from(image.data, "base64"), mimeType: image.mimeType })),
      });
      return NextResponse.json({ attachment });
    }

    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
      return NextResponse.json({ error: "Attach an image or a PDF" }, { status: 415 });
    }
    // The browser sends a shrunken copy for the model; the original goes to Notion.
    const preview = { data: form.get("preview"), mimeType: form.get("previewMime") };
    const modelImage = isBase64ImageWithinLimits(preview)
      ? { bytes: Buffer.from(preview.data, "base64"), mimeType: preview.mimeType }
      : bytes.byteLength <= MAX_ATTACHED_IMAGE_BYTES ? { bytes, mimeType: file.type } : null;
    const attachment = addNoteAttachment(draftId, {
      name: file.name || "image",
      kind: "image",
      mimeType: file.type,
      bytes,
      modelImages: modelImage ? [modelImage] : [],
    });
    return NextResponse.json({ attachment });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Attachments must be 20MB or smaller" }, { status: 413 });
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "PDF support requires Poppler on the server" }, { status: 501 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}

export async function DELETE(req: Request) {
  const blocked = denied(req);
  if (blocked) return blocked;
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body = await req.json() as { draftId?: unknown; id?: unknown };
    if (typeof body.draftId !== "string" || typeof body.id !== "string") {
      return NextResponse.json({ error: "draftId and id are required" }, { status: 400 });
    }
    return NextResponse.json({ removed: removeNoteAttachment(body.draftId, body.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
