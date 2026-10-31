import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { ResumeError } from "@/extension/robin/resume";
import { compileResumePreview } from "@/lib/resume-preview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 75;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export const POST = apiRoute(async (request) => {
  try {
    const body = await parseJsonWithinLimit<{ source?: unknown } | null>(request, 1_250_000);
    return NextResponse.json(await compileResumePreview(body?.source, request.signal), { headers });
  } catch (error) {
    const status = error instanceof ResumeError ? error.status : error instanceof RequestBodyTooLargeError ? 413
      : error instanceof SyntaxError || error instanceof TypeError ? 400 : 500;
    return NextResponse.json({ error: status === 500 ? "Local preview failed; the source was not changed." : error instanceof Error ? error.message : "Invalid preview request" }, { status, headers });
  }
});
