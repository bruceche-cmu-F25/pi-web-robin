"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardEvent } from "@/extension/robin/events";
import type { DetailBlock, DetailInline, TechEventDetail, TechEventPerson } from "@/extension/robin/tech-event-detail";
import { rateTechEventForFullStackAi, type TechEvent } from "@/extension/robin/tech-events";
import { useI18n } from "@/hooks/useI18n";
import { mutate, usePolledResource } from "./usePolledResource";
import {
  Avatar,
  Chip,
  EventCover,
  ScoreBar,
  TOPIC_TONE,
  durationMinutes,
  formatDay,
  formatTimeRange,
  googleCalendarUrl,
  localDay,
} from "./techEventView";
import styles from "./EventsBoard.module.css";

interface EventPageResponse {
  event: TechEvent;
  detail: TechEventDetail | null;
  detailError?: string;
  today: string;
}

interface ScheduleResponse {
  events: DashboardEvent[];
  google?: { connected: boolean; error?: string };
}

/** Rendered from the parsed tree, never as HTML — see extension/robin/tech-event-detail.ts. */
function Inlines({ parts }: { parts: DetailInline[] }) {
  return parts.map((part, index) => {
    if ("br" in part) return <br key={index} />;
    let node: React.ReactNode = part.text;
    if (part.bold) node = <strong>{node}</strong>;
    if (part.italic) node = <em>{node}</em>;
    if (part.href) {
      node = <a href={part.href} target="_blank" rel="noopener noreferrer" className={styles.proseLink}>{node}</a>;
    }
    return <Fragment key={index}>{node}</Fragment>;
  });
}

function Blocks({ blocks }: { blocks: DetailBlock[] }) {
  return blocks.map((block, index) => {
    switch (block.kind) {
      case "p": return <p key={index}><Inlines parts={block.inlines} /></p>;
      case "h": return <h3 key={index}><Inlines parts={block.inlines} /></h3>;
      case "hr": return <hr key={index} />;
      case "quote": return <blockquote key={index}><Blocks blocks={block.blocks} /></blockquote>;
      case "ul":
      case "ol": {
        const List = block.kind;
        return (
          <List key={index}>
            {block.items.map((item, itemIndex) => <li key={itemIndex}><Blocks blocks={item} /></li>)}
          </List>
        );
      }
    }
  });
}

function PersonLinks({ person }: { person: TechEventPerson }) {
  const labels = { x: "X", linkedin: "LinkedIn", website: "Web" } as const;
  if (person.links.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-2">
      {person.links.map((link) => (
        <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="pi-eyebrow" style={{ color: "var(--accent)" }}>
          {labels[link.kind]} ↗
        </a>
      ))}
    </span>
  );
}

function formatDuration(minutes: number, t: ReturnType<typeof useI18n>["t"]): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t("robin.events.durationMinutes", { minutes: String(rest) });
  return rest === 0
    ? t("robin.events.durationHours", { hours: String(hours) })
    : t("robin.events.durationHoursMinutes", { hours: String(hours), minutes: String(rest) });
}

function daysUntil(day: string, today: string): number {
  return Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={`pi-card ${styles.panel}`}>
      <h2 className="pi-eyebrow">{title}</h2>
      {children}
    </section>
  );
}

