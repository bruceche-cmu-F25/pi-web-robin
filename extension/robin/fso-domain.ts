/**
 * Full Stack Open workspace state: the chapter on screen, and your notes.
 *
 * One small file. The open chapter is written on every click because a
 * cross-origin frame reports nothing about itself — it is the only way the
 * mentor can answer "this page". Notes are yours, one per chapter, written as
 * you read; completion stays in the dashboard's progress file so both surfaces
 * tick the same steps.
 */
import { findChapter, type FsoChapter } from "./fso.ts";
import { FULLSTACK_STEPS, fullstackPlan } from "./learning.ts";
import { readJsonObject, updateJsonObject } from "./paths.ts";

const FILE = "fso.json";
const PROGRESS_FILE = "fullstack-open-progress.json";
interface FullstackProgress { completedIds: string[] }

function completedIds(state: FullstackProgress | null): string[] {
  if (state === null) return [];
  if (!Array.isArray(state.completedIds) || state.completedIds.some((id) => typeof id !== "string")) {
    throw new Error("Invalid Full Stack Open progress file");
  }
  return state.completedIds;
}

/** Course reads never depend on the other Learning Hub track. */
export function fullstackSnapshot(): ReturnType<typeof fullstackPlan> {
  return fullstackPlan(completedIds(readJsonObject<FullstackProgress>(PROGRESS_FILE)));
}

/** Explicit, idempotent ticks; return the committed course plan, not a mixed-track refresh. */
export function setFullstackCompleted(id: string, completed: boolean): ReturnType<typeof fullstackPlan> {
  if (!FULLSTACK_STEPS.some((step) => step.id === id)) throw new Error("Unknown course step");
  if (typeof completed !== "boolean") throw new Error("completed must be a boolean");
  return updateJsonObject<FullstackProgress, ReturnType<typeof fullstackPlan>>(PROGRESS_FILE, (state) => {
    const ids = new Set(completedIds(state));
    const changed = ids.has(id) !== completed;
    if (completed) ids.add(id);
    else ids.delete(id);
    const value = { ...state, completedIds: [...ids] };
    return { value, result: fullstackPlan(value.completedIds), changed };
  });
}

/** Long enough for a real chapter's notes; short enough that a runaway paste cannot bloat every mentor turn. */
export const NOTE_MAX_LENGTH = 20_000;

export interface FsoNote {
  text: string;
  /** UTC instant, ISO 8601. */
  updatedAt: string;
}

interface FsoState {
  openChapterId?: string;
  openedAt?: string;
  notes?: Record<string, FsoNote>;
}

export interface FsoSnapshot {
  fullstack: ReturnType<typeof fullstackPlan>;
  openChapterId: string | null;
  openedAt: string | null;
  notes: Record<string, FsoNote>;
}

function readState(): FsoState {
  return readJsonObject<FsoState>(FILE) ?? {};
}

export function fsoSnapshot(): FsoSnapshot {
  const state = readState();
  return {
    openChapterId: findChapter(state.openChapterId) ? state.openChapterId! : null,
    openedAt: state.openedAt ?? null,
    notes: state.notes ?? {},
    fullstack: fullstackSnapshot(),
  };
}

export function openChapter(id: string): FsoChapter {
  const chapter = findChapter(id);
  if (!chapter) throw new Error("Unknown Full Stack Open chapter");
  updateJsonObject<FsoState, void>(FILE, (state) => ({
    value: { ...state, openChapterId: chapter.id, openedAt: new Date().toISOString() },
    result: undefined,
    changed: true,
  }));
  return chapter;
}

/** Saving an empty note deletes it, so the notebook lists only chapters with something in them. */
export function saveNote(id: string, text: string): FsoNote | null {
  if (!findChapter(id)) throw new Error("Unknown Full Stack Open chapter");
  if (typeof text !== "string") throw new Error("text must be a string");
  if (text.length > NOTE_MAX_LENGTH) throw new Error(`A note is limited to ${NOTE_MAX_LENGTH} characters`);
  const note = text.trim() ? { text, updatedAt: new Date().toISOString() } : null;
  updateJsonObject<FsoState, void>(FILE, (state) => {
    const notes = { ...state?.notes };
    const changed = note ? notes[id]?.text !== text : id in notes;
    if (note) notes[id] = note;
    else delete notes[id];
    return { value: { ...state, notes }, result: undefined, changed };
  });
  return note;
}
