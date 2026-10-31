"use client";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const HOLD_MS = 300;
const CANCEL_DISTANCE = 64;
interface Actions {
  phase: () => string;
  start: () => Promise<boolean>;
  finish: () => void;
  cancel: () => void;
}

/** One button: tap to latch, tap again to finish; hold/release after permission is known. */
export function useVoiceGesture(actions: Actions) {
  const [holding, setHolding] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const ready = useRef(false);
  const latest = useRef(actions);
  useEffect(() => { latest.current = actions; });
  const gesture = useRef<null | { id: number; y: number; began: number; finishOnRelease: boolean; canHold: boolean; cancel: boolean; target: HTMLButtonElement }>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);

  function reset() {
    const previous = gesture.current; gesture.current = null;
    if (timer.current) clearTimeout(timer.current); timer.current = null;
    if (previous?.target.hasPointerCapture?.(previous.id)) previous.target.releasePointerCapture(previous.id);
    setHolding(false); setCancelling(false);
  }
  function cancel() { reset(); latest.current.cancel(); }
  function start() {
    // Call synchronously from the gesture so Safari can unlock its AudioContext.
    void latest.current.start().then(ok => { if (ok) ready.current = true; });
  }
  function activate() {
    const phase = latest.current.phase();
    if (phase === "recording") latest.current.finish();
    else if (!["permission", "transcribing", "waiting"].includes(phase)) start();
  }
  useEffect(() => {
    let mounted = true;
    // Safari may not expose microphone permission queries. Unknown permission is safely tap-to-finish.
    void navigator.permissions?.query({ name: "microphone" as PermissionName }).then(result => {
      if (mounted) ready.current = result.state === "granted";
    }).catch(() => {});
    const blur = () => {
      if (!gesture.current) return;
      if (latest.current.phase() === "permission") reset(); // permission prompt: latch, never send on release
      else cancel();
    };
    window.addEventListener("blur", blur);
    return () => { mounted = false; reset(); window.removeEventListener("blur", blur); };
    // The listener reads the current capture through latest, never a render snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { holding, cancelling, cancel, reset, handlers: {
    onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
      if (event.button !== 0 || !event.isPrimary || gesture.current) return;
      const phase = latest.current.phase();
      suppressClick.current = true;
      if (["permission", "transcribing", "waiting"].includes(phase)) return;
      event.preventDefault(); // don't summon a keyboard or select a label
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { id: event.pointerId, y: event.clientY, began: Date.now(), finishOnRelease: phase === "recording", canHold: ready.current, cancel: false, target: event.currentTarget };
      if (phase !== "recording") start();
      timer.current = setTimeout(() => {
        if (gesture.current?.canHold && !gesture.current.finishOnRelease) setHolding(true);
      }, HOLD_MS);
    },
    onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
      const g = gesture.current;
      if (!g || g.id !== event.pointerId) return;
      g.cancel = g.y - event.clientY >= CANCEL_DISTANCE;
      setCancelling(g.cancel);
    },
    onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
      const g = gesture.current;
      if (!g || g.id !== event.pointerId) return;
      const finish = g.finishOnRelease || (g.canHold && Date.now() - g.began >= HOLD_MS);
      reset();
      if (g.cancel) latest.current.cancel();
      // Releasing before permission resolves stays in tap mode. No unseen audio is sent.
      else if (finish && latest.current.phase() === "recording") latest.current.finish();
    },
    onPointerCancel: cancel,
    onLostPointerCapture() { if (gesture.current) cancel(); },
    onContextMenu(event: React.MouseEvent) { event.preventDefault(); },
    onKeyDown(event: React.KeyboardEvent) {
      suppressClick.current = false;
      if (event.repeat && ["Enter", " "].includes(event.key)) event.preventDefault();
    },
    onClick() {
      if (suppressClick.current) { suppressClick.current = false; return; }
      activate(); // native Enter/Space and assistive-technology clicks
    },
  } };
}
