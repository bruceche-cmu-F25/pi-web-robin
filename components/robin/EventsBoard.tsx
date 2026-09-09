"use client";

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

function localDay(event: TechEvent): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      ...(event.timezone ? { timeZone: event.timezone } : {}),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(event.startAt));
  } catch {
    return event.startAt.slice(0, 10);
  }
}

function formatTime(event: TechEvent, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      ...(event.timezone ? { timeZone: event.timezone } : {}),
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(event.startAt));
  } catch {
    return "";
  }
}

function formatDay(day: string, locale: string, compact = false): string {
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(locale, {
    timeZone: "UTC",
    ...(compact ? { month: "short", day: "numeric" } : { weekday: "long", month: "short", day: "numeric" }),
  });
}

function Chip({ label, tone }: { label: string; tone?: "accent" | "danger" | "success" | "muted" }) {
  const color = tone === "accent"
    ? "var(--accent)"
    : tone === "danger"
      ? "color-mix(in srgb, var(--danger) 80%, var(--text))"
      : tone === "success"
        ? "color-mix(in srgb, var(--success) 65%, var(--text))"
        : "var(--text-muted)";
  return (
    <span
      className="pi-eyebrow inline-flex shrink-0 items-center gap-1 border px-1.5 py-0.5"
      style={{
        color,
        borderColor: tone ? `color-mix(in srgb, ${color} 45%, var(--border))` : "var(--border)",
        background: tone ? `color-mix(in srgb, ${color} 8%, transparent)` : "var(--bg-panel)",
      }}
    >
      {label}
    </span>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <span className="pi-eyebrow block" title={label}>{label}</span>
      <strong
        className="mt-0.5 block text-lg tabular-nums"
        style={{ color: "var(--text)", fontWeight: 600 }}
      >
        {value.toFixed(1)}
      </strong>
      <div className="mt-1 h-1 overflow-hidden" style={{ background: "var(--border)" }} aria-hidden="true">
        <div
          className="h-full"
          style={{ width: `${value * 20}%`, background: "var(--accent)" }}
        />
      </div>
    </div>
  );
}

function SignalChips({ signals }: { signals: TechEventSignal[] }) {
  const { t } = useI18n();
  return (
    <>
      {signals.filter((signal) => !["approval", "sold-out", "schedule-conflict"].includes(signal)).slice(0, 3).map((signal) => (
        <Chip key={signal} label={t(`robin.events.signal.${signal}`)} tone={signal === "fullstack-ai" ? "accent" : undefined} />
      ))}
    </>
  );
}

function ScheduleStatus({ rating, ready, unavailable }: { rating: TechEventRating; ready: boolean; unavailable: boolean }) {
  const { t } = useI18n();
  if (!ready) return <Chip label={t(unavailable ? "robin.events.scheduleUnavailable" : "robin.events.scheduleChecking")} />;
  if (rating.conflicts.length === 0) return <Chip label={t("robin.events.noConflict")} tone="success" />;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Chip
        label={t("robin.events.conflictCount", { count: String(rating.conflicts.length) })}
        tone="danger"
      />
      <span className="min-w-0 text-xs break-words" style={{ color: "var(--danger)" }} title={rating.conflicts.map((item) => item.title).join(", ")}>
        {t("robin.events.conflictsWith", { title: rating.conflicts.map((item) => item.title).slice(0, 2).join("、") })}
      </span>
    </div>
  );
}

