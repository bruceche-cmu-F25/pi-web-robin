import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataPath, newId, readJsonObject, updateJsonObject } from "./paths.ts";

/**
 * Files that belong to a note draft: the slides or photos it was written
 * from. They feed "Prepare for Notion" and are uploaded into the Notion page
 * when the note is filed, so they live on disk beside the draft rather than in
 * the browser.
 *
 * Each file keeps its original bytes (for Notion) and, separately, what a
 * model should see: a small JPEG for a photo, the extracted text for a PDF,
 * page images for a scanned PDF.
 */
export interface NoteAttachment {
  id: string;
  name: string;
  kind: "image" | "pdf";
  mimeType: string;
  size: number;
  pages?: number;
  /** Characters of PDF text kept for the model. */
  textChars?: number;
  truncated?: boolean;
  modelImages: number;
  modelImageMime?: string;
  createdAt: string;
}

export interface NoteAttachmentInput {
  name: string;
  kind: "image" | "pdf";
  mimeType: string;
  bytes: Uint8Array;
  text?: string;
  pages?: number;
  truncated?: boolean;
  modelImages: Array<{ bytes: Uint8Array; mimeType: string }>;
}

const INDEX = "note-attachments.json";
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_NOTE_ATTACHMENTS = 10;
/** Notion's single-part upload limit; free workspaces cap files at 5MB on their side. */
export const MAX_NOTE_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function folder(draftId: string): string {
  if (!SAFE_ID.test(draftId)) throw new Error("Invalid draft id");
  return dataPath(join("note-attachments", draftId));
}

function filePath(draftId: string, id: string, suffix: string): string {
  if (!SAFE_ID.test(id)) throw new Error("Invalid attachment id");
  return join(folder(draftId), `${id}${suffix}`);
}

export function listNoteAttachments(draftId: string): NoteAttachment[] {
  if (!SAFE_ID.test(draftId)) return [];
  return readJsonObject<Record<string, NoteAttachment[]>>(INDEX)?.[draftId] ?? [];
}

export function addNoteAttachment(draftId: string, input: NoteAttachmentInput): NoteAttachment {
  if (input.bytes.byteLength > MAX_NOTE_ATTACHMENT_BYTES) throw new Error("Attachments must be 20MB or smaller");
  if (listNoteAttachments(draftId).length >= MAX_NOTE_ATTACHMENTS) {
    throw new Error(`A note can have at most ${MAX_NOTE_ATTACHMENTS} attachments`);
  }
  const id = newId();
  mkdirSync(folder(draftId), { recursive: true });
  writeFileSync(filePath(draftId, id, ".bin"), input.bytes);
  if (input.text) writeFileSync(filePath(draftId, id, ".txt"), input.text, "utf8");
  input.modelImages.forEach((image, index) => writeFileSync(filePath(draftId, id, `.m${index}`), image.bytes));

  const attachment: NoteAttachment = {
    id,
    name: input.name.slice(0, 200) || (input.kind === "pdf" ? "document.pdf" : "image"),
    kind: input.kind,
    mimeType: input.mimeType,
    size: input.bytes.byteLength,
    ...(input.pages ? { pages: input.pages } : {}),
    ...(input.text ? { textChars: input.text.length } : {}),
    ...(input.truncated ? { truncated: true } : {}),
    modelImages: input.modelImages.length,
    ...(input.modelImages[0] ? { modelImageMime: input.modelImages[0].mimeType } : {}),
    createdAt: new Date().toISOString(),
  };
  updateJsonObject<Record<string, NoteAttachment[]>, void>(INDEX, (current) => ({
    result: undefined,
    value: { ...current, [draftId]: [...(current?.[draftId] ?? []), attachment] },
    changed: true,
  }));
  return attachment;
}

export function readNoteAttachmentFile(draftId: string, id: string): { bytes: Buffer; attachment: NoteAttachment } | null {
  const attachment = listNoteAttachments(draftId).find((item) => item.id === id);
  if (!attachment) return null;
  try {
    return { bytes: readFileSync(filePath(draftId, id, ".bin")), attachment };
  } catch {
    return null;
  }
}

export function removeNoteAttachment(draftId: string, id: string): boolean {
  const removed = updateJsonObject<Record<string, NoteAttachment[]>, boolean>(INDEX, (current) => {
    const items = current?.[draftId] ?? [];
    if (!items.some((item) => item.id === id)) return { result: false, value: current ?? {}, changed: false };
    return { result: true, value: { ...current, [draftId]: items.filter((item) => item.id !== id) }, changed: true };
  });
  if (removed) {
    for (const name of [".bin", ".txt", ...Array.from({ length: MAX_NOTE_ATTACHMENTS }, (_, index) => `.m${index}`)]) {
      rmSync(filePath(draftId, id, name), { force: true });
    }
  }
  return removed;
}

/** Drop every file of a draft: it was deleted, or its note (with these files) is now in Notion. */
export function clearNoteAttachments(draftId: string): void {
  if (!SAFE_ID.test(draftId)) return;
  updateJsonObject<Record<string, NoteAttachment[]>, void>(INDEX, (current) => {
    if (!current?.[draftId]) return { result: undefined, value: current ?? {}, changed: false };
    const next = { ...current };
    delete next[draftId];
    return { result: undefined, value: next, changed: true };
  });
  rmSync(folder(draftId), { recursive: true, force: true });
}

/**
 * What a model is given for a draft's files, within an image cap and a text
 * budget. Later files lose text first when the budget runs out.
 */
export function readNoteAttachmentsForModel(draftId: string, limits: { images: number; textChars: number }) {
  const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
  const documents: Array<{ name: string; text: string; pages?: number; truncated: boolean }> = [];
  let budget = limits.textChars;
  const attachments = listNoteAttachments(draftId);
  for (const attachment of attachments) {
    for (let index = 0; index < attachment.modelImages && images.length < limits.images; index += 1) {
      try {
        images.push({
          type: "image",
          data: readFileSync(filePath(draftId, attachment.id, `.m${index}`)).toString("base64"),
          mimeType: attachment.modelImageMime ?? "image/jpeg",
        });
      } catch { /* A missing preview only costs the model this page. */ }
    }
    if (attachment.textChars && budget > 0) {
      try {
        const text = readFileSync(filePath(draftId, attachment.id, ".txt"), "utf8");
        const kept = text.slice(0, budget);
        budget -= kept.length;
        documents.push({
          name: attachment.name,
          text: kept,
          ...(attachment.pages ? { pages: attachment.pages } : {}),
          truncated: Boolean(attachment.truncated) || kept.length < text.length,
        });
      } catch { /* Same: the file is still filed, the model just does not read it. */ }
    }
  }
  return { attachments, images, documents };
}
