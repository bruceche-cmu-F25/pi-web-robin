"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playFocusAlarm } from "./useAudio";
import {
  changeFocusTimer, DEFAULT_FOCUS_TIMER, FOCUS_TIMER_KEY, parseFocusTimer,
  type FocusTimerAction, type FocusTimerState,
} from "@/lib/focus-timer";

// Survives client-side route changes; no audio is created until a user gesture.
let audio: AudioContext | null = null;
function unlockSound() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume().catch(() => {});
  } catch { /* Sound is optional (autoplay policy / unsupported browser). */ }
}

function ring() {
  if (!audio) return;
  const play = () => { try { playFocusAlarm(audio!); } catch { /* Visual reminder remains available. */ } };
  if (audio.state === "suspended") void audio.resume().then(play).catch(() => {});
  else if (audio.state === "running") play();
}

/** Ask once, from the click that starts a round — never on page load. */
function requestNotifications() {
  try {
    if (window.isSecureContext && "Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission().catch(() => {});
    }
  } catch { /* The in-page reminder remains available. */ }
}

/** `onComplete` runs in the one tab that claimed the finish, never in the others. */
export function useFocusTimer(onComplete?: (state: FocusTimerState) => void) {
  const [state, setState] = useState(DEFAULT_FOCUS_TIMER);
  const [now, setNow] = useState(0);
  const [ready, setReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [notice, setNotice] = useState(false);
  const current = useRef(DEFAULT_FOCUS_TIMER);
  const mounted = useRef(false);
  const storageOK = useRef(true);
  const completed = useRef(onComplete);
  useEffect(() => { completed.current = onComplete; });

  const apply = useCallback((next: FocusTimerState) => {
    current.current = next;
    setState((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next);
  }, []);

  const read = useCallback(() => {
    if (!storageOK.current) return current.current;
    try {
      return parseFocusTimer(localStorage.getItem(FOCUS_TIMER_KEY));
    } catch {
      storageOK.current = false;
      setStorageAvailable(false);
      return current.current;
    }
  }, []);

  const dispatch = useCallback(async (action: FocusTimerAction) => {
    const update = () => {
      if (!mounted.current) return;
      const before = read();
      const time = Date.now();
      // Give a visible tab first refusal. Hidden tabs can still ring, but only
      // after a short grace period. Web Locks makes claiming completion atomic.
      if (action.type === "expire" && document.hidden && time < (before.endsAt ?? 0) + 1500) return;
      const next = changeFocusTimer(before, action, time);
      if (next !== before) {
        try {
          if (storageOK.current) localStorage.setItem(FOCUS_TIMER_KEY, JSON.stringify(next));
        } catch {
          storageOK.current = false;
          setStorageAvailable(false);
        }
      }
      apply(next);
      setNow(time);
      if (before.status === "running" && next.status === "complete") {
        setNotice(true);
        if (next.sound) ring();
        completed.current?.(next);
      } else if (next.status !== "complete") {
        setNotice(false);
      }
    };
    if (navigator.locks) {
      await navigator.locks.request(FOCUS_TIMER_KEY, update);
    } else {
      // Non-secure legacy browsers have no cross-tab mutex: only the focused
      // document may claim completion. It catches up when focus returns.
      if (action.type !== "expire" || document.hasFocus()) update();
    }
  }, [apply, read]);

  useEffect(() => {
    mounted.current = true;
    apply(read());
    setNow(Date.now());
    setReady(true);
    const sync = (event: StorageEvent) => {
      if (event.key !== FOCUS_TIMER_KEY && event.key !== null) return;
      apply(read());
      setNotice(false);
      setNow(Date.now());
    };
    window.addEventListener("storage", sync);
    return () => {
      mounted.current = false;
      window.removeEventListener("storage", sync);
    };
  }, [apply, read]);

  useEffect(() => {
    if (!ready || state.status !== "running") return;
    const tick = () => {
      const time = Date.now();
      setNow(time);
      if (time >= state.endsAt!) void dispatch({ type: "expire" });
    };
    tick();
    // The 1s interval only drives the display: after a few minutes hidden,
    // Chrome batches repeating timers to once a minute, which would make a
    // background tab ring up to a minute late. One-shot timers armed once per
    // deadline are not batched. The second covers the grace period a hidden
    // tab leaves for a visible one.
    const wait = Math.max(0, state.endsAt! - Date.now());
    const deadlines = [wait, wait + 1600].map((ms) => window.setTimeout(tick, ms));
    const interval = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    window.addEventListener("pageshow", tick);
    return () => {
      deadlines.forEach(clearTimeout);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
      window.removeEventListener("pageshow", tick);
    };
  }, [ready, state.status, state.endsAt, dispatch]);

  const act = (action: FocusTimerAction) => {
    if (current.current.sound || (action.type === "settings" && action.sound)) unlockSound();
    if (action.type === "start") requestNotifications();
    void dispatch(action);
  };

  return { state, now, ready, storageAvailable, notice, dismissNotice: () => setNotice(false), act,
    previewSound: () => { unlockSound(); ring(); },
    // Opening the panel is a user gesture (sound) and may be the first render
    // of a new day (today's record), so it refreshes the clock too.
    unlock: () => { if (current.current.sound) unlockSound(); setNow(Date.now()); } };
}
