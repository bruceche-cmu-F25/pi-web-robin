import { createContext, useContext } from "react";
import type { DashboardEvent } from "@/extension/robin/events";
import {
  eventColorKey,
  seriesSeed,
  type EventColorKey,
} from "@/extension/robin/eventColors";

/**
 * Every coloured surface in the calendar, decided in one place.
 *
 * **Colour is an edge, not a fill.** Each event is drawn in its calendar's
 * muted colour — see eventColors.ts for how it is chosen — but the block it
 * sits on is only a whisper of that colour, and the hue arrives through a
 * spine down the block's left edge at full strength. The grid then reads as
 * one material with coloured spines running through it, and the colour scans
 * in a single vertical sweep down a column instead of asking you to compare
 * six washes against each other.
 *
 * That is a reversal. The fill used to carry the hue at `-soft`, and with six
 * hues at one alpha a busy week came out a quilt with no figure and no ground.
 * Dropping the fill to `-faint` and putting the hue on the edge gives the
 * grid a quiet ground back without giving up the colour.
 *
 * **Weight still carries the kind of thing**: a band that occupies whole days
 * takes the heavier fill, something that happens at 10:00 the lighter one.
 *
 * **The spine is the same for every event.** The rule used to be drawn at full
 * strength for a calendar you can edit and held back to `-line` for a
 * subscribed one, so that its weight said whether the event was yours. That
 * does not survive the reversal above: the spine is now the only place the hue
 * appears at strength, and dulling it on subscribed events would draw a
 * Google-connected calendar — the common case — almost entirely in the palest
 * thing available. Ownership is carried instead where it is actually needed:
 * the agenda names the source calendar on the row, the details dialog says
 * read-only, and the legend under the grid lists the calendars by name.
 *
 * The hue stays out of the title. Colouring the type as well was tried and is
 * worse: six hues of text on six washes turns a week into a paint chart, and
 * none of the six clears 4.5:1 against the panel at the size a block's title
 * is set in. The title is neutral, and the one thing that changes it is the
 * grid it sits in.
 *
 * The face is the serif, not the mono. An event title is the one piece of free
 * prose in the calendar, sitting in the narrowest column on the page — and
 * mono is the widest face in the stack, which is what stopped "Stripe onsite
 * loop 1" fitting on two lines in a three-way overlap. The serif is the face
 * this app already sets its prose and its titles in; the machinery around the
 * title — the clock, the location, the chrome — stays mono, as it is
 * everywhere else.
 */
export interface EventSurface {
  background: string;
  borderLeft: string;
  color: string;
  fontFamily: string;
}

/** Wide enough to carry a hue at a glance down a column of blocks. */
const SPINE_WIDTH = 4;

/**
 * Which colour each series was dealt — see orderSeriesColors.
 *
 * One decision for the whole panel, not per view. A ranking taken from only
 * the current week would renumber itself every time you paged, and a series
 * would change colour for no reason the reader can see.
 */
export type SeriesPalette = ReadonlyMap<string, EventColorKey>;

export const SeriesPaletteContext = createContext<SeriesPalette | null>(null);

/**
 * The surfaces, bound to the palette in context.
 *
 * With no provider above it this falls back to hashing the series, which is
 * right for a lone component and wrong-but-harmless anywhere else: colours
 * stay stable and per-series, they just stop being evenly dealt.
 */
export function useEventSurface(): {
  timed: (event: DashboardEvent) => EventSurface;
  span: (event: DashboardEvent) => EventSurface;
} {
  const palette = useContext(SeriesPaletteContext);

  const surface = (event: DashboardEvent, alpha: string): EventSurface => {
    const key = palette?.get(seriesSeed(event)) ?? eventColorKey(event);
    return {
      background: `var(--event-${key}${alpha})`,
      borderLeft: `${SPINE_WIDTH}px solid var(--event-${key})`,
      color: "var(--text)",
      fontFamily: "var(--font-serif)",
    };
  };

  return {
    /** Something that happens at a time: a chip in the month grid, a block in the week. */
    timed: (event) => surface(event, "-faint"),
    /** Something that spans days: the bars across a month row or the all-day band. */
    span: (event) => surface(event, "-soft"),
  };
}
