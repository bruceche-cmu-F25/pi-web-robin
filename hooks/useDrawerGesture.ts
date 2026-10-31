"use client";

import { useEffect, type RefObject } from "react";
import { drawerResistance, drawerSpring, drawerTarget, drawerVelocity } from "@/lib/drawer-motion";

/** Progressive enhancement on the drawer's header only. Links and vertical scrolling stay native. */
export function useDrawerGesture(panel: RefObject<HTMLDivElement | null>, scrim: RefObject<HTMLButtonElement | null>, enabled: boolean, onClose: () => void) {
  useEffect(() => {
    const element = panel.current, backdrop = scrim.current;
    if (!enabled || !element || !backdrop) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let gesture: { id: number; startX: number; startY: number; origin: number; width: number; active: boolean; points: Array<{ x: number; time: number }> } | null = null;
    const clear = () => {
      cancelAnimationFrame(frame); frame = 0;
      element.style.removeProperty("transform"); element.style.removeProperty("transition");
      backdrop.style.removeProperty("opacity"); backdrop.style.removeProperty("transition");
    };
    const position = () => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41;
    const paint = (x: number, width: number) => {
      element.style.transition = "none";
      element.style.transform = `translateX(${x}px)`;
      backdrop.style.transition = "none";
      backdrop.style.opacity = String(Math.max(0, Math.min(1, 1 + x / width)));
    };
    const release = () => {
      const previous = gesture; gesture = null;
      if (previous && element.hasPointerCapture(previous.id)) element.releasePointerCapture(previous.id);
      return previous;
    };
    const settle = (target: number, velocity: number, width: number) => {
      cancelAnimationFrame(frame);
      let x = position(), last = performance.now();
      const finish = () => {
        frame = 0;
        if (target < 0) { paint(target, width); onClose(); }
        else clear();
      };
      if (reduced.matches) { finish(); return; }
      const tick = (now: number) => {
        const next = drawerSpring(x, velocity, target, (now - last) / 1000);
        x = next.x; velocity = next.velocity; last = now;
        paint(x, width);
        if (Math.abs(x - target) < 0.3 && Math.abs(velocity) < 3) finish();
        else frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Element) || !event.target.closest("[data-drawer-handle]")) return;
      const origin = position();
      cancelAnimationFrame(frame); frame = 0;
      const width = element.offsetWidth + (parseFloat(getComputedStyle(element).left) || 0);
      paint(origin, width); // Freeze the presentation, never jump to the logical open state.
      gesture = { id: event.pointerId, startX: event.clientX, startY: event.clientY, origin, width, active: false, points: [{ x: origin, time: event.timeStamp }] };
      element.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      const g = gesture;
      if (!g || event.pointerId !== g.id) return;
      const dx = event.clientX - g.startX, dy = event.clientY - g.startY;
      if (!g.active) {
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { release(); settle(0, 0, g.width); return; }
        if (Math.abs(dx) < 8) return;
        g.active = true;
      }
      const x = drawerResistance(g.origin + dx, g.width);
      paint(x, g.width);
      g.points = [...g.points.filter(point => event.timeStamp - point.time <= 100), { x, time: event.timeStamp }];
    };
    const up = (event: PointerEvent) => {
      if (gesture?.id !== event.pointerId) return;
      const g = release()!;
      const velocity = g.active ? drawerVelocity(g.points, event.timeStamp) : 0;
      settle(g.active ? drawerTarget(position(), velocity, g.width) : 0, velocity, g.width);
    };
    const cancel = () => {
      const g = release();
      if (g) settle(0, 0, g.width);
      else clear();
    };
    const lostCapture = (event: PointerEvent) => { if (gesture?.id === event.pointerId) cancel(); };
    const otherPointer = (event: PointerEvent) => { if (gesture && event.pointerId !== gesture.id) cancel(); };
    const visibility = () => { if (document.hidden) { release(); clear(); } };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", cancel);
    element.addEventListener("lostpointercapture", lostCapture);
    window.addEventListener("pointerdown", otherPointer, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    reduced.addEventListener("change", cancel);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", cancel);
      element.removeEventListener("lostpointercapture", lostCapture);
      window.removeEventListener("pointerdown", otherPointer, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      reduced.removeEventListener("change", cancel);
      document.removeEventListener("visibilitychange", visibility);
      release(); clear();
    };
  }, [enabled, onClose, panel, scrim]);
}
