"use client";

import { useI18n } from "@/hooks/useI18n";
import { curriculumPath } from "@/extension/robin/study";
import { localizeCurriculumModule } from "@/extension/robin/curriculum-locales";

interface Props {
  /** Null on a phone, where the directory is one full-width pane. */
  width: number | null;
  overviewActive: boolean;
  activeModuleId: string | null;
  onOverview: () => void;
  onSelect: (trackId: string, moduleId: string) => void;
}

/**
 * The fixed, job-focused route through the wider curriculum catalog.
 *
 * This is deliberately navigation rather than progress: the numbers explain
 * dependency order, while the active stripe only says which part of the map is
 * open. It does not claim that anything before it has been completed.
 */
export function CurriculumRail({
  width,
  overviewActive,
  activeModuleId,
  onOverview,
  onSelect,
}: Props) {
  const { locale, t } = useI18n();
  const path = curriculumPath();

  return (
    <aside
      className="flex flex-col"
      aria-label={t("coding.study.pathTitle")}
      style={width === null
        ? { flex: 1, minWidth: 0, minHeight: 0, background: "var(--nav-panel-background)" }
        : {
          width,
          minWidth: width,
          maxWidth: width,
          background: "var(--nav-panel-background)",
        }}
    >
      <header
        className="flex flex-col gap-1 border-b px-3 py-2.5"
        style={{ borderColor: "var(--border)" }}
      >
        <h2 className="pi-label" style={{ fontSize: 11 }}>
          {t("coding.study.pathTitle")}
        </h2>
        <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.45 }}>
          {t("coding.study.pathBlurb")}
        </p>
      </header>

      <nav className="flex-1 overflow-y-auto py-1" style={{ minHeight: 0 }}>
        <button
          type="button"
          onClick={onOverview}
          className="ui-action flex w-full flex-col gap-0.5 border-b px-3 py-2.5 text-left"
          style={{
            color: overviewActive ? "var(--accent)" : "var(--text)",
            borderLeft: overviewActive ? "3px solid var(--accent)" : "3px solid transparent",
            borderBottomColor: "var(--border)",
          }}
          aria-current={overviewActive ? "page" : undefined}
        >
          <span style={{ fontSize: 12.5 }}>{t("coding.study.overviewTitle")}</span>
          <span className="pi-eyebrow" style={{ fontSize: 9 }}>
            {t("coding.study.overviewShort")}
          </span>
        </button>

        <ol className="flex flex-col">
          {path.map(({ track, module: rawModule }, index) => {
            const courseModule = localizeCurriculumModule(rawModule, locale);
            const active = activeModuleId === courseModule.id;
            return (
              <li key={courseModule.id}>
                <button
                  type="button"
                  onClick={() => onSelect(track.id, courseModule.id)}
                  className="ui-action flex w-full items-start gap-2 py-2 pl-3 pr-3 text-left"
                  style={{
                    color: active ? "var(--accent)" : "var(--text)",
                    borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
                  }}
                  aria-current={active ? "step" : undefined}
                  title={courseModule.outcome}
                >
                  <span
                    className="pi-eyebrow shrink-0"
                    style={{
                      width: "2ch",
                      paddingTop: 1,
                      fontSize: 9,
                      color: active ? "var(--accent)" : "var(--text-dim)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                    aria-hidden
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block" style={{ fontSize: 12, lineHeight: 1.3 }}>
                      {courseModule.title}
                    </span>
                    <span
                      className="pi-eyebrow mt-0.5 block truncate"
                      style={{ fontSize: 9, color: "var(--text-dim)" }}
                    >
                      {track.title}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </aside>
  );
}
