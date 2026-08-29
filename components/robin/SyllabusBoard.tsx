"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  CURRICULUM,
  curriculumPath,
  type CurriculumItem,
  type CurriculumModule,
  type CurriculumTrack,
} from "@/extension/robin/study";
import { EVENT_COLOR_KEYS } from "@/extension/robin/eventColors";
import { localizeCurriculumModule } from "@/extension/robin/curriculum-locales";
import { CurriculumOverview } from "./CurriculumOverview";

interface Props {
  track: CurriculumTrack;
  onTrackChange: (trackId: string) => void;
  /** The item the mentor is anchored to, marked so the two cannot disagree. */
  selected: string | null;
  overview: boolean;
  focusedModuleId: string | null;
  /** Changes on repeat directory clicks so the same card is revealed again. */
  focusRequest: number;
  onModuleChange: (trackId: string, moduleId: string) => void;
  onOpen: (item: CurriculumItem) => void;
}

/**
 * The overview is one page; the detailed syllabus keeps its original ordered
 * card stream. The added unit briefs explain why each card exists without
 * replacing the catalog structure that was already working.
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
  const modulesRef = useRef<HTMLDivElement>(null);
  const path = curriculumPath();

  useEffect(() => {
    if (overview || !focusedModuleId) return;
    modulesRef.current
      ?.querySelector<HTMLElement>(`[data-study-module="${focusedModuleId}"]`)
      ?.scrollIntoView({ block: "start" });
  }, [overview, track.id, focusedModuleId, focusRequest]);

  if (overview) {
    return <CurriculumOverview onSelect={onModuleChange} />;
  }

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
        <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, maxWidth: "80ch" }}>
          {t(`coding.trackOutcome.${track.id}`)}
        </p>
      </header>

      <div
        className="flex-1 overflow-y-auto"
        style={{ minHeight: 0, background: "var(--dashboard-ground)" }}
      >
        <div ref={modulesRef} className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
          {track.modules.map((rawModule) => {
            const courseModule = localizeCurriculumModule(rawModule, locale);
            return (
              <UnitCard
                key={courseModule.id}
                courseModule={courseModule}
                stageIndex={path.findIndex(({ module }) => module.id === courseModule.id)}
                focused={focusedModuleId === courseModule.id}
                selected={selected}
                onOpen={onOpen}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}

function UnitCard({
  courseModule,
  stageIndex,
  focused,
  selected,
  onOpen,
}: {
  courseModule: CurriculumModule;
  stageIndex: number;
  focused: boolean;
  selected: string | null;
  onOpen: (item: CurriculumItem) => void;
}) {
  const { t } = useI18n();
  const hue = EVENT_COLOR_KEYS[Math.max(stageIndex, 0) % EVENT_COLOR_KEYS.length];
  const guide = courseModule.guide;
  const minimumResource = guide
    ? courseModule.items.find((item) => item.id === guide.minimumItemId)
    : null;

  return (
    <article
      data-study-module={courseModule.id}
      className="pi-panel flex flex-col p-5"
      style={{
        borderTop: `4px solid var(--event-${hue})`,
        borderRightColor: focused ? "var(--accent)" : undefined,
        borderBottomColor: focused ? "var(--accent)" : undefined,
        borderLeftColor: focused ? "var(--accent)" : undefined,
        background: "var(--bg-panel)",
        boxShadow: "var(--card-shadow)",
        scrollMarginTop: 16,
      }}
    >
      <header className="flex flex-col gap-3 border-b pb-4" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-start gap-3">
          {stageIndex >= 0 ? (
            <span
              className="pi-eyebrow flex shrink-0 items-center justify-center"
              style={{
                width: 36,
                height: 36,
                border: `1px solid var(--event-${hue})`,
                color: `var(--todo-${hue})`,
                fontSize: 11,
              }}
              aria-hidden
            >
              {String(stageIndex + 1).padStart(2, "0")}
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <span className="pi-eyebrow block" style={{ fontSize: 9 }}>
              {stageIndex >= 0 ? t("coding.study.coreUnit") : t("coding.study.referenceUnit")}
            </span>
            <h2 style={{ marginTop: 3, fontSize: 20, color: "var(--text)", lineHeight: 1.25 }}>
              {courseModule.title}
            </h2>
          </div>
        </div>

        <section
          className="flex flex-col gap-1.5 p-3"
          style={{
            borderLeft: `3px solid var(--event-${hue})`,
            background: "var(--accent-faint)",
          }}
          aria-labelledby={`objective-${courseModule.id}`}
        >
          <h3 id={`objective-${courseModule.id}`} className="pi-eyebrow" style={{ fontSize: 9 }}>
            {t("coding.study.objective")}
          </h3>
          <p style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.6 }}>
            {courseModule.outcome}
          </p>
        </section>
      </header>

      {guide ? (
        <dl className="flex flex-col py-1">
          <GuideRow label={t("coding.study.plainLanguage")} value={guide.plainLanguage} />
          <GuideRow label={t("coding.study.prerequisites")} value={guide.prerequisites} />
          <GuideRow label={t("coding.study.applicationRole")} value={guide.applicationRole} />
          <GuideRow label={t("coding.study.jobRelevance")} value={guide.jobRelevance} />
          <GuideRow
            label={t("coding.study.minimumResource")}
            value={minimumResource?.title ?? guide.minimumItemId}
          />
          <GuideRow label={t("coding.study.smallExercise")} value={guide.smallExercise} />
          <GuideRow label={t("coding.study.exitCriteria")} value={guide.exitCriteria} last />
        </dl>
      ) : null}

      <section className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <h3 className="pi-label" style={{ fontSize: 10 }}>
          {t("coding.study.resources")}
        </h3>
        <ul className="mt-2 flex flex-col">
          {courseModule.items.map((item, itemIndex) => (
            <li
              key={item.id}
              style={{ borderTop: itemIndex === 0 ? undefined : "1px solid var(--border)" }}
            >
              <ItemRow
                item={item}
                minimum={item.id === guide?.minimumItemId}
                active={selected === item.id}
                onOpen={() => onOpen(item)}
              />
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

function GuideRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-1 py-3"
      style={{ borderBottom: last ? undefined : "1px solid var(--border)" }}
    >
      <dt className="pi-eyebrow" style={{ fontSize: 9 }}>
        {label}
      </dt>
      <dd style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.55 }}>
        {value}
      </dd>
    </div>
  );
}

/** A resource opens in its own tab; a milestone only anchors the mentor. */
function ItemRow({
  item,
  minimum,
  active,
  onOpen,
}: {
  item: CurriculumItem;
  minimum: boolean;
  active: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const milestone = item.kind === "milestone";
  const href = milestone ? null : item.url;

  const body = (
    <>
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1" style={{ fontSize: 13.5, lineHeight: 1.45 }}>
          {item.title}
        </span>
        <span
          className="pi-eyebrow shrink-0"
          style={{
            fontSize: 9,
            color: milestone || minimum ? "var(--accent-amber)" : "var(--text-dim)",
          }}
        >
          {minimum
            ? t("coding.study.minimumMark")
            : milestone
              ? t("coding.study.milestoneMark")
              : t(`coding.kind.${item.kind}`)}
        </span>
      </span>
      {item.hint ? (
        <span style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
          {item.hint}
        </span>
      ) : null}
    </>
  );

  const style = {
    color: active ? "var(--accent)" : "var(--text)",
    borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
    textDecoration: "none",
  };

  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onOpen}
      className="ui-action flex w-full flex-col gap-1 py-2.5 pl-2 pr-1 text-left"
      style={style}
      aria-current={active ? "true" : undefined}
    >
      {body}
    </a>
  ) : (
    <button
      type="button"
      onClick={onOpen}
      className="ui-action flex w-full flex-col gap-1 py-2.5 pl-2 pr-1 text-left"
      style={style}
      aria-current={active ? "true" : undefined}
    >
      {body}
    </button>
  );
}
