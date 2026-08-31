"use client";

import { useI18n } from "@/hooks/useI18n";
import { curriculumOverview, type CurriculumItem } from "@/extension/robin/study";
import { localizeCurriculumModule } from "@/extension/robin/curriculum-locales";
import { EVENT_COLOR_KEYS, type EventColorKey } from "@/extension/robin/eventColors";

interface Props {
  selected: string | null;
  onSelect: (trackId: string, moduleId: string) => void;
  onOpen: (item: CurriculumItem) => void;
}

interface Point {
  x: number;
  y: number;
}

const CANVAS_WIDTH = 1240;
const CANVAS_HEIGHT = 620;

/** Four stages per row let the route use a wide desktop canvas without becoming a tall poster. */
const TOPIC_POINTS: readonly Point[] = [
  { x: 155, y: 120 },
  { x: 465, y: 120 },
  { x: 775, y: 120 },
  { x: 1085, y: 120 },
  { x: 1085, y: 390 },
  { x: 775, y: 390 },
  { x: 465, y: 390 },
  { x: 155, y: 390 },
];

const CHECKPOINT_KEYS = [
  "javascript",
  "state",
  "request",
  "api",
  "data",
  "auth",
  "production",
  "architecture",
] as const;

/**
 * The full-stack system as a spatial roadmap.
 *
 * Like roadmap.sh, the map itself contains only short topic and checkpoint
 * labels. The detail belongs behind the click: what it is, why it matters, how
 * to learn it, an exercise, and resources. Solid lines are the main route;
 * dotted lines are checks, not alternate prerequisites and never progress.
 */
