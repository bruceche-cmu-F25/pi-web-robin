import { randomUUID } from "node:crypto";
import { readJsonObject, updateJsonObject } from "./paths.ts";
import { MAX_RESUME_BYTES, ResumeError, resumeText, type ResumeDocument } from "./resume.ts";

const FILE = "resume.json";
const COLLECTION = "resume-collection.json";
const EMPTY: ResumeDocument = { source: "", revision: "empty", updatedAt: null };
export interface ResumeChoice { id: string; name: string; updatedAt: string | null }
type NamedResume = ResumeChoice & ResumeDocument;
interface Collection { mainName?: string; documents: NamedResume[] }

function name(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f]/.test(value)) throw new ResumeError("Give this resume a name (up to 80 characters)");
  return value.trim();
}
function collection(value: unknown): Collection {
  if (value === null) return { documents: [] };
  const row = value as Collection;
  if (!Array.isArray(row.documents) || (row.mainName !== undefined && typeof row.mainName !== "string")) throw new ResumeError("Resume collection is invalid; restore a backup before editing", 500);
  if (row.mainName !== undefined) name(row.mainName);
  const ids = new Set<string>();
  for (const entry of row.documents) {
    if (!entry || typeof entry.id !== "string" || !/^[0-9a-f-]{36}$/.test(entry.id) || ids.has(entry.id)) throw new ResumeError("Resume collection is invalid; restore a backup before editing", 500);
    ids.add(entry.id); name(entry.name); document(entry);
  }
  return row;
}
function choice(id: string, items: Collection): NamedResume {
  const item = items.documents.find((entry) => entry.id === id);
  if (!item) throw new ResumeError("Resume not found", 404);
  return item;
}
export function listResumes(): ResumeChoice[] {
  const main = readResume("main");
  const items = collection(readJsonObject(COLLECTION));
  return [{ id: "main", name: items.mainName ?? "My resume", updatedAt: main.updatedAt }, ...items.documents.map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))];
}
export function createResume(input: unknown): NamedResume {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ResumeError("Invalid resume");
  const body = input as Record<string, unknown>;
  const label = name(body.name);
  if (body.source !== undefined && body.source !== "") throw new ResumeError("Create the resume first, then save its source explicitly");
  const source = "";
  return updateJsonObject<Collection, NamedResume>(COLLECTION, (stored) => {
    const items = collection(stored);
    const item = { id: randomUUID(), name: label, source, revision: randomUUID(), updatedAt: new Date().toISOString() };
    return { value: { ...items, documents: [...items.documents, item] }, result: item, changed: true };
  });
}
export function renameResume(input: unknown): ResumeChoice {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ResumeError("Invalid resume");
  const body = input as Record<string, unknown>;
  const label = name(body.name);
  if (typeof body.id !== "string") throw new ResumeError("Resume not found", 404);
  return updateJsonObject<Collection, ResumeChoice>(COLLECTION, (stored) => {
    const items = collection(stored);
    if (body.id === "main") {
      const updatedAt = readResume("main").updatedAt;
      return { value: { ...items, mainName: label }, result: { id: "main", name: label, updatedAt }, changed: items.mainName !== label };
    }
    const item = choice(body.id as string, items);
    return { value: { ...items, documents: items.documents.map((entry) => entry.id === body.id ? { ...entry, name: label } : entry) },
      result: { id: item.id, name: label, updatedAt: item.updatedAt }, changed: item.name !== label };
  });
}

function document(value: unknown): ResumeDocument {
  if (value === null) return { ...EMPTY };
  const row = value as ResumeDocument;
  if (typeof row.revision !== "string" || !row.revision || typeof row.updatedAt !== "string"
    || !Number.isFinite(Date.parse(row.updatedAt))) throw new ResumeError("Resume storage is invalid; restore a backup before editing", 500);
  resumeText(row.source, "stored source", MAX_RESUME_BYTES);
  return { source: row.source, revision: row.revision, updatedAt: row.updatedAt };
}

/** Reads do not seed from the scoring CV or create a file. */
export function readResume(id = "main"): ResumeDocument {
  if (id === "main") return document(readJsonObject(FILE));
  const item = choice(id, collection(readJsonObject(COLLECTION)));
  return { source: item.source, revision: item.revision, updatedAt: item.updatedAt };
}

/** A failed/lost save can be retried, but a stale editor can never overwrite newer work. */
export function saveResume(input: unknown, id = "main"): ResumeDocument {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ResumeError("Invalid resume save");
  const body = input as Record<string, unknown>;
  const source = resumeText(body.source, "source", MAX_RESUME_BYTES);
  if (typeof body.revision !== "string" || !body.revision) throw new ResumeError("Reload the saved version before editing", 409);
  const save = (current: ResumeDocument) => {
    if (source === current.source) return current;
    if (body.revision !== current.revision) throw new ResumeError("The saved resume changed in another editor. Your draft is kept; compare with the saved version before retrying.", 409);
    return { source, revision: randomUUID(), updatedAt: new Date().toISOString() };
  };
  if (id !== "main") return updateJsonObject<Collection, ResumeDocument>(COLLECTION, (stored) => {
    const items = collection(stored);
    const item = choice(id, items);
    const next = save(item);
    return { value: { ...items, documents: items.documents.map((entry) => entry.id === id ? { ...entry, ...next } : entry) },
      result: { source: next.source, revision: next.revision, updatedAt: next.updatedAt }, changed: next !== item };
  });
  return updateJsonObject<ResumeDocument, ResumeDocument>(FILE, (stored) => {
    const current = document(stored);
    const next = save(current);
    return { value: next, result: next, changed: next !== current };
  });
}
