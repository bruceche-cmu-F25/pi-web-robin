import { MAX_RESUME_PDF_BYTES, MAX_RESUME_PDF_PAGES, MAX_RESUME_PDF_TEXT, ResumeError } from "../extension/robin/resume.ts";
import { extractPdfText, hasPdfHeader, pdfPageCount } from "./pdf-render";

/** Fail closed on partial/scan extraction rather than silently dropping a resume page. */
export async function readResumePdf(bytes: Uint8Array, signal?: AbortSignal): Promise<{ text: string; pages: number }> {
  if (!bytes.length || bytes.length > MAX_RESUME_PDF_BYTES) throw new ResumeError("Resume PDFs must be nonempty and at most 5 MB", 413);
  if (!hasPdfHeader(bytes)) throw new ResumeError("The selected file is not a PDF", 415);
  signal?.throwIfAborted();
  try {
    // Check the complete page count before extracting, never convert only the first N pages.
    const pages = await pdfPageCount(bytes);
    signal?.throwIfAborted();
    if (pages > MAX_RESUME_PDF_PAGES) throw new ResumeError("Resume PDFs may contain at most 5 pages; no pages were converted", 413);
    const extracted = await extractPdfText(bytes, MAX_RESUME_PDF_TEXT);
    signal?.throwIfAborted();
    if (extracted.truncated || extracted.pages !== pages) throw new ResumeError("PDF text could not be read completely. No partial conversion was used.", 422);
    const pageTexts = extracted.text.split(/^--- page \d+ ---\n/gm).slice(1);
    // Whitespace and the synthetic page labels are not evidence that a scan was read.
    if (pageTexts.length !== pages || pageTexts.some((text) => text.replace(/\s/g, "").length < 40)) {
      throw new ResumeError("This PDF has scanned, blank or unreadable pages. Run OCR first or upload a PDF with selectable text; no partial conversion was used.", 422);
    }
    return { text: extracted.text, pages };
  } catch (error) {
    if (error instanceof ResumeError || signal?.aborted) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ResumeError("PDF conversion requires Poppler (pdfinfo and pdftotext) on the Pi Web server", 503);
    throw new ResumeError("Cannot read this PDF. It may be password-protected or damaged; upload an unlocked, readable copy.", 422);
  }
}
