"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DIVIDER_WIDTH,
  PANEL_LIMITS,
  RAIL_LIMITS,
  clampPaneWidth,
  parseStoredWidth,
  type PaneLimits,
} from "./paneWidths";

const RAIL_STORAGE_KEY = "pi-coding-rail-width";
const PANEL_STORAGE_KEY = "pi-coding-panel-width";

/** Everything a PaneDivider needs, so a call site is one spread. */
export interface PaneControl {
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  onCommit: () => void;
  onReset: () => void;
}

export interface PaneWidths {
  rail: PaneControl;
  panel: PaneControl;
}

interface Pane {
  width: number;
  /** Set the width now; the ref keeps the value readable before React re-renders. */
  apply: (width: number) => void;
  /** Write the current width to localStorage. */
  commit: () => void;
  /** Back to the preferred width, saved. */
  reset: () => void;
  limits: PaneLimits;
}

/**
 * One pane's width, with its last value readable synchronously.
 *
 * The ref is not an optimisation. Persisting on release means the commit runs
 * right after a resize, and a keyboard nudge does both in the same tick — where
 * a closure over the state variable still holds the width from the render
 * before, so the value written down is the one from before the adjustment. The
 * ref is what makes "save what it is now" mean now.
 */
function usePane(storageKey: string, limits: PaneLimits): Pane {
  const [width, setWidth] = useState(limits.preferred);
  const latest = useRef(limits.preferred);

  const apply = useCallback((next: number) => {
    latest.current = next;
    setWidth(next);
  }, []);

  useEffect(() => {
    // Read after mount, not during render: the server has no localStorage and
    // would otherwise disagree with the first client paint.
    apply(parseStoredWidth(window.localStorage.getItem(storageKey), limits));
  }, [apply, storageKey, limits]);

  const commit = useCallback(() => {
    window.localStorage.setItem(storageKey, String(latest.current));
  }, [storageKey]);

  const reset = useCallback(() => {
    apply(limits.preferred);
    window.localStorage.setItem(storageKey, String(limits.preferred));
  }, [apply, limits, storageKey]);

  return { width, apply, commit, reset, limits };
}

/**
 * The two side pane widths, shared by both tracks of the workspace.
 *
 * Shared deliberately: problems and curriculum are one workspace and one habit,
 * so a rail you widened while reading should still be that wide when you go
 * back to solving. They are a browser preference like the open/closed rail, and
 * stay in localStorage rather than the store — a second machine has no business
 * rearranging the panes on this one.
 *
 * Persisted on release rather than on every pointer move: a drag fires dozens
 * of events a second and each write is synchronous.
 */
export function usePaneWidths(railVisible: boolean): PaneWidths {
  const rail = usePane(RAIL_STORAGE_KEY, RAIL_LIMITS);
  const panel = usePane(PANEL_STORAGE_KEY, PANEL_LIMITS);

  /**
   * A requested width, resolved against the room actually available.
   *
   * `otherPane` carries the seams as well as the opposite pane: both are width
   * the middle never gets, and counting them is what makes the floor in
   * ./paneWidths.ts true of the pane rather than of the gap it sits in.
   */
  const control = (pane: Pane, otherPane: number): PaneControl => ({
    width: pane.width,
    min: pane.limits.min,
    max: pane.limits.max,
    onResize: (requested) => {
      pane.apply(clampPaneWidth(requested, pane.limits, {
        viewport: window.innerWidth,
        otherPane,
      }));
    },
    onCommit: pane.commit,
    onReset: pane.reset,
  });

  return {
    rail: control(rail, panel.width + 2 * DIVIDER_WIDTH),
    // The rail's width only counts against the panel while the rail is on
    // screen; with it hidden the panel may take the room the rail gave back.
    panel: control(panel, railVisible ? rail.width + 2 * DIVIDER_WIDTH : DIVIDER_WIDTH),
  };
}
