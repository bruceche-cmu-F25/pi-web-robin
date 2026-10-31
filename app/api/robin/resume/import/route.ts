import { NextResponse } from "next/server";
import { MAX_RESUME_PDF_BYTES, ResumeError } from "@/extension/robin/resume";
import { apiError, apiRoute } from "@/lib/api-route";
import { parseFormDataWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { readResumePdf } from "@/lib/resume-pdf";
import { proposeResumeFromPdf } from "@/lib/resume-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 330;

/** Temporary local PDF parsing → proposal only. Neither the PDF nor the LaTeX is saved here. */
export const POST = apiRoute(async (req) => {
  if (!req.headers.get("content-type")?.startsWith("multipart/form-data;")) return apiError("Upload one PDF as multipart/form-data", 415);
  try {
    const form = await parseFormDataWithinLimit(req, MAX_RESUME_PDF_BYTES + 65536);
    const file = form.get("file");
    if (!(file instanceof File) || form.getAll("file").length !== 1) return apiError("Upload exactly one PDF");
    if (!file.size || file.size > MAX_RESUME_PDF_BYTES) return apiError("Resume PDFs must be nonempty and at most 5 MB", 413);
    const locale = form.get("locale") === "zh-CN" ? "zh-CN" : form.get("locale") === "zh-TW" ? "zh-TW" : "en";
    const extracted = await readResumePdf(new Uint8Array(await file.arrayBuffer()), req.signal);
    const result = await proposeResumeFromPdf(extracted.text, extracted.pages, locale, req.signal);
    return NextResponse.json({ ...result, imported: { name: file.name.slice(0, 240), ...extracted } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, error instanceof RequestBodyTooLargeError ? 413 : error instanceof ResumeError ? error.status : 500);
  }
}, { json: false });
