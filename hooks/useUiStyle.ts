"use client";

import { useCallback, useSyncExternalStore } from "react";

export type UiStyle = "balanced" | "classic";

const STORAGE_KEY = "pi-ui-style";
const DEFAULT_STYLE: UiStyle = "balanced";
const listeners = new Set<() => void>();
let currentStyle: UiStyle | null = null;

export function normalizeUiStyle(value: unknown): UiStyle {
  return value === "classic" ? "classic" : DEFAULT_STYLE;
}

export function nextUiStyle(style: UiStyle): UiStyle {
  return style === "balanced" ? "classic" : "balanced";
}

function applyUiStyle(style: UiStyle): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.uiStyle = style;
}

function readUiStyle(): UiStyle {
  if (typeof window === "undefined") return DEFAULT_STYLE;
  try {
    return normalizeUiStyle(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_STYLE;
  }
}

function ensureUiStyle(): UiStyle {
  if (typeof window === "undefined") return DEFAULT_STYLE;
  if (currentStyle) return currentStyle;
  currentStyle = readUiStyle();
  applyUiStyle(currentStyle);
  return currentStyle;
}

function setStoredUiStyle(style: UiStyle): void {
  currentStyle = style;
  applyUiStyle(style);
  try {
    window.localStorage.setItem(STORAGE_KEY, style);
  } catch {
    // Storage can be unavailable in private browsing; the live preference still applies.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensureUiStyle();
  return () => listeners.delete(listener);
}

export function useUiStyle() {
  const style = useSyncExternalStore(subscribe, ensureUiStyle, () => DEFAULT_STYLE);
  const setStyle = useCallback((next: UiStyle) => setStoredUiStyle(next), []);
  const toggleStyle = useCallback(() => setStoredUiStyle(nextUiStyle(ensureUiStyle())), []);

  return {
    style,
    setStyle,
    toggleStyle,
    isBalanced: style === "balanced",
  };
}
