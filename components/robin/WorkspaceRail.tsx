"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./WorkspaceRail.module.css";

/** One resource surface, like Dashboard's Todo rail; native disclosure on narrow screens. */
export function WorkspaceRail({ title, children, hidden = false, expandedOnMobile = false }: { title: string; children: ReactNode; hidden?: boolean; expandedOnMobile?: boolean }) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1150px)");
    const sync = () => {
      const element = details.current;
      if (!element) return;
      if (media.matches && element.contains(document.activeElement)) element.querySelector("summary")?.focus({ preventScroll: true });
      element.open = expandedOnMobile || !media.matches;
    };
    sync(); media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [expandedOnMobile]);
  return <aside className={`robin-workspace-rail ${styles.rail}`} aria-label={title} hidden={hidden}>
    <details ref={details} open>
      <summary className={styles.title}>{title}</summary>
      <div className={styles.body}>{children}</div>
    </details>
  </aside>;
}
