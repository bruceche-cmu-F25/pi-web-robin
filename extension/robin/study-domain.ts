/**
 * Study behavior shared by the HTTP and Pi tool adapters.
 *
 * Small on purpose. There is nothing to record here: the curriculum side keeps
 * no progress, no status, and no counts, so the only state is which resource
 * the workspace has open and which track the syllabus is showing.
 */
import {
  CURRICULUM,
  findItem,
  findTrack,
  isTrackId,
  type CurriculumTrack,
  type ItemLocation,
} from "./study.ts";
import { readStudyState, writeStudyState } from "./store.ts";

export type StudyResult<T> = T | { error: string };

/**
 * Open an item, and remember it.
 *
 * Remembered because a cross-origin frame reports nothing about itself — this
 * write is the only reason the mentor can answer a question about "this page".
 * It says what is open, not that anything was read.
 */
export function setCurrentItem(idOrTitle: string, track?: string): StudyResult<ItemLocation> {
  const found = findItem(idOrTitle);
  if (!found) return { error: `No curriculum item matches "${idOrTitle}".` };
  writeStudyState({
    currentItemId: found.item.id,
    track: isTrackId(track) ? track : found.track.id,
  });
  return found;
}

export function setStudyTrack(track: string): StudyResult<string> {
  if (!isTrackId(track)) return { error: `No curriculum track called "${track}".` };
  writeStudyState({ track });
  return track;
}

/** The item the workspace has open, with everything needed to talk about it. */
export function currentItem(): ItemLocation | null {
  const state = readStudyState();
  if (!state.currentItemId) return null;
  return findItem(state.currentItemId);
}

/** The track the syllabus is showing, falling back to the first one. */
export function currentTrack(): CurriculumTrack {
  const state = readStudyState();
  return (state.track ? findTrack(state.track) : null) ?? CURRICULUM[0];
}

export interface ModuleOutline {
  moduleId: string;
  title: string;
  outcome: string;
  items: Array<{ id: string; title: string; kind: string }>;
}

/**
 * A track's shape: its modules, what each is for, and what is in them.
 *
 * Built for the mentor rather than the page. The syllabus already draws all of
 * this; what a tool result adds is the outcomes, which is the part that lets
 * an answer be anchored to what the module is actually for.
 */
export function trackOutline(trackId: string): StudyResult<{
  track: CurriculumTrack;
  modules: ModuleOutline[];
}> {
  const track = findTrack(trackId);
  if (!track) return { error: `No curriculum track called "${trackId}".` };
  return {
    track,
    modules: track.modules.map((courseModule) => ({
      moduleId: courseModule.id,
      title: courseModule.title,
      outcome: courseModule.outcome,
      items: courseModule.items.map((item) => ({
        id: item.id,
        title: item.title,
        kind: item.kind,
      })),
    })),
  };
}
