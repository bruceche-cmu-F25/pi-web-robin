import { NextResponse } from "next/server";
import { listResumes, readResume, saveResume } from "@/extension/robin/resume-domain";
import { jobProfile } from "@/extension/robin/job-profile";
import { ResumeError } from "@/extension/robin/resume";
import { proposeResume } from "@/lib/resume-agent";
import { apiRoute, apiError } from "@/lib/api-route";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";

export const dynamic = "force-dynamic";
export const maxDuration = 210;
const route = (handler: (req: Request) => Promise<NextResponse> | NextResponse) => apiRoute(async (req) => {
  try { return await handler(req); }
  catch (error) {
    if (error instanceof ResumeError) return apiError(error, error.status);
    if (error instanceof RequestBodyTooLargeError) return apiError(error, 413);
    if (error instanceof SyntaxError || error instanceof TypeError) return apiError("Invalid request or response", 400);
    return apiError(error, 500);
  }
});
const json = (data: unknown) => NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
// Allows JSON escaping overhead; individual fields have smaller UTF-8 limits.
const body = (req: Request) => parseJsonWithinLimit<unknown>(req, 1_500_000);

const resumeId = (req: Request) => new URL(req.url).searchParams.get("id") ?? "main";
export const GET = route((req) => json({ document: readResume(resumeId(req)), resumes: listResumes(), hasProfile: Boolean(jobProfile().cv.trim()) }));
export const PUT = route(async (req) => json({ document: saveResume(await body(req), resumeId(req)) }));
// No write occurs here, so disconnect/cancel may safely stop the model turn.
export const POST = route(async (req) => json(await proposeResume(await body(req), req.signal)));
