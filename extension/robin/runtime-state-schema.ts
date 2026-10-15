/** Only these operational documents participate in the v3 cutover.
 * Do not include credentials, caches, CRM send queues or arbitrary filenames.
 * Adding files later requires a versioned migration, not just changing this list.
 */
export const RUNTIME_STATE_VERSION = 3;
export const RUNTIME_STATE_FILES = [
  "background-runs.json",
  "job-scan.json", "job-scoring.json", "job-sweep.json",
  "tech-event-scan.json", "round-scan.json",
  "telegram-state.json", "job-digest-state.json", "gmail-digest-state.json", "reminder-state.json",
  "mail-review.json",
] as const;
export type RuntimeStateFile = (typeof RUNTIME_STATE_FILES)[number];

export function isRuntimeStateFile(file: string): file is RuntimeStateFile {
  return (RUNTIME_STATE_FILES as readonly string[]).includes(file);
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate meaningful types without normalizing, expiring, trimming or dropping
 * legacy/unknown fields. A damaged ledger must fail rather than resend history.
 */
export function validateRuntimeState(file: RuntimeStateFile, value: unknown): asserts value is Record<string, unknown> {
  if (!isRuntimeStateFile(file) || !object(value)) throw new Error(`${file}: expected a registered JSON object`);
  const fail = (field: string): never => { throw new Error(`${file}: invalid ${field}`); };
  if (["telegram-state.json", "job-digest-state.json", "gmail-digest-state.json", "reminder-state.json"].includes(file)) {
    const chatIds = (ids: unknown): boolean => Array.isArray(ids) && ids.every((id) => typeof id === "number" && Number.isSafeInteger(id));
    if (value.runs !== undefined && (!object(value.runs) || !Object.values(value.runs).every(chatIds))) fail("delivery runs");
    for (const field of ["date", "runKey"]) if (value[field] !== undefined && typeof value[field] !== "string") fail(field);
    if (value.chatIds !== undefined && !chatIds(value.chatIds)) fail("chatIds");
  } else if (file === "background-runs.json") {
    for (const [name, lease] of Object.entries(value)) {
      if (!object(lease) || typeof lease.ownerId !== "string" || typeof lease.heartbeatAt !== "string") fail(`lease ${name}`);
    }
  } else if (file === "mail-review.json") {
    if (typeof value.day !== "string" || typeof value.reviewedAt !== "string" || !Array.isArray(value.items)) fail("mail review");
    for (const item of value.items as unknown[]) {
      if (!object(item) || typeof item.id !== "string" || (item.done !== undefined && typeof item.done !== "boolean")) fail("mail item");
    }
  } else {
    for (const field of ["id", "ownerId", "heartbeatAt", "startedAt", "weeklyAt"]) {
      if (value[field] !== undefined && typeof value[field] !== "string") fail(field);
    }
    for (const field of ["finishedAt", "error"]) {
      if (value[field] !== undefined && value[field] !== null && typeof value[field] !== "string") fail(field);
    }
    if (value.running !== undefined && typeof value.running !== "boolean") fail("running");
    for (const field of ["round", "totalRounds", "startedWith", "remaining", "boardsTotal", "boardsDone", "unreachable", "parked", "scanned", "matched", "added", "closed", "seen", "kept", "expired", "days"]) {
      if (value[field] !== undefined && (typeof value[field] !== "number" || !Number.isFinite(value[field]))) fail(field);
    }
    for (const field of ["sources", "directories"]) if (value[field] !== undefined && !Array.isArray(value[field])) fail(field);
    if (value.cursors !== undefined && (!object(value.cursors) || !Object.values(value.cursors).every((cursor) => typeof cursor === "number" && Number.isFinite(cursor)))) fail("cursors");
  }
}
