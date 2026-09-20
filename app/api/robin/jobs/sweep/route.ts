import { NextResponse } from "next/server";
import { runDirectorySweep, DIRECTORIES } from "@/extension/robin/job-directory";
import { sweepState } from "@/extension/robin/job-domain";
import { jobProfile } from "@/extension/robin/job-profile";
import { apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/**
 * At most one sweep at a time, per server process.
 *
 * Two concurrent sweeps would double the load on three ATS APIs from one IP
 * and interleave their writes to the same progress file, so the second caller
 * is told a sweep is already running rather than starting another.
 */
let running: Promise<unknown> | null = null;

/** Progress, for the page's poll. */
export const GET = apiRoute(async () => {
  return NextResponse.json({
    sweep: sweepState(),
    directories: DIRECTORIES.map(({ id, label }) => ({ id, label })),
  });
});

/**
 * Start a sweep and return immediately.
 *
 * A full walk of the three directories is roughly twenty minutes — far past
 * any sane request timeout — so the work is deliberately left running in the
 * process and its progress is published to a file the page polls. That means a
 * server restart kills the sweep; the cursor it writes as it goes is what makes
 * the next run pick up rather than start over.
 */
export const POST = apiRoute(async (req) => {
  if (running) {
    return NextResponse.json({ started: false, reason: "already-running", sweep: sweepState() });
  }

  let body: { directories?: unknown; limit?: unknown; resume?: unknown } = {};
  try {
    body = await req.json() as typeof body;
  } catch {
    // No body is fine — everything has a default.
  }

  const directories = Array.isArray(body.directories)
    ? body.directories.filter((id): id is string => typeof id === "string")
    : undefined;
  const limit = Number.isInteger(body.limit) && (body.limit as number) > 0
    ? body.limit as number
    : Infinity;

  const task = runDirectorySweep({
    profile: jobProfile(),
    ...(directories ? { directories } : {}),
    limit,
    resume: body.resume === true,
  }).finally(() => {
    running = null;
  });
  running = task;
  // Nothing awaits this, so an unhandled rejection would take down the process.
  task.catch(() => {});

  return NextResponse.json({ started: true, sweep: sweepState() });
});
