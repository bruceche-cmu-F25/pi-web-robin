"use client";

import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ResourceActivity } from "./usePolledResource";
import { useSearchParams } from "next/navigation";
import styles from "./Dashboard.module.css";

/** Preferences are browser-local; hidden content keeps drafts but suspends polling. */
export function DashboardDisclosure({ id, title, description, children, initialOpen = false }: {
  id: string; title: string; description?: string; children: ReactNode; initialOpen?: boolean;
}) {
  const parentActive = useContext(ResourceActivity);
  const params = useSearchParams();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(initialOpen);
  const [ready, setReady] = useState(false);
  const [visited, setVisited] = useState(initialOpen);
  useEffect(() => {
    try { const value = localStorage.getItem(`robin-disclosure:${id}`); if (value !== null) { setOpen(value === "open"); if (value === "open") setVisited(true); } } catch { /* Optional preference. */ }
    if (window.location.hash === `#${id}`) { setOpen(true); setVisited(true); }
    setReady(true);
  }, [id]);
  useEffect(() => {
    let frame = 0;
    const reveal = () => {
      if (parentActive && window.location.hash === `#${id}`) {
        setOpen(true); setVisited(true);
        frame = requestAnimationFrame(() => {
          detailsRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
          detailsRef.current?.querySelector("summary")?.focus({ preventScroll: true });
        });
      }
    };
    reveal(); window.addEventListener("hashchange", reveal);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("hashchange", reveal); };
  }, [id, params, parentActive]);
  return <details ref={detailsRef} className={styles.disclosure} data-disclosure={id} open={open} onToggle={(event) => {
    const next = event.currentTarget.open;
    setOpen(next); if (next) setVisited(true);
    if (ready) try { localStorage.setItem(`robin-disclosure:${id}`, next ? "open" : "closed"); } catch { /* Keep live choice. */ }
  }}>
    <summary className="ui-action"><span className={styles.disclosureCopy}><span>{title}</span>{description && <small>{description}</small>}</span></summary>
    <ResourceActivity value={parentActive && open}>{(open || visited) && children}</ResourceActivity>
  </details>;
}

export function DashboardPane({ active, children, className, id }: { active: boolean; children: ReactNode; className?: string; id: string }) {
  const [visited, setVisited] = useState(active);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  return <div id={id} hidden={!active} className={className}><ResourceActivity value={active}>{(active || visited) && children}</ResourceActivity></div>;
}