/** One public event: its introduction, its people, and whether it fits your week. */
export function EventDetail({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const url = `/api/robin/tech-events/${encodeURIComponent(id)}`;
  // The board is polled; this page is not. A description changes daily at most.
  const [data, setData] = useState<EventPageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const scheduleResource = usePolledResource<ScheduleResponse>("/api/robin/events", 60_000);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const response = await fetch(refresh ? `${url}?refresh=1` : url, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as EventPageResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setData(body);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [url]);

  useEffect(() => { void load(); }, [load]);

  const schedule = useMemo(() => scheduleResource.data?.events ?? [], [scheduleResource.data]);
  const scheduleUnavailable = !!(scheduleResource.error || scheduleResource.data?.google?.error);
  const scheduleReady = scheduleResource.data !== null && !scheduleUnavailable;
  const rating = useMemo(() => data ? rateTechEventForFullStackAi(data.event, schedule) : null, [data, schedule]);

  const setFlag = async (change: { saved?: boolean; hidden?: boolean }) => {
    if (!data) return;
    setBusy(true);
    try {
      await mutate("/api/robin/tech-events", "PATCH", { id: data.event.id, ...change });
      setData((current) => current ? {
        ...current,
        event: { ...current.event, ...change },
      } : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <Link href="/dashboard/events" className="ui-action pi-eyebrow min-h-11 self-start">← {t("robin.events.backToEvents")}</Link>
  );

  if (loading) {
    return (
      <div className={`robin-page robin-dashboard flex-1 overflow-y-auto ${styles.page}`} style={{ minHeight: 0 }}>
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 desktop:p-6">
          {back}
          <div className={styles.skeletonHero} />
          <p className={styles.empty} role="status">{t("robin.events.detailLoading")}</p>
        </main>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={`robin-page robin-dashboard flex-1 overflow-y-auto ${styles.page}`} style={{ minHeight: 0 }}>
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 desktop:p-6">
          {back}
          <div className={styles.empty}>
            <p>{t("robin.events.detailMissing")}</p>
            {error && <p className="mt-2 text-xs">{error}</p>}
          </div>
        </main>
      </div>
    );
  }

  const { event, detail, today } = data;
  const day = localDay(event);
  const until = daysUntil(day, today);
  const duration = durationMinutes(event);
  const location = event.online ? undefined : detail?.fullAddress ?? [event.venue, event.city].filter(Boolean).join(", ");
  const mapsUrl = location
    ? detail?.coordinate
      ? `https://www.google.com/maps/search/?api=1&query=${detail.coordinate.latitude},${detail.coordinate.longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`
    : null;
  // Luma reports 0 when the host hides the guest list; that is "unknown", not "nobody".
  const reported = detail?.guestCount ?? event.guests;
  const guests = typeof reported === "number" && reported > 0 ? reported : undefined;
  const tone = TOPIC_TONE[event.topics[0] ?? "swe"];

  return (
    <div className={`robin-page robin-dashboard flex-1 overflow-y-auto ${styles.page}`} style={{ minHeight: 0 }}>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 desktop:p-6">
        {back}

        <header className={styles.detailHero} style={{ "--row-tone": tone } as React.CSSProperties}>
          <div className={styles.detailCover}>
            <EventCover event={event} eager />
          </div>
          <div className={styles.detailHeading}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="pi-eyebrow" style={{ color: "var(--accent)" }}>
                {until === 0 ? t("robin.events.today") : until === 1 ? t("robin.events.tomorrow") : t("robin.events.inDays", { count: String(until) })}
              </span>
              {event.topics.map((topic) => (
                <Chip key={topic} label={t(`robin.events.topic.${topic}`)} color={TOPIC_TONE[topic]} />
              ))}
              {event.saved && <Chip label={t("robin.events.savedMark")} tone="accent" />}
              {event.hidden && <Chip label={t("robin.events.hiddenMark")} />}
            </div>
            <h1 className={styles.detailTitle}>{event.title}</h1>
            <p className={styles.meta}>
              {formatDay(day, locale)} · {formatTimeRange(event, locale)}
              {event.host ? ` · ${event.host}` : ""}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <a href={event.url} target="_blank" rel="noopener noreferrer" className="ui-action pi-chrome-label pi-bracket min-h-11 text-xs" data-state="accent">
                {event.soldOut ? t("robin.events.joinWaitlist") : t("robin.events.rsvp")} ↗
              </a>
              <a href={googleCalendarUrl(event, location)} target="_blank" rel="noopener noreferrer" className="ui-action pi-eyebrow min-h-11">
                + {t("robin.events.addToCalendar")}
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={() => void setFlag({ saved: !event.saved })}
                className="ui-action pi-eyebrow min-h-11 disabled:opacity-40"
                data-state={event.saved ? "accent" : undefined}
                aria-pressed={!!event.saved}
              >
                {event.saved ? `★ ${t("robin.events.unsave")}` : `☆ ${t("robin.events.save")}`}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void setFlag({ hidden: !event.hidden })}
                className="ui-action pi-eyebrow min-h-11 disabled:opacity-40"
                data-hover={event.hidden ? undefined : "danger"}
              >
                {event.hidden ? t("robin.events.unhide") : t("robin.events.hide")}
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div className={styles.error} role="alert">
            <p className="min-w-0 flex-1 break-words text-sm">{error}</p>
          </div>
        )}

        <div className={styles.detailGrid}>
          <div className="flex min-w-0 flex-col gap-5">
            <section className={`pi-card ${styles.panel}`} aria-labelledby="event-about">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="event-about" className={styles.sectionTitle}>{t("robin.events.about")}</h2>
                <button type="button" className="ui-action pi-eyebrow min-h-11 disabled:opacity-40" disabled={refreshing} onClick={() => void load(true)}>
                  {refreshing ? t("robin.events.refreshing") : t("robin.events.refreshDetail")}
                </button>
              </div>
              {data.detailError && (
                <p className={styles.notice}>{detail ? t("robin.events.detailStale") : t("robin.events.detailFailed")} <span className="opacity-70">({data.detailError})</span></p>
              )}
              {detail && detail.description.length > 0 ? (
                <div className={styles.prose}><Blocks blocks={detail.description} /></div>
              ) : detail ? (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>{t("robin.events.noDescription")}</p>
              ) : null}
              {detail && (
                <p className="pi-eyebrow">{t("robin.events.fetchedAt", { date: new Date(detail.fetchedAt).toLocaleString(locale) })}</p>
              )}
            </section>

            {detail && detail.hosts.length > 0 && (
              <section className={`pi-card ${styles.panel}`} aria-labelledby="event-hosts">
                <h2 id="event-hosts" className={styles.sectionTitle}>{t("robin.events.hostedBy")}</h2>
                <ul className={styles.people}>
                  {detail.hosts.map((host) => (
                    <li key={`${host.name}:${host.links[0]?.url ?? ""}`} className={styles.person}>
                      <Avatar name={host.name} url={host.avatarUrl} size={44} />
                      <div className="min-w-0">
                        <strong className="block text-sm" style={{ color: "var(--text)" }}>{host.name}</strong>
                        {host.bio && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{host.bio}</p>}
                        <PersonLinks person={host} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {detail && detail.featuredGuests.length > 0 && (
              <section className={`pi-card ${styles.panel}`} aria-labelledby="event-guests">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id="event-guests" className={styles.sectionTitle}>{t("robin.events.whoIsGoing")}</h2>
                  {typeof guests === "number" && <span className="pi-eyebrow">{t("robin.events.guests", { count: String(guests) })}</span>}
                </div>
                <ul className={styles.people}>
                  {detail.featuredGuests.map((guest) => (
                    <li key={`${guest.name}:${guest.links[0]?.url ?? ""}`} className={styles.person}>
                      <Avatar name={guest.name} url={guest.avatarUrl} size={36} />
                      <div className="min-w-0">
                        <strong className="block text-sm" style={{ color: "var(--text)" }}>{guest.name}</strong>
                        {guest.bio && <p className={`text-xs ${styles.clamp2}`} style={{ color: "var(--text-muted)" }}>{guest.bio}</p>}
                        <PersonLinks person={guest} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <aside className="flex min-w-0 flex-col gap-4">
            <Panel title={t("robin.events.when")}>
              <p className={styles.panelBig}>{formatDay(day, locale)}</p>
              <p className="text-sm" style={{ color: "var(--text)" }}>{formatTimeRange(event, locale)}</p>
              {duration && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{formatDuration(duration, t)}</p>}
              {rating && (
                <div className="pt-1">
                  {!scheduleReady ? (
                    <Chip label={t(scheduleUnavailable ? "robin.events.scheduleUnavailable" : "robin.events.scheduleChecking")} />
                  ) : rating.conflicts.length === 0 ? (
                    <Chip label={t("robin.events.noConflict")} tone="success" />
                  ) : (
                    <div className="flex flex-col gap-1">
                      <Chip label={t("robin.events.conflictCount", { count: String(rating.conflicts.length) })} tone="danger" />
                      <ul className="text-xs" style={{ color: "var(--danger)" }}>
                        {rating.conflicts.map((conflict) => (
                          <li key={conflict.id}>{conflict.start ? `${conflict.start}${conflict.end ? `–${conflict.end}` : ""} · ` : ""}{conflict.title}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </Panel>

            <Panel title={t("robin.events.where")}>
              {event.online ? (
                <p className={styles.panelBig}>{t("robin.events.online")}</p>
              ) : (
                <>
                  {detail?.neighborhood && <p className="pi-eyebrow" style={{ color: "var(--accent)" }}>{detail.neighborhood}</p>}
                  <p className="text-sm" style={{ color: "var(--text)" }}>{location || t("robin.events.addressHidden")}</p>
                  {mapsUrl && (
                    <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="ui-action pi-eyebrow min-h-11 self-start">
                      {t("robin.events.openMap")} ↗
                    </a>
                  )}
                </>
              )}
            </Panel>

            <Panel title={t("robin.events.registration")}>
              <div className="flex flex-wrap gap-1.5">
                {event.free && <Chip label={t("robin.events.free")} tone="success" />}
                {event.soldOut && <Chip label={t("robin.events.soldOut")} tone="danger" />}
                {event.requiresApproval && <Chip label={t("robin.events.approval")} />}
                {detail?.waitlist && <Chip label={t("robin.events.waitlist")} />}
                {detail?.nearCapacity && !event.soldOut && <Chip label={t("robin.events.nearCapacity")} tone="danger" />}
              </div>
              {typeof guests === "number" && (
                <p className={styles.panelBig}>{t("robin.events.guests", { count: String(guests) })}</p>
              )}
              {typeof detail?.spotsRemaining === "number" && detail.spotsRemaining > 0 && (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("robin.events.spotsLeft", { count: String(detail.spotsRemaining) })}</p>
              )}
            </Panel>

            {rating && (
              <Panel title={t("robin.events.fitTitle")}>
                <div className="flex items-baseline gap-2">
                  <strong className={styles.bigScore}>{rating.overall.toFixed(1)}</strong>
                  <span className="pi-eyebrow">/ 5 · {t("robin.events.overallScore")}</span>
                </div>
                <ScoreBar label={t("robin.events.relevanceScore")} value={rating.relevance} />
                <ScoreBar label={t("robin.events.fitScore")} value={rating.suitability} />
                <div className="flex flex-wrap gap-1.5">
                  {rating.signals.map((signal) => (
                    <Chip
                      key={signal}
                      label={t(`robin.events.signal.${signal}`)}
                      tone={signal === "fullstack-ai" ? "accent" : ["sold-out", "schedule-conflict"].includes(signal) ? "danger" : undefined}
                    />
                  ))}
                </div>
                {event.matched.length > 0 && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("robin.events.why", { terms: event.matched.join(", ") })}</p>
                )}
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("robin.events.scoreMethod")}</p>
              </Panel>
            )}

            {detail?.calendar && (
              <Panel title={t("robin.events.community")}>
                <div className={styles.person}>
                  <Avatar name={detail.calendar.name} url={detail.calendar.avatarUrl} size={44} />
                  <div className="min-w-0">
                    <strong className="block text-sm" style={{ color: "var(--text)" }}>{detail.calendar.name}</strong>
                    {detail.calendar.about && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{detail.calendar.about}</p>}
                    {detail.calendar.url && (
                      <a href={detail.calendar.url} target="_blank" rel="noopener noreferrer" className="pi-eyebrow" style={{ color: "var(--accent)" }}>
                        {t("robin.events.moreFromHost")} ↗
                      </a>
                    )}
                  </div>
                </div>
              </Panel>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
