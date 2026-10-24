"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
      // Keep push available in dev without caching stale Next/HMR chunks.
      // Update the same scope in place so existing push subscriptions survive.
      const pushOnly = process.env.NODE_ENV !== "production";
      const scriptUrl = `/sw.js?v=${encodeURIComponent(appVersion)}${pushOnly ? "&pushOnly=1" : ""}`;

      void navigator.serviceWorker.register(scriptUrl, {
        scope: "/",
        updateViaCache: "none",
      }).catch((error: unknown) => {
        console.error("Failed to register the Pi Web service worker:", error);
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
