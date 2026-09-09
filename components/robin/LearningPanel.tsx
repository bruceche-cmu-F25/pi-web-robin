"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { EventColorKey } from "@/extension/robin/eventColors";
import { FULLSTACK_STEPS, practiceHref, type LearningSnapshot } from "@/extension/robin/learning";
import { mutate, usePolledResource } from "./usePolledResource";
import { PracticeDailyPlan } from "./PracticeDailyPlan";

const ACTION = "ui-action pi-chrome-label pi-bracket text-xs disabled:opacity-40";
const PRIMARY_ACTION = "ui-action ui-action--outline pi-bracket inline-flex min-h-[44px] items-center justify-center px-3 py-2 text-sm font-medium";
const PARTS = [...new Set(FULLSTACK_STEPS.map((step) => step.part))];

/**
 * Two tracks, two hues from the calendar palette — colour marks the *kind* of
 * learning, exactly the way the product shelf colours its categories. Iris
 * (violet) for the problem track, honey (gold) for the course. The title text
 * stays neutral, so the hue lands on the spine, the label and the chip and
 * never has to carry a paragraph at less than 4.5:1.
 */
const TRACK_COLORS: Record<"problems" | "course", EventColorKey> = {
  problems: "iris",
  course: "honey",
};

function trackSurface(key: EventColorKey) {
  return {
    spine: `4px solid var(--event-${key})`,
    ink: `var(--event-${key})`,
    wash: `var(--event-${key}-soft)`,
    line: `var(--event-${key}-line)`,
  };
}

/** Kind chip, tinted with the track's hue rather than the one accent. */
function KindChip({ label, hue }: { label: string; hue: EventColorKey }) {
  const surface = trackSurface(hue);
  return (
    <span
      className="shrink-0 px-1.5 py-0.5 text-xs"
      style={{
        fontFamily: "var(--font-mono)",
        background: surface.wash,
        color: surface.ink,
        border: `1px solid ${surface.line}`,
      }}
    >
      {label}
    </span>
  );
}

/** A hairline, not a bar chart: one hue, square ends, no label inside. */
function ProgressBar({ done, total, label, hue }: { done: number; total: number; label: string; hue: EventColorKey }) {
  const surface = trackSurface(hue);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      className="w-full"
      style={{ height: 3, background: surface.wash }}
    >
      <div style={{ height: "100%", width: `${total ? (done / total) * 100 : 0}%`, background: surface.ink }} />
    </div>
  );
}

