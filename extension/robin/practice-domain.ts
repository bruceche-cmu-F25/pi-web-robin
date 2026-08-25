/** Practice behavior shared by the HTTP and Pi tool adapters. */
import { localDate } from "./dates.ts";
import {
  ATTEMPT_OUTCOMES,
  PRACTICE_STATUSES,
  emptyRecord,
  findProblem,
  isDue,
  reviewDateFor,
  type Attempt,
  type AttemptOutcome,
  type CatalogProblem,
  type PracticeRecord,
  type PracticeList,
  type PracticeStatus,
} from "./practice.ts";
import {
  readPracticeRecords,
  readPracticeState,
  writePracticeRecords,
  writePracticeState,
} from "./store.ts";

export type PracticeResult<T> = T | { error: string };

/** Only the last stretch of history is worth keeping per problem. */
const MAX_ATTEMPTS = 20;

function resolve(slugOrName: string): PracticeResult<CatalogProblem> {
  const problem = findProblem(slugOrName);
  return problem ?? { error: `No problem in the NeetCode catalog matches "${slugOrName}".` };
}

/**
 * Read-modify-write one problem's record.
 *
 * The whole file is rewritten because it is one small array and
 * `writeJsonArray` renames a complete temp file into place; a partial update
 * has nothing to be partial about.
 */
function upsert(
  slug: string,
  change: (record: PracticeRecord) => void,
): PracticeRecord {
  const records = readPracticeRecords();
  const existing = records.find((record) => record.slug === slug);
  const record = existing ?? emptyRecord(slug);
  change(record);
  record.updatedAt = new Date().toISOString();
  if (!existing) records.push(record);
  writePracticeRecords(records);
  return record;
}

export function logAttempt(input: {
  problem: string;
  outcome: AttemptOutcome;
  minutes?: number;
  hintLevel?: number;
  confidence?: number;
  note?: string;
}): PracticeResult<{ problem: CatalogProblem; record: PracticeRecord }> {
  const found = resolve(input.problem);
  if ("error" in found) return found;
  if (!(ATTEMPT_OUTCOMES as readonly string[]).includes(input.outcome)) {
    return { error: `outcome must be one of: ${ATTEMPT_OUTCOMES.join(", ")}` };
  }

  const attempt: Attempt = {
    at: new Date().toISOString(),
    outcome: input.outcome,
    ...(Number.isFinite(input.minutes) ? { minutes: Math.max(0, Math.round(input.minutes as number)) } : {}),
    ...(Number.isFinite(input.hintLevel)
      ? { hintLevel: Math.min(Math.max(Math.round(input.hintLevel as number), 0), 4) }
      : {}),
  };

  const record = upsert(found.link, (draft) => {
    draft.attempts.push(attempt);
    if (draft.attempts.length > MAX_ATTEMPTS) {
      draft.attempts.splice(0, draft.attempts.length - MAX_ATTEMPTS);
    }
    // "Attempted" is never a downgrade from "solved": having once solved a
    // problem is a fact about the past that a later bad sitting does not undo.
    // What a bad sitting does change is when it comes back — see below.
    if (input.outcome === "solved") draft.status = "solved";
    else if (draft.status !== "solved") draft.status = "attempted";

    if (input.note !== undefined) {
      const note = input.note.trim();
      if (note) draft.note = note;
      else delete draft.note;
    }

    const confidence = Number.isFinite(input.confidence)
      ? Math.min(Math.max(Math.round(input.confidence as number), 1), 5)
      : outcomeConfidence(input.outcome, attempt.hintLevel);
    draft.confidence = confidence;
    draft.nextReviewOn = draft.status === "solved" ? reviewDateFor(confidence) : undefined;
  });

  return { problem: found, record };
}

/**
 * A confidence to schedule by when the user did not give one.
 *
 * Hints count against it: solving a problem after being walked most of the way
 * there is not the same recall as solving it cold, and scheduling it as though
 * it were is how a review queue quietly stops being useful.
 */
