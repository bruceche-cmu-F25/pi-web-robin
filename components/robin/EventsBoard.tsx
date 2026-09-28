"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { DashboardEvent } from "@/extension/robin/events";
import {
  TECH_EVENT_TOPICS,
  rateTechEventForFullStackAi,
  type TechEvent,
  type TechEventRating,
  type TechEventScanState,
  type TechEventSignal,
  type TechEventTopic,
} from "@/extension/robin/tech-events";
import { useI18n } from "@/hooks/useI18n";
import { mutate, usePolledResource } from "./usePolledResource";
import {
  Chip,
  EventCover,
  TOPIC_TONE,
  eventHref,
  formatDay,
  formatTime,
  localDay,
} from "./techEventView";
import styles from "./EventsBoard.module.css";

interface EventsResponse {
  events: TechEvent[];
  scan: TechEventScanState | null;
  scanning: boolean;
  today: string;
}

interface ScheduleResponse {
  events: DashboardEvent[];
  google?: { connected: boolean; error?: string };
}

type TopicFilter = TechEventTopic | "all";
type RatedEvent = TechEvent & { rating: TechEventRating };

/** How far ahead the day ribbon looks. Two weeks is as far as an evening gets planned. */
const RIBBON_DAYS = 14;

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function SignalChips({ signals, limit = 3 }: { signals: TechEventSignal[]; limit?: number }) {
  const { t } = useI18n();
  return (
    <>
      {signals.filter((signal) => !["approval", "sold-out", "schedule-conflict"].includes(signal)).slice(0, limit).map((signal) => (
        <Chip key={signal} label={t(`robin.events.signal.${signal}`)} tone={signal === "fullstack-ai" ? "accent" : undefined} />
      ))}
    </>
  );
}

function TopicChips({ topics }: { topics: TechEventTopic[] }) {
  const { t } = useI18n();
  return (
    <>
      {topics.slice(0, 3).map((topic) => (
        <Chip key={topic} label={t(`robin.events.topic.${topic}`)} color={TOPIC_TONE[topic]} />
      ))}
    </>
  );
}

function ScheduleStatus({ rating, ready, unavailable }: { rating: TechEventRating; ready: boolean; unavailable: boolean }) {
  const { t } = useI18n();
  if (!ready) return <Chip label={t(unavailable ? "robin.events.scheduleUnavailable" : "robin.events.scheduleChecking")} />;
  if (rating.conflicts.length === 0) return <Chip label={t("robin.events.noConflict")} tone="success" />;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <Chip label={t("robin.events.conflictCount", { count: String(rating.conflicts.length) })} tone="danger" />
      <span className="min-w-0 text-xs break-words" style={{ color: "var(--danger)" }} title={rating.conflicts.map((item) => item.title).join(", ")}>
        {t("robin.events.conflictsWith", { title: rating.conflicts.map((item) => item.title).slice(0, 2).join("、") })}
      </span>
    </span>
  );
}

function ScoreBadge({ value, large = false }: { value: number; large?: boolean }) {
  const { t } = useI18n();
  return (
    <span className={styles.scoreBadge} data-size={large ? "large" : undefined} title={t("robin.events.scoreMethod")}>
      <strong>{value.toFixed(1)}</strong>
      <small>{t("robin.events.overallScore")}</small>
    </span>
  );
}

function StatusChips({ event }: { event: RatedEvent }) {
  const { t } = useI18n();
  return (
    <>
      {event.saved && <Chip label={t("robin.events.savedMark")} tone="accent" />}
      {event.hidden && <Chip label={t("robin.events.hiddenMark")} />}
      {event.free && <Chip label={t("robin.events.free")} />}
      {event.soldOut && <Chip label={t("robin.events.soldOut")} tone="danger" />}
      {event.requiresApproval && <Chip label={t("robin.events.approval")} />}
    </>
  );
}

function placeLine(event: TechEvent, online: string): string {
  return event.online ? online : [event.venue, event.city].filter(Boolean).join(" · ");
}

interface CardActions {
  busy: boolean;
  pending: boolean;
  onSave: () => void;
  onHide: () => void;
}

