import { compressImageFile } from "@/lib/image-compress";
import { MAX_ATTACHED_IMAGE_BYTES, isBase64ImageWithinLimits } from "@/lib/image-attachments";

/** One file handed to an agent: images go to the model as images, PDFs as their text. */
export interface AgentAttachment {
  id: string;
  name: string;
  kind: "image" | "pdf";
  images: Array<{ data: string; mimeType: string }>;
  text?: string;
  pages?: number;
  /** The text was cut at the reading limit, or a scan had more pages than image slots. */
  truncated?: boolean;
  previewUrl?: string;
}

/** Fewer characters than this across a whole PDF means a scan: send its pages as images instead. */
const SCANNED_PDF_TEXT_CHARS = 200;

export function isAttachableFile(file: Pick<File, "name" | "type">): boolean {
  return file.type.startsWith("image/") || file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

async function postPdf<T>(url: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.set("file", file);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const response = await fetch(url, { method: "POST", body: form });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok || body.error) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

/**
 * Read a picked, pasted or dropped file. `imageSlots` is how many more images
 * the message can carry; a scanned PDF uses up to that many for its pages.
 */
export async function readAgentAttachment(file: File, imageSlots: number): Promise<AgentAttachment> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (file.type.startsWith("image/")) {
    if (imageSlots < 1) throw new Error("image-limit");
    if (file.size > MAX_ATTACHED_IMAGE_BYTES) throw new Error(`${file.name}: images must be 10MB or smaller`);
    const image = await compressImageFile(file);
    return { id, name: file.name || "image", kind: "image", images: [image], previewUrl: `data:${image.mimeType};base64,${image.data}` };
  }

  const extracted = await postPdf<{ text: string; pages: number; truncated: boolean }>("/api/pdf/text", file);
  if (extracted.text.replace(/--- page \d+ ---/g, "").trim().length >= SCANNED_PDF_TEXT_CHARS) {
    return { id, name: file.name, kind: "pdf", images: [], text: extracted.text, pages: extracted.pages, truncated: extracted.truncated };
  }
  if (imageSlots < 1) throw new Error("image-limit");
  const rendered = await postPdf<{ images?: Array<{ data: string; mimeType: string }>; truncated?: boolean }>(
    "/api/pdf/render", file, { maxPages: String(imageSlots) },
  );
  const images = (rendered.images ?? []).filter(isBase64ImageWithinLimits);
  if (images.length === 0) throw new Error(`${file.name}: no readable pages`);
  return { id, name: file.name, kind: "pdf", images, pages: extracted.pages, truncated: Boolean(rendered.truncated) };
}

/** Per message, matching what the server accepts. */
export { MAX_ATTACHED_IMAGES as MAX_AGENT_IMAGES } from "@/lib/image-attachments";
export const MAX_AGENT_DOCUMENTS = 5;
