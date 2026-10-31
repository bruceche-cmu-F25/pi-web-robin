"use client";

import { useEffect } from "react";
import { startLiquidGlass } from "@/lib/liquid-glass";

/** Mount inside the hydrated workspace, not the streaming root layout: an
 * earlier root effect would decorate server HTML before React hydrates it.
 * No children, wrappers or React render loop. */
export function LiquidGlassEffects() {
  useEffect(() => {
    // CSS.supports only checks URL syntax, not SVG backdrop rendering. Chromium
    // implements it; Safari/Firefox keep the CSS frost rather than broken glass.
    if (!/(?:Chrome|Chromium)\//.test(navigator.userAgent) ||
        !CSS.supports("backdrop-filter", 'url("#glass-probe")') ||
        typeof ResizeObserver === "undefined") return;
    const preferences = matchMedia("(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)");
    let stop: (() => void) | undefined;
    const sync = () => {
      const theme = document.documentElement.dataset.theme;
      const active = (theme === "glass" || theme === "glass-dark") && !preferences.matches && !document.hidden;
      if (active && !stop) stop = startLiquidGlass();
      else if (!active && stop) { stop(); stop = undefined; }
    };
    const theme = new MutationObserver(sync);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    preferences.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      theme.disconnect();
      preferences.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      stop?.();
    };
  }, []);
  return null;
}