function Actions({ event, busy, pending, onSave, onHide }: CardActions & { event: RatedEvent }) {
  const { t } = useI18n();
  return (
    <div className={styles.cardActions}>
      <button
        type="button"
        disabled={busy}
        onClick={onSave}
        className="ui-action pi-eyebrow min-h-11 min-w-11 disabled:opacity-40"
        data-state={event.saved ? "accent" : undefined}
        aria-pressed={!!event.saved}
        aria-label={`${event.saved ? t("robin.events.unsave") : t("robin.events.save")}: ${event.title}`}
      >
        {pending ? t("robin.events.saving") : event.saved ? `★ ${t("robin.events.unsave")}` : `☆ ${t("robin.events.save")}`}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onHide}
        className="ui-action pi-eyebrow min-h-11 min-w-11 disabled:opacity-40"
        data-hover={event.hidden ? undefined : "danger"}
        aria-label={`${event.hidden ? t("robin.events.unhide") : t("robin.events.hide")}: ${event.title}`}
      >
        {event.hidden ? t("robin.events.unhide") : t("robin.events.hide")}
      </button>
    </div>
  );
}

/** A recommendation: cover first, because the shortlist is where you decide. */
function FeaturedCard({
  event,
  rank,
  locale,
  scheduleReady,
  scheduleUnavailable,
  ...actions
}: CardActions & {
  event: RatedEvent;
  rank: number;
  locale: string;
  scheduleReady: boolean;
  scheduleUnavailable: boolean;
}) {
  const { t } = useI18n();
  const place = placeLine(event, t("robin.events.online"));
  return (
    <article className={styles.featured} data-rank={rank} data-saved={event.saved || undefined} aria-busy={actions.pending}>
      <Link href={eventHref(event.id)} className={styles.featuredMedia} tabIndex={-1} aria-hidden="true">
        <EventCover event={event} eager={rank === 1} />
        <span className={styles.rank} aria-hidden="true">{rank}</span>
      </Link>
      <div className={styles.featuredBody}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <time className="pi-eyebrow" dateTime={event.startAt} style={{ color: "var(--accent)" }}>
            {formatDay(localDay(event), locale, "weekday")} · {formatDay(localDay(event), locale, "compact")} · {formatTime(event, event.startAt, locale)}
          </time>
          <ScoreBadge value={event.rating.overall} large={rank === 1} />
        </div>
        <h3 className={styles.featuredTitle}>
          <Link href={eventHref(event.id)} className={styles.eventLink} aria-label={t("robin.events.rank", { rank: String(rank) }) + ": " + event.title}>
            {event.title}
          </Link>
        </h3>
        <p className={styles.meta}>{[event.host, place].filter(Boolean).join(" · ")}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <TopicChips topics={event.topics} />
          <SignalChips signals={event.rating.signals} limit={2} />
          <StatusChips event={event} />
        </div>
        <div className={styles.featuredFooter}>
          <ScheduleStatus rating={event.rating} ready={scheduleReady} unavailable={scheduleUnavailable} />
          <Actions event={event} {...actions} />
        </div>
      </div>
    </article>
  );
}