function EventCard({
  event,
  locale,
  scheduleReady,
  scheduleUnavailable,
  busy,
  pending,
  rank,
  onSave,
  onHide,
}: {
  event: RatedEvent;
  locale: string;
  scheduleReady: boolean;
  scheduleUnavailable: boolean;
  busy: boolean;
  pending: boolean;
  rank?: number;
  onSave: () => void;
  onHide: () => void;
}) {
  const { t } = useI18n();
  const place = event.online
    ? t("robin.events.online")
    : [event.venue, event.city].filter(Boolean).join(" · ");
  return (
    <article
      className={styles.card}
      data-recommended={rank ? "true" : undefined}
      data-saved={event.saved || undefined}
      aria-busy={pending}
    >
      <div className={styles.cardBody}>
        <div className="flex min-w-0 flex-1 gap-3">
          {rank && (
            <span
              className="flex size-8 shrink-0 items-center justify-center border text-sm tabular-nums"
              style={{
                borderColor: "var(--accent-line-strong)",
                background: "var(--accent-soft)",
                color: "var(--accent)",
                fontWeight: 700,
              }}
              aria-label={t("robin.events.rank", { rank: String(rank) })}
            >
              {rank}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <time className="pi-eyebrow" dateTime={event.startAt} style={{ color: "var(--accent)" }}>
                {formatDay(localDay(event), locale, true)} · {formatTime(event, locale)}
              </time>
              {event.saved && <Chip label={t("robin.events.savedMark")} tone="accent" />}
              {event.hidden && <Chip label={t("robin.events.hiddenMark")} />}
            </div>
            <h3 className={styles.eventTitle}><a
              href={event.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.eventLink}
              style={{ color: "var(--text)", fontWeight: 550 }}
              title={event.url}
            >
              {event.title}
            </a></h3>
            <p className="mt-2 text-xs break-words" style={{ color: "var(--text-muted)" }} title={[event.host, place].filter(Boolean).join(" · ")}>
              {[event.host, place].filter(Boolean).join(" · ")}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <SignalChips signals={event.rating.signals} />
              {event.free && <Chip label={t("robin.events.free")} />}
              {event.soldOut && <Chip label={t("robin.events.soldOut")} tone="danger" />}
              {event.requiresApproval && <Chip label={t("robin.events.approval")} />}
              {typeof event.guests === "number" && event.guests >= 25 && (
                <Chip label={t("robin.events.guests", { count: String(event.guests) })} />
              )}
            </div>
          </div>
        </div>

        <details className={styles.scoreDetails}>
          <summary className={styles.scoreSummary}>
            <span className="pi-eyebrow">{t("robin.events.overallScore")}</span>
            <strong className={styles.scoreValue}>{event.rating.overall.toFixed(1)}<small> / 5</small></strong>
            <span className="pi-eyebrow">{t("robin.events.scoreDetails")}</span>
          </summary>
          <div className="grid grid-cols-2 gap-3 pt-3" aria-label={t("robin.events.scores")}>
            <Score label={t("robin.events.relevanceScore")} value={event.rating.relevance} />
            <Score label={t("robin.events.fitScore")} value={event.rating.suitability} />
            <p className="col-span-2 text-xs" style={{ color: "var(--text-muted)" }}>{t("robin.events.scoreMethod")}</p>
          </div>
        </details>
      </div>

      <div className={styles.cardFooter}>
        <ScheduleStatus rating={event.rating} ready={scheduleReady} unavailable={scheduleUnavailable} />
        <div className={styles.cardActions}>
          <button
            type="button"
            disabled={busy}
            onClick={onSave}
            className="ui-action pi-eyebrow min-h-11 min-w-11 disabled:opacity-40"
            data-state={event.saved ? "accent" : undefined}
            aria-pressed={!!event.saved}
          >
            {pending ? t("robin.events.saving") : event.saved ? t("robin.events.unsave") : t("robin.events.save")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onHide}
            className="ui-action pi-eyebrow min-h-11 min-w-11 disabled:opacity-40"
            data-hover={event.hidden ? undefined : "danger"}
          >
            {event.hidden ? t("robin.events.unhide") : t("robin.events.hide")}
          </button>
        </div>
      </div>
    </article>
  );
}

/** A scored shortlist of Bay Area Full-stack AI events, checked against the calendar. */
export function EventsBoard() {
  const { t, locale } = useI18n();
  const eventResource = usePolledResource<EventsResponse>("/api/robin/tech-events", 30_000);
  const scheduleResource = usePolledResource<ScheduleResponse>("/api/robin/events", 30_000);

  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<TopicFilter>("all");
  const [savedOnly, setSavedOnly] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const scheduleUnavailable = !!(scheduleResource.error || scheduleResource.data?.google?.error);
  const scheduleReady = scheduleResource.data !== null && !scheduleUnavailable;
  const schedule = useMemo(() => scheduleResource.data?.events ?? [], [scheduleResource.data]);
  const events = useMemo(() => eventResource.data?.events ?? [], [eventResource.data]);
  const rated = useMemo<RatedEvent[]>(() => events.map((event) => ({
    ...event,
    rating: rateTechEventForFullStackAi(event, schedule),
  })), [events, schedule]);

  const visible = useMemo(() => rated.filter((event) => {
    if (event.hidden && !showHidden) return false;
    if (savedOnly && !event.saved) return false;
    if (topic !== "all" && !event.topics.includes(topic)) return false;
    const text = [event.title, event.host, event.city, event.venue, ...event.matched].join(" ").toLocaleLowerCase(locale);
    return text.includes(query.trim().toLocaleLowerCase(locale));
  }), [rated, showHidden, savedOnly, topic, query, locale]);

  const hasFilters = query !== "" || topic !== "all" || savedOnly || showHidden;
  const clearFilters = () => {
    setQuery("");
    setTopic("all");
    setSavedOnly(false);
    setShowHidden(false);
  };

  const recommendations = useMemo(() => scheduleReady
    ? rated
      .filter((event) => !event.hidden && !event.soldOut && event.rating.conflicts.length <= 1 && event.rating.overall >= 3.5)
      .sort((a, b) => b.rating.overall - a.rating.overall || a.startAt.localeCompare(b.startAt))
      .slice(0, 3)
    : [], [rated, scheduleReady]);

  const days = useMemo(() => {
    const grouped = new Map<string, RatedEvent[]>();
    for (const event of visible) {
      const day = localDay(event);
      const list = grouped.get(day) ?? [];
      list.push(event);
      grouped.set(day, list);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, items]) => [
      day,
      items.sort((a, b) => b.rating.overall - a.rating.overall || a.startAt.localeCompare(b.startAt)),
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

  const scan = eventResource.data?.scan ?? null;
  const running = scanning || eventResource.data?.scanning === true;
  const failures = (scan?.sources ?? []).filter((source) => source.error);
  const error = actionError ?? eventResource.error ?? scheduleResource.error ?? scheduleResource.data?.google?.error;

  return (
    <div className={`robin-page robin-dashboard flex-1 overflow-y-auto ${styles.page}`} style={{ minHeight: 0 }}>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 desktop:p-6">
        <header className="flex flex-wrap items-baseline justify-between gap-4">
          <div className="flex flex-col gap-2">
            <span className="pi-eyebrow" style={{ color: "var(--accent)" }}>{t("robin.events.kicker")}</span>
            <h1 className="text-3xl" style={{ fontStyle: "italic", fontWeight: 400, color: "var(--text)" }}>
              {t("robin.events.title")}
            </h1>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>{t("robin.events.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a href="#all-upcoming-events" className={`ui-action pi-eyebrow ${styles.listShortcut}`}>{t("robin.events.allUpcoming")} ↓</a>
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

        <section className="pi-card flex flex-col gap-3 p-4" aria-labelledby="event-recommendations">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-2">
              <h2 id="event-recommendations" className="pi-label">{t("robin.events.shortlistTitle")}</h2>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("robin.events.shortlistExplain")}</p>
            </div>
            <div className="flex items-center gap-4 text-right">
              <div>
                <strong className="block text-2xl tabular-nums" style={{ color: "var(--accent)" }}>{scheduleReady && eventResource.data ? recommendations.length : "—"}</strong>
                <span className="pi-eyebrow">{t("robin.events.noConflictPicks")}</span>
              </div>
              <div className="hidden h-9 w-px desktop:block" style={{ background: "var(--border)" }} />
              <p className="hidden max-w-52 text-xs desktop:block" style={{ color: "var(--text-muted)" }}>
                {t("robin.events.scoreMethod")}
              </p>
            </div>
          </div>

          {eventResource.loading || !scheduleReady ? (
            <div className={styles.empty} role="status">
              {t(eventResource.loading ? "robin.events.loading" : scheduleUnavailable ? "robin.events.scheduleUnavailable" : "robin.events.scheduleChecking")}
            </div>
          ) : !eventResource.data && eventResource.error ? (
            <p className={styles.empty}>{t("robin.events.loadFailed")}</p>
          ) : recommendations.length === 0 ? (
            <div className="border p-4 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
              {t("robin.events.noRecommendations")}
            </div>
          ) : (
            <div className={styles.recommendations}>
              {recommendations.map((event, index) => (
                <EventCard
                  key={`recommended:${event.id}`}
                  event={event}
                  locale={locale}
                  scheduleReady={scheduleReady}
                  scheduleUnavailable={scheduleUnavailable}
                  busy={busyId !== null}
                  pending={busyId === event.id}
                  rank={index + 1}
                  onSave={() => void patch(event, { saved: !event.saved })}
                  onHide={() => void patch(event, { hidden: !event.hidden })}
                />
              ))}
            </div>
          )}
        </section>

        <section className="pi-card flex flex-col gap-3 p-4" aria-labelledby="all-upcoming-events">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="all-upcoming-events" tabIndex={-1} className="pi-label">{t("robin.events.allUpcoming")}</h2>
            <span className="pi-eyebrow" role="status">{t("robin.events.resultCount", { count: eventResource.data ? String(visible.length) : "—" })}</span>
          </header>

          <label className="flex flex-col gap-2">
            <span className="pi-eyebrow">{t("robin.events.search")}</span>
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
                {t(`robin.events.topic.${candidate}`)}
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

          <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
            <span className="pi-eyebrow">{t("robin.events.sortedWithinDay")}</span>
            {hasFilters && <button type="button" className="ui-action pi-eyebrow min-h-11" onClick={clearFilters}>{t("robin.events.clearFilters")}</button>}
          </div>

          {eventResource.loading ? (
            <p className={styles.empty} role="status">{t("robin.events.loading")}</p>
          ) : !eventResource.data && eventResource.error ? (
            <p className={styles.empty}>{t("robin.events.loadFailed")}</p>
          ) : days.length === 0 ? (
            <div className={styles.empty}>
              <p>{running ? t("robin.events.scanningNote") : hasFilters ? t("robin.events.emptyFiltered") : t("robin.events.empty")}</p>
              <p className="mt-2 text-xs">{hasFilters ? t("robin.events.filterHint") : t("robin.events.cadence")}</p>
            </div>
          ) : days.map(([day, dayEvents]) => (
            <section key={day} className="flex flex-col gap-1" aria-labelledby={`events-${day}`}>
              <h3
                id={`events-${day}`}
                className="pi-eyebrow flex items-center gap-2 border-b py-3"
                style={{ background: "var(--bg-panel)", borderColor: "var(--border)", color: "var(--text)" }}
              >
                {day === eventResource.data?.today ? t("robin.events.today") : formatDay(day, locale)}
                <span className="tabular-nums" style={{ color: "var(--text-muted)" }}>{dayEvents.length}</span>
              </h3>
              <div className={styles.eventList}>
                {dayEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    locale={locale}
                    scheduleReady={scheduleReady}
                    scheduleUnavailable={scheduleUnavailable}
                    busy={busyId !== null}
                    pending={busyId === event.id}
                    onSave={() => void patch(event, { saved: !event.saved })}
                    onHide={() => void patch(event, { hidden: !event.hidden })}
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
