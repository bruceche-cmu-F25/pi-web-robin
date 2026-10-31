"use client";

import { useSyncExternalStore } from "react";

export type NavigationPlacement = "left" | "left-labels" | "top" | "top-icons";
export const NAVIGATION_PLACEMENT_STORAGE_KEY = "pi-web:navigation-placement";
export const NAVIGATION_PLACEMENT_DEFAULT: NavigationPlacement = "left";

export function parseNavigationPlacement(raw: string | null): NavigationPlacement {
  return raw === "left-labels" || raw === "top" || raw === "top-icons" ? raw : NAVIGATION_PLACEMENT_DEFAULT;
}

let placement: NavigationPlacement | null = null;
const listeners = new Set<() => void>();

function readStoredPlacement(): NavigationPlacement {
  try {
    return parseNavigationPlacement(window.localStorage.getItem(NAVIGATION_PLACEMENT_STORAGE_KEY));
  } catch {
    // Keep a page-local choice when storage is blocked, including on remount.
    return placement ?? NAVIGATION_PLACEMENT_DEFAULT;
  }
}

function getSnapshot(): NavigationPlacement {
  return placement ??= readStoredPlacement();
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== NAVIGATION_PLACEMENT_STORAGE_KEY) return;
  const next = readStoredPlacement();
  if (next === placement) return;
  placement = next;
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
    placement = readStoredPlacement();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function setNavigationPlacement(next: NavigationPlacement): void {
  if (next === getSnapshot()) return;
  placement = next;
  try {
    window.localStorage.setItem(NAVIGATION_PLACEMENT_STORAGE_KEY, next);
  } catch {
    // Still applies to every mounted consumer on this page.
  }
  notify();
}

export function useNavigationPlacement(): NavigationPlacement {
  return useSyncExternalStore(subscribe, getSnapshot, () => NAVIGATION_PLACEMENT_DEFAULT);
}
