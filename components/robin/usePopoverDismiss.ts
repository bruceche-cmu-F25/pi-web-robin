"use client";

import { useEffect, useRef } from "react";

/**
 * Close a `<details>` popover when the click or the keyboard leaves it.
 *
 * `<details>` has no light-dismiss of its own: an open colour picker or link
 * box stays open until its own summary is clicked again, so opening a second
 * one leaves both hanging over the list. Attaching this to each popover also
 * gives them mutual exclusion for free — opening one is a click outside every
 * other.
 *
 * `open` is left uncontrolled and toggled on the element, which is what the
 * native summary click does too.
 */
export function usePopoverDismiss() {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const dismiss = (event: Event) => {
      const element = ref.current;
      if (!element?.open) return;
      if (event.type === "keydown") {
        if ((event as KeyboardEvent).key !== "Escape") return;
      } else if (element.contains(event.target as Node)) {
        return;
      }
      element.open = false;
    };

    // pointerdown rather than click: a mousedown that starts outside should
    // close the popover even if the button it lands on re-renders the row.
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, []);

  return ref;
}
