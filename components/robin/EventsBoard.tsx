"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  TECH_EVENT_TOPICS,
  type TechEvent,
  type TechEventScanState,
  type TechEventTopic,
} from "@/extension/robin/tech-events";
import { mutate, usePolledResource } from "./usePolledResource";

interface EventsResponse {
  events: TechEvent[];
  scan: TechEventScanState | null;
  scanning: boolean;
  today: string;
}

type TopicFilter = TechEventTopic | "all";

/**
 * The calendar day an event falls on, in the host's own time zone.
 *
 * Not the viewer's: `startAt` is a UTC instant, and a 6pm meetup in San
 * Francisco read from a laptop on East Coast time is still Tuesday's meetup,
 * not Wednesday's. Falls back to the viewer's zone only when the host
 * published none.
 */
function localDay(event: TechEvent): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      ...(event.timezone ? { timeZone: event.timezone } : {}),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(event.startAt));
  } catch {
    // An unknown IANA zone throws rather than falling back on its own.
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

function formatDay(day: string, locale: string): string {
  // Parsed as noon UTC so the date cannot slip a day either side of the line.
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(locale, {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function Chip({ label, tone }: { label: string; tone?: "accent" | "danger" | "muted" }) {
  const color = tone === "accent"
    ? "var(--accent)"
    : tone === "danger"
      ? "var(--danger)"
      : "var(--text-dim)";
  return (
    <span
      className="pi-eyebrow shrink-0 px-1.5 py-0.5"
      style={{
        color,
        border: `1px solid ${tone ? color : "var(--border)"}`,
        opacity: tone ? 1 : 0.85,
      }}
    >
      {label}
    </span>
  );
}

function EventRow({
  event,
  locale,
  busy,
  onSave,
  onHide,
}: {
  event: TechEvent;
  locale: string;
  busy: boolean;
  onSave: () => void;
  onHide: () => void;
}) {
  const { t } = useI18n();
  const place = [event.venue, event.city].filter(Boolean).join(" · ");

  return (
    <div
      className="group flex flex-col gap-1 rounded px-2 py-1.5"
      style={{ background: "var(--bg-subtle)", opacity: event.hidden ? 0.45 : 1 }}
    >
      <div className="flex items-baseline gap-2">
        <span
          className="w-16 shrink-0 tabular-nums text-xs"
          style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}
        >
          {formatTime(event, locale)}
        </span>
        {/* noreferrer matters: these URLs come from a third-party event feed. */}
        <a
          href={event.url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 text-sm hover:underline"
          style={{ color: "var(--text)" }}
          title={event.url}
        >
          {event.title}
        </a>
        {event.saved && <Chip label={t("robin.events.savedMark")} tone="accent" />}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 pl-18">
        {event.host && (
          <span
            className="truncate text-xs"
            style={{ color: "var(--text-muted)", maxWidth: "18rem" }}
            title={event.host}
          >
            {event.host}
          </span>
        )}
        {event.online
          ? <Chip label={t("robin.events.online")} />
          : place && (
            <span className="truncate text-xs" style={{ color: "var(--text-muted)", maxWidth: "22rem" }} title={place}>
              {place}
            </span>
          )}
        {event.free && <Chip label={t("robin.events.free")} />}
        {event.soldOut && <Chip label={t("robin.events.soldOut")} tone="danger" />}
        {event.requiresApproval && <Chip label={t("robin.events.approval")} />}
        {typeof event.guests === "number" && event.guests >= 25 && (
          <span
            className="shrink-0 tabular-nums text-xs"
            style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}
          >
            {t("robin.events.guests", { count: String(event.guests) })}
          </span>
        )}
        {event.topics.map((topic) => (
          <Chip key={topic} label={t(`robin.events.topic.${topic}`)} tone="accent" />
        ))}
      </div>

      {/* Dimmed rather than hover-revealed: a hover-only control cannot be
          reached on a phone, and this dashboard is used on one. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 pl-18 opacity-60 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          disabled={busy}
          onClick={onSave}
          className="ui-action pi-eyebrow disabled:opacity-40"
          data-state={event.saved ? "accent" : undefined}
        >
          {event.saved ? t("robin.events.unsave") : t("robin.events.save")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onHide}
          className="ui-action pi-eyebrow disabled:opacity-40"
          data-hover={event.hidden ? undefined : "danger"}
        >
          {event.hidden ? t("robin.events.unhide") : t("robin.events.hide")}
        </button>
        {event.matched.length > 0 && (
          <span
            className="ml-auto truncate text-xs"
            style={{ color: "var(--text-dim)", maxWidth: "16rem" }}
          >
            {t("robin.events.why", { terms: event.matched.join(", ") })}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Bay Area AI and software-engineering events, scraped once a week.
 *
 * The page is a list of links on purpose. Everything here happens somewhere
 * else — you RSVP on Luma, not here — so the job is to be the one screen that
 * answers "what is worth going to this week" without you reading a city feed
 * that is half book clubs. What this page owns beyond the links is the two
 * decisions the feed cannot make for you: which ones you have decided to go to
 * (`saved`) and which ones you never want to see again (`hidden`).
 *
 * The weekly scan is triggered by the GET behind this list — see
 * /api/robin/tech-events. Opening the page on a stale week starts a scan and
 * shows last week's list while it runs; the poll below is what swaps in the
 * new one.
 */
export function EventsBoard() {
  const { t, locale } = useI18n();
  const { data, error, refresh } = usePolledResource<EventsResponse>("/api/robin/tech-events", 30_000);

  const [topic, setTopic] = useState<TopicFilter>("all");
  const [savedOnly, setSavedOnly] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // Memoised only so the filter below has a stable dependency: `?? []` would
  // hand it a new empty array on every render.
  const events = useMemo(() => data?.events ?? [], [data]);

  const visible = useMemo(() => events.filter((event) => {
    if (event.hidden && !showHidden) return false;
    if (savedOnly && !event.saved) return false;
    if (topic !== "all" && !event.topics.includes(topic)) return false;
    return true;
  }), [events, showHidden, savedOnly, topic]);

  const days = useMemo(() => {
    const grouped = new Map<string, TechEvent[]>();
    for (const event of visible) {
      const day = localDay(event);
      const list = grouped.get(day) ?? [];
      list.push(event);
      grouped.set(day, list);
    }
    return [...grouped.entries()];
  }, [visible]);

  const patch = async (event: TechEvent, change: { saved?: boolean; hidden?: boolean }) => {
    setBusyId(event.id);
    setActionError(null);
    try {
      await mutate("/api/robin/tech-events", "PATCH", { id: event.id, ...change });
      await refresh();
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
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setScanning(false);
    }
  };

  const scan = data?.scan ?? null;
  const running = scanning || data?.scanning === true;
  const failures = (scan?.sources ?? []).filter((source) => source.error);

  return (
    <div className="robin-page robin-dashboard flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 desktop:p-6">
        <header className="flex flex-wrap items-baseline justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl" style={{ fontStyle: "italic", fontWeight: 400, color: "var(--text)" }}>
              {t("robin.events.title")}
            </h1>
            <p className="pi-eyebrow">{t("robin.events.subtitle")}</p>
          </div>
          <nav className="flex flex-wrap items-baseline gap-3">
            <span className="pi-eyebrow">
              {scan?.finishedAt
                ? t("robin.events.lastScan", { date: new Date(scan.finishedAt).toLocaleDateString(locale) })
                : t("robin.events.neverScanned")}
            </span>
            <button
              type="button"
              onClick={() => void scanNow()}
              disabled={running}
              className="ui-action pi-chrome-label pi-bracket text-xs disabled:opacity-40"
              data-state="accent"
            >
              {running ? t("robin.events.scanning") : t("robin.events.scan")}
            </button>
          </nav>
        </header>

        {(actionError || error) && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>{actionError ?? error}</p>
        )}

        {/* ── filters ────────────────────────────────────────────────── */}
        <section className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          {(["all", ...TECH_EVENT_TOPICS] as TopicFilter[]).map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => setTopic(candidate)}
              className="ui-action pi-chrome-label pi-bracket"
              data-state={candidate === topic ? "accent" : undefined}
              style={{ fontSize: 10 }}
              aria-current={candidate === topic ? "true" : undefined}
            >
              {t(`robin.events.topic.${candidate}`)}
            </button>
          ))}
          <span className="ml-auto flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={() => setSavedOnly((on) => !on)}
              className="ui-action pi-eyebrow"
              data-state={savedOnly ? "accent" : undefined}
              aria-pressed={savedOnly}
            >
              {t("robin.events.savedOnly")}
            </button>
            <button
              type="button"
              onClick={() => setShowHidden((on) => !on)}
              className="ui-action pi-eyebrow"
              data-state={showHidden ? "accent" : undefined}
              aria-pressed={showHidden}
            >
              {t("robin.events.showHidden")}
            </button>
          </span>
        </section>

        {/* ── the list ───────────────────────────────────────────────── */}
        {days.length === 0 ? (
          <section
            className="flex flex-col gap-2 rounded-lg p-4"
            style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
          >
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {running
                ? t("robin.events.scanningNote")
                : events.length > 0
                  ? t("robin.events.emptyFiltered")
                  : t("robin.events.empty")}
            </p>
          </section>
        ) : (
          days.map(([day, dayEvents]) => (
            <section
              key={day}
              className="flex flex-col gap-2 rounded-lg p-4"
              style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
            >
              <h2 className="pi-label">
                {day === data?.today ? t("robin.events.today") : formatDay(day, locale)}
                <span className="ml-2 tabular-nums" style={{ color: "var(--text-dim)" }}>
                  {dayEvents.length}
                </span>
              </h2>
              <div className="flex flex-col gap-1.5">
                {dayEvents.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    locale={locale}
                    busy={busyId === event.id}
                    onSave={() => void patch(event, { saved: !event.saved })}
                    onHide={() => void patch(event, { hidden: !event.hidden })}
                  />
                ))}
              </div>
            </section>
          ))
        )}

        {/* Where the list came from, and what broke. Last, because it is the
            thing you read once when something looks wrong — not every day. */}
        <section
          className="flex flex-col gap-1 rounded-lg p-4"
          style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
        >
          <span className="pi-eyebrow">{t("robin.events.sources")}</span>
          {scan
            ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {t("robin.events.scanSummary", {
                  seen: String(scan.seen),
                  kept: String(scan.kept),
                  sources: String(scan.sources.length),
                })}
              </p>
            )
            : <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("robin.events.neverScanned")}</p>}
          {failures.map((source) => (
            <p key={source.id} className="text-xs" style={{ color: "var(--danger)" }}>
              {source.name}: {source.error}
            </p>
          ))}
          <p className="pi-eyebrow">{t("robin.events.cadence")}</p>
        </section>
      </main>
    </div>
  );
}