function outcomeConfidence(outcome: AttemptOutcome, hintLevel: number | undefined): number {
  const base = outcome === "solved" ? 4 : outcome === "partial" ? 2 : 1;
  return Math.min(Math.max(base - Math.floor((hintLevel ?? 0) / 2), 1), 5);
}

export function setStatus(
  problemRef: string,
  status: PracticeStatus,
): PracticeResult<{ problem: CatalogProblem; record: PracticeRecord }> {
  const found = resolve(problemRef);
  if ("error" in found) return found;
  if (!(PRACTICE_STATUSES as readonly string[]).includes(status)) {
    return { error: `status must be one of: ${PRACTICE_STATUSES.join(", ")}` };
  }

  const record = upsert(found.link, (draft) => {
    draft.status = status;
    if (status === "solved") {
      draft.nextReviewOn = reviewDateFor(draft.confidence ?? 3);
    } else {
      delete draft.nextReviewOn;
      if (status === "todo") {
        // Back to untouched: keep the note, drop the schedule and the rating,
        // which no longer describe anything.
        delete draft.confidence;
      }
    }
  });

  return { problem: found, record };
}

export function setNote(
  problemRef: string,
  note: string,
): PracticeResult<{ problem: CatalogProblem; record: PracticeRecord }> {
  const found = resolve(problemRef);
  if ("error" in found) return found;
  const record = upsert(found.link, (draft) => {
    const trimmed = note.trim();
    if (trimmed) draft.note = trimmed;
    else delete draft.note;
  });
  return { problem: found, record };
}

/** Mark a review done without pretending it was a fresh attempt. */
export function reschedule(
  problemRef: string,
  confidence: number,
): PracticeResult<{ problem: CatalogProblem; record: PracticeRecord }> {
  const found = resolve(problemRef);
  if ("error" in found) return found;
  const clamped = Math.min(Math.max(Math.round(confidence), 1), 5);
  const record = upsert(found.link, (draft) => {
    draft.confidence = clamped;
    if (draft.status === "solved") draft.nextReviewOn = reviewDateFor(clamped);
  });
  return { problem: found, record };
}

export interface PracticeSnapshot {
  problem: CatalogProblem;
  record: PracticeRecord | null;
  due: boolean;
}

export function snapshot(problemRef: string, today = localDate()): PracticeResult<PracticeSnapshot> {
  const found = resolve(problemRef);
  if ("error" in found) return found;
  const record = readPracticeRecords().find((entry) => entry.slug === found.link) ?? null;
  return { problem: found, record, due: isDue(record ?? undefined, today) };
}

/* ─────────────────────── the open problem ─────────────────────── */

/** Point the workspace — and therefore the coach — at a problem. */
export function setCurrentProblem(
  problemRef: string,
  list?: PracticeList,
): PracticeResult<{ problem: CatalogProblem }> {
  const found = resolve(problemRef);
  if ("error" in found) return found;
  writePracticeState({ currentSlug: found.link, ...(list ? { list } : {}) });
  return { problem: found };
}

/**
 * Mirror the browser's list choice so the coach defaults to the same one.
 *
 * The choice itself belongs to the browser — it is a view preference, like the
 * calendar's — but a coach that answers "what's left?" from NeetCode 150 while
 * you are working through Blind 75 is answering about someone else's week.
 */
export function setPracticeList(list: PracticeList): void {
  writePracticeState({ list });
}

/** The list the workspace is working from, for tools that need a default. */
export function currentList(): PracticeList {
  return readPracticeState().list ?? "neetcode150";
}

/** The problem the workspace has open, or null when nothing is selected. */
export function currentProblem(today = localDate()): PracticeSnapshot | null {
  const slug = readPracticeState().currentSlug;
  if (!slug) return null;
  const result = snapshot(slug, today);
  return "error" in result ? null : result;
}
