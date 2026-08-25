/**
 * How wide the coding workspace's side panes are allowed to be.
 *
 * Pure, and separate from the hook that uses it, because the interesting part
 * is the arithmetic: a dragged width is a request, not an instruction. It has
 * to survive a window that is narrower than the side panes put together, and
 * it must never squeeze what is between them to nothing — on the problems
 * track that is a full third-party application, and a NeetCode editor 90px
 * wide is not a smaller version of the feature, it is the feature gone.
 */

export interface PaneLimits {
  min: number;
  max: number;
  /** Where a double-click on the divider puts it back to. */
  preferred: number;
}

/** The roadmap rail: wide enough for a problem title, no wider than it needs. */
export const RAIL_LIMITS: PaneLimits = { min: 180, max: 520, preferred: 288 };

/** The record bar and the agent conversation. */
export const PANEL_LIMITS: PaneLimits = { min: 280, max: 720, preferred: 360 };

/**
 * The floor under whatever the side panes leave.
 *
 * Not a limit on that pane — nothing sets its width, it takes what is left —
 * but a limit on how much the sides may take from it.
 */
export const MIN_CENTRE_WIDTH = 320;

/** The seam itself takes room; the caller counts it into `otherPane`. */
export const DIVIDER_WIDTH = 5;

export interface PaneSpace {
  /** Usable width for the whole workspace, in CSS pixels. */
  viewport: number;
  /** How much the other side pane is already taking; 0 when it is hidden. */
  otherPane: number;
}

/**
 * Resolve a requested width against the limits and the space actually there.
 *
 * The minimum wins over the viewport ceiling on purpose. When the window is too
 * narrow for all three panes, something has to give, and a rail clamped down to
 * 40px would be unreadable chrome that still costs 40px — better to keep it
 * legible and let the middle pane be the one that runs out of room, since it is
 * the one that can scroll.
 */
export function clampPaneWidth(
  requested: number,
  limits: PaneLimits,
  space: PaneSpace,
): number {
  const room = space.viewport - space.otherPane - MIN_CENTRE_WIDTH;
  const ceiling = Math.max(limits.min, Math.min(limits.max, room));
  const wanted = Number.isFinite(requested) ? requested : limits.preferred;
  return Math.round(Math.min(Math.max(wanted, limits.min), ceiling));
}

/** Read a persisted width, falling back to the preferred one for anything unusable. */
export function parseStoredWidth(stored: string | null, limits: PaneLimits): number {
  const parsed = Number.parseInt(stored ?? "", 10);
  return Number.isFinite(parsed) ? parsed : limits.preferred;
}
