import { NextResponse } from "next/server";
import { parseFormDataWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { MAX_ATTACHED_IMAGES } from "@/lib/image-attachments";
import { renderPdfPages } from "@/lib/pdf-render";
import { isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_PDF_BYTES + 1024 * 1024;

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  try {
    const formData = await parseFormDataWithinLimit(request, MAX_REQUEST_BYTES);
    const file = formData.get("file");
    const maxPagesValue = formData.get("maxPages");
    const requestedPages = typeof maxPagesValue === "string" ? Number(maxPagesValue) : NaN;
    const maxPages = Number.isInteger(requestedPages)
      ? Math.min(MAX_ATTACHED_IMAGES, Math.max(1, requestedPages))
      : MAX_ATTACHED_IMAGES;

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Select one PDF file" }, { status: 400 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "PDFs must be 25MB or smaller" }, { status: 413 });
    }

    const rendered = await renderPdfPages(new Uint8Array(await file.arrayBuffer()), maxPages);
    return NextResponse.json(rendered);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "PDFs must be 25MB or smaller" }, { status: 413 });
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return NextResponse.json({ error: "PDF support requires Poppler (pdftoppm) on the server" }, { status: 501 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 422 },
    );
  }
}
