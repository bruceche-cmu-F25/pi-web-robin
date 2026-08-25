import { isReadOnlyEvent, type DashboardEvent } from "@/extension/robin/events";
import { eventColorKey } from "@/extension/robin/eventColors";

/**
 * Every coloured surface in the calendar, decided in one place.
 *
 * Each event is drawn in its own muted colour — see eventColors.ts for how it
 * is chosen — so commitments are distinguishable at a glance without the
 * calendar turning into a wall of competing hues. **Weight carries the kind of
 * thing**: a band that occupies whole days takes the heavier fill, something
 * that happens at 10:00 the lighter one. **The rule carries ownership**: a
 * calendar you can edit gets the colour at full strength down its left edge, a
 * subscribed one — Google — gets it held back.
 *
 * Ownership deliberately moves the rule and not the fill: a calendar that is
 * entirely subscribed is the common case once Google is connected, and it must
 * not come out drawn entirely in the palest wash available.
 *
 * The hue stays under the title rather than in it. Colouring the type as well
 * was tried and is worse: six hues of text on six washes turns a week into a
 * paint chart, and the wash already says everything the colour is for. The
 * title itself is neutral, and the one thing that changes it is the grid it
 * sits in.
 *
 * The face is the mono, not the display serif: an event title is changing data
 * in a dense grid — the same reason the clock under it has always been mono,
 * and the same face the labels elsewhere in the app are set in. Not uppercased
 * though, unlike those labels: they are fixed chrome of our own writing, and
 * "Design review" is neither.
 */
export interface EventSurface {
  background: string;
  borderLeft: string;
  color: string;
  fontFamily: string;
}

function colorFor(event: DashboardEvent, suffix: string): string {
  return `var(--event-${eventColorKey(event)}${suffix})`;
}

function ownershipRule(event: DashboardEvent): string {
  if (isReadOnlyEvent(event)) {
    return `2px solid ${colorFor(event, "-line")}`;
  }
  return `2px solid ${colorFor(event, "")}`;
}

function surface(event: DashboardEvent, background: string): EventSurface {
  return {
    background,
    borderLeft: ownershipRule(event),
    color: "var(--text)",
    fontFamily: "var(--font-mono)",
  };
}

/** Something that happens at a time: a chip in the month grid, a block in the week. */
export function timedSurface(event: DashboardEvent): EventSurface {
  return surface(event, colorFor(event, "-soft"));
}

/** Something that spans days: the bars across a month row or the all-day band. */
export function spanSurface(event: DashboardEvent): EventSurface {
  return surface(event, colorFor(event, "-fill"));
}
