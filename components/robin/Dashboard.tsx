"use client";

import { useI18n } from "@/hooks/useI18n";
import { useEffect, useRef, useState } from "react";
import { localDate, parseLocalDate } from "@/extension/robin/dates";
import { AssistantBar } from "./AssistantBar";
import { CalendarPanel } from "./CalendarPanel";
import { WorkQueuePanel } from "./WorkQueuePanel";
import { PlannerPanel } from "./PlannerPanel";
import { AttentionPanel } from "./AttentionPanel";
import { JobsPanel } from "./JobsPanel";
import { LearningPanel } from "./LearningPanel";
import { LinksPanel } from "./LinksPanel";
import { TodoPanel } from "./TodoPanel";
import styles from "./Dashboard.module.css";
import { useIsSplitLayout } from "@/hooks/useIsMobile";

const SHORTCUTS = [
  { href: "#dashboard-todos", key: "robin.dashboard.todo", icon: "M9 6h11M9 12h11M9 18h11M3 6l1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2" },
  { href: "/dashboard/jobs", key: "robin.dashboard.apply", icon: "M8 6V4h8v2M3 7h18v13H3zM3 12h18M10 12v3h4v-3" },
  { href: "#fullstack-open", key: "robin.dashboard.practice", icon: "m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18" },
  { href: "#dashboard-links", key: "robin.dashboard.links", icon: "m10 13 4-4m-6 6-2 2a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m4 6a3 3 0 0 0 4 0l4-4a3 3 0 0 0-4-4l-2 2" },
];

// Small utilities belong here, not in the global workspace navigation.
const TOOLS = [
  { href: "/tools", key: "toolbox.title", icon: "M4 7h16v14H4zM8 7V3h8v4M4 12h16M10 10v4h4v-4" },
];

/**
 * Rendered on the client so the heading follows the viewer's clock. The panels
 * still bucket todos against the server's local date, which is where `due` was
 * written — see app/api/robin/todos/route.ts.
 */
function useLocalToday(): string | null {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setToday(localDate());
    update();
    // Cheap enough to just re-check every minute so the heading survives midnight.
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, []);
  return today;
}

function useLocalClock(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function DashboardClock({ locale }: { locale: string }) {
  const now = useLocalClock();
  const clock = now?.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }) ?? "";

  return (
    <time
      dateTime={now?.toISOString()}
      className="pi-eyebrow"
      suppressHydrationWarning
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {clock}
    </time>
  );
}

export function Dashboard() {
  const { t, locale } = useI18n();
  const today = useLocalToday();
  const desktop = useIsSplitLayout();
  const viewportRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const header = headerRef.current;
    if (!viewport || !header) return;
    const measure = () => {
      viewport.style.setProperty("--dashboard-sticky-top", `${header.offsetHeight + 16}px`);
      viewport.style.setProperty("--dashboard-rail-height", `${Math.max(120, viewport.clientHeight - header.offsetHeight - 32)}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(header);
    measure();
    return () => observer.disconnect();
  }, []);
  const heading = today
    ? parseLocalDate(today).toLocaleDateString(locale, {
      weekday: "long",
      month: "long",
      day: "numeric",
    })
    : "";

  return (
    // globals.css locks html/body to the viewport height with
    // overflow:hidden for the chat shell. This page is a document, so it
    // supplies its own scroll container rather than changing that shared rule.
    <div ref={viewportRef} className={`robin-page robin-page--sticky-top robin-dashboard flex-1 overflow-y-auto scroll-smooth motion-reduce:scroll-auto ${styles.viewport}`} style={{ minHeight: 0 }}>
      <header ref={headerRef} className="robin-dashboard-header sticky top-0" style={{ zIndex: "var(--z-sticky)" }}>
        <div className={`${styles.frame} px-4 py-2 desktop:px-6`}>
          <AssistantBar />
        </div>
      </header>

      <main className={`${styles.frame} flex flex-col gap-4 p-4 desktop:p-6`}>
        {/* pi's page head: an italic serif title over a tracked mono dateline. */}
        <div className="flex flex-wrap items-baseline gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl" style={{ fontStyle: "italic", fontWeight: 400, color: "var(--text)" }}>
              {t("sidebar.dashboard")}
            </h1>
            {/* Empty until the effect runs, so server and client markup agree. */}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="pi-eyebrow" suppressHydrationWarning>
                {heading}
              </p>
              <DashboardClock locale={locale} />
            </div>
          </div>
        </div>

        <nav aria-label={t("sidebar.dashboard")} className={`robin-dashboard-shortcuts ${styles.shortcuts}`}>
          {SHORTCUTS.map(({ href, key, icon }) => (
            <a key={href} href={href} className={`ui-action ${styles.shortcut}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icon} /></svg>
              {t(key)}
            </a>
          ))}
        </nav>

        <div className={styles.panels} data-dashboard-panels>
          <div className={styles.main}>
            <CalendarPanel />
            <PlannerPanel />
            <WorkQueuePanel />
            <AttentionPanel />
            <JobsPanel />
            <LearningPanel />
            <nav id="dashboard-tools" aria-labelledby="dashboard-tools-title" className={styles.tools}>
              <h2 id="dashboard-tools-title" className="pi-section-title">{t("robin.dashboard.tools")}</h2>
              {TOOLS.map(({ href, key, icon }) => (
                <a key={href} href={href} className={`ui-action ${styles.shortcut}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icon} /></svg>
                  {t(key)}
                </a>
              ))}
            </nav>
            <LinksPanel placement={desktop ? "other" : "all"} />
          </div>
          <aside className={styles.rail} aria-label={t("robin.todos.title")}>
            <TodoPanel embedded={desktop} />
            {desktop && <LinksPanel placement="daily" embedded />}
          </aside>
        </div>
      </main>
    </div>
  );
}
