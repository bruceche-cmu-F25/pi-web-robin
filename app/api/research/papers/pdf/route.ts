import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { PaperError, paperText } from "@/extension/robin/papers-domain";
import { getPaperPdf, getPaperPdfPage } from "@/extension/robin/paper-pdf-domain";
import { pdfPageCount, renderPdfPage } from "@/lib/pdf-render";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const GET = apiRoute(async (req) => {
  try {
    const params = new URL(req.url).searchParams;
    const id = paperText(params.get("id"), 100, true);
    const page = params.has("page") ? Number(params.get("page")) : null;
    if (page !== null && (!Number.isInteger(page) || page < 1 || page > 2000)) throw new PaperError("Invalid PDF page", 400);
    const pdf = await getPaperPdf(id, { pageCount: pdfPageCount, signal: req.signal });
    if (params.has("hash") && params.get("hash") !== pdf.hash) throw new PaperError("The PDF changed. Reload the preview.", 409);
    if (params.get("download") === "1") return new NextResponse(new Uint8Array(pdf.bytes), { headers: {
      "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=paper.pdf", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
    if (page === null) return NextResponse.json({ pages: pdf.pages, hash: pdf.hash });
    const image = await getPaperPdfPage(pdf, page, renderPdfPage);
    return new NextResponse(new Uint8Array(image), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return NextResponse.json({ error: missing ? "PDF preview requires Poppler (pdfinfo and pdftoppm) on the server." : error instanceof Error ? error.message : String(error) },
      { status: error instanceof PaperError ? error.status : missing ? 501 : 422 });
  }
});
