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
    if (file === "job-digest-state.json" && value.applicationPreflight !== undefined
      && (!object(value.applicationPreflight) || typeof value.applicationPreflight.message !== "string"
        || value.applicationPreflight.message.length > 250 || typeof value.applicationPreflight.at !== "string"
        || !Number.isFinite(Date.parse(value.applicationPreflight.at)))) fail("applicationPreflight");
    if (file === "job-digest-state.json" && value.applicationChecks !== undefined) {
      if (!object(value.applicationChecks) || Object.keys(value.applicationChecks).length > 14) fail("applicationChecks");
      for (const [key, check] of Object.entries(value.applicationChecks as Record<string, unknown>)) {
        if (!object(check) || key !== `${check.day}:${check.timeZone}`
          || typeof check.at !== "string" || !Number.isFinite(Date.parse(check.at))
          || ["discovered", "unscored", "pendingScoring", "eligible", "attempted", "confirmed", "unresolved"].some(field => !Number.isSafeInteger(check[field]) || (check[field] as number) < 0)
          || !Array.isArray(check.issues) || check.issues.length > 9
          || check.issues.some(issue => !["scan-stale", "scan-errors", "scoring-error", "scoring-pending", "supply-empty", "no-receipts", "submission-uncertain", "application-error", "paused"].includes(issue))
          || !Array.isArray(check.failures) || check.failures.length > 20
          || check.failures.some(failure => !object(failure) || typeof failure.reason !== "string" || !/^[A-Z_]{1,50}$/.test(failure.reason)
            || !Number.isSafeInteger(failure.count) || (failure.count as number) < 0
            || !Array.isArray(failure.ids) || failure.ids.length > 20 || failure.ids.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,32}$/.test(id)))) fail("applicationChecks");
      }
    }
    for (const [field, max] of [["applicationReports", 20], ["applicationRunReports", 80]] as const) {
      if (file !== "job-digest-state.json" || value[field] === undefined) continue;
      if (!object(value[field]) || Object.keys(value[field]).length > max) fail(field);
      for (const [key, entry] of Object.entries(value[field] as Record<string, unknown>)) {
        if (!object(entry)) fail("application report entry");
        const storedEntry = entry as Record<string, unknown>;
        if (!object(storedEntry.report)) fail("application report entry");
        const report = storedEntry.report as Record<string, unknown>;
        if (!/^\d{4}-\d{2}-\d{2}:.{1,80}$/.test(key)
          || !["sending", "accepted", "uncertain", "failed"].includes(String(storedEntry.state))
          || typeof storedEntry.owner !== "string" || !Number.isSafeInteger(storedEntry.accepted) || (storedEntry.accepted as number) < 0
          || typeof report.day !== "string" || typeof report.timeZone !== "string"
          || (field === "applicationReports" ? key !== `${report.day}:${report.timeZone}`
            : !key.startsWith(`${report.day}:${report.timeZone}:run:`) || !/^[a-zA-Z0-9_-]{1,80}$/.test(key.slice(`${report.day}:${report.timeZone}:run:`.length)))
          || typeof report.asOf !== "string" || !Number.isFinite(Date.parse(report.asOf))
          || typeof report.enabled !== "boolean" || typeof report.running !== "boolean"
          || ["attempted", "confirmed", "errors", "attention", "uncertain", "total", "shown"].some(field => !Number.isSafeInteger(report[field]) || (report[field] as number) < 0)
          || !Array.isArray(report.rows) || report.rows.length > 40 || report.shown !== report.rows.length
          || (report.rows as unknown[]).some(row => !object(row) || typeof row.id !== "string" || typeof row.company !== "string" || typeof row.title !== "string"
            || typeof row.updatedAt !== "string" || typeof row.attemptedToday !== "boolean"
            || !["preparing", "review", "blocked", "attention", "error", "unavailable", "submitting", "uncertain", "submitted"].includes(String(row.stage))
            || (row.receiptAt !== null && (typeof row.receiptAt !== "string" || !Number.isFinite(Date.parse(row.receiptAt)))))) fail("application report entry");
      }
    }
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
