"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  CURRICULUM,
  curriculumOverview,
  curriculumPath,
  type CurriculumItem,
  type CurriculumModule,
  type CurriculumTrack,
} from "@/extension/robin/study";
import { EVENT_COLOR_KEYS, type EventColorKey } from "@/extension/robin/eventColors";
import { localizeCurriculumModule } from "@/extension/robin/curriculum-locales";
import { CurriculumOverview } from "./CurriculumOverview";

interface Props {
  track: CurriculumTrack;
  onTrackChange: (trackId: string) => void;
  /** The item the mentor is anchored to, marked so the two cannot disagree. */
  selected: string | null;
  overview: boolean;
  focusedModuleId: string | null;
  /** Changes on repeat directory clicks so the same unit returns to its start. */
  focusRequest: number;
  onModuleChange: (trackId: string, moduleId: string) => void;
  onOpen: (item: CurriculumItem) => void;
}

/**
 * One complete module at a time.
 *
 * The page uses the full center canvas: context sits beside the learning route,
 * every resource stays visible, and the exercise and exit standard close the
 * loop. The same shared card renders every track, so reference material cannot
 * quietly fall back to a bare list of links.
 */
export function SyllabusBoard({
  track,
  onTrackChange,
  selected,
  overview,
  focusedModuleId,
  focusRequest,
  onModuleChange,
  onOpen,
}: Props) {
  const { locale, t } = useI18n();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const path = curriculumPath();
  const rawModule = track.modules.find((courseModule) => courseModule.id === focusedModuleId)
    ?? track.modules[0];

  useEffect(() => {
    if (overview) return;
    scrollerRef.current?.scrollTo({ top: 0 });
  }, [overview, track.id, rawModule?.id, focusRequest]);

  if (overview) {
    return (
      <CurriculumOverview
        selected={selected}
        onSelect={onModuleChange}
        onOpen={onOpen}
      />
    );
  }

  if (!rawModule) return null;

  const courseModule = localizeCurriculumModule(rawModule, locale);
  const stageIndex = path.findIndex(({ module }) => module.id === courseModule.id);
  const overviewIndex = curriculumOverview().findIndex(({ module }) => module.id === courseModule.id);

  return (
    <section className="flex min-w-0 flex-1 flex-col" style={{ minHeight: 0 }}>
      <header
        className="flex flex-col gap-2 border-b px-4 py-2.5"
        style={{ borderColor: "var(--border)", background: "var(--bg-panel)" }}
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {CURRICULUM.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => onTrackChange(candidate.id)}
              className="ui-action pi-chrome-label pi-bracket"
              data-state={candidate.id === track.id ? "accent" : undefined}
              style={{ fontSize: 10 }}
              title={candidate.title}
            >
              {t(`coding.trackName.${candidate.id}`)}
            </button>
          ))}
        </div>

        <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, maxWidth: "90ch" }}>
          {t(`coding.trackOutcome.${track.id}`)}
        </p>

        <label className="flex items-center gap-2" htmlFor="study-unit-select">
          <span className="pi-eyebrow shrink-0" style={{ fontSize: 9 }}>
            {t("coding.study.units")}
          </span>
          <select
            id="study-unit-select"
            value={rawModule.id}
            onChange={(event) => onModuleChange(track.id, event.target.value)}
            style={{
              minWidth: 0,
              minHeight: 44,
              flex: 1,
              border: "1px solid var(--border)",
              borderRadius: 0,
              padding: "7px 10px",
              background: "var(--control-bg)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            }}
          >
            {track.modules.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {localizeCurriculumModule(candidate, locale).title}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto"
        style={{ minHeight: 0, background: "var(--dashboard-ground)" }}
      >
        <div className="mx-auto w-full p-4 desktop:p-6" style={{ maxWidth: 1500 }}>
          <UnitCanvas
            courseModule={courseModule}
            stageIndex={stageIndex}
            colorIndex={overviewIndex >= 0 ? overviewIndex : stageIndex}
            totalStages={path.length}
            selected={selected}
            onOpen={onOpen}
          />
        </div>
      </div>
    </section>
  );
}

function UnitCanvas({
  courseModule,
  stageIndex,
  colorIndex,
  totalStages,
  selected,
  onOpen,
}: {
  courseModule: CurriculumModule;
  stageIndex: number;
  colorIndex: number;
  totalStages: number;
  selected: string | null;
  onOpen: (item: CurriculumItem) => void;
}) {
  const { t } = useI18n();
  const hue = EVENT_COLOR_KEYS[Math.max(colorIndex, 0) % EVENT_COLOR_KEYS.length];
  const guide = courseModule.guide;

  return (
    <article
      data-study-module={courseModule.id}
      className="pi-panel overflow-hidden"
      style={{
        borderTop: `5px solid var(--event-${hue})`,
        background: `color-mix(in srgb, var(--bg-panel) 97%, var(--event-${hue}))`,
        boxShadow: "var(--card-shadow)",
      }}
    >
      <header
        className="grid gap-5 border-b p-5 desktop:grid-cols-[auto_minmax(0,1fr)] desktop:p-8"
        style={{ borderColor: "var(--border)" }}
      >
        <StageMark stageIndex={stageIndex} totalStages={totalStages} hue={hue} />
        <div className="min-w-0">
          <span className="pi-eyebrow block" style={{ fontSize: 9, color: `var(--todo-${hue})` }}>
            {stageIndex >= 0 ? t("coding.study.coreUnit") : t("coding.study.referenceUnit")}
          </span>
          <h2
            style={{
              maxWidth: "36ch",
              marginTop: 6,
              fontSize: "clamp(1.6rem, 3vw, 2.5rem)",
              color: "var(--text)",
              lineHeight: 1.12,
              letterSpacing: "-0.025em",
              textWrap: "balance",
            }}
          >
            {courseModule.title}
          </h2>
          <section className="mt-5" aria-labelledby={`objective-${courseModule.id}`}>
            <h3 id={`objective-${courseModule.id}`} className="pi-eyebrow" style={{ fontSize: 9 }}>
              {t("coding.study.objective")}
            </h3>
            <p
              className="pi-prose"
              style={{ maxWidth: "78ch", marginTop: 7, fontSize: 17, color: "var(--text)", lineHeight: 1.7 }}
            >
              {courseModule.outcome}
            </p>
          </section>
        </div>
      </header>

      <div className="grid gap-px desktop:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.55fr)]" style={{ background: "var(--border)" }}>
        <aside className="flex flex-col gap-6 p-5 desktop:p-7" style={{ background: "var(--bg-panel)" }}>
          <section aria-labelledby={`plain-${courseModule.id}`}>
            <LearningSectionHeading step="01" label={t("coding.study.what")} hue={hue} />
            <div
              className="mt-3 p-4"
              style={{ borderLeft: `3px solid var(--event-${hue})`, background: `var(--event-${hue}-faint)` }}
            >
              <h3 id={`plain-${courseModule.id}`} className="pi-eyebrow" style={{ fontSize: 9 }}>
                {t("coding.study.plainLanguage")}
              </h3>
              <p className="pi-prose" style={{ marginTop: 8, fontSize: 15, color: "var(--text)", lineHeight: 1.75 }}>
                {guide.plainLanguage}
              </p>
            </div>
          </section>

          <dl className="flex flex-col gap-px" style={{ border: "1px solid var(--border)", background: "var(--border)" }}>
            <GuideFact label={t("coding.study.prerequisites")} value={guide.prerequisites} />
            <GuideFact label={t("coding.study.applicationRole")} value={guide.applicationRole} />
            <GuideFact label={t("coding.study.jobRelevance")} value={guide.jobRelevance} />
          </dl>
        </aside>

        <section className="flex min-w-0 flex-col gap-5 p-5 desktop:p-7" style={{ background: "var(--bg-panel)" }} aria-label={t("coding.study.how")}>
          <div>
            <LearningSectionHeading step="02" label={t("coding.study.how")} hue={hue} />
            <p className="pi-prose mt-3" style={{ maxWidth: "72ch", fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
              {t("coding.study.minimumResource")}: {courseModule.items.find((item) => item.id === guide.minimumItemId)?.title ?? guide.minimumItemId}
            </p>
          </div>

          <ol className="grid gap-3 desktop:grid-cols-2">
            {courseModule.items.map((item, index) => {
              const minimum = item.id === guide.minimumItemId;
              const milestone = item.kind === "milestone";
              return (
                <ResourceCard
                  key={item.id}
                  item={item}
                  index={index}
                  minimum={minimum}
                  active={selected === item.id}
                  hue={hue}
                  wide={minimum || milestone}
                  onOpen={() => onOpen(item)}
                />
              );
            })}
          </ol>

          <div className="mt-auto grid gap-3 desktop:grid-cols-2">
            <LearningCheck
              label={t("coding.study.smallExercise")}
              value={guide.smallExercise}
              borderColor={`var(--event-${hue})`}
            />
            <LearningCheck
              label={t("coding.study.exitCriteria")}
              value={guide.exitCriteria}
              borderColor="var(--success)"
            />
          </div>
        </section>
      </div>
    </article>
  );
}

function StageMark({ stageIndex, totalStages, hue }: { stageIndex: number; totalStages: number; hue: EventColorKey }) {
  if (stageIndex < 0) {
    return <span aria-hidden className="hidden desktop:block" style={{ width: 58 }} />;
  }

  return (
    <span
      className="pi-eyebrow flex shrink-0 items-center justify-center"
      style={{
        width: 58,
        height: 58,
        border: `1px solid var(--event-${hue})`,
        background: `var(--event-${hue}-faint)`,
        color: `var(--todo-${hue})`,
        fontSize: 10,
        fontVariantNumeric: "tabular-nums",
      }}
      aria-label={`${stageIndex + 1} / ${totalStages}`}
    >
      {String(stageIndex + 1).padStart(2, "0")}/{String(totalStages).padStart(2, "0")}
    </span>
  );
}

function LearningSectionHeading({ step, label, hue }: { step: string; label: string; hue: EventColorKey }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="pi-eyebrow flex h-7 w-7 shrink-0 items-center justify-center"
        style={{ border: `1px solid var(--event-${hue})`, color: `var(--todo-${hue})`, fontSize: 9 }}
        aria-hidden
      >
        {step}
      </span>
      <h3 className="pi-label" style={{ borderLeftColor: `var(--event-${hue})`, fontSize: 11 }}>
        {label}
      </h3>
    </div>
  );
}

function GuideFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4" style={{ background: "var(--bg-panel)" }}>
      <dt className="pi-eyebrow" style={{ fontSize: 9 }}>{label}</dt>
      <dd className="pi-prose" style={{ marginTop: 7, fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.65 }}>
        {value}
      </dd>
    </div>
  );
}

