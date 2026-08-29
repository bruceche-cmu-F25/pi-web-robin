/**
 * Calendar layout maths. Pure — no node builtins, no DOM.
 *
 * Two problems live here, both of which are easy to get subtly wrong and so are
 * kept out of the components and tested directly:
 *
 * 1. Overlapping timed events on one day, which must share the day's width.
 * 2. Multi-day events on a week row, which must stack into lanes without
 *    colliding, clipped to the week.
 */
import { eventEndDate, isAllDayBand, type CalendarEvent } from "./events.ts";

export const MINUTES_PER_DAY = 24 * 60;

export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

export function fromMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(minutes, MINUTES_PER_DAY));
  const hours = Math.floor(clamped / 60);
  return `${String(hours).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

export interface PositionedEvent<T> {
  event: T;
  startMinutes: number;
  endMinutes: number;
  /** Zero-based column within the overlapping cluster. */
  column: number;
  /** How many columns the cluster needs — the divisor for the width. */
  columns: number;
}

/** Below this, a block is too short to show its own title. */
export const MIN_EVENT_MINUTES = 30;

/**
 * Place one day's timed events, giving overlapping ones side-by-side columns.
 *
 * Events are grouped into clusters of transitively-overlapping events; within a
 * cluster each event takes the first column free at its start time, and every
 * event in the cluster is divided by the same column count so their edges line
 * up. Zero-length and past-midnight ends are clamped so nothing renders
 * inverted or invisible.
 */
export function layoutDayEvents<T extends CalendarEvent>(events: T[]): PositionedEvent<T>[] {
  const timed = events
    .filter((event) => !isAllDayBand(event))
    .map((event) => {
      const startMinutes = Math.min(toMinutes(event.start as string), MINUTES_PER_DAY);
      const rawEnd = event.end ? toMinutes(event.end) : startMinutes + MIN_EVENT_MINUTES;
      return {
        event,
        startMinutes,
        endMinutes: Math.min(Math.max(rawEnd, startMinutes + MIN_EVENT_MINUTES), MINUTES_PER_DAY),
      };
    })
    .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);

  const placed: PositionedEvent<T>[] = [];
  let cluster: typeof timed = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const columnEnds: number[] = [];
    const withColumns = cluster.map((item) => {
      let column = columnEnds.findIndex((end) => end <= item.startMinutes);
      if (column === -1) column = columnEnds.length;
      columnEnds[column] = item.endMinutes;
      return { ...item, column };
    });
    for (const item of withColumns) placed.push({ ...item, columns: columnEnds.length });
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of timed) {
    // A new cluster starts once an event begins at or after everything before it ends.
    if (cluster.length > 0 && item.startMinutes >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMinutes);
  }
  flush();
  return placed;
}

/** Where an empty week opens. Nothing to measure, so this is just waking hours. */
const EMPTY_FIRST = 8;
const EMPTY_LAST = 20;
/** A grid shorter than this stops reading as a day at all. */
const MIN_HOURS = 8;
/**
 * The top of the grid snaps to a multiple of this many hours.
 *
 * The range used to be pinned at 06:00–22:00 and could only grow, on the
 * argument that a top edge tracking the first event would move under you from
 * week to week. The argument is right and the fix was too blunt: sixteen hours
 * is ~900px at the current hour height, so a week that starts at 09:30 opened
 * with three and a half empty hours you had to scroll past every time.
 *
 * Snapping keeps both. The top moves only when the week genuinely shifts by
 * two hours, not every time one meeting is rescheduled. The bottom is not
 * snapped: it is the edge you scroll to, not the one you read from, and
 * rounding it up only adds height back.
 *
 * The snap rounds down to the bracket the first event is *in*, and adds
 * nothing on top of that. An earlier version padded an hour of air above the
 * first event before snapping, so that the earliest block was not welded to
 * the top rule — but an hour of air plus a rounding down is up to three empty
 * hours, and a 06:00 start opened the grid at 04:00. An early week is early;
 * it should not have to be scrolled into.
 */
const SNAP_HOURS = 2;

/**
 * The hours the week grid draws, measured from the timed events in it.
 *
 * All-day and multi-day events are excluded — they live in their own band and
 * have no position on the hour grid, so a trip must not stretch it to midnight.
 */
export function visibleHourRange<T extends CalendarEvent>(
  events: T[],
): { first: number; last: number } {
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const event of layoutDayEvents(events)) {
    earliest = Math.min(earliest, Math.floor(event.startMinutes / 60));
    latest = Math.max(latest, Math.ceil(event.endMinutes / 60));
  }
  if (earliest === Number.POSITIVE_INFINITY) return { first: EMPTY_FIRST, last: EMPTY_LAST };

  let first = Math.max(0, Math.floor(earliest / SNAP_HOURS) * SNAP_HOURS);
  let last = Math.min(24, latest);
  // Grow downwards first: a short day should gain an evening, not a dawn.
  while (last - first < MIN_HOURS && last < 24) last += 1;
  while (last - first < MIN_HOURS && first > 0) first -= 1;
  return { first, last };
}

export interface SpanBar<T> {
  event: T;
  /** Index into the supplied days array, clipped to the week. */
  startIndex: number;
  endIndex: number;
  /** True when the event actually begins/ends outside this week. */
  continuesBefore: boolean;
  continuesAfter: boolean;
  lane: number;
}

/**
 * Stack all-day and multi-day events into lanes across a row of days.
 *
 * Longer events are placed first so a week-long bar takes the top lane and
 * shorter ones tuck underneath, which is what makes the row readable. Bars are
 * clipped to the row and flagged where they continue, so the component can
 * square off the cut edges.
 */
export function layoutSpanBars<T extends CalendarEvent>(
  events: T[],
  days: string[],
): { bars: SpanBar<T>[]; lanes: number } {
  if (days.length === 0) return { bars: [], lanes: 0 };
  const first = days[0] as string;
  const last = days[days.length - 1] as string;

  const candidates = events
    .filter(isAllDayBand)
    .filter((event) => event.date <= last && eventEndDate(event) >= first)
    .map((event) => {
      const startsAt = event.date;
      const endsAt = eventEndDate(event);
      const startIndex = Math.max(0, days.indexOf(startsAt < first ? first : startsAt));
      const endRaw = endsAt > last ? last : endsAt;
      const endIndex = days.indexOf(endRaw);
      return {
        event,
        startIndex,
        endIndex: endIndex === -1 ? days.length - 1 : endIndex,
        continuesBefore: startsAt < first,
        continuesAfter: endsAt > last,
      };
    })
    .sort((a, b) => {
      const spanA = a.endIndex - a.startIndex;
      const spanB = b.endIndex - b.startIndex;
      if (spanA !== spanB) return spanB - spanA; // longest first
      if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
      return a.event.title.localeCompare(b.event.title);
    });

  // Occupancy is tracked as intervals, not just each lane's furthest right
  // edge: placing the longest bar first would otherwise block the empty space
  // to its left and push short bars into needless extra lanes.
  const laneIntervals: { start: number; end: number }[][] = [];
  const bars = candidates.map((candidate) => {
    let lane = laneIntervals.findIndex((intervals) => intervals.every(
      (interval) => interval.end < candidate.startIndex || interval.start > candidate.endIndex,
    ));
    if (lane === -1) {
      lane = laneIntervals.length;
      laneIntervals.push([]);
    }
    (laneIntervals[lane] as { start: number; end: number }[]).push({
      start: candidate.startIndex,
      end: candidate.endIndex,
    });
    return { ...candidate, lane };
  });

  return { bars, lanes: laneIntervals.length };
}
