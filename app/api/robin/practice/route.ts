import { NextResponse } from "next/server";
import {
  logAttempt,
  reschedule,
  setCurrentProblem,
  setNote,
  setPracticeList,
  setStatus,
} from "@/extension/robin/practice-domain";
import { ATTEMPT_OUTCOMES, PRACTICE_LISTS, PRACTICE_STATUSES } from "@/extension/robin/practice";
import { localDate, readPracticeRecords, readPracticeState } from "@/extension/robin/store";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function guard(req: Request, requireJson: boolean): NextResponse | null {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (requireJson && !hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}

function fail(error: unknown, status = 400): NextResponse {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

/** Everything the board needs to re-render, in one shape for every caller. */
function snapshotResponse() {
  const state = readPracticeState();
  return {
    records: readPracticeRecords(),
    currentSlug: state.currentSlug ?? null,
    list: state.list ?? null,
    today: localDate(),
  };
}

/**
 * Records only — the catalog is not in the response.
 *
 * It is a generated file the browser bundle already has, and it never changes
 * between deploys; sending 100 KB of it with every poll would be paying for
 * the same bytes forever. What does change is the user's own history, which is
 * small.
 */
export async function GET(req: Request) {
  const blocked = guard(req, false);
  if (blocked) return blocked;
  try {
    return NextResponse.json(snapshotResponse());
  } catch (error) {
    return fail(error, 500);
  }
}

/** Log one attempt. */
export async function POST(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as {
      problem?: unknown;
      outcome?: unknown;
      minutes?: unknown;
      hintLevel?: unknown;
      confidence?: unknown;
      note?: unknown;
    };
    if (typeof body.problem !== "string" || !body.problem.trim()) {
      return fail(new Error("problem is required"));
    }
    if (typeof body.outcome !== "string"
      || !(ATTEMPT_OUTCOMES as readonly string[]).includes(body.outcome)) {
      return fail(new Error(`outcome must be one of: ${ATTEMPT_OUTCOMES.join(", ")}`));
    }

    const result = logAttempt({
      problem: body.problem,
      outcome: body.outcome as (typeof ATTEMPT_OUTCOMES)[number],
      ...(typeof body.minutes === "number" ? { minutes: body.minutes } : {}),
      ...(typeof body.hintLevel === "number" ? { hintLevel: body.hintLevel } : {}),
      ...(typeof body.confidence === "number" ? { confidence: body.confidence } : {}),
      ...(typeof body.note === "string" ? { note: body.note } : {}),
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ record: result.record, today: localDate() });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Everything that is not a fresh attempt: status, note, review rating, and
 * which problem the workspace has open.
 *
 * The last one is why the coach can answer "this problem" at all — a
 * cross-origin frame reports nothing about itself, so opening a problem has to
 * be written down on the way past.
 */
export async function PATCH(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as {
      problem?: unknown;
      status?: unknown;
      note?: unknown;
      confidence?: unknown;
      current?: unknown;
      list?: unknown;
    };
    const list = typeof body.list === "string"
      && (PRACTICE_LISTS as readonly string[]).includes(body.list)
      ? body.list as (typeof PRACTICE_LISTS)[number]
      : undefined;

    // Changing the list is the one edit that names no problem: it is a view
    // preference being mirrored so the coach's default matches the rail.
    if (body.problem === undefined) {
      if (!list) return fail(new Error("problem is required"));
      setPracticeList(list);
      return NextResponse.json(snapshotResponse());
    }

    if (typeof body.problem !== "string" || !body.problem.trim()) {
      return fail(new Error("problem is required"));
    }

    if (body.current === true) {
      const selected = setCurrentProblem(body.problem, list);
      if ("error" in selected) return NextResponse.json({ error: selected.error }, { status: 404 });
    }

    if (typeof body.status === "string") {
      if (!(PRACTICE_STATUSES as readonly string[]).includes(body.status)) {
        return fail(new Error(`status must be one of: ${PRACTICE_STATUSES.join(", ")}`));
      }
      const result = setStatus(body.problem, body.status as (typeof PRACTICE_STATUSES)[number]);
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
    }

    if (typeof body.note === "string") {
      const result = setNote(body.problem, body.note);
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
    }

    if (typeof body.confidence === "number") {
      const result = reschedule(body.problem, body.confidence);
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json(snapshotResponse());
  } catch (error) {
    return fail(error);
  }
}