function LearningCheck({ label, value, borderColor }: { label: string; value: string; borderColor: string }) {
  return (
    <section className="p-4" style={{ borderLeft: `3px solid ${borderColor}`, background: "var(--bg-hover)" }}>
      <h3 className="pi-eyebrow" style={{ fontSize: 9 }}>{label}</h3>
      <p className="pi-prose" style={{ marginTop: 8, fontSize: 14.5, color: "var(--text)", lineHeight: 1.68 }}>
        {value}
      </p>
    </section>
  );
}

function ResourceCard({
  item,
  index,
  minimum,
  active,
  hue,
  wide,
  onOpen,
}: {
  item: CurriculumItem;
  index: number;
  minimum: boolean;
  active: boolean;
  hue: EventColorKey;
  wide: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const milestone = item.kind === "milestone";
  const href = milestone ? null : item.url;
  const host = href ? hostOf(href) : null;

  const content = (
    <>
      <span className="flex items-center justify-between gap-3">
        <span className="pi-eyebrow" style={{ fontSize: 9, color: minimum || milestone ? `var(--todo-${hue})` : "var(--text-dim)" }}>
          {String(index + 1).padStart(2, "0")} · {minimum ? t("coding.study.minimumMark") : milestone ? t("coding.study.milestoneMark") : t(`coding.kind.${item.kind}`)}
        </span>
        {host ? <span className="pi-eyebrow" style={{ fontSize: 8, color: "var(--text-dim)" }}>{host}</span> : null}
      </span>
      <strong style={{ fontSize: 15, lineHeight: 1.4, fontWeight: 500 }}>{item.title}</strong>
      <span className="pi-prose" style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.65 }}>
        {item.hint}
      </span>
      <span className="pi-eyebrow mt-auto pt-2" style={{ fontSize: 9, color: active ? "var(--accent)" : `var(--todo-${hue})` }}>
        {milestone ? t("coding.study.milestoneMark") : `${t(`coding.kind.${item.kind}`)} ↗`}
      </span>
    </>
  );

  const className = `ui-action flex min-h-44 w-full flex-col gap-2.5 p-4 text-left${wide ? " desktop:col-span-2" : ""}`;
  const style = {
    border: active ? "1px solid var(--accent)" : `1px solid ${minimum || milestone ? `var(--event-${hue})` : "var(--border)"}`,
    borderLeft: active ? "4px solid var(--accent)" : minimum || milestone ? `4px solid var(--event-${hue})` : "1px solid var(--border)",
    background: minimum || milestone ? `var(--event-${hue}-faint)` : "var(--bg-hover)",
    color: active ? "var(--accent)" : "var(--text)",
    textDecoration: "none",
  };

  return href ? (
    <li className={wide ? "desktop:col-span-2" : undefined}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onOpen}
        className={className.replace(" desktop:col-span-2", "")}
        style={style}
        aria-current={active ? "true" : undefined}
      >
        {content}
      </a>
    </li>
  ) : (
    <li className={wide ? "desktop:col-span-2" : undefined}>
      <button type="button" onClick={onOpen} className={className.replace(" desktop:col-span-2", "")} style={style} aria-current={active ? "true" : undefined}>
        {content}
      </button>
    </li>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}
