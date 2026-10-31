import { createHash } from "node:crypto";
import { browseVault, readVaultNote } from "./obsidian-browser-domain.ts";
import { ObsidianError, resolveObsidianVault } from "./obsidian-domain.ts";
import { readJsonObject, updateJsonObject } from "./paths.ts";
import { isRoadmapPath, roadmapKey, splitRoadmap, ROADMAP_STATUSES, type RoadmapRecord, type RoadmapSection } from "./learning-roadmap.ts";

import { COURSE_LESSONS, COURSE_STAGES, COURSE_SOURCES, COURSE_NAMESPACE, COURSE_PATH } from "./learning-course.ts";

const FILE = "learning-roadmap-progress.json";
type Progress = Record<string, RoadmapRecord>;
function records(value: Progress | null): Progress {
  if (value === null) return {};
  for (const [key, record] of Object.entries(value)) {
    if (!record || typeof record.vaultId !== "string" || typeof record.path !== "string" || typeof record.section !== "string"
      || typeof record.title !== "string" || typeof record.evidence !== "string" || typeof record.fingerprint !== "string"
      || !ROADMAP_STATUSES.includes(record.status) || !Number.isSafeInteger(record.revision) || record.revision < 1
      || typeof record.updatedAt !== "string" || key !== roadmapKey(record.vaultId, record.path, record.section)) {
      throw new Error("Invalid learning roadmap progress file");
    }
  }
  return value;
}
function progressFor(vaultId: string) {
  return Object.values(records(readJsonObject<Progress>(FILE))).filter((record) => record.vaultId === vaultId);
}

export async function roadmapCatalog(vaultId: string) {
  const index = await browseVault(vaultId);
  return { ...index, notes: index.notes.filter((note) => isRoadmapPath(note.path)), progress: progressFor(vaultId) };
}

export async function roadmapNote(vaultId: string, path: string) {
  const note = await readVaultNote(vaultId, path);
  const sections: RoadmapSection[] = splitRoadmap(note.content).map((section) => ({ ...section,
    fingerprint: createHash("sha256").update(section.content).digest("hex"),
  }));
  return { note, sections, progress: progressFor(vaultId).filter((record) => record.path === path) };
}

function validateRecord(input: unknown): RoadmapRecord {
  if (!input || typeof input !== "object") throw new ObsidianError("Expected a study record");
  const value = input as Record<string, unknown>;
  for (const field of ["vaultId", "path", "section", "fingerprint"] as const) {
    if (typeof value[field] !== "string" || !value[field] || value[field].length > 2048) throw new ObsidianError(`Invalid ${field}`);
  }
  if (!ROADMAP_STATUSES.includes(value.status as RoadmapRecord["status"]) || typeof value.evidence !== "string" || value.evidence.length > 20_000
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) throw new ObsidianError("Invalid status, evidence or revision");
  if (value.status === "confident" && !value.evidence.trim()) throw new ObsidianError("Describe your evidence before marking this understood");
  return value as unknown as RoadmapRecord;
}

export async function saveRoadmapRecord(input: unknown): Promise<RoadmapRecord> {
  const value = validateRecord(input);
  const { vaultId, path, section, fingerprint } = value;
  resolveObsidianVault(vaultId);
  const source = await roadmapNote(vaultId, path);
  const current = source.sections.find((item) => item.id === section);
  if (!current || current.fingerprint !== fingerprint) throw new ObsidianError("Source changed; refresh and review it before saving", 409);
  return persistRecord(value, current.title);
}

function persistRecord(value: RoadmapRecord, title: string): RoadmapRecord {
  const { vaultId, path, section, fingerprint, status, evidence, revision } = value;
  // Content is read-only. This lock protects study records, not external source edits.
  return updateJsonObject<Progress, RoadmapRecord>(FILE, (stored) => {
    const all = records(stored);
    const key = roadmapKey(vaultId, path, section);
    if ((all[key]?.revision ?? 0) !== revision) throw new ObsidianError("Study record changed in another window; reload before saving", 409);
    const record = { vaultId, path, section, fingerprint, status, evidence, title,
      revision: revision + 1, updatedAt: new Date().toISOString() };
    return { value: { ...all, [key]: record }, result: record, changed: true };
  });
}

const lessons = COURSE_LESSONS.map((lesson) => ({ ...lesson, fingerprint: createHash("sha256")
  .update(JSON.stringify([lesson, lesson.sources.map((id) => COURSE_SOURCES[id])])).digest("hex") }));

/** Available without an Obsidian installation. Source-note assessments remain separate. */
export function learningCourse() {
  return { stages: COURSE_STAGES, lessons, sources: COURSE_SOURCES,
    progress: progressFor(COURSE_NAMESPACE).filter((record) => record.path === COURSE_PATH) };
}

export function saveCourseRecord(input: unknown): RoadmapRecord {
  if (!input || typeof input !== "object") throw new ObsidianError("Expected a study record");
  const supplied = input as Record<string, unknown>;
  const value = validateRecord({ ...supplied, vaultId: COURSE_NAMESPACE, path: COURSE_PATH, section: supplied.lessonId });
  const lesson = lessons.find((lesson) => lesson.id === value.section);
  if (!lesson) throw new ObsidianError("Unknown course lesson", 404);
  if (lesson.fingerprint !== value.fingerprint) throw new ObsidianError("Lesson changed; reload and review it before saving", 409);
  return persistRecord(value, lesson.title);
}
