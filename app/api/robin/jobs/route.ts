import { NextResponse } from "next/server";
import { deleteJob, jobBoard, setJobsStatus, updateJob } from "@/extension/robin/job-domain";
import { JOB_STATUSES, type JobStatus } from "@/extension/robin/jobs";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/**
 * The list, best-first, plus the two things the page needs to explain it: how
 * the last scan went, and where the push threshold sits. Sending them together
 * keeps the page from firing three requests to render one screen.
 *
 * The CV is deliberately not included — it can be long and only the profile
 * editor needs it, so it lives behind /api/robin/jobs/profile.
 */
export const GET = apiRoute(async () => NextResponse.json(jobBoard()));

/**
 * Change one job's status, or edit your note on it.
 *
 * Status and note are the only fields the browser may write. Scores come from
 * the scorer through the agent tools and `notifiedAt` from the digest — letting
 * the page set either would make "why was I shown this" unanswerable.
 */
export const PATCH = apiRoute(async (req) => {
  const body = await req.json() as { id?: unknown; status?: unknown; note?: unknown };
  if (typeof body.id !== "string" || !body.id) return apiError(new Error("id is required"));
  if (body.status !== undefined
    && (typeof body.status !== "string" || !JOB_STATUSES.includes(body.status as JobStatus))) {
    return apiError(new Error(`status must be one of: ${JOB_STATUSES.join(", ")}`));
  }
  if (body.note !== undefined && typeof body.note !== "string") {
    return apiError(new Error("note must be text"));
  }

  const job = updateJob(body.id, {
    ...(typeof body.status === "string" ? { status: body.status as JobStatus } : {}),
    ...(typeof body.note === "string" ? { note: body.note } : {}),
  });
  if (!job) return apiError(new Error(`No job with id "${body.id}"`), 404);
  return NextResponse.json({ job });
}, { errorStatus: 500 });

/** Set one status on many jobs at once — a bulk drop, and the undo of one. */
export const POST = apiRoute(async (req) => {
  const body = await req.json() as { ids?: unknown; status?: unknown };
  if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 5000
    || !body.ids.every((id) => typeof id === "string" && id)) {
    return apiError(new Error("ids must be a non-empty list of job ids"));
  }
  if (typeof body.status !== "string" || !JOB_STATUSES.includes(body.status as JobStatus)) {
    return apiError(new Error(`status must be one of: ${JOB_STATUSES.join(", ")}`));
  }
  return NextResponse.json({ changed: setJobsStatus(body.ids as string[], body.status as JobStatus) });
}, { errorStatus: 500 });

export const DELETE = apiRoute(async (req) => {
  const body = await req.json() as { id?: unknown };
  if (typeof body.id !== "string" || !body.id) return apiError(new Error("id is required"));
  if (!deleteJob(body.id)) return apiError(new Error(`No job with id "${body.id}"`), 404);
  return NextResponse.json({ ok: true });
}, { errorStatus: 500 });
