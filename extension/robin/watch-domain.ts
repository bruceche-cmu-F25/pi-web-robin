import { readJsonObject, updateJsonObject } from "./paths.ts";
import { WATCH_ITEM_IDS, watchPlan, type WatchPlan } from "./watch.ts";

const FILE = "watch-progress.json";
/** In the order they were ticked, so the page knows which course you are in. */
interface WatchProgress { watchedIds: string[] }

function watchedIds(state: WatchProgress | null): string[] {
  if (state === null) return [];
  if (!Array.isArray(state.watchedIds) || state.watchedIds.some((id) => typeof id !== "string")) {
    throw new Error("Invalid watch progress file");
  }
  return state.watchedIds;
}

export function watchSnapshot(): WatchPlan {
  return watchPlan(watchedIds(readJsonObject<WatchProgress>(FILE)));
}

/** Explicit, idempotent writes. Ticking again moves the lecture to the end. */
export function setWatched(id: string, watched: boolean): void {
  if (!WATCH_ITEM_IDS.has(id)) throw new Error("Unknown lecture");
  if (typeof watched !== "boolean") throw new Error("watched must be a boolean");
  updateJsonObject<WatchProgress, void>(FILE, (state) => {
    const current = watchedIds(state);
    const next = current.filter((existing) => existing !== id);
    if (watched) next.push(id);
    const changed = next.length !== current.length || next.some((value, index) => value !== current[index]);
    return { value: { ...state, watchedIds: next }, result: undefined, changed };
  });
}