export function CurriculumOverview({ selected, onSelect, onOpen }: Props) {
  const { locale, t } = useI18n();
  const stages = curriculumOverview();

  return (
    <section className="flex min-w-0 flex-1 flex-col" style={{ minHeight: 0 }}>
      <header
        className="flex flex-col gap-3 border-b px-4 py-3"
        style={{ borderColor: "var(--border)", background: "var(--bg-panel)" }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="pi-label" style={{ fontSize: 11 }}>
              {t("coding.study.overviewTitle")}
            </h2>
            <p
              className="pi-prose mt-2"
              style={{ maxWidth: "72ch", fontSize: 14.5, color: "var(--copy)", lineHeight: 1.65 }}
            >
              {t("coding.study.overviewBlurb")}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-3" aria-label={t("coding.study.roadmapLegend.title")}>
            <RoadmapLegend kind="topic" label={t("coding.study.roadmapLegend.topic")} />
            <RoadmapLegend kind="checkpoint" label={t("coding.study.roadmapLegend.checkpoint")} />
          </div>
        </div>
      </header>

      <div
        className="flex-1 overflow-y-auto"
        style={{ minHeight: 0, background: "var(--roadmap-ground)" }}
      >
        <div className="overflow-x-auto">
          <div className="p-4" style={{ minWidth: CANVAS_WIDTH }}>
            <div
              className="relative mx-auto"
              style={{ width: "100%", minWidth: CANVAS_WIDTH - 32, height: CANVAS_HEIGHT }}
            >
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d="M 45 120 H 1165 Q 1195 120 1195 150 V 360 Q 1195 390 1165 390 H 45"
                fill="none"
                stroke="var(--roadmap-path)"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
              />
              {TOPIC_POINTS.slice(0, stages.length).map((point, index) => (
                <line
                  key={CHECKPOINT_KEYS[index]}
                  x1={point.x}
                  y1={point.y + 25}
                  x2={point.x}
                  y2={point.y + 76}
                  stroke={`var(--event-${EVENT_COLOR_KEYS[index % EVENT_COLOR_KEYS.length]}-line)`}
                  strokeWidth="3"
                  strokeDasharray="2 9"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>

            <ol aria-label={t("coding.study.overviewTitle")}>
              {stages.map(({ id, track, module: rawModule }, index) => {
                const courseModule = localizeCurriculumModule(rawModule, locale);
                const point = TOPIC_POINTS[index];
                const hue = EVENT_COLOR_KEYS[index % EVENT_COLOR_KEYS.length];
                if (!point) return null;

                return (
                  <li key={courseModule.id}>
                    <RoadmapNode
                      kind="topic"
                      point={point}
                      hue={hue}
                      label={t(`coding.study.roadmapNode.${id}`)}
                      title={courseModule.guide?.plainLanguage ?? courseModule.outcome}
                      onClick={() => onSelect(track.id, courseModule.id)}
                    />
                    <RoadmapNode
                      kind="checkpoint"
                      point={{ x: point.x, y: point.y + 104 }}
                      hue={hue}
                      label={t(`coding.study.checkpoint.${CHECKPOINT_KEYS[index]}`)}
                      title={courseModule.guide?.smallExercise ?? courseModule.outcome}
                      onClick={() => onSelect(track.id, courseModule.id)}
                    />
                  </li>
                );
              })}
              </ol>
            </div>
          </div>
        </div>

        <section className="border-t px-4 py-6" style={{ borderColor: "var(--border)" }}>
          <div className="mx-auto w-full" style={{ maxWidth: 1500 }}>
            <h2 className="pi-label" style={{ fontSize: 11 }}>
              {t("coding.study.roadmapResources")}
            </h2>
            <div className="mt-4 grid gap-4 desktop:grid-cols-2">
              {stages.map(({ id, module: rawModule }, index) => {
                const courseModule = localizeCurriculumModule(rawModule, locale);
                const hue = EVENT_COLOR_KEYS[index % EVENT_COLOR_KEYS.length];
                const resources = courseModule.items.filter(
                  (item): item is CurriculumItem & { url: string } => Boolean(item.url),
                );

                return (
                  <article
                    key={courseModule.id}
                    className="pi-panel flex min-w-0 flex-col p-4"
                    style={{
                      borderTop: `4px solid var(--event-${hue})`,
                      background: `color-mix(in srgb, var(--bg-panel) 96%, var(--event-${hue}))`,
                    }}
                  >
                    <header className="flex items-baseline justify-between gap-3 border-b pb-3" style={{ borderColor: "var(--border)" }}>
                      <h3 style={{ fontSize: 18, color: "var(--text)", lineHeight: 1.35 }}>
                        {t(`coding.study.roadmapNode.${id}`)}
                      </h3>
                      <span className="pi-eyebrow shrink-0" style={{ fontSize: 9, color: `var(--todo-${hue})` }}>
                        {resources.length}
                      </span>
                    </header>
                    <p className="pi-prose py-3" style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.65 }}>
                      {courseModule.guide.plainLanguage}
                    </p>

                    <ul className="flex flex-col border-t" style={{ borderColor: "var(--border)" }}>
                      {resources.map((item, itemIndex) => {
                        const minimum = item.id === courseModule.guide?.minimumItemId;
                        const active = selected === item.id;
                        return (
                          <li
                            key={item.id}
                            style={{ borderTop: itemIndex === 0 ? undefined : "1px solid var(--border)" }}
                          >
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => onOpen(item)}
                              className="ui-action flex min-h-11 w-full flex-col gap-1 px-2 py-3 text-left"
                              style={{
                                borderLeft: active ? `3px solid var(--event-${hue})` : "3px solid transparent",
                                color: active ? `var(--todo-${hue})` : "var(--text)",
                                textDecoration: "none",
                              }}
                              aria-current={active ? "true" : undefined}
                            >
                              <span className="flex items-baseline gap-2">
                                <span className="min-w-0 flex-1" style={{ fontSize: 13.5, lineHeight: 1.45 }}>
                                  {item.title}
                                </span>
                                <span className="pi-eyebrow shrink-0" style={{ fontSize: 9, color: minimum ? `var(--todo-${hue})` : "var(--text-dim)" }}>
                                  {minimum ? t("coding.study.minimumMark") : t(`coding.kind.${item.kind}`)} ↗
                                </span>
                              </span>
                              {item.hint ? (
                                <span className="pi-prose" style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55 }}>
                                  {item.hint}
                                </span>
                              ) : null}
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

function RoadmapLegend({ kind, label }: { kind: "topic" | "checkpoint"; label: string }) {
  const topic = kind === "topic";
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        style={{
          width: 18,
          height: 18,
          border: topic ? "2px solid var(--event-clay)" : "2px solid var(--event-clay-line)",
          background: topic
            ? "color-mix(in srgb, var(--bg-panel) 68%, var(--event-clay))"
            : "color-mix(in srgb, var(--bg-panel) 88%, var(--event-clay))",
        }}
      />
      <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--text-muted)" }}>
        {label}
      </span>
    </span>
  );
}

function RoadmapNode({
  kind,
  point,
  hue,
  label,
  title,
  onClick,
}: {
  kind: "topic" | "checkpoint";
  point: Point;
  hue: EventColorKey;
  label: string;
  title: string;
  onClick: () => void;
}) {
  const topic = kind === "topic";

  return (
    <button
      type="button"
      onClick={onClick}
      className="study-roadmap-node ui-action absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center px-3 py-2 text-center"
      style={{
        top: point.y,
        left: `${(point.x / CANVAS_WIDTH) * 100}%`,
        width: topic ? 148 : 196,
        minHeight: topic ? 50 : 56,
        border: topic
          ? `2px solid var(--event-${hue})`
          : `2px solid var(--event-${hue}-line)`,
        background: topic
          ? `color-mix(in srgb, var(--bg-panel) 68%, var(--event-${hue}))`
          : `color-mix(in srgb, var(--bg-panel) 88%, var(--event-${hue}))`,
        color: "var(--text)",
        boxShadow: "var(--card-shadow)",
      }}
      title={title}
    >
      <span style={{ fontSize: topic ? 15 : 13, lineHeight: 1.3 }}>
        {label}
      </span>
    </button>
  );
}
