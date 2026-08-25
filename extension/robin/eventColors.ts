/**
 * The calendar's muted colour palette, decided in one place.
 *
 * Every event is drawn in one of six low-saturation colours, chosen from a
 * stable hash of its identity. Recurring Google events share a colour seed, so
 * every occurrence keeps the same hue; unrelated events get an arbitrary but
 * stable colour. The keys here are semantic — the actual hex lives in
 * globals.css as `--event-<key>` with a light and a dark value — so the same
 * event reads as a wash on parchment and on the dark canvas alike.
 */

export const EVENT_COLOR_KEYS = ["clay", "sage", "teal", "slate", "plum", "honey"] as const;
export type EventColorKey = (typeof EVENT_COLOR_KEYS)[number];

/** djb2 — cheap, deterministic, and spread evenly over the palette. */
export function seedColorKey(seed: string): EventColorKey {
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0;
  }
  return EVENT_COLOR_KEYS[hash % EVENT_COLOR_KEYS.length];
}

/** Prefer a provider's recurrence seed, then the event's stable id. */
export function eventColorKey(event: { colorSeed?: string; id?: string; title: string }): EventColorKey {
  return seedColorKey(event.colorSeed ?? event.id ?? event.title);
}
