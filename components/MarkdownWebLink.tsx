"use client";

import { useSyncExternalStore, type ComponentProps } from "react";
import { isExternalMarkdownHref } from "@/lib/markdown";

const subscribe = () => () => {};
const browserOrigin = () => window.location.origin;
const serverOrigin = () => "";

/** Native links: same-site navigation stays here; other sites use a safe new tab. */
export function MarkdownWebLink({ href, ...props }: ComponentProps<"a">) {
  // Hydration-safe; origin cannot change without loading a different document.
  const origin = useSyncExternalStore(subscribe, browserOrigin, serverOrigin);
  let sameOrigin = false;
  if (origin && href) {
    try {
      const url = new URL(href, origin);
      sameOrigin = (url.protocol === "http:" || url.protocol === "https:") && url.origin === origin;
    } catch { /* Keep malformed external URLs out of in-page handling. */ }
  }
  const newTab = !href || (isExternalMarkdownHref(href) && !sameOrigin);
  return <a {...props} href={href} target={newTab ? "_blank" : undefined} rel={newTab ? "noopener noreferrer" : undefined} />;
}
