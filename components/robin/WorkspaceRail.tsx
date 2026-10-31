"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./WorkspaceRail.module.css";

/** One resource surface, like Dashboard's Todo rail; native disclosure on narrow screens. */
export function WorkspaceRail({ title, children }: { title: string; children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1150px)");
    const sync = () => {
      const element = details.current;
      if (!element) return;
      if (media.matches && element.contains(document.activeElement)) element.querySelector("summary")?.focus({ preventScroll: true });
      element.open = !media.matches;
    };
    sync(); media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return <aside className={`robin-workspace-rail ${styles.rail}`} aria-label={title}>
    <details ref={details} open>
      <summary className={styles.title}>{title}</summary>
      <div className={styles.body}>{children}</div>
    </details>
  </aside>;
}
