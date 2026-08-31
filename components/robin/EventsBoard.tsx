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
      ? "var(--danger)"
      : tone === "success"
        ? "var(--success)"
        : "var(--text-dim)";
  return (
    <span
      className="pi-eyebrow inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1"
      style={{
        color,
        border: `1px solid ${tone ? `color-mix(in srgb, ${color} 45%, var(--border))` : "var(--border)"}`,
        background: tone ? `color-mix(in srgb, ${color} 8%, transparent)` : "transparent",
      }}
    >
      {label}
    </span>
  );
}

function Score({ label, value, prominent = false }: { label: string; value: number; prominent?: boolean }) {
  return (
    <div className="min-w-0">
      <span className="pi-eyebrow block truncate" style={{ color: "var(--text-dim)" }} title={label}>{label}</span>
      <strong
        className={`mt-0.5 block tabular-nums ${prominent ? "text-2xl" : "text-lg"}`}
        style={{ color: prominent ? "var(--accent)" : "var(--text)", fontWeight: 600 }}
      >
        {value.toFixed(1)}
      </strong>
      <div className="mt-1 h-1 overflow-hidden rounded-full" style={{ background: "var(--border)" }} aria-hidden="true">
        <div
          className="h-full rounded-full"
          style={{ width: `${value * 20}%`, background: prominent ? "var(--accent)" : "var(--text-dim)" }}
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

function ScheduleStatus({ rating, ready }: { rating: TechEventRating; ready: boolean }) {
  const { t } = useI18n();
  if (!ready) return <Chip label={t("robin.events.scheduleChecking")} />;
  if (rating.conflicts.length === 0) return <Chip label={t("robin.events.noConflict")} tone="success" />;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Chip
        label={t("robin.events.conflictCount", { count: String(rating.conflicts.length) })}
        tone="danger"
      />
      <span className="min-w-0 truncate text-xs" style={{ color: "var(--danger)" }} title={rating.conflicts.map((item) => item.title).join(", ")}>
        {t("robin.events.conflictsWith", { title: rating.conflicts.map((item) => item.title).slice(0, 2).join("、") })}
      </span>
    </div>
  );
}

function EventCard({
  event,
  locale,
  scheduleReady,
  busy,
  rank,
  onSave,
  onHide,
}: {
  event: RatedEvent;
  locale: string;
  scheduleReady: boolean;
  busy: boolean;
  rank?: number;
  onSave: () => void;
  onHide: () => void;
}) {
  const { t } = useI18n();
  const place = event.online
    ? t("robin.events.online")
    : [event.venue, event.city].filter(Boolean).join(" · ");
  const conflicted = scheduleReady && event.rating.conflicts.length > 0;

  return (
    <article
      className="group relative overflow-hidden rounded-xl border p-4 transition-transform duration-150 hover:-translate-y-px motion-reduce:transform-none motion-reduce:transition-none"
      style={{
        borderColor: conflicted ? "color-mix(in srgb, var(--danger) 45%, var(--border))" : "var(--border)",
        background: rank
          ? "linear-gradient(145deg, color-mix(in srgb, var(--accent) 10%, var(--bg-panel)), var(--bg-panel) 56%)"
          : "var(--bg-subtle)",
        opacity: event.hidden ? 0.5 : 1,
      }}
    >
      <div className="flex flex-col gap-4 desktop:flex-row desktop:items-start">
        <div className="flex min-w-0 flex-1 gap-3">
          {rank && (
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-sm tabular-nums"
              style={{ background: "var(--accent)", color: "var(--bg)", fontWeight: 700 }}
              aria-label={t("robin.events.rank", { rank: String(rank) })}
            >
              {rank}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="pi-eyebrow" style={{ color: "var(--accent)" }}>
                {formatDay(localDay(event), locale, true)} · {formatTime(event, locale)}
              </span>
              {event.saved && <Chip label={t("robin.events.savedMark")} tone="accent" />}
            </div>
            <a
              href={event.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-base leading-snug hover:underline"
              style={{ color: "var(--text)", fontWeight: 550 }}
              title={event.url}
            >
              {event.title}
            </a>
            <p className="mt-1 truncate text-xs" style={{ color: "var(--text-muted)" }} title={[event.host, place].filter(Boolean).join(" · ")}>
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

        <div className="grid shrink-0 grid-cols-3 gap-3 desktop:w-64" aria-label={t("robin.events.scores")}>
          <Score label={t("robin.events.overallScore")} value={event.rating.overall} prominent />
          <Score label={t("robin.events.relevanceScore")} value={event.rating.relevance} />
          <Score label={t("robin.events.fitScore")} value={event.rating.suitability} />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t pt-3 desktop:flex-row desktop:items-center" style={{ borderColor: "var(--border)" }}>
        <ScheduleStatus rating={event.rating} ready={scheduleReady} />
        <div className="flex items-center gap-4 desktop:ml-auto">
          <button
            type="button"
            disabled={busy}
            onClick={onSave}
            className="ui-action pi-eyebrow min-h-11 disabled:opacity-40"
            data-state={event.saved ? "accent" : undefined}
          >
            {event.saved ? t("robin.events.unsave") : t("robin.events.save")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onHide}
            className="ui-action pi-eyebrow min-h-11 disabled:opacity-40"
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

  const [topic, setTopic] = useState<TopicFilter>("all");
  const [savedOnly, setSavedOnly] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const scheduleReady = scheduleResource.data !== null;
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
    return true;
  }), [rated, showHidden, savedOnly, topic]);

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
    return [...grouped.entries()].map(([day, items]) => [
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
    <div className="robin-page robin-dashboard flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 desktop:p-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="pi-eyebrow" style={{ color: "var(--accent)" }}>{t("robin.events.kicker")}</p>
            <h1 className="text-3xl" style={{ fontStyle: "italic", fontWeight: 400, color: "var(--text)" }}>
              {t("robin.events.title")}
            </h1>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>{t("robin.events.subtitle")}</p>
          </div>
          <nav className="flex flex-wrap items-center gap-3">
            <span className="pi-eyebrow">
              {scan?.finishedAt
                ? t("robin.events.lastScan", { date: new Date(scan.finishedAt).toLocaleDateString(locale) })
                : t("robin.events.neverScanned")}
            </span>
            <button
              type="button"
              onClick={() => void scanNow()}
              disabled={running}
              className="ui-action pi-chrome-label pi-bracket min-h-11 px-3 text-xs disabled:opacity-40"
              data-state="accent"
            >
              {running ? t("robin.events.scanning") : t("robin.events.scan")}
            </button>
          </nav>
        </header>

        {error && <p className="text-sm" role="alert" style={{ color: "var(--danger)" }}>{error}</p>}

        <section
          className="overflow-hidden rounded-2xl border p-4 desktop:p-5"
          style={{
            borderColor: "color-mix(in srgb, var(--accent) 35%, var(--border))",
            background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, var(--bg-panel)), var(--bg-panel) 48%)",
          }}
          aria-labelledby="event-recommendations"
        >
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="pi-eyebrow" style={{ color: "var(--accent)" }}>{t("robin.events.shortlistKicker")}</p>
              <h2 id="event-recommendations" className="mt-1 text-xl" style={{ color: "var(--text)", fontWeight: 550 }}>
                {t("robin.events.shortlistTitle")}
              </h2>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{t("robin.events.shortlistExplain")}</p>
            </div>
            <div className="flex items-center gap-4 text-right">
              <div>
                <strong className="block text-2xl tabular-nums" style={{ color: "var(--accent)" }}>{recommendations.length}</strong>
                <span className="pi-eyebrow">{t("robin.events.noConflictPicks")}</span>
              </div>
              <div className="hidden h-9 w-px desktop:block" style={{ background: "var(--border)" }} />
              <p className="hidden max-w-52 text-xs desktop:block" style={{ color: "var(--text-dim)" }}>
                {t("robin.events.scoreMethod")}
              </p>
            </div>
          </div>

          {!scheduleReady ? (
            <div className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
              {t("robin.events.scheduleChecking")}
            </div>
          ) : recommendations.length === 0 ? (
            <div className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
              {t("robin.events.noRecommendations")}
            </div>
          ) : (
            <div className="grid gap-3">
              {recommendations.map((event, index) => (
                <EventCard
                  key={`recommended:${event.id}`}
                  event={event}
                  locale={locale}
                  scheduleReady={scheduleReady}
                  busy={busyId === event.id}
                  rank={index + 1}
                  onSave={() => void patch(event, { saved: !event.saved })}
                  onHide={() => void patch(event, { hidden: !event.hidden })}
                />
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-wrap items-center gap-2" aria-label={t("robin.events.filters")}>
          {(["all", ...TECH_EVENT_TOPICS] as TopicFilter[]).map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => setTopic(candidate)}
              className="ui-action pi-chrome-label pi-bracket min-h-11 px-2"
              data-state={candidate === topic ? "accent" : undefined}
              style={{ fontSize: 10 }}
              aria-pressed={candidate === topic}
            >
              {t(`robin.events.topic.${candidate}`)}
            </button>
          ))}
          <span className="desktop:ml-auto flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setSavedOnly((on) => !on)}
              className="ui-action pi-eyebrow min-h-11"
              data-state={savedOnly ? "accent" : undefined}
              aria-pressed={savedOnly}
            >
              {t("robin.events.savedOnly")}
            </button>
            <button
              type="button"
              onClick={() => setShowHidden((on) => !on)}
              className="ui-action pi-eyebrow min-h-11"
              data-state={showHidden ? "accent" : undefined}
              aria-pressed={showHidden}
            >
              {t("robin.events.showHidden")}
            </button>
          </span>
        </section>

        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg" style={{ color: "var(--text)", fontWeight: 550 }}>{t("robin.events.allUpcoming")}</h2>
          <span className="pi-eyebrow">{t("robin.events.sortedWithinDay")}</span>
        </div>

        {days.length === 0 ? (
          <section className="rounded-xl border p-4" style={{ background: "var(--bg-panel)", borderColor: "var(--border)" }}>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {running
                ? t("robin.events.scanningNote")
                : events.length > 0
                  ? t("robin.events.emptyFiltered")
                  : t("robin.events.empty")}
            </p>
          </section>
        ) : days.map(([day, dayEvents]) => (
          <section key={day} className="flex flex-col gap-2" aria-labelledby={`events-${day}`}>
            <h3 id={`events-${day}`} className="pi-label sticky top-0 z-10 flex items-center gap-2 py-2" style={{ background: "var(--bg)" }}>
              {day === eventResource.data?.today ? t("robin.events.today") : formatDay(day, locale)}
              <span className="tabular-nums" style={{ color: "var(--text-dim)" }}>{dayEvents.length}</span>
            </h3>
            <div className="grid gap-2">
              {dayEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  locale={locale}
                  scheduleReady={scheduleReady}
                  busy={busyId === event.id}
                  onSave={() => void patch(event, { saved: !event.saved })}
                  onHide={() => void patch(event, { hidden: !event.hidden })}
                />
              ))}
            </div>
          </section>
        ))}

        <section className="flex flex-col gap-1 rounded-xl border p-4" style={{ background: "var(--bg-panel)", borderColor: "var(--border)" }}>
          <span className="pi-eyebrow">{t("robin.events.sources")}</span>
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
          <p className="pi-eyebrow">{t("robin.events.cadence")}</p>
        </section>
      </main>
    </div>
  );
}