/** One daily front door, backed by the same records as the learning workspace. */
export function LearningPanel({ showCourseOutline = false }: { showCourseOutline?: boolean }) {
  const { t } = useI18n();
  const { data, error, loading, refresh } = usePolledResource<LearningSnapshot>("/api/robin/learning", 15_000);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const complete = async (step: string, completed: boolean) => {
    setBusy(true);
    setActionError(null);
    try {
      await mutate("/api/robin/learning", "PATCH", { step, completed });
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const practice = data?.practice;
  const course = data?.fullstack;
  const currentProblem = practice?.daily.newProblems[0] ?? practice?.daily.reviews[0];
  const completed = new Set(course?.completedIds);

  return (
    <section id="fullstack-open" className="pi-card flex scroll-mt-24 flex-col gap-3 p-4" aria-label={t("learn.title")}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h2 className="pi-label">{t(showCourseOutline ? "learn.daily.continue" : "learn.title")}</h2>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{t("learn.daily.focusHint")}</span>
        </div>
        {!showCourseOutline && (
          <a href="/learn" className="ui-action pi-chrome-label pi-bracket text-xs" data-state="accent">
            {t("learn.daily.hub")}
          </a>
        )}
      </header>

      {loading && !data && <p role="status" className="py-2 text-sm" style={{ color: "var(--text-dim)" }}>{t("learn.daily.loading")}</p>}
      {(error || actionError) && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--danger)" }}>
          <span>{actionError ?? error}</span>
          <button type="button" className={ACTION} onClick={() => void refresh()}>{t("learn.daily.retry")}</button>
        </div>
      )}

      {/* Two tracks, one habit. Side by side on desktop so the card reads as
          one row of the day rather than two stacked panels. */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))" }}>
        {practice && (
          <article className="flex flex-col gap-2 rounded px-2 py-1.5" style={{ background: "var(--bg-subtle)", borderLeft: trackSurface(TRACK_COLORS.problems).spine }}>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="pi-eyebrow" style={{ color: trackSurface(TRACK_COLORS.problems).ink }}>NeetCode · {practice.list === "neetcode150" ? "150" : practice.list === "blind75" ? "Blind 75" : t("coding.list.all")}</h3>
              <span className="pi-eyebrow" style={{ fontVariantNumeric: "tabular-nums" }}>
                {t("learn.progress.solved", { solved: practice.stats.solved, total: practice.stats.total })}
              </span>
            </div>
            <div aria-live="polite" aria-atomic="true" className="flex min-w-0 flex-col items-start gap-3 py-2">
              {currentProblem ? (
                <>
                  <h4 className="text-lg font-medium" style={{ color: "var(--text)", overflowWrap: "anywhere" }}>{currentProblem.problem}</h4>
                  <a href={practiceHref(currentProblem.link, practice.list)} className={PRIMARY_ACTION} data-state="accent">
                    {t(practice.daily.newProblems.length ? "learn.daily.startNew" : "learn.daily.startReview")} →
                  </a>
                </>
              ) : (
                <p className="text-sm" style={{ color: "var(--text)" }}>{t("coding.plan.clear")}</p>
              )}
            </div>
            <a href={`/coding?track=problems&list=${practice.list}`}
              className="ui-action flex min-h-[44px] items-center text-xs" style={{ color: "var(--text-muted)" }}>
              {t("coding.plan.browse")}
            </a>
            <details className="border-t" style={{ borderColor: "var(--border)" }}>
              <summary className="ui-action min-h-[44px] cursor-pointer py-3 text-xs" style={{ color: "var(--text-muted)" }}>
                {t("learn.daily.practiceDetails")}
              </summary>
              <div className="flex flex-col gap-3 pb-2">
                <ProgressBar
                  hue={TRACK_COLORS.problems}
                  done={practice.stats.solved}
                  total={practice.stats.total}
                  label={t("learn.progress.solved", { solved: practice.stats.solved, total: practice.stats.total })}
                />
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("coding.plan.totalRounds", { count: practice.daily.rounds, target: practice.daily.roundTarget })}
                </p>
                <PracticeDailyPlan plan={practice.daily} list={practice.list} />
              </div>
            </details>
          </article>
        )}

        {course && (
          <article className="flex flex-col gap-2 rounded px-2 py-1.5" style={{ background: "var(--bg-subtle)", borderLeft: trackSurface(TRACK_COLORS.course).spine }}>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="pi-eyebrow" style={{ color: trackSurface(TRACK_COLORS.course).ink }}>Full Stack Open</h3>
              <span className="pi-eyebrow" style={{ fontVariantNumeric: "tabular-nums" }}>
                {t("learn.daily.courseProgress", { completed: course.completed, total: course.total })}
              </span>
            </div>
            <div aria-live="polite" aria-atomic="true" className="flex min-w-0 flex-col items-start gap-2 py-2">
              {course.next ? (
                <>
                  <KindChip hue={TRACK_COLORS.course} label={`P${course.next.part} · ${t(`learn.daily.${course.next.kind}`)}`} />
                  <h4 className="text-lg font-medium" style={{ color: "var(--text)", overflowWrap: "anywhere" }}>{course.next.title}</h4>
                </>
              ) : (
                <p className="text-sm" style={{ color: "var(--text-dim)" }}>{t("learn.daily.courseDone")}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {course.next && (
                <>
                  <a href={course.next.url} target="_blank" rel="noopener noreferrer" className={PRIMARY_ACTION} data-state="accent">
                    {t("learn.daily.continueCourse")} ↗
                  </a>
                  <button type="button" className={`${ACTION} min-h-11`} disabled={busy || Boolean(error)} onClick={() => void complete(course.next!.id, true)}>
                    {t(busy ? "learn.daily.saving" : "learn.daily.complete")}
                  </button>
                </>
              )}
              {!showCourseOutline && (
                <a href="/learn#fullstack-open" className="ui-action flex min-h-11 items-center text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("learn.daily.outline")}
                </a>
              )}
              {course.lastCompleted && (
                <button
                  type="button"
                  className="ui-action min-h-11 text-xs disabled:opacity-40"
                  style={{ color: "var(--text-muted)" }}
                  disabled={busy || Boolean(error)}
                  onClick={() => void complete(course.lastCompleted!.id, false)}
                  title={`${t("learn.daily.lastDone")} ${course.lastCompleted.title}`}
                >
                  {t("learn.daily.undo")}
                </button>
              )}
            </div>
            {(course.currentPart || course.upcoming.length > 0) && (
              <details className="border-t" style={{ borderColor: "var(--border)" }}>
                <summary className="ui-action min-h-[44px] cursor-pointer py-3 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("learn.daily.courseDetails")}
                </summary>
                <ProgressBar
                  hue={TRACK_COLORS.course}
                  done={course.completed}
                  total={course.total}
                  label={t("learn.daily.courseProgress", { completed: course.completed, total: course.total })}
                />
            {course.currentPart && (
              <section className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }} aria-label={t("learn.daily.partProgressTitle")}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h4 className="pi-eyebrow">{t("learn.daily.partProgressTitle")} · Part {course.currentPart.part}</h4>
                  <span className="pi-eyebrow" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {course.currentPart.completed}/{course.currentPart.total}
                  </span>
                </div>
                <ProgressBar hue={TRACK_COLORS.course} done={course.currentPart.completed} total={course.currentPart.total}
                  label={t("learn.daily.partProgress", { part: course.currentPart.part, completed: course.currentPart.completed, total: course.currentPart.total })} />
                <p className="text-xs" style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                  {course.currentPart.byKind.map((group) => `${t(`learn.daily.${group.kind}`)} ${group.completed}/${group.total}`).join(" · ")}
                </p>
                <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)", overflowWrap: "anywhere" }}>
                  <span style={{ color: "var(--text)" }}>{t("learn.daily.topics")} · </span>
                  {course.currentPart.topics.join(" · ")}
                </p>
              </section>
            )}
            {course.upcoming.length > 0 && (
              <section className="flex flex-col gap-1 border-t pt-3" style={{ borderColor: "var(--border)" }} aria-label={t("learn.daily.upcoming")}>
                <h4 className="pi-eyebrow">{t("learn.daily.upcoming")}</h4>
                <ol className="flex flex-col">
                  {course.upcoming.map((step, index) => (
                    <li key={step.id} className="flex min-w-0 items-baseline gap-2 text-xs">
                      <span aria-hidden="true" className="pi-eyebrow shrink-0" style={{ color: "var(--text-muted)" }}>{index + 1}.</span>
                      <a href={step.url} target="_blank" rel="noopener noreferrer"
                        className="ui-action flex min-h-11 min-w-0 flex-1 flex-wrap items-baseline gap-x-2 py-2 leading-relaxed"
                        style={{ overflowWrap: "anywhere" }}>
                        <span className="pi-eyebrow shrink-0" style={{ color: "var(--text-muted)" }}>P{step.part} · {t(`learn.daily.${step.kind}`)}</span>
                        <span className="min-w-0">{step.title} ↗</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </section>
            )}
              </details>
            )}
          </article>
        )}
      </div>

      {course && showCourseOutline && (
        <div className="flex flex-col gap-2">
          <p className="pi-eyebrow" style={{ color: "var(--text-muted)" }}>{t("learn.daily.manual")}</p>
          <p className="pi-eyebrow" style={{ color: "var(--text-muted)" }}>{t("learn.daily.scope")}</p>
          {PARTS.map((part) => {
            const steps = FULLSTACK_STEPS.filter((step) => step.part === part);
            const count = steps.filter((step) => completed.has(step.id)).length;
            return (
              <details key={part} className="border-t" style={{ borderColor: "var(--border)" }}>
                <summary className="ui-action flex cursor-pointer items-baseline gap-2 py-2 text-sm">
                  <span style={{ color: count === steps.length ? "var(--accent)" : "var(--text)" }}>Part {part}</span>
                  <span className="pi-eyebrow" style={{ fontVariantNumeric: "tabular-nums" }}>{count}/{steps.length}</span>
                </summary>
                <ol className="flex flex-col pb-2">
                  {steps.map((step) => {
                    const done = completed.has(step.id);
                    const current = step.id === course.next?.id;
                    return (
                      <li key={step.id} className="group flex items-center gap-2 rounded px-2 py-1" style={{ background: current ? "var(--bg-subtle)" : undefined }}>
                        <input
                          type="checkbox"
                          checked={done}
                          disabled={busy || Boolean(error)}
                          aria-label={`${t("learn.daily.complete")}: ${step.title}`}
                          onChange={(event) => void complete(step.id, event.target.checked)}
                        />
                        <span className="pi-eyebrow w-14 shrink-0">{t(`learn.daily.${step.kind}`)}</span>
                        <a
                          href={step.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-current={current ? "step" : undefined}
                          className="ui-action min-w-0 flex-1 truncate text-xs"
                          style={{
                            color: done ? "var(--text-dim)" : current ? "var(--accent)" : "var(--text)",
                            textDecoration: done ? "line-through" : undefined,
                          }}
                        >
                          {step.title} ↗
                        </a>
                        {current && <span className="pi-eyebrow shrink-0" style={{ color: "var(--accent)" }}>{t("learn.daily.current")}</span>}
                      </li>
                    );
                  })}
                </ol>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
