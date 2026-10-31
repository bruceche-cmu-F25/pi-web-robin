import { createContext, useContext } from "react";
import type { DashboardEvent } from "@/extension/robin/events";
import { eventColorKey, seriesSeed, type EventColorKey } from "@/extension/robin/eventColors";

/** Only explicit browser preferences live in this map; automatic colors are pure hashes. */
export type SeriesPalette = ReadonlyMap<string, EventColorKey>;
export const SeriesPaletteContext = createContext<SeriesPalette | null>(null);

export interface EventSurface {
  background: string;
  borderLeft: string;
  color: string;
  fontFamily: string;
}

/** One paint rule for week/day, month and agenda. Neutral text stays legible on
 * opaque tinted paper; a vivid spine carries the series hue. Calendar-only CSS
 * tokens keep the existing Product/Learning/Todo palettes unchanged.
 */
export function useEventSurface() {
  const palette = useContext(SeriesPaletteContext);
  const marker = (event: DashboardEvent) =>
    `var(--calendar-${palette?.get(seriesSeed(event)) ?? eventColorKey(event)})`;
  const surface = (event: DashboardEvent, weight: number): EventSurface => ({
    background: `color-mix(in srgb, ${marker(event)} ${weight}%, var(--bg-panel))`,
    borderLeft: `3px solid ${marker(event)}`,
    color: "var(--text)",
    fontFamily: "var(--calendar-font)",
  });
  return {
    marker,
    timed: (event: DashboardEvent) => surface(event, 12),
    span: (event: DashboardEvent) => surface(event, 20),
  };
}
