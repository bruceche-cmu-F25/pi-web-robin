"use client";

import { useSyncExternalStore } from "react";
import { MOBILE_MAX_WIDTH, SPLIT_PANEL_MIN_WIDTH } from "@/lib/panel-layout";

// lib/panel-layout.ts is the source of truth for this breakpoint; the media
// queries in app/globals.css mirror the same number.
const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;
// Narrow phones keep secondary toolbar actions behind the More button.
const NARROW_MOBILE_QUERY = "(max-width: 480px)";
// The width at which a panel can take a column of its own instead of covering
// what it sits beside.
const SPLIT_QUERY = `(min-width: ${SPLIT_PANEL_MIN_WIDTH}px)`;

function subscribeToQuery(query: string, cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(query);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function queryMatches(query: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

const subscribeMobile = (cb: () => void) => subscribeToQuery(MOBILE_QUERY, cb);
const getMobileSnapshot = () => queryMatches(MOBILE_QUERY);
const subscribeNarrowMobile = (cb: () => void) => subscribeToQuery(NARROW_MOBILE_QUERY, cb);
const getNarrowMobileSnapshot = () => queryMatches(NARROW_MOBILE_QUERY);
const subscribeSplit = (cb: () => void) => subscribeToQuery(SPLIT_QUERY, cb);
const getSplitSnapshot = () => queryMatches(SPLIT_QUERY);

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Returns true when the viewport is at or below the mobile breakpoint.
 * SSR-safe: renders as desktop (false) on the server and first client paint,
 * then syncs to the real viewport after hydration.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeMobile, getMobileSnapshot, getServerSnapshot);
}

/** Returns true when the compact mobile toolbar should collapse extra actions. */
export function useIsNarrowMobile(): boolean {
  return useSyncExternalStore(subscribeNarrowMobile, getNarrowMobileSnapshot, getServerSnapshot);
}

/**
 * Returns true when there is room for a panel to sit beside the page rather
 * than over it. SSR-safe in the same way as useIsMobile: false until the
 * viewport is known, which is the overlay behaviour and the safe default.
 */
export function useIsSplitLayout(): boolean {
  return useSyncExternalStore(subscribeSplit, getSplitSnapshot, getServerSnapshot);
}
