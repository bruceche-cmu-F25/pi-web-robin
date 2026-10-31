"use client";

import { useLayoutEffect, type RefObject } from "react";

/** Measure chrome only when its geometry changes; never on scroll or streamed text.
 * CSS uses these insets in Glass, with the original flow layout as the fallback. */
export function useChatChromeInsets(rootRef: RefObject<HTMLDivElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;
    const toolbar = root.closest(".chat-main")?.querySelector<HTMLElement>(".pi-topbar");
    const header = root.querySelector<HTMLElement>(".chat-inline-header");
    const composer = root.querySelector<HTMLElement>(".chat-composer");
    if (!header || !composer) return;

    const measure = () => {
      const toolbarStyle = toolbar ? getComputedStyle(toolbar) : null;
      const toolbarHeight = toolbar ? toolbar.getBoundingClientRect().height
        + (parseFloat(toolbarStyle!.marginTop) || 0) + (parseFloat(toolbarStyle!.marginBottom) || 0) : 0;
      const bottom = composer.getBoundingClientRect().height + (parseFloat(getComputedStyle(root).paddingBottom) || 0);
      const values = {
        "--chat-toolbar-height": toolbarHeight,
        "--chat-scroll-top": toolbarHeight + header.getBoundingClientRect().height,
        "--chat-scroll-bottom": bottom,
      };
      for (const [name, value] of Object.entries(values)) {
        const next = `${Math.ceil(value)}px`;
        if (root.style.getPropertyValue(name) !== next) root.style.setProperty(name, next);
      }
    };
    measure();
    root.setAttribute("data-scroll-chrome", "");
    const observer = new ResizeObserver(measure);
    for (const element of [root, toolbar, header, composer]) if (element) observer.observe(element);
    return () => {
      observer.disconnect();
      root.removeAttribute("data-scroll-chrome");
      for (const name of ["--chat-toolbar-height", "--chat-scroll-top", "--chat-scroll-bottom"]) root.style.removeProperty(name);
    };
  }, [rootRef, enabled]);
}
