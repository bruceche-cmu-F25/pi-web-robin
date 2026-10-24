import { NextResponse } from "next/server";
import { getPaper, PaperError, paperText, savePaperSource } from "@/extension/robin/papers-domain";
import { importResearchPdf, PAPER_TEXT_LIMIT } from "@/extension/robin/paper-reading-domain";
import { downloadPaperPdf } from "@/extension/robin/paper-sources";
import { storePaperPdf } from "@/extension/robin/paper-pdf-domain";
import { guardApiRequest } from "@/lib/api-route";
import { parseFormDataWithinLimit, parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { extractPdfText } from "@/lib/pdf-render";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function POST(req: Request) {
  const multipart = req.headers.get("content-type")?.startsWith("multipart/form-data;");
  const blocked = guardApiRequest(req, { json: !multipart });
  if (blocked) return blocked;
  try {
    let id: string, revision: unknown, bytes: Uint8Array, label: string;
    if (multipart) {
      const form = await parseFormDataWithinLimit(req, 20 * 1024 * 1024 + 10_000);
      if (!form.has("id")) {
        const file = form.get("file");
        if (!file || typeof file === "string") throw new PaperError("Choose a PDF under 20 MB");
        if (file.size > 20 * 1024 * 1024) throw new PaperError("PDF must be under 20 MB", 413);
        const paper = await importResearchPdf(new Uint8Array(await file.arrayBuffer()), file.name, paperText(form.get("projectId"), 100, true), { extract: extractPdfText, signal: req.signal });
        return NextResponse.json({ paper }, { headers: { "Cache-Control": "private, no-store" } });
      }
      id = paperText(form.get("id"), 100, true);
      revision = Number(form.get("revision"));
      const paper = getPaper(id);
      if (paper.revision !== revision) throw new PaperError("Paper changed; reload before importing", 409);
      const file = form.get("file");
      if (!file || typeof file === "string" || file.size > 20 * 1024 * 1024) throw new PaperError("Choose a PDF under 20 MB");
      bytes = new Uint8Array(await file.arrayBuffer());
      label = file.name.slice(0, 200);
    } else {
      const body = await parseJsonWithinLimit<{ id: unknown; revision: unknown; text?: unknown }>(req, 420_000);
      id = paperText(body.id, 100, true);
      revision = body.revision;
      const paper = getPaper(id);
      if (paper.revision !== revision) throw new PaperError("Paper changed; reload before importing", 409);
      if (body.text !== undefined) {
        return NextResponse.json({ paper: savePaperSource(id, revision, { text: paperText(body.text, 100_000, true), kind: "pasted", label: "User-provided text / 用户提供文本", truncated: false, loadedAt: new Date().toISOString() }) });
      }
      if (!paper.pdfUrl) throw new PaperError("No PDF link available. Upload a PDF or paste its text.");
      label = paper.pdfUrl;
      bytes = await downloadPaperPdf(paper.pdfUrl, req.signal);
    }
    const extracted = await extractPdfText(bytes, PAPER_TEXT_LIMIT);
    req.signal.throwIfAborted();
    return NextResponse.json({ paper: savePaperSource(id, revision, { ...extracted, kind: "pdf", label, loadedAt: new Date().toISOString(), pdfHash: storePaperPdf(bytes) }) });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return NextResponse.json({ error: "PDF reading needs Poppler (pdftotext) on the server. You can paste text instead." }, { status: 501 });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, {
      status: error instanceof PaperError ? error.status : error instanceof RequestBodyTooLargeError ? 413 : 422,
    });
  }
}
