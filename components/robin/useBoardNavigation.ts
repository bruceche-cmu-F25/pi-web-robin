"use client";

import { useLayoutEffect, useRef } from "react";
import { applyQueryPatch, writeUrlState, type QueryPatch } from "@/lib/url-state";

const STORAGE_KEY = "pi-board-scroll-v1";
const LIMIT = 40;
function viewKey(path: string, search: string): string {
  const params = new URLSearchParams(search); params.sort();
  const query = params.toString();
  return path + (query ? `?${query}` : "");
}
function positions(): Array<[string, number]> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((entry): entry is [string, number] => Array.isArray(entry) && typeof entry[0] === "string" && Number.isFinite(entry[1]) && entry[1] >= 0).slice(-LIMIT) : [];
  } catch { return []; }
}
function remember(key: string, top: number) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...positions().filter(([id]) => id !== key), [key, top]].slice(-LIMIT))); }
  catch { /* Restricted storage must not block browsing. */ }
}

/** URL owns filters; this tab keeps only the last scroll offset for each list URL. */
export function useBoardNavigation(path: string, search: string, ready: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const save = useRef(() => {});
  const changedHere = useRef<string | null>(null);
  const key = viewKey(path, search);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !ready) return;
    const saved = positions().find(([id]) => id === key)?.[1];
    let restoring = saved !== undefined && changedHere.current !== key;
    let top = restoring ? saved! : element.scrollTop;
    changedHere.current = null;
    const restore = () => {
      if (!restoring) return;
      element.scrollTop = top;
      if (Math.abs(element.scrollTop - top) < 1) restoring = false;
    };
    const track = () => { if (!restoring) top = element.scrollTop; };
    const takeControl = () => { restoring = false; top = element.scrollTop; };
    const keydown = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) takeControl();
    };
    const persist = () => remember(key, top);
    save.current = () => { track(); persist(); };
    // Async rows may not be tall enough yet. Stop restoring as soon as the
    // position is reachable, or the user takes control; never fight their scroll.
    const observer = new ResizeObserver(restore);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    restore();
    element.addEventListener("scroll", track, { passive: true });
    element.addEventListener("wheel", takeControl, { passive: true });
    element.addEventListener("touchstart", takeControl, { passive: true });
    element.addEventListener("pointerdown", takeControl, { passive: true });
    element.addEventListener("keydown", keydown);
    window.addEventListener("pagehide", persist);
    return () => {
      persist(); save.current = () => {};
      observer.disconnect();
      element.removeEventListener("scroll", track);
      element.removeEventListener("wheel", takeControl);
      element.removeEventListener("touchstart", takeControl);
      element.removeEventListener("pointerdown", takeControl);
      element.removeEventListener("keydown", keydown);
      window.removeEventListener("pagehide", persist);
    };
  }, [key, ready]);

  const updateView = (patch: QueryPatch, mode: "push" | "replace" = "push") => {
    if (window.location.pathname !== path) return;
    save.current();
    const next = viewKey(path, applyQueryPatch(window.location.search, patch));
    // An explicit filter change keeps the controls in place, not an old visit's
    // offset. Back/forward and reload instead read the stored destination offset.
    if (next !== key) changedHere.current = next;
    if (scrollRef.current) remember(next, scrollRef.current.scrollTop);
    writeUrlState(patch, mode);
  };
  return { scrollRef, updateView };
}
