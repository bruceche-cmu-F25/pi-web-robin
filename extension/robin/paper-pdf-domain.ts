import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataPath, readJsonObject, updateJsonObject } from "./paths.ts";
import { getPaper, PaperError } from "./papers-domain.ts";
import { downloadPaperPdf } from "./paper-sources.ts";

const MAX_PDF_BYTES = 20 * 1024 * 1024;
function file(name: string): string { return join(dataPath("paper-pdfs"), name); }
function cached(name: string, limit: number): Buffer | null {
  try {
    const path = file(name), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new PaperError("Invalid cached PDF file", 422);
    return readFileSync(path);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
function publish(name: string, bytes: Uint8Array): void {
  const directory = dataPath("paper-pdfs");
  mkdirSync(directory, { recursive: true });
  if (lstatSync(directory).isSymbolicLink()) throw new PaperError("PDF cache must not be a symlink", 422);
  const temporary = file(`.${randomUUID()}.tmp`);
  try { writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" }); renameSync(temporary, file(name)); }
  finally { rmSync(temporary, { force: true }); }
}
/** Preserve original bytes, including uploads, independently of extracted text. */
export function storePaperPdf(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_PDF_BYTES) throw new PaperError("PDF must be under 20 MB", 413);
  if (!Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from("%PDF-"))) throw new PaperError("The source is not a PDF", 422);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (!cached(`${hash}.pdf`, MAX_PDF_BYTES)) publish(`${hash}.pdf`, bytes);
  return hash;
}
interface PdfOptions {
  signal?: AbortSignal;
  download?: typeof downloadPaperPdf;
  pageCount: (bytes: Uint8Array) => Promise<number>;
}
/** Legacy remote papers are fetched on demand. Old uploads need re-upload: their bytes were discarded. */
export async function getPaperPdf(id: string, options: PdfOptions): Promise<{ hash: string; bytes: Buffer; pages: number }> {
  const paper = getPaper(id);
  let hash = paper.source?.pdfHash;
  if (!hash) {
    const label = paper.source?.kind === "pdf" ? paper.source.label : "";
    if (label && !/^https?:\/\//i.test(label)) throw new PaperError("The original upload was not retained. Upload the PDF again to preview it.", 404);
    const url = label || paper.pdfUrl;
    if (!url) throw new PaperError("No original PDF available. Upload a PDF to preview it.", 404);
    const key = createHash("sha256").update(JSON.stringify([paper.id, url, paper.source?.loadedAt])).digest("hex");
    hash = readJsonObject<Record<string, string>>("paper-pdf-downloads.json")?.[key];
    if (!hash) {
      const bytes = await (options.download ?? downloadPaperPdf)(url, options.signal);
      options.signal?.throwIfAborted();
      hash = storePaperPdf(bytes);
      const savedHash = hash;
      updateJsonObject<Record<string, string>, void>("paper-pdf-downloads.json", (state) => ({ value: { ...state, [key]: savedHash }, result: undefined, changed: true }));
    }
  }
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new PaperError("Invalid PDF reference", 422);
  const bytes = cached(`${hash}.pdf`, MAX_PDF_BYTES);
  if (!bytes) throw new PaperError("The saved original PDF is missing. Upload it again.", 404);
  const metadata = cached(`${hash}.json`, 1000);
  const pages = metadata ? JSON.parse(metadata.toString("utf8")).pages : await options.pageCount(bytes);
  if (!Number.isInteger(pages) || pages < 1 || pages > 2000) throw new PaperError("PDF preview supports 1–2000 pages", 422);
  options.signal?.throwIfAborted();
  if (!metadata) publish(`${hash}.json`, Buffer.from(JSON.stringify({ pages })));
  return { hash, bytes, pages };
}
/** Render only the requested page; identical content reuses its cached page images. */
export async function getPaperPdfPage(pdf: Awaited<ReturnType<typeof getPaperPdf>>, page: number, render: (bytes: Uint8Array, page: number) => Promise<Uint8Array>): Promise<Uint8Array> {
  if (!Number.isInteger(page) || page < 1 || page > pdf.pages) throw new PaperError("Invalid PDF page", 400);
  const name = `${pdf.hash}-${page}.jpg`;
  const existing = cached(name, 10 * 1024 * 1024);
  if (existing) return existing;
  const image = await render(pdf.bytes, page);
  if (image.byteLength > 10 * 1024 * 1024) throw new PaperError("PDF page is too large", 413);
  publish(name, image);
  return image;
}
