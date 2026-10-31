"use client";

import { useEffect, useMemo, useState } from "react";
import { EVENT_COLOR_KEYS, seriesSeed, type EventColorKey } from "@/extension/robin/eventColors";
import type { DashboardEvent } from "@/extension/robin/events";

// One key per series: unrelated choices in two tabs cannot overwrite each other.
const PREFIX = "robin-calendar-series-color:v1:";
const storageKey = (seed: string) => PREFIX + encodeURIComponent(seed);

/** Display preferences only. Never writes events or the provider's calendar. */
export function useCalendarColors(events: readonly DashboardEvent[] | undefined) {
  const seeds = useMemo(() => new Set((events ?? []).map(seriesSeed)), [events]);
  const [colors, setColors] = useState<ReadonlyMap<string, EventColorKey>>(new Map());
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const read = () => {
      try {
        const next = new Map<string, EventColorKey>();
        for (const seed of seeds) {
          const value = localStorage.getItem(storageKey(seed));
          if (EVENT_COLOR_KEYS.includes(value as EventColorKey)) next.set(seed, value as EventColorKey);
        }
        setColors(next);
        setFailed(false);
      } catch { setFailed(true); } // Keep the last known choices when storage is unavailable.
    };
    read();
    const changed = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(PREFIX)) read(); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [seeds]);

  const choose = (event: DashboardEvent, color: EventColorKey | null) => {
    const seed = seriesSeed(event);
    try {
      if (color === null) localStorage.removeItem(storageKey(seed));
      else localStorage.setItem(storageKey(seed), color);
      setColors((current) => {
        const next = new Map(current);
        if (color === null) next.delete(seed); else next.set(seed, color);
        return next;
      });
      setFailed(false);
    } catch { setFailed(true); } // A failed write must not look like a saved preference.
  };
  return { colors, choose, failed };
}
