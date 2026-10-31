import { randomUUID } from "node:crypto";
import { readJsonObject, updateJsonObject } from "./paths.ts";
import { MAX_RESUME_BYTES, ResumeError, resumeText, type ResumeDocument } from "./resume.ts";

const FILE = "resume.json";
const EMPTY: ResumeDocument = { source: "", revision: "empty", updatedAt: null };

function document(value: unknown): ResumeDocument {
  if (value === null) return { ...EMPTY };
  const row = value as ResumeDocument;
  if (typeof row.revision !== "string" || !row.revision || typeof row.updatedAt !== "string"
    || !Number.isFinite(Date.parse(row.updatedAt))) throw new ResumeError("Resume storage is invalid; restore a backup before editing", 500);
  resumeText(row.source, "stored source", MAX_RESUME_BYTES);
  return { source: row.source, revision: row.revision, updatedAt: row.updatedAt };
}

/** Reads do not seed from the scoring CV or create a file. */
export function readResume(): ResumeDocument { return document(readJsonObject(FILE)); }

/** A failed/lost save can be retried, but a stale editor can never overwrite newer work. */
export function saveResume(input: unknown): ResumeDocument {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ResumeError("Invalid resume save");
  const body = input as Record<string, unknown>;
  const source = resumeText(body.source, "source", MAX_RESUME_BYTES);
  if (typeof body.revision !== "string" || !body.revision) throw new ResumeError("Reload the saved version before editing", 409);
  return updateJsonObject<ResumeDocument, ResumeDocument>(FILE, (stored) => {
    const current = document(stored);
    if (source === current.source) return { value: current, result: current, changed: false };
    if (body.revision !== current.revision) throw new ResumeError("The saved resume changed in another editor. Your draft is kept; compare with the saved version before retrying.", 409);
    const next = { source, revision: randomUUID(), updatedAt: new Date().toISOString() };
    return { value: next, result: next, changed: true };
  });
}