/** One row of the full list: dense, scannable, and a link to the event's page. */
function EventRow({
  event,
  locale,
  scheduleReady,
  scheduleUnavailable,
  ...actions
}: CardActions & {
  event: RatedEvent;
  locale: string;
  scheduleReady: boolean;
  scheduleUnavailable: boolean;
}) {
  const { t } = useI18n();
  const place = placeLine(event, t("robin.events.online"));
  const tone = TOPIC_TONE[event.topics[0] ?? "swe"];
  return (
    <article
      className={styles.row}
      data-saved={event.saved || undefined}
      data-hidden={event.hidden || undefined}
      aria-busy={actions.pending}
      style={{ "--row-tone": tone } as React.CSSProperties}
    >
      <time className={styles.rowTime} dateTime={event.startAt}>
        <strong>{formatTime(event, event.startAt, locale, false)}</strong>
        <span>{event.online ? t("robin.events.online") : event.city?.split(",")[0] ?? ""}</span>
      </time>
      <Link href={eventHref(event.id)} className={styles.rowThumb} tabIndex={-1} aria-hidden="true">
        <EventCover event={event} />
      </Link>
      <div className={styles.rowMain}>
        <h4 className={styles.rowTitle}>
          <Link href={eventHref(event.id)} className={styles.eventLink}>{event.title}</Link>
        </h4>
        <p className={styles.meta} title={[event.host, place].filter(Boolean).join(" · ")}>
          {[event.host, place].filter(Boolean).join(" · ")}
          {typeof event.guests === "number" && event.guests >= 25 && (
            <span className="tabular-nums"> · {t("robin.events.guests", { count: String(event.guests) })}</span>
          )}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <TopicChips topics={event.topics} />
          <SignalChips signals={event.rating.signals} limit={2} />
          <StatusChips event={event} />
        </div>
        <div className={styles.rowFooter}>
          <ScheduleStatus rating={event.rating} ready={scheduleReady} unavailable={scheduleUnavailable} />
          <a href={event.url} target="_blank" rel="noopener noreferrer" className="ui-action pi-eyebrow min-h-11" title={event.url}>
            {t("robin.events.openOnLuma")} ↗
          </a>
          <Actions event={event} {...actions} />
        </div>
      </div>
      <div className={styles.rowScore}>
        <ScoreBadge value={event.rating.overall} />
      </div>
    </article>
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className={styles.stat}>
      <strong style={accent ? { color: "var(--accent)" } : undefined}>{value}</strong>
      <span className="pi-eyebrow">{label}</span>
    </div>
  );
}

