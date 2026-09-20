import { NextResponse } from "next/server";
import {
  listPractice,
  logAttempt,
  patchPractice,
  setPracticeList,
} from "@/extension/robin/practice-domain";
import { ATTEMPT_OUTCOMES, PRACTICE_LISTS, PRACTICE_STATUSES } from "@/extension/robin/practice";
import { localDate } from "@/extension/robin/dates";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/**
 * Serialise the domain's board. `bySlug` is dropped because JSON has no Map
 * and the browser already joins against its bundled catalog by slug.
 */
function snapshotResponse() {
  const { records, currentSlug, list, today } = listPractice();
  return { records, currentSlug, list, today };
}

/** Records only — the catalog stays out of the response; see `listPractice`. */
export const GET = apiRoute(async () => {
  return NextResponse.json(snapshotResponse());
});

/** Log one attempt. */
export const POST = apiRoute(async (req) => {
  const body = await req.json() as {
    problem?: unknown;
    outcome?: unknown;
    minutes?: unknown;
    hintLevel?: unknown;
    confidence?: unknown;
    note?: unknown;
  };
  if (typeof body.problem !== "string" || !body.problem.trim()) {
    return apiError(new Error("problem is required"));
  }
  if (typeof body.outcome !== "string"
    || !(ATTEMPT_OUTCOMES as readonly string[]).includes(body.outcome)) {
    return apiError(new Error(`outcome must be one of: ${ATTEMPT_OUTCOMES.join(", ")}`));
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
});

/**
 * Everything that is not a fresh attempt: status, note, review rating, and
 * which problem the workspace has open.
 *
 * The last one is why the coach can answer "this problem" at all — a
 * cross-origin frame reports nothing about itself, so opening a problem has to
 * be written down on the way past.
 */
export const PATCH = apiRoute(async (req) => {
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
    if (!list) return apiError(new Error("problem is required"));
    setPracticeList(list);
    return NextResponse.json(snapshotResponse());
  }

  if (typeof body.problem !== "string" || !body.problem.trim()) {
    return apiError(new Error("problem is required"));
  }

  if (typeof body.status === "string"
    && !(PRACTICE_STATUSES as readonly string[]).includes(body.status)) {
    return apiError(new Error(`status must be one of: ${PRACTICE_STATUSES.join(", ")}`));
  }

  const result = patchPractice({
    problem: body.problem,
    ...(body.current === true ? { current: true } : {}),
    ...(body.current === true && list ? { list } : {}),
    ...(typeof body.status === "string"
      ? { status: body.status as (typeof PRACTICE_STATUSES)[number] }
      : {}),
    ...(typeof body.note === "string" ? { note: body.note } : {}),
    ...(typeof body.confidence === "number" ? { confidence: body.confidence } : {}),
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });

  return NextResponse.json(snapshotResponse());
});
