import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { MAX_ATTACHED_IMAGE_BYTES } from "./image-attachments";

const execFileAsync = promisify(execFile);
const PDF_HEADER = Buffer.from("%PDF-");
const PDF_HEADER_SCAN_BYTES = 1024;
const PDF_RENDER_TIMEOUT_MS = 60_000;

export interface RenderedPdf {
  images: Array<{ data: string; mimeType: "image/jpeg" }>;
  truncated: boolean;
}

export function hasPdfHeader(data: Uint8Array): boolean {
  return Buffer.from(data.buffer, data.byteOffset, Math.min(data.byteLength, PDF_HEADER_SCAN_BYTES))
    .indexOf(PDF_HEADER) !== -1;
}

export async function renderPdfPages(data: Uint8Array, maxPages: number): Promise<RenderedPdf> {
  if (!hasPdfHeader(data)) throw new Error("The selected file is not a valid PDF");
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error("maxPages must be a positive integer");

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-web-pdf-"));
  const inputPath = path.join(directory, "input.pdf");
  const outputPrefix = path.join(directory, "page");

  try {
    await fs.writeFile(inputPath, data);
    await execFileAsync("pdftoppm", [
      "-f", "1",
      "-l", String(maxPages + 1),
      "-scale-to", "1800",
      "-jpeg",
      "-jpegopt", "quality=82,optimize=y",
      "-q",
      inputPath,
      outputPrefix,
    ], { timeout: PDF_RENDER_TIMEOUT_MS, maxBuffer: 1024 * 1024 });

    const pageNames = (await fs.readdir(directory))
      .filter((name) => /^page-\d+\.jpg$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (pageNames.length === 0) throw new Error("The PDF has no renderable pages");

    const images = await Promise.all(pageNames.slice(0, maxPages).map(async (name) => {
      const bytes = await fs.readFile(path.join(directory, name));
      if (bytes.byteLength > MAX_ATTACHED_IMAGE_BYTES) {
        throw new Error("A rendered PDF page is too large to attach");
      }
      return { data: bytes.toString("base64"), mimeType: "image/jpeg" as const };
    }));

    return { images, truncated: pageNames.length > maxPages };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export interface ExtractedPdfText {
  text: string;
  pages: number;
  truncated: boolean;
}

/**
 * A PDF's own text, all pages, via Poppler's pdftotext. Cheaper and more exact
 * for a model than page images, and not bound by the image cap, so a 40-slide
 * deck arrives whole. A scan comes back (nearly) empty; callers fall back to
 * renderPdfPages for those.
 */
export async function extractPdfText(data: Uint8Array, maxChars: number): Promise<ExtractedPdfText> {
  if (!hasPdfHeader(data)) throw new Error("The selected file is not a valid PDF");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-web-pdf-"));
  const inputPath = path.join(directory, "input.pdf");
  try {
    await fs.writeFile(inputPath, data);
    const { stdout } = await execFileAsync("pdftotext", ["-layout", "-enc", "UTF-8", "-q", inputPath, "-"], {
      timeout: PDF_RENDER_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
    // pdftotext ends every page with a form feed.
    const pageTexts = stdout.split("\f");
    if (pageTexts.at(-1)?.trim() === "") pageTexts.pop();
    const text = pageTexts
      .map((page, index) => `--- page ${index + 1} ---\n${page.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim()}`)
      .join("\n\n");
    return {
      text: text.length > maxChars ? text.slice(0, maxChars) : text,
      pages: pageTexts.length,
      truncated: text.length > maxChars,
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
