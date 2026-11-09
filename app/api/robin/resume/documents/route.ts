import { NextResponse } from "next/server";
import { apiError, apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { createResume, listResumes, renameResume } from "@/extension/robin/resume-domain";
import { ResumeError } from "@/extension/robin/resume";

export const dynamic = "force-dynamic";
const route = (handler: (req: Request) => Promise<NextResponse>) => apiRoute(async (req) => {
  try { return await handler(req); }
  catch (error) {
    if (error instanceof ResumeError) return apiError(error, error.status);
    if (error instanceof RequestBodyTooLargeError) return apiError(error, 413);
    return apiError(error, 500);
  }
});
const json = (value: unknown) => NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });
export const POST = route(async (req) => {
  const document = createResume(await parseJsonWithinLimit(req, 1_500_000));
  return json({ document, resumes: listResumes() });
});
export const PATCH = route(async (req) => {
  const document = renameResume(await parseJsonWithinLimit(req, 10_000));
  return json({ document, resumes: listResumes() });
});
