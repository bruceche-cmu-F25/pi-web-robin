import { NextResponse } from "next/server";
import { parseFormDataWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { extractPdfText } from "@/lib/pdf-render";
import { isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_PDF_BYTES + 1024 * 1024;
/** About 15k tokens: a long lecture deck or a paper, without flooding the agent's context. */
const MAX_TEXT_CHARS = 60_000;

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  try {
    const formData = await parseFormDataWithinLimit(request, MAX_REQUEST_BYTES);
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Select one PDF file" }, { status: 400 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "PDFs must be 25MB or smaller" }, { status: 413 });
    }
    return NextResponse.json(await extractPdfText(new Uint8Array(await file.arrayBuffer()), MAX_TEXT_CHARS));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "PDFs must be 25MB or smaller" }, { status: 413 });
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "PDF support requires Poppler (pdftotext) on the server" }, { status: 501 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 422 },
    );
  }
}
