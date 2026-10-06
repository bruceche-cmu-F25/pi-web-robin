import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { runDirectorySweep, DIRECTORIES } from "@/extension/robin/job-directory";
import { claimJobSweepRun, failJobSweepRun, heartbeatJobSweepRun, saveJobSweepState, sweepState, withJobSweepOwnership, type JobSweepState } from "@/extension/robin/job-domain";
import { jobProfile } from "@/extension/robin/job-profile";
import { RUN_LEASE_MS, RUNTIME_OWNER_ID, startRunHeartbeat } from "@/extension/robin/run-lease";
import { apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/**
 * The local promise is a fast path; a persisted renewable lease below provides
 * the cross-process exclusion.
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

  const startedAt = new Date().toISOString();
  const previous = body.resume === true ? sweepState() : null;
  const state: JobSweepState = {
    id: randomUUID(), ownerId: RUNTIME_OWNER_ID, heartbeatAt: startedAt, startedAt,
    finishedAt: null, running: true, boardsTotal: 0, boardsDone: 0, unreachable: 0,
    parked: 0, scanned: 0, matched: 0, added: 0, directories: [],
    cursors: previous?.cursorVersion === 2 ? previous.cursors : {}, cursorVersion: 2, error: null,
  };
  if (!claimJobSweepRun(state, Date.now() - RUN_LEASE_MS)) {
    return NextResponse.json({ started: false, reason: "already-running", sweep: sweepState() });
  }

  const controller = new AbortController();
  const heartbeatTimer = startRunHeartbeat(() => heartbeatJobSweepRun(state.id!, state.ownerId!), controller);
  const persist = (progress: JobSweepState): boolean => {
    const owned = saveJobSweepState(progress);
    if (!owned) controller.abort();
    return owned;
  };

  const task = runDirectorySweep({
    profile: jobProfile(),
    ...(directories ? { directories } : {}),
    limit,
    resume: body.resume === true,
    signal: controller.signal,
    ownership: state,
    persist,
    commit: (action) => withJobSweepOwnership(state.id!, state.ownerId!, action),
  }).catch((error) => {
    failJobSweepRun(state.id!, state.ownerId!, error);
    throw error;
  }).finally(() => {
    clearInterval(heartbeatTimer);
    running = null;
  });
  running = task;
  // Nothing awaits this, so an unhandled rejection would take down the process.
  task.catch(() => {});

  return NextResponse.json({ started: true, sweep: sweepState() });
});
