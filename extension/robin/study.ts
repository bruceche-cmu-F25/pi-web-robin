/**
 * Study logic the browser also needs.
 *
 * Like ./practice.ts, this file stays free of `node:fs` so the syllabus board
 * can import its values directly.
 *
 * Deliberately without a record type. The practice side counts because a
 * review schedule needs to know what you solved and how well; reading does not
 * work that way. Nothing here tracks status, scores progress, or ranks what to
 * open next — the curriculum offers an order and the resources, and what you
 * took from them is yours to know. The only thing the workspace stores is one
 * id: which resource is open, so the mentor can answer "this page".
 */
import {
  CURRICULUM,
  LEARNING_SHELF,
  type CurriculumItem,
  type CurriculumModule,
  type CurriculumTrack,
} from "./curriculum.ts";

export type {
  CurriculumItem,
  CurriculumModule,
  CurriculumTrack,
  ShelfGroup,
  ShelfLink,
} from "./curriculum.ts";
export { CURRICULUM, ITEM_KINDS, LEARNING_SHELF } from "./curriculum.ts";

export const TRACK_IDS = CURRICULUM.map((track) => track.id);

export function findTrack(trackId: string): CurriculumTrack | null {
  return CURRICULUM.find((track) => track.id === trackId) ?? null;
}

export function isTrackId(value: unknown): value is string {
  return typeof value === "string" && TRACK_IDS.includes(value);
}

/** Every item in the curriculum, in reading order. */
export function allItems(): CurriculumItem[] {
  return CURRICULUM.flatMap((track) => track.modules.flatMap((module) => module.items));
}

export function itemsInTrack(track: CurriculumTrack): CurriculumItem[] {
  return track.modules.flatMap((module) => module.items);
}

export interface ItemLocation {
  item: CurriculumItem;
  module: CurriculumModule;
  track: CurriculumTrack;
}

/**
 * Resolve an item and where it sits.
 *
 * The module and track come back with it because nothing about an item means
 * anything on its own: the mentor needs the module's outcome to know what the
 * user is reading *for*, and the page needs it to show them the same thing.
 *
 * Titles are accepted as well as ids so the mentor can act on "open the
 * FastAPI tutorial" without the user having to know an id exists.
 */
export function findItem(idOrTitle: string): ItemLocation | null {
  const needle = idOrTitle.trim().toLowerCase();
  if (!needle) return null;
  let byTitle: ItemLocation | null = null;
  for (const track of CURRICULUM) {
    for (const courseModule of track.modules) {
      for (const item of courseModule.items) {
        if (item.id === needle) return { item, module: courseModule, track };
        if (!byTitle && item.title.toLowerCase() === needle) {
          byTitle = { item, module: courseModule, track };
        }
      }
    }
  }
  return byTitle;
}

export interface ShelfEntry {
  item: CurriculumItem;
  /** Where this appearance points — the item's URL unless the shelf overrode it. */
  url: string;
}

export interface ResolvedShelfGroup {
  id: string;
  entries: ShelfEntry[];
}

/**
 * The links shelf, with its ids resolved to the items they name.
 *
 * An entry naming something that no longer exists is dropped rather than
 * thrown on: a test pins every id, so a dangling one is a build-time mistake,
 * and the shelf's job at runtime is to render the links that are real.
 */
export function learningShelf(): ResolvedShelfGroup[] {
  const byId = new Map(allItems().map((item) => [item.id, item]));
  return LEARNING_SHELF.map((group) => ({
    id: group.id,
    entries: group.links.flatMap((link) => {
      const item = byId.get(link.id);
      if (!item?.url) return [];
      return [{ item, url: link.url ?? item.url }];
    }),
  }));
}
