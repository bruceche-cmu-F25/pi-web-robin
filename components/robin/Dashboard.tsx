"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { localDate, parseLocalDate } from "@/extension/robin/dates";
import { useIsSplitLayout } from "@/hooks/useIsMobile";
import { writeUrlState } from "@/lib/url-state";
import { AssistantBar } from "./AssistantBar";
import { CompanionLauncher } from "./CompanionLauncher";
import { CalendarPanel } from "./CalendarPanel";
import { WorkQueuePanel } from "./WorkQueuePanel";
import { PlannerPanel } from "./PlannerPanel";
import { AttentionPanel } from "./AttentionPanel";
import { JobsPanel } from "./JobsPanel";
import { LearningPanel } from "./LearningPanel";
import { LinksPanel } from "./LinksPanel";
import { TodoPanel } from "./TodoPanel";
import { DailyOverview } from "./DailyOverview";
import { BriefBoard } from "./BriefBoard";
import { ChatReviews } from "./ChatReviews";
import { usePolledResource } from "./usePolledResource";
import type { SessionReviewsResponse } from "@/lib/session-reviews";
import { DashboardDirectory } from "./DashboardDirectory";
import { DashboardDisclosure, DashboardPane } from "./DashboardDisclosure";
import { DASHBOARD_VIEWS, dashboardView, type DashboardView } from "./dashboard-view";
import { useBoardNavigation } from "./useBoardNavigation";
import styles from "./Dashboard.module.css";

const ICONS: Record<DashboardView, string> = {
  daily: "m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7",
  calendar: "M4 5h16v16H4zM4 10h16M8 2v6m8-6v6",
  todos: "m3 6 2 2 3-4M11 6h10M3 13h5m3 0h10M3 20h5m3 0h10",
  more: "M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z",
};

