"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { EventColorKey } from "@/extension/robin/eventColors";
import {
  WATCH_CHANNELS, WATCH_COURSES, watchPlan, watchThumbnail, watchUrl,
  type WatchCourse, type WatchItem, type WatchPlan,
} from "@/extension/robin/watch";
import styles from "./WatchList.module.css";

/**
 * The watch list: every lecture in one column, ticked off by hand.
 *
 * One column on purpose. This page is for the days reading will not go in, so
 * it has one decision on it — which lecture next — and a grid of cards would
 * turn that back into choosing. Progress is kept by Robin, like Full Stack
 * Open's, so it follows you between devices; the plan is recomputed locally
 * from the same function the server uses, which is what lets a tick show
 * before the write returns.
 *
 * Thumbnails come straight from YouTube's image host, as on the podcast
 * shelf: every one of these links opens YouTube anyway.
 */

/** One calendar hue per course, chosen so neighbours never share a family. */
const COURSE_HUE: Record<string, EventColorKey> = {
  cs50w: "rose",
  netninja: "teal",
  missing: "iris",
  cs50sql: "honey",
  cs50x: "clay",
};
const CHANNEL_HUE: Record<string, EventColorKey> = { hnasr: "sage", bytebytego: "plum" };

const ALL_ITEMS = WATCH_COURSES.flatMap((course) => course.items);
const TOTAL_HOURS = Math.round(ALL_ITEMS.reduce((sum, item) => sum + item.minutes, 0) / 60);

function hueVars(hue: EventColorKey): CSSProperties {
  return {
    "--hue-ink": `var(--todo-${hue})`,
    "--hue-line": `var(--event-${hue})`,
    "--hue-soft": `var(--event-${hue}-soft)`,
    "--hue-faint": `var(--event-${hue}-faint)`,
  } as CSSProperties;
}

