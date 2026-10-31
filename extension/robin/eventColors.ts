/** Shared color keys. Calendar paint is scoped locally; other boards retain their palette. */
export const EVENT_COLOR_KEYS = [
  "clay", "sage", "teal", "slate", "plum", "honey", "fern", "iris", "rose",
] as const;
export type EventColorKey = (typeof EVENT_COLOR_KEYS)[number];

/** djb2 — deterministic across views, refreshes and devices. Finite palettes can collide. */
export function seedColorKey(seed: string): EventColorKey {
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0;
  }
  return EVENT_COLOR_KEYS[hash % EVENT_COLOR_KEYS.length];
}

/** Provider recurrence identity wins; local repeats are identified by their trimmed title.
 * A local title rename therefore changes its identity; unrelated equal titles share a color.
 * Neither a start time nor the other events currently loaded can change a series color.
 */
export function seriesSeed(event: { colorSeed?: string; title: string }): string {
  return event.colorSeed?.trim() || event.title.trim();
}

export function eventColorKey(event: { colorSeed?: string; title: string }): EventColorKey {
  return seedColorKey(seriesSeed(event));
}

/** Explicit todo colors are independent of the calendar's browser-only series overrides. */
export function todoSpanColorKey(todo: { title: string; color?: EventColorKey }): EventColorKey {
  return todo.color ?? seedColorKey(todo.title.trim());
}