export function Dashboard() {
  const { t, locale } = useI18n();
  const desktop = useIsSplitLayout();
  const reviews = usePolledResource<SessionReviewsResponse>("/api/sessions/reviews", 2500, !desktop);
  const reviewCount = reviews.data?.reviews?.length ?? 0;
  const params = useSearchParams();
  const [hash, setHash] = useState("");
  const [today, setToday] = useState<string | null>(null);
  const view = dashboardView(params, hash);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const workspace = workspaceRef.current, header = headerRef.current, footer = footerRef.current;
    if (!workspace || !header || typeof ResizeObserver === "undefined") return;
    // Measure actual chrome, including safe areas, wrapping and keyboard hiding.
    // CSS alone enables overlap in Glass; ordinary themes keep their flow layout.
    const measure = () => {
      workspace.style.setProperty("--dashboard-header-height", `${header.offsetHeight}px`);
      workspace.style.setProperty("--dashboard-footer-height", `${footer?.offsetHeight ?? 0}px`);
      workspace.dataset.chromeMeasured = "true";
    };
    const observer = new ResizeObserver(measure);
    observer.observe(header, { box: "border-box" });
    if (footer) observer.observe(footer, { box: "border-box" });
    measure();
    return () => {
      observer.disconnect(); delete workspace.dataset.chromeMeasured;
      workspace.style.removeProperty("--dashboard-header-height");
      workspace.style.removeProperty("--dashboard-footer-height");
    };
  }, [desktop]);

  const scrollKey = new URLSearchParams({ view: desktop ? "desktop" : view, ...(hash ? { anchor: hash } : {}), ...(view === "todos" ? { tasks: params.get("tasks") ?? "all" } : {}) });
  const { scrollRef } = useBoardNavigation("/dashboard", scrollKey.toString(), true);
  useEffect(() => {
    const update = () => setToday(localDate()); update();
    const timer = setInterval(update, 60_000);
    const hashChanged = () => setHash(window.location.hash);
    hashChanged(); window.addEventListener("hashchange", hashChanged);
    return () => { clearInterval(timer); window.removeEventListener("hashchange", hashChanged); };
  }, []);
  useEffect(() => { setHash(window.location.hash); }, [params]);
  useEffect(() => {
    // Explicit view separates phone navigation from a remembered calendar mode.
    if (!params.get("view")) writeUrlState({ view: dashboardView(params, window.location.hash) }, "replace");
  }, [params]);
  const select = (next: DashboardView) => {
    const url = new URL(window.location.href);
    url.hash = ""; url.searchParams.set("view", next);
    for (const key of ["todo", "event", "add", "plan"]) url.searchParams.delete(key);
    // Home always opens today; its deliberate date browsing is independent of Calendar.
    if (next === "daily") url.searchParams.delete("dailyDate");
    if (next === "calendar") url.searchParams.set("calendar", "day");
    window.history.pushState(null, "", url); setHash("");
  };
  const launch = (mode: "search" | "execute") => window.dispatchEvent(new CustomEvent("robin-assistant-open", { detail: mode }));
  const contextHref = (href: string) => {
    const url = new URL(href, "https://robin.invalid");
    for (const key of ["session", "cwd"]) { const value = params.get(key); if (value) url.searchParams.set(key, value); }
    return url.pathname + url.search;
  };
  let displayDate = today;
  if (!desktop && (view === "daily" || view === "calendar")) {
    const requested = params.get(view === "daily" ? "dailyDate" : "date");
    try { if (requested) { parseLocalDate(requested); displayDate = requested; } } catch { /* Invalid links retain today's date. */ }
  }
  const heading = displayDate ? parseLocalDate(displayDate).toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" }) : "";
  const homeDate = displayDate ? parseLocalDate(displayDate).toLocaleDateString(locale, { month: "short", day: "numeric" }) : "";
  const homeWeekday = displayDate ? parseLocalDate(displayDate).toLocaleDateString(locale, { weekday: "long" }) : "";
  // Chat owns a different shell: keep RobinMargin's native document boundary.
  const chatLink = <a href={contextHref("/")} data-dashboard-chat className={`ui-action ${styles.chatLink}`} aria-label={reviewCount && !reviews.error ? `${t("daily.chat")} · ${t("daily.reviews.count", { count: String(reviewCount) })}` : undefined}>
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2v-10a9 9 0 0 1 18 0Z" /><path d="M7 9h8M7 13h5" /></svg>
    <span>{t("daily.chat")}</span>
    {reviewCount > 0 && !reviews.error && <span className={styles.chatBadge} aria-hidden="true">{reviewCount > 99 ? "99+" : reviewCount}</span>}
  </a>;
  return <div ref={workspaceRef} className={`robin-dashboard ${styles.workspace}`}>
    <header ref={headerRef} className={`robin-dashboard-header ${styles.header}`}>
      <DashboardPane id="dashboard-desktop-assistant" active={desktop} className={`${styles.frame} ${styles.desktopToolbar}`}>
        <div className={styles.desktopSearch}><AssistantBar active={desktop} /></div>
      </DashboardPane>
      {!desktop && <section className={styles.mobileHead} aria-label={t("daily.navigation")}>
        <div className={styles.pageTitle}>
          {view === "daily" ? <><p>{homeWeekday}</p><h1 className={styles.dateTitle} aria-live="polite"><time dateTime={displayDate ?? undefined} data-display-date={displayDate}>{homeDate}</time></h1></>
            : <>{view !== "calendar" && <p>{heading}</p>}<h1>{t(`daily.view.${view}`)}</h1></>}
        </div>
        <div className={`robin-dashboard-toolbar ${styles.toolbar}`}>
          {chatLink}
          <button type="button" className="ui-action" onClick={() => launch("search")} aria-label={t("daily.search")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
          </button>
        </div>
        <button type="button" className={styles.agentEntry} onClick={() => launch("execute")} aria-haspopup="dialog">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h2m3 0h2m3 0h1M7 13h10m-7 3h4" /></svg>
          <span>{t("daily.askRobin")}</span>
          <svg className={styles.agentArrow} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
        </button>
      </section>}
    </header>
    <div ref={scrollRef} className={`robin-page flex-1 overflow-y-auto ${styles.viewport}`}>
      <main className={styles.frame}>
        {desktop && <div className={styles.desktopHead}>
          <h1>{t("daily.navigation")}</h1>
          <div className={styles.desktopHeadActions}>
            <p>{heading}</p>
            <Link href={contextHref("/tools")} prefetch={false} className={`ui-action ui-action--outline ${styles.desktopToolLink}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 6a5 5 0 00-6 6L3 17a3 3 0 004 4l5-5a5 5 0 006-6l-3 3-4-4z" /></svg>
              {t("toolbox.shortcut")}
            </Link>
          </div>
        </div>}
        {desktop && <div className={styles.desktopBrief}><BriefBoard compact today={today ?? ""} /></div>}
        <DashboardPane id="dashboard-daily-view" active={!desktop && view === "daily"}>
          <ChatReviews resource={reviews} />
          <DailyOverview />
        </DashboardPane>
        <div className={styles.panels}>
          <DashboardPane id="dashboard-calendar-view" active={desktop || view === "calendar"} className={styles.calendarPane}>
            <CalendarPanel />
          </DashboardPane>
          <DashboardPane id="dashboard-todos-view" active={desktop || view === "todos"} className={styles.rail}>
            {desktop && <LinksPanel placement="daily" embedded />}
            <TodoPanel embedded={desktop} />
          </DashboardPane>
          <DashboardPane id="dashboard-more-view" active={desktop || view === "more"} className={styles.extras}>
            {!desktop && <><DashboardDirectory href={contextHref} /><h2 className={styles.inlineToolsTitle}>{t("daily.inlineTools")}</h2></>}
            <PlannerPanel compact={!desktop} />
            <DashboardDisclosure id="dashboard-work-queue" title={t(desktop ? "daily.focusPreview" : "daily.queue")} description={t("daily.queueHint")}><WorkQueuePanel /></DashboardDisclosure>
            {desktop ? <>
              <AttentionPanel />
              <LearningPanel homePreview />
              <JobsPanel />
              <LinksPanel placement="other" embedded />
            </> : <>
              <DashboardDisclosure id="dashboard-links" title={t("daily.linksAll")} description={t("daily.linksHint")}><LinksPanel placement="all" /></DashboardDisclosure>
              <DashboardDisclosure id="fullstack-open" title={t("daily.learningPreview")} description={t("daily.learningHint")}><LearningPanel /></DashboardDisclosure>
              <DashboardDisclosure id="dashboard-jobs" title={t("daily.jobsPreview")} description={t("daily.jobsHint")}><JobsPanel /></DashboardDisclosure>
            </>}
          </DashboardPane>
        </div>
      </main>
    </div>
    {!desktop && <footer ref={footerRef} className={styles.mobileFooter}>
      <nav className={`robin-dashboard-dock ${styles.bottomNav}`} aria-label={t("daily.navigation")}>
        {DASHBOARD_VIEWS.map((key, index) => <Fragment key={key}>
          {index === 2 && <CompanionLauncher />}
          <button type="button" className="ui-action" data-view={key} aria-current={view === key ? "page" : undefined} aria-controls={`dashboard-${key}-view`} onClick={() => select(key)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICONS[key]} /></svg><span>{t(`daily.view.${key}`)}</span>
          </button>
        </Fragment>)}
      </nav>
    </footer>}
  </div>;
}
