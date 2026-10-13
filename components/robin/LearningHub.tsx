"use client";

import { useI18n } from "@/hooks/useI18n";
import { LearningShelf } from "./LearningShelf";
import { LearningPanel } from "./LearningPanel";
import { FDE_ROADMAP_URL } from "@/extension/robin/learning-shelf";

interface HubEntry {
  id: string;
  href: string;
  title: string;
  blurb: string;
}

/**
 * The Learning Hub: the front door, and nothing else.
 *
 * A landing page earns its place by being shorter than what it links to. This
 * one holds today's two tracks, the other ways in, and the reading list — no
 * calendar, no todos, no job pipeline. Those live on the dashboard, and
 * duplicating them here would make this a second dashboard rather than a way
 * to choose what to work on. The shelf below is the study links specifically,
 * not the saved-links collection, which is a different shelf for a different
 * part of the day.
 *
 * Problem practice has no entry of its own here: the NeetCode track above
 * already is its way in, with the same count, so a card repeating it only
 * pushed the rest below the fold. Full Stack Open is the full-stack spine,
 * with its own workspace.
 */
export function LearningHub() {
  const { t } = useI18n();

  const entries: HubEntry[] = [
    {
      id: "fso",
      href: "/learn/fso",
      title: t("learn.entry.fso.title"),
      blurb: t("learn.entry.fso.blurb"),
    },
    {
      id: "capability-map",
      href: "/learn/map",
      title: t("learn.entry.capabilityMap.title"),
      blurb: t("learn.entry.capabilityMap.blurb"),
    },
    {
      id: "gpt2-walkthrough",
      href: "/learn/gpt2",
      title: t("learn.entry.gpt2.title"),
      blurb: t("learn.entry.gpt2.blurb"),
    },
    {
      id: "watch",
      href: "/learn/watch",
      title: t("learn.entry.watch.title"),
      blurb: t("learn.entry.watch.blurb"),
    },
  ];

  return (
    // `robin-dashboard` is what scopes the card styling this page borrows;
    // globals.css locks the body to the viewport for the chat shell, so a
    // document page brings its own scroll container.
    <div className="robin-page robin-dashboard flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 desktop:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl" style={{ fontStyle: "italic", fontWeight: 400, color: "var(--text)" }}>
              {t("learn.title")}
            </h1>
            <p className="pi-eyebrow">{t("learn.subtitle")}</p>
          </div>
        </div>

        <LearningPanel showCourseOutline />

        <section className="pi-card flex flex-col gap-5 p-5 desktop:p-6" aria-labelledby="fde-roadmap-title">
          <header className="flex flex-col gap-4 desktop:flex-row desktop:items-start desktop:justify-between">
            <div className="max-w-3xl">
              <p className="pi-eyebrow" style={{ color: "var(--accent)" }}>{t("learn.fde.eyebrow")}</p>
              <h2 id="fde-roadmap-title" className="mt-2 text-2xl italic" style={{ color: "var(--text)" }}>
                {t("learn.fde.title")}
              </h2>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {t("learn.fde.intro")}
              </p>
            </div>
            <a
              href={FDE_ROADMAP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="ui-action ui-action--card inline-flex min-h-11 shrink-0 items-center gap-3 px-4 py-2 text-sm"
              style={{ color: "var(--accent)", textDecoration: "none" }}
            >
              {t("learn.fde.open")} <span aria-hidden="true">↗</span>
            </a>
          </header>
          <ol className="grid grid-cols-1 gap-px desktop:grid-cols-4" style={{ background: "var(--border)", border: "1px solid var(--border)" }}>
            {[1, 2, 3, 4].map((week) => (
              <li key={week} className="flex flex-col gap-2 p-4" style={{ background: "var(--bg-panel)" }}>
                <span className="pi-eyebrow" style={{ color: "var(--accent)" }}>{t(`learn.fde.week${week}.label`)}</span>
                <span className="text-base font-semibold" style={{ color: "var(--text)" }}>{t(`learn.fde.week${week}.title`)}</span>
                <span className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>{t(`learn.fde.week${week}.detail`)}</span>
              </li>
            ))}
          </ol>
          <div className="grid gap-3 desktop:grid-cols-2">
            <p className="border-l-2 pl-3 text-sm leading-relaxed" style={{ borderColor: "var(--accent)", color: "var(--text)" }}>
              {t("learn.fde.value")}
            </p>
            <p className="border-l-2 pl-3 text-sm leading-relaxed" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
              {t("learn.fde.limit")}
            </p>
          </div>
        </section>

        {/* One sheet ruled into columns, like a contents page: the ways in
            are read as a set, not as cards competing with today's tracks.
            The 1px gap over a border-coloured ground draws the hairlines. */}
        <section className="pi-card flex flex-col gap-3 p-4" aria-labelledby="learn-more">
          <h2 id="learn-more" className="pi-label">{t("learn.more")}</h2>
          <ul className="grid grid-cols-1 gap-px desktop:grid-cols-2" style={{ background: "var(--border)", border: "1px solid var(--border)" }}>
            {entries.map((entry) => (
              <li key={entry.id} className="flex" style={{ background: "var(--bg-panel)" }}>
                <a
                  href={entry.href}
                  className="ui-action flex min-h-11 flex-1 flex-col gap-1.5 px-4 py-3"
                  style={{ textDecoration: "none" }}
                >
                  <span className="flex items-baseline justify-between gap-3" style={{ color: "var(--text)", fontSize: 17, fontStyle: "italic" }}>
                    {entry.title}
                    <span aria-hidden="true" style={{ color: "var(--accent)", fontStyle: "normal" }}>→</span>
                  </span>
                  <span style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55 }}>
                    {entry.blurb}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <LearningShelf />
      </main>
    </div>
  );
}
