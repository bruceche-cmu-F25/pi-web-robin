"use client";

import { useI18n } from "@/hooks/useI18n";
import { curriculumOverview } from "@/extension/robin/study";
import { localizeCurriculumModule } from "@/extension/robin/curriculum-locales";
import { EVENT_COLOR_KEYS } from "@/extension/robin/eventColors";

interface Props {
  onSelect: (trackId: string, moduleId: string) => void;
}

/** The eight-question world model that the detailed units unpack. */
export function CurriculumOverview({ onSelect }: Props) {
  const { locale, t } = useI18n();
  const stages = curriculumOverview();

  return (
    <section className="flex min-w-0 flex-1 flex-col" style={{ minHeight: 0 }}>
      <header
        className="flex flex-col gap-2 border-b px-4 py-3"
        style={{ borderColor: "var(--border)", background: "var(--bg-panel)" }}
      >
        <h2 className="pi-label" style={{ fontSize: 11 }}>
          {t("coding.study.overviewTitle")}
        </h2>
        <p style={{ maxWidth: "76ch", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55 }}>
          {t("coding.study.overviewBlurb")}
        </p>
      </header>

      <div
        className="flex-1 overflow-y-auto"
        style={{ minHeight: 0, background: "var(--dashboard-ground)" }}
      >
        <ol className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-4">
          {stages.map(({ id, track, module: rawModule }, index) => {
            const courseModule = localizeCurriculumModule(rawModule, locale);
            const hue = EVENT_COLOR_KEYS[index % EVENT_COLOR_KEYS.length];
            return (
              <li key={courseModule.id}>
                <button
                  type="button"
                  onClick={() => onSelect(track.id, courseModule.id)}
                  className="pi-panel ui-action flex w-full items-start gap-4 p-4 text-left"
                  style={{
                    borderLeft: `4px solid var(--event-${hue})`,
                    background: "var(--bg-panel)",
                    boxShadow: "var(--card-shadow)",
                  }}
                >
                  <span
                    className="pi-eyebrow flex shrink-0 items-center justify-center"
                    style={{
                      width: 34,
                      height: 34,
                      border: `1px solid var(--event-${hue})`,
                      color: `var(--todo-${hue})`,
                      fontSize: 11,
                      fontVariantNumeric: "tabular-nums",
                    }}
                    aria-hidden
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className="block"
                      style={{ fontSize: 16, color: "var(--text)", lineHeight: 1.35 }}
                    >
                      {t(`coding.study.overviewStage.${id}`)}
                    </span>
                    <span
                      className="mt-1 block"
                      style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55 }}
                    >
                      {courseModule.guide?.plainLanguage ?? courseModule.outcome}
                    </span>
                    <span
                      className="pi-eyebrow mt-2 block"
                      style={{ fontSize: 9, color: `var(--todo-${hue})` }}
                    >
                      {t("coding.study.openUnit")}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
