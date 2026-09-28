"use client";

import { useState } from "react";
import type { TechEvent, TechEventTopic } from "@/extension/robin/tech-events";
import styles from "./EventsBoard.module.css";

/**
 * Pieces the events board and an event's own page share.
 *
 * Time is always shown in the host's zone, not the browser's: a Bay Area
 * meetup at 17:30 is a 17:30 meetup even when the laptop is in Taipei.
 */

/** The in-app page for one event. The id carries a colon, hence the encoding. */
export function eventHref(id: string): string {
  return `/dashboard/events/${encodeURIComponent(id)}`;
}

export function localDay(event: Pick<TechEvent, "startAt" | "timezone">): string {
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

export function formatTime(event: Pick<TechEvent, "timezone">, instant: string, locale: string, zone = true): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      ...(event.timezone ? { timeZone: event.timezone } : {}),
      hour: "numeric",
      minute: "2-digit",
      ...(zone ? { timeZoneName: "short" } : {}),
    }).format(new Date(instant));
  } catch {
    return "";
  }
}

/** "6:30 PM – 9:30 PM PDT", or just the start when the host gave no end. */
export function formatTimeRange(event: TechEvent, locale: string): string {
  if (!event.endAt) return formatTime(event, event.startAt, locale);
  return `${formatTime(event, event.startAt, locale, false)} – ${formatTime(event, event.endAt, locale)}`;
}

export function formatDay(day: string, locale: string, style: "long" | "compact" | "weekday" = "long"): string {
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  const options: Intl.DateTimeFormatOptions = style === "compact"
    ? { month: "short", day: "numeric" }
    : style === "weekday"
      ? { weekday: "short" }
      : { weekday: "long", month: "long", day: "numeric" };
  return date.toLocaleDateString(locale, { timeZone: "UTC", ...options });
}

/** Whole minutes between start and end, or null when there is no end. */
export function durationMinutes(event: TechEvent): number | null {
  if (!event.endAt) return null;
  const minutes = Math.round((Date.parse(event.endAt) - Date.parse(event.startAt)) / 60_000);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

/** Add-to-Google-Calendar link. Built here, so nothing from the host reaches the URL unencoded. */
export function googleCalendarUrl(event: TechEvent, location?: string): string {
  const stamp = (instant: string) => new Date(instant).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = event.endAt ?? new Date(Date.parse(event.startAt) + 2 * 60 * 60 * 1_000).toISOString();
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${stamp(event.startAt)}/${stamp(end)}`,
    details: event.url,
    ...(location ? { location } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** Each topic gets one of the calendar's muted hues, used as an edge, never a fill. */
export const TOPIC_TONE: Record<TechEventTopic, string> = {
  ai: "var(--event-teal)",
  swe: "var(--event-iris)",
  data: "var(--event-honey)",
  hardware: "var(--event-clay)",
  startup: "var(--event-plum)",
};

export type ChipTone = "accent" | "danger" | "success" | "muted";

export function Chip({ label, tone, color }: { label: string; tone?: ChipTone; color?: string }) {
  const resolved = color ?? (tone === "accent"
    ? "var(--accent)"
    : tone === "danger"
      ? "color-mix(in srgb, var(--danger) 80%, var(--text))"
      : tone === "success"
        ? "color-mix(in srgb, var(--success) 65%, var(--text))"
        : "var(--text-muted)");
  const tinted = !!(tone || color);
  return (
    <span
      className="pi-eyebrow inline-flex shrink-0 items-center gap-1 border px-1.5 py-0.5"
      style={{
        color: color ? "var(--text)" : resolved,
        borderColor: tinted ? `color-mix(in srgb, ${resolved} 45%, var(--border))` : "var(--border)",
        background: tinted ? `color-mix(in srgb, ${resolved} 9%, transparent)` : "var(--bg-panel)",
      }}
    >
      {color && <span aria-hidden="true" className={styles.topicDot} style={{ background: resolved }} />}
      {label}
    </span>
  );
}

/**
 * The event's cover, or a quiet typographic stand-in.
 *
 * Luma covers are user uploads and fail often enough (deleted, hotlink-blocked)
 * that a broken-image icon would show up weekly; the fallback is the host's
 * initials on the first topic's hue.
 */
export function EventCover({
  event,
  className,
  eager = false,
}: {
  event: Pick<TechEvent, "coverUrl" | "title" | "host" | "topics">;
  className?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const tone = TOPIC_TONE[event.topics[0] ?? "swe"];
  if (event.coverUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote user uploads; the app runs unoptimized
      <img
        src={event.coverUrl}
        alt=""
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        referrerPolicy="no-referrer"
        className={`${styles.cover} ${className ?? ""}`}
        onError={() => setFailed(true)}
      />
    );
  }
  const initials = (event.host ?? event.title)
    .split(/\s+/)
    .filter((word) => /^[\p{L}\p{N}]/u.test(word))
    .slice(0, 2)
    .map((word) => [...word][0]!.toUpperCase())
    .join("");
  return (
    <div
      aria-hidden="true"
      className={`${styles.cover} ${styles.coverFallback} ${className ?? ""}`}
      style={{ "--cover-tone": tone } as React.CSSProperties}
    >
      <span>{initials || "◆"}</span>
    </div>
  );
}

export function Avatar({ name, url, size = 36 }: { name: string; url?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initial = [...name.trim()][0]?.toUpperCase() ?? "?";
  return url && !failed ? (
    // eslint-disable-next-line @next/next/no-img-element -- remote Luma avatar
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={styles.avatar}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  ) : (
    <span aria-hidden="true" className={`${styles.avatar} ${styles.avatarFallback}`} style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {initial}
    </span>
  );
}

export function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="pi-eyebrow" title={label}>{label}</span>
        <strong className="text-sm tabular-nums" style={{ color: "var(--text)", fontWeight: 600 }}>{value.toFixed(1)}</strong>
      </div>
      <div className="mt-1 h-1 overflow-hidden" style={{ background: "var(--border)" }} aria-hidden="true">
        <div className="h-full" style={{ width: `${value * 20}%`, background: "var(--accent)" }} />
      </div>
    </div>
  );
}