export function WatchList() {
  const { t } = useI18n();
  const [ids, setIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const writing = useRef(Promise.resolve());
  const idsRef = useRef<string[]>([]);
  useEffect(() => { idsRef.current = ids ?? []; }, [ids]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/robin/watch")
      .then(async (response) => {
        const body = await response.json().catch(() => null) as WatchPlan | { error?: string } | null;
        if (!response.ok || !body || !("watchedIds" in body)) {
          throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${response.status})`);
        }
        if (!cancelled) setIds(body.watchedIds);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { cancelled = true; };
  }, []);

  const plan = useMemo(() => (ids ? watchPlan(ids) : null), [ids]);

  // Writes are chained so two quick ticks land in the order they were made;
  // the server's answer then replaces the optimistic list, and a failure puts
  // back what was there.
  const toggle = useCallback((itemId: string, watched: boolean) => {
    setError(null);
    const previous = idsRef.current;
    const rest = previous.filter((id) => id !== itemId);
    idsRef.current = watched ? [...rest, itemId] : rest;
    setIds(idsRef.current);
    writing.current = writing.current.then(async () => {
      try {
        const response = await fetch("/api/robin/watch", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item: itemId, watched }),
        });
        const body = await response.json().catch(() => null) as WatchPlan | { error?: string } | null;
        if (!response.ok || !body || !("watchedIds" in body)) {
          throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${response.status})`);
        }
        idsRef.current = body.watchedIds;
        setIds(body.watchedIds);
      } catch (reason) {
        idsRef.current = previous;
        setIds(previous);
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    });
  }, []);

  const featured = useMemo(() => {
    if (!plan?.upNext) return null;
    const { courseId, itemId } = plan.upNext;
    const course = WATCH_COURSES.find((entry) => entry.id === courseId)!;
    const item = course.items.find((entry) => entry.id === itemId)!;
    return { course, item, fresh: plan.watched === 0 };
  }, [plan]);

  const watchedSet = useMemo(() => new Set(plan?.watchedIds ?? []), [plan]);
  const watchedMinutes = useMemo(
    () => ALL_ITEMS.reduce((sum, item) => sum + (watchedSet.has(item.id) ? item.minutes : 0), 0),
    [watchedSet],
  );

  return (
    <div className="robin-page robin-dashboard flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      <main className={`${styles.page} mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 desktop:p-6`}>
        <a
          href="/learn"
          className="ui-action pi-chrome-label pi-bracket self-start"
          style={{ fontSize: 11, textDecoration: "none" }}
        >
          ← {t("learn.gpt2.back")}
        </a>

        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="pi-eyebrow">{t("watch.eyebrow")}</span>
              <h1 className="text-3xl" style={{ fontStyle: "italic", fontWeight: 400, color: "var(--text)" }}>
                {t("watch.title")}
              </h1>
            </div>
            <div className={styles.stats}>
              <div className={styles.stat}>
                <span className={styles.statValue}>
                  {plan ? plan.watched : "–"} <small>/ {plan?.total ?? "–"}</small>
                </span>
                <span className="pi-eyebrow" style={{ fontSize: 9.5 }}>{t("watch.statLectures")}</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statValue}>
                  {plan ? duration(watchedMinutes) : "–"} <small>/ {TOTAL_HOURS}h</small>
                </span>
                <span className="pi-eyebrow" style={{ fontSize: 9.5 }}>{t("watch.statTime")}</span>
              </div>
            </div>
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: 13.5, lineHeight: 1.65 }}>{t("watch.intro")}</p>
          {error && (
            <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>
          )}
        </header>

        {featured && (
          <a
            href={watchUrl(featured.course, featured.item)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.resume}
            style={hueVars(COURSE_HUE[featured.course.id])}
          >
            <span className={styles.thumb}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={watchThumbnail(featured.item, "hqdefault")} alt="" width={480} height={270} decoding="async" fetchPriority="high" />
              <span className={styles.play} aria-hidden>▶</span>
              <span className={styles.badge}>
                {featured.item.episodes ? `${t("watch.episodes", { count: featured.item.episodes })} · ` : ""}
                {duration(featured.item.minutes)}
              </span>
            </span>
            <span className={styles.resumeBody}>
              <span className="pi-eyebrow" style={{ color: "var(--hue-ink)" }}>
                {featured.fresh ? t("watch.start") : t("watch.resume")} · {featured.course.title}
              </span>
              <span className={styles.resumeTitle}>{featured.item.title}</span>
              {featured.item.fso && (
                <span className={styles.chips}>
                  <span className={`${styles.chip} ${styles.chipFso}`} title={t("watch.fsoHint")}>FSO {featured.item.fso}</span>
                </span>
              )}
              <span className={styles.playButton}>{t("watch.play")} ↗</span>
            </span>
          </a>
        )}

        {WATCH_COURSES.map((course) => (
          <CourseBlock key={course.id} course={course} plan={plan} watched={watchedSet} onToggle={toggle} />
        ))}

        <section className="flex flex-col gap-2" aria-labelledby="watch-channels">
          <h2 id="watch-channels" className="pi-label">{t("watch.channels")}</h2>
          <div className={styles.channels}>
            {WATCH_CHANNELS.map((channel) => (
              <a
                key={channel.id}
                href={channel.url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.channel}
                style={hueVars(CHANNEL_HUE[channel.id])}
              >
                <span style={{ color: "var(--hue-ink)", fontSize: 15, fontStyle: "italic" }}>{channel.title} ↗</span>
                <span style={{ color: "var(--text-muted)", fontSize: 12.5, lineHeight: 1.5 }}>
                  {t(`watch.channel.${channel.id}`)}
                </span>
              </a>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function CourseBlock({
  course,
  plan,
  watched,
  onToggle,
}: {
  course: WatchCourse;
  plan: WatchPlan | null;
  watched: ReadonlySet<string>;
  onToggle: (itemId: string, watched: boolean) => void;
}) {
  const { t } = useI18n();
  const progress = plan?.courses.find((entry) => entry.id === course.id);
  const share = progress ? progress.watched / progress.total : 0;

  return (
    <section className={styles.course} style={hueVars(COURSE_HUE[course.id])} aria-labelledby={`watch-${course.id}`}>
      <div className={styles.courseHead}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 id={`watch-${course.id}`} className={styles.courseTitle}>{course.title}</h2>
          <span className={styles.count}>
            <strong>{progress ? progress.watched : "–"}</strong> / {course.items.length}
          </span>
        </div>
        <div className={styles.bar} aria-hidden>
          <div className={styles.barFill} style={{ width: `${share * 100}%` }} />
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
          {t(`watch.course.${course.id}.blurb`)}
        </p>
        <div className={styles.links}>
          {course.links.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ui-action pi-chrome-label"
              style={{ fontSize: 10.5 }}
            >
              {link.label} ↗
            </a>
          ))}
        </div>
      </div>

      <ol className={styles.rows}>
        {course.items.map((item, index) => (
          <LectureRow
            key={item.id}
            course={course}
            item={item}
            index={index}
            watched={watched.has(item.id)}
            next={progress?.nextId === item.id}
            disabled={!plan}
            onToggle={onToggle}
          />
        ))}
      </ol>
    </section>
  );
}

function LectureRow({
  course,
  item,
  index,
  watched,
  next,
  disabled,
  onToggle,
}: {
  course: WatchCourse;
  item: WatchItem;
  index: number;
  watched: boolean;
  next: boolean;
  disabled: boolean;
  onToggle: (itemId: string, watched: boolean) => void;
}) {
  const { t } = useI18n();
  const href = watchUrl(course, item);

  return (
    <li
      className={styles.row}
      data-next={next || undefined}
      data-watched={watched || undefined}
      data-optional={item.optional || undefined}
    >
      <input
        type="checkbox"
        checked={watched}
        disabled={disabled}
        onChange={(event) => onToggle(item.id, event.target.checked)}
        aria-label={`${t("watch.mark")}: ${item.title}`}
        className={styles.check}
      />
      {/* The still is a second way to the same video, so it stays out of the
          tab order and the accessibility tree; the title is the link. */}
      <a href={href} target="_blank" rel="noopener noreferrer" className={styles.thumb} tabIndex={-1} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={watchThumbnail(item)} alt="" width={320} height={180} loading="lazy" decoding="async" />
        {watched
          ? <span className={styles.watchedMark}>✓</span>
          : <span className={styles.badge}>{duration(item.minutes)}</span>}
      </a>
      <div className={styles.rowBody}>
        <a href={href} target="_blank" rel="noopener noreferrer" className={`ui-action ${styles.rowTitle}`}>
          {item.title}
        </a>
        <div className={styles.chips}>
          <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
          {next && <span className={`${styles.chip} ${styles.chipNext}`}>{t("watch.next")}</span>}
          {item.fso && (
            <span className={`${styles.chip} ${styles.chipFso}`} title={t("watch.fsoHint")}>FSO {item.fso}</span>
          )}
          {item.optional && <span className={`${styles.chip} ${styles.chipOptional}`}>{t("watch.optional")}</span>}
          {item.episodes && <span className={styles.index}>{t("watch.episodes", { count: item.episodes })}</span>}
        </div>
      </div>
    </li>
  );
}

function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
