/**
 * The calendar's muted colour palette, decided in one place.
 *
 * Every event is drawn in one of six low-saturation colours, chosen from a
 * stable hash of **the repeating thing it is an occurrence of**. The keys here
 * are semantic — the actual hex lives in globals.css as `--event-<key>` with a
 * light and a dark value — so the same series reads as a wash on parchment and
 * on the dark canvas alike.
 *
 * What the hash is fed is the whole design, and it is easy to get wrong in
 * both directions:
 *
 * - Seeding on the event's **id** makes every occurrence its own colour. Robin
 *   writes each repeat of a local event as its own row with its own random id,
 *   so a Leetcode hour that recurs six times in a week came out in six
 *   unrelated hues — the same commitment, painted as six different things.
 * - Seeding on the **calendar** makes a whole calendar one colour. That is
 *   accurate and useless: a week of study is then a single hue, and the thing
 *   you actually want to pick out — this class, that gym slot — is invisible.
 *
 * So the seed is the series: a provider's recurrence id where there is one,
 * and otherwise the title, which is what identifies a local repeat. Two local
 * events sharing a title are the same commitment by any reading, and they get
 * the same colour.
 *
 * More series than the palette has colours means colours repeat. Which series
 * share one is decided by `orderSeriesColors`, which deals the palette out in
 * time-of-day order so that the repeats fall as far apart down the day as the
 * nine allow. `seedColorKey` remains the fallback for anything holding a
 * single event with no view of the rest.
 */

/**
 * Nine, not six.
 *
 * Six hues meant a normal week of ten or so series had to double up: the
 * expected number of distinct colours for ten series in six buckets is 5.0, so
 * three or four separate commitments came out in one hue no matter how well
 * the hash spread. Nine takes that to 6.5, and fern, iris and rose fill the
 * three widest gaps that were left on the wheel — greens, violets, and the red
 * between plum and clay.
 *
 * Nine is where it stops. The tenth would have to sit inside twenty degrees of
 * something already here, which buys a number and costs a distinction.
 *
 * Adding a key is not free: each one needs `--event-<key>` and its four alphas
 * plus a `--todo-<key>` in both themes, because a todo's colour is picked from
 * this same list. Nothing outside globals.css hardcodes the count.
 */
export const EVENT_COLOR_KEYS = [
  "clay", "sage", "teal", "slate", "plum", "honey", "fern", "iris", "rose",
] as const;
export type EventColorKey = (typeof EVENT_COLOR_KEYS)[number];

/** djb2 — cheap, deterministic, and spread evenly over the palette. */
export function seedColorKey(seed: string): EventColorKey {
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0;
  }
  return EVENT_COLOR_KEYS[hash % EVENT_COLOR_KEYS.length];
}

/**
 * What identifies the repeating thing an event is an occurrence of.
 *
 * `colorSeed` is the provider's recurrence identity, shared by every
 * occurrence of a Google series — see google-calendar.ts. Local events have
 * none, and their title is what repeats.
 */
export function seriesSeed(event: { colorSeed?: string; title: string }): string {
  return event.colorSeed?.trim() || event.title.trim();
}

/**
 * The colour an event is drawn in when nothing knows what else is on screen.
 *
 * Prefer `orderSeriesColors` wherever the whole set is available: the hash is
 * even in aggregate but lumpy at the scale of one week, which is the only
 * scale anybody looks at.
 */
export function eventColorKey(event: { colorSeed?: string; title: string }): EventColorKey {
  return seedColorKey(seriesSeed(event));
}

/**
 * The order colours are handed out in, chosen so that consecutive ones are far
 * apart on the wheel.
 *
 * Series are dealt in time-of-day order, so consecutive entries here land on
 * commitments that sit next to each other in the grid — a 10:00 and an 11:00.
 * Walking EVENT_COLOR_KEYS instead would hand those two neighbouring hues,
 * since that array is grouped by family. Every consecutive pair below is at
 * least 80° apart in both themes; only the wrap from honey back to clay is
 * close, and that is reached only once the palette is exhausted.
 */
const DEAL_ORDER: readonly EventColorKey[] = [
  "clay", "teal", "plum", "sage", "slate", "rose", "fern", "iris", "honey",
];

/**
 * Minutes since midnight, or past the end of the day for something with no
 * time of day.
 *
 * All-day series are dealt last, after everything with a clock. They live in
 * their own band above the grid, and ranking them first — which is where they
 * sit on the screen — spent the front of the palette before the time grid got
 * any of it: a week with five all-day series opened its 06:00 on the sixth
 * colour. The grid is the part that is read down the day, so the grid gets the
 * palette in order and the band takes what is left.
 */
const ALL_DAY_RANK = 24 * 60 + 1;

function startMinutes(start: string | undefined): number {
  if (!start) return ALL_DAY_RANK;
  const [hours, minutes] = start.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/**
 * One colour per series, dealt in the order the series appear down a day.
 *
 * Every series is ranked by the earliest time of day it ever starts at —
 * 06:00, then 09:30, then 10:00, with all-day things after all of them — and
 * the palette is handed out along that ranking. A week therefore reads in palette order from top to
 * bottom, and neighbouring rows are always far apart in hue, which is the
 * thing the hash could not promise: it spread evenly over thousands of series
 * but had no opinion about the fifteen you are actually looking at.
 *
 * The trade is that a colour is now a property of the set, not of the event
 * alone. Inserting a series earlier in the day shifts the ones below it by one
 * colour. Deal over every event the panel holds rather than over the visible
 * week, so at least paging between weeks does not repaint anything.
 */
export function orderSeriesColors(
  events: readonly { colorSeed?: string; title: string; start?: string }[],
): Map<string, EventColorKey> {
  const earliest = new Map<string, number>();
  for (const event of events) {
    const seed = seriesSeed(event);
    const minutes = startMinutes(event.start);
    const seen = earliest.get(seed);
    if (seen === undefined || minutes < seen) earliest.set(seed, minutes);
  }

  return new Map(
    [...earliest.entries()]
      // Seed breaks the tie so two series at the same time keep a fixed order
      // rather than depending on which was read out of the store first.
      .sort(([seedA, a], [seedB, b]) => a - b || seedA.localeCompare(seedB))
      .map(([seed], index) => [seed, DEAL_ORDER[index % DEAL_ORDER.length] as EventColorKey]),
  );
}