/** A scored shortlist of Bay Area Full-stack AI events, checked against the calendar. */
export function EventsBoard() {
  const { t, locale } = useI18n();
  const eventResource = usePolledResource<EventsResponse>("/api/robin/tech-events", 30_000);
  const scheduleResource = usePolledResource<ScheduleResponse>("/api/robin/events", 30_000);

  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<TopicFilter>("all");
  const [day, setDay] = useState<string | null>(null);
  const [savedOnly, setSavedOnly] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const scheduleUnavailable = !!(scheduleResource.error || scheduleResource.data?.google?.error);
  const scheduleReady = scheduleResource.data !== null && !scheduleUnavailable;
  const schedule = useMemo(() => scheduleResource.data?.events ?? [], [scheduleResource.data]);
  const events = useMemo(() => eventResource.data?.events ?? [], [eventResource.data]);
  const today = eventResource.data?.today ?? null;
  const rated = useMemo<RatedEvent[]>(() => events.map((event) => ({
    ...event,
    rating: rateTechEventForFullStackAi(event, schedule),
  })), [events, schedule]);
  const shown = useMemo(() => rated.filter((event) => !event.hidden), [rated]);

  const visible = useMemo(() => rated.filter((event) => {
    if (event.hidden && !showHidden) return false;
    if (savedOnly && !event.saved) return false;
    if (topic !== "all" && !event.topics.includes(topic)) return false;
    if (day && localDay(event) !== day) return false;
    const text = [event.title, event.host, event.city, event.venue, ...event.matched].join(" ").toLocaleLowerCase(locale);
    return text.includes(query.trim().toLocaleLowerCase(locale));
  }), [rated, showHidden, savedOnly, topic, day, query, locale]);

  const hasFilters = query !== "" || topic !== "all" || savedOnly || showHidden || day !== null;
  const clearFilters = () => {
    setQuery("");
    setTopic("all");
    setDay(null);
    setSavedOnly(false);
    setShowHidden(false);
  };

  const recommendations = useMemo(() => scheduleReady
    ? rated
      .filter((event) => !event.hidden && !event.soldOut && event.rating.conflicts.length <= 1 && event.rating.overall >= 3.5)
      .sort((a, b) => b.rating.overall - a.rating.overall || a.startAt.localeCompare(b.startAt))
      .slice(0, 3)
    : [], [rated, scheduleReady]);

  const topicCounts = useMemo(() => {
    const counts = new Map<TopicFilter, number>([["all", shown.length]]);
    for (const event of shown) for (const candidate of event.topics) counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
    return counts;
  }, [shown]);

  const ribbon = useMemo(() => {
    if (!today) return [];
    const perDay = new Map<string, { count: number; saved: number }>();
    for (const event of shown) {
      const key = localDay(event);
      const entry = perDay.get(key) ?? { count: 0, saved: 0 };
      entry.count += 1;
      if (event.saved) entry.saved += 1;
      perDay.set(key, entry);
    }
    return Array.from({ length: RIBBON_DAYS }, (_, index) => {
      const key = addDays(today, index);
      return { day: key, ...(perDay.get(key) ?? { count: 0, saved: 0 }) };
    });
  }, [shown, today]);
  const ribbonMax = Math.max(1, ...ribbon.map((entry) => entry.count));
  const thisWeek = ribbon.slice(0, 7).reduce((sum, entry) => sum + entry.count, 0);
  const savedCount = shown.filter((event) => event.saved).length;

  const days = useMemo(() => {
    const grouped = new Map<string, RatedEvent[]>();
    for (const event of visible) {
      const key = localDay(event);
      const list = grouped.get(key) ?? [];
      list.push(event);
      grouped.set(key, list);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, items]) => [
      key,
      items.sort((a, b) => a.startAt.localeCompare(b.startAt) || b.rating.overall - a.rating.overall),
    ] as const);
  }, [visible]);

  const patch = async (event: TechEvent, change: { saved?: boolean; hidden?: boolean }) => {
    setBusyId(event.id);
    setActionError(null);
    try {
      await mutate("/api/robin/tech-events", "PATCH", { id: event.id, ...change });
      await eventResource.refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyId(null);
    }
  };

  const scanNow = async () => {
    setScanning(true);
    setActionError(null);
    try {
      await mutate("/api/robin/tech-events/scan", "POST", {});
      await eventResource.refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setScanning(false);
    }
  };

  const pickDay = (key: string) => {
    setDay((current) => current === key ? null : key);
    document.getElementById("all-upcoming-events")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const scan = eventResource.data?.scan ?? null;
  const running = scanning || eventResource.data?.scanning === true;
  const failures = (scan?.sources ?? []).filter((source) => source.error);
  const error = actionError ?? eventResource.error ?? scheduleResource.error ?? scheduleResource.data?.google?.error;
  const loaded = !!eventResource.data;
  const cardProps = (event: RatedEvent) => ({
    busy: busyId !== null,
    pending: busyId === event.id,
    onSave: () => void patch(event, { saved: !event.saved }),
    onHide: () => void patch(event, { hidden: !event.hidden }),
  });

  return (
    <div className={`robin-page robin-dashboard flex-1 overflow-y-auto ${styles.page}`} style={{ minHeight: 0 }}>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 desktop:p-6">
        <header className={styles.hero}>
          <div className="flex min-w-0 flex-col gap-2">
            <span className="pi-eyebrow" style={{ color: "var(--accent)" }}>{t("robin.events.kicker")}</span>
            <h1 className={styles.pageTitle}>{t("robin.events.title")}</h1>
            <p className="max-w-xl text-sm" style={{ color: "var(--text-muted)" }}>{t("robin.events.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="pi-eyebrow">
              {scan?.finishedAt
                ? t("robin.events.lastScan", { date: new Date(scan.finishedAt).toLocaleDateString(locale) })
                : t("robin.events.neverScanned")}
            </span>
            <button
              type="button"
              onClick={() => void scanNow()}
              disabled={running || eventResource.loading}
              className="ui-action pi-chrome-label pi-bracket min-h-11 text-xs disabled:opacity-40"
              data-state="accent"
            >
              {running ? t("robin.events.scanning") : t("robin.events.scan")}
            </button>
          </div>
          <div className={styles.stats}>
            <Stat value={loaded ? String(shown.length) : "—"} label={t("robin.events.statUpcoming")} />
            <Stat value={loaded ? String(thisWeek) : "—"} label={t("robin.events.statThisWeek")} />
            <Stat value={loaded ? String(savedCount) : "—"} label={t("robin.events.statSaved")} accent={savedCount > 0} />
            <Stat value={loaded && scheduleReady ? String(recommendations.length) : "—"} label={t("robin.events.noConflictPicks")} accent />
          </div>
        </header>

        {error && (
          <div className={styles.error} role="alert">
            <p className="min-w-0 flex-1 break-words text-sm">{error}</p>
            <button type="button" className="ui-action pi-eyebrow min-h-11" onClick={() => { void eventResource.refresh(); void scheduleResource.refresh(); setActionError(null); }}>
              {t("robin.events.retry")}
            </button>
          </div>
        )}
        {running && <p role="status" className={styles.notice}>{t("robin.events.scanningNote")}</p>}

        {ribbon.length > 0 && (
          <nav className={styles.ribbon} aria-label={t("robin.events.ribbonLabel")}>
            {ribbon.map((entry) => (
              <button
                key={entry.day}
                type="button"
                className={styles.ribbonDay}
                data-today={entry.day === today || undefined}
                data-selected={entry.day === day || undefined}
                data-empty={entry.count === 0 || undefined}
                data-weekend={[0, 6].includes(new Date(`${entry.day}T12:00:00Z`).getUTCDay()) || undefined}
                aria-pressed={entry.day === day}
                disabled={entry.count === 0}
                onClick={() => pickDay(entry.day)}
                aria-label={t("robin.events.ribbonDay", { day: formatDay(entry.day, locale), count: String(entry.count) })}
              >
                <span className="pi-eyebrow">{entry.day === today ? t("robin.events.today") : formatDay(entry.day, locale, "weekday")}</span>
                <strong>{Number(entry.day.slice(8))}</strong>
                <span className={styles.ribbonBar} aria-hidden="true">
                  <span style={{ height: `${(entry.count / ribbonMax) * 100}%` }} />
                </span>
                <span className={styles.ribbonCount}>{entry.count || "·"}{entry.saved > 0 ? " ★" : ""}</span>
              </button>
            ))}
          </nav>
        )}

        <section className="flex flex-col gap-3" aria-labelledby="event-recommendations">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="pi-eyebrow" style={{ color: "var(--accent)" }}>{t("robin.events.shortlistKicker")}</span>
              <h2 id="event-recommendations" className={styles.sectionTitle}>{t("robin.events.shortlistTitle")}</h2>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("robin.events.shortlistExplain")} {t("robin.events.scoreMethod")}</p>
            </div>
          </div>

          {eventResource.loading || !scheduleReady ? (
            <div className={styles.empty} role="status">
              {t(eventResource.loading ? "robin.events.loading" : scheduleUnavailable ? "robin.events.scheduleUnavailable" : "robin.events.scheduleChecking")}
            </div>
          ) : !eventResource.data && eventResource.error ? (
            <p className={styles.empty}>{t("robin.events.loadFailed")}</p>
          ) : recommendations.length === 0 ? (
            <div className={styles.empty}>{t("robin.events.noRecommendations")}</div>
          ) : (
            <div className={styles.recommendations} data-count={recommendations.length}>
              {recommendations.map((event, index) => (
                <FeaturedCard
                  key={`recommended:${event.id}`}
                  event={event}
                  rank={index + 1}
                  locale={locale}
                  scheduleReady={scheduleReady}
                  scheduleUnavailable={scheduleUnavailable}
                  {...cardProps(event)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="pi-card flex flex-col gap-3 p-4" aria-labelledby="all-upcoming-events">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="all-upcoming-events" tabIndex={-1} className={styles.sectionTitle}>{t("robin.events.allUpcoming")}</h2>
            <span className="pi-eyebrow" role="status">{t("robin.events.resultCount", { count: loaded ? String(visible.length) : "—" })}</span>
          </header>

          <label className="flex flex-col gap-2">
            <span className="sr-only">{t("robin.events.search")}</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("robin.events.searchPlaceholder")} className="min-h-11 w-full px-3 text-sm" />
          </label>
          <div className={styles.filters} role="group" aria-label={t("robin.events.filters")}>
            {(["all", ...TECH_EVENT_TOPICS] as TopicFilter[]).map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() => setTopic(candidate)}
                className="ui-action ui-action--chip pi-eyebrow min-h-11 px-3 py-2"
                data-state={candidate === topic ? "accent" : "muted"}
                aria-pressed={candidate === topic}
              >
                {candidate !== "all" && <span aria-hidden="true" className={styles.topicDot} style={{ background: TOPIC_TONE[candidate] }} />}
                {t(`robin.events.topic.${candidate}`)}
                <span className="tabular-nums" style={{ opacity: 0.7 }}> {topicCounts.get(candidate) ?? 0}</span>
              </button>
            ))}
            <span className="flex flex-wrap items-center gap-2 desktop:ml-auto">
              <button
                type="button"
                onClick={() => setSavedOnly((on) => !on)}
                className="ui-action ui-action--chip pi-eyebrow min-h-11 px-3 py-2"
                data-state={savedOnly ? "accent" : "muted"}
                aria-pressed={savedOnly}
              >
                {t("robin.events.savedOnly")}
              </button>
              <button
                type="button"
                onClick={() => setShowHidden((on) => !on)}
                className="ui-action ui-action--chip pi-eyebrow min-h-11 px-3 py-2"
                data-state={showHidden ? "accent" : "muted"}
                aria-pressed={showHidden}
              >
                {t("robin.events.showHidden")}
              </button>
            </span>
          </div>

          {(day || hasFilters) && (
            <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
              {day ? (
                <span className="pi-eyebrow" style={{ color: "var(--accent)" }}>{t("robin.events.dayFilter", { day: formatDay(day, locale) })}</span>
              ) : <span className="pi-eyebrow">{t("robin.events.sortedWithinDay")}</span>}
              {hasFilters && <button type="button" className="ui-action pi-eyebrow min-h-11" onClick={clearFilters}>{t("robin.events.clearFilters")}</button>}
            </div>
          )}

          {eventResource.loading ? (
            <p className={styles.empty} role="status">{t("robin.events.loading")}</p>
          ) : !eventResource.data && eventResource.error ? (
            <p className={styles.empty}>{t("robin.events.loadFailed")}</p>
          ) : days.length === 0 ? (
            <div className={styles.empty}>
              <p>{running ? t("robin.events.scanningNote") : hasFilters ? t("robin.events.emptyFiltered") : t("robin.events.empty")}</p>
              <p className="mt-2 text-xs">{hasFilters ? t("robin.events.filterHint") : t("robin.events.cadence")}</p>
            </div>
          ) : days.map(([key, dayEvents]) => (
            <section key={key} className={styles.dayGroup} aria-labelledby={`events-${key}`}>
              <h3 id={`events-${key}`} className={styles.dayHeader} data-today={key === today || undefined}>
                <span>{key === today ? t("robin.events.today") : formatDay(key, locale)}</span>
                <span className="tabular-nums" style={{ color: "var(--text-muted)" }}>{t("robin.events.resultCount", { count: String(dayEvents.length) })}</span>
              </h3>
              <div className={styles.eventList}>
                {dayEvents.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    locale={locale}
                    scheduleReady={scheduleReady}
                    scheduleUnavailable={scheduleUnavailable}
                    {...cardProps(event)}
                  />
                ))}
              </div>
            </section>
          ))}
        </section>

        <details className={`pi-card p-4 ${styles.sources}`}>
          <summary className="pi-eyebrow min-h-11 content-center">{t("robin.events.sources")}{failures.length > 0 ? ` · ${t("robin.events.sourceFailures", { count: String(failures.length) })}` : ""}</summary>
          {scan ? (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("robin.events.scanSummary", {
                seen: String(scan.seen),
                kept: String(scan.kept),
                sources: String(scan.sources.length),
              })}
            </p>
          ) : <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("robin.events.neverScanned")}</p>}
          {failures.map((source) => (
            <p key={source.id} className="text-xs" style={{ color: "var(--danger)" }}>{source.name}: {source.error}</p>
          ))}
          <p className="pi-eyebrow mt-2">{t("robin.events.cadence")}</p>
        </details>
      </main>
    </div>
  );
}
