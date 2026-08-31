"use client";

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  problemsInList,
  recordMap,
  statsFor,
  type PracticeList,
  type PracticeRecord,
} from "@/extension/robin/practice";
import { LearningShelf } from "./LearningShelf";
import { usePolledResource } from "./usePolledResource";

interface PracticeResponse {
  records: PracticeRecord[];
  list: PracticeList | null;
  today: string;
}

interface HubEntry {
  id: string;
  href: string;
  title: string;
  blurb: string;
  /**
   * Where you already are in it, when that is a thing worth saying. Null while
   * the first poll is in flight, and null for good on an entry that keeps no
   * count.
   */
  progress: string | null;
}

/**
 * The Learning Hub: the front door, and nothing else.
 *
 * A landing page earns its place by being shorter than what it links to. This
 * one holds the ways in and the reading list — no calendar, no todos, no job
 * pipeline. Those live on the dashboard, and duplicating them here would make
 * this a second dashboard rather than a way to choose what to work on. The
 * shelf below is the study links specifically, not the saved-links collection,
 * which is a different shelf for a different part of the day.
 *
 * Entries are built here rather than in a constant file because each one wants
 * live numbers next to it: an entry that says "12/150 solved · 2 due" answers
 * "what should I do now" in a way a bare button cannot. Adding a third entry
 * later is adding one object to the array below.
 */
export function LearningHub() {
  const { t } = useI18n();
  /**
   * Only the practice side is polled.
   *
   * There is nothing to fetch for the curriculum: it keeps no progress, so its
   * entry says what it is rather than how far through it you are. Reviews, on
   * the other hand, are the one number worth putting in front of someone
   * before they choose what to do — a problem due today stops being due if
   * nobody tells them.
   *
   * Slower than the workspace's poll: this is a page you pass through.
   */
  const practice = usePolledResource<PracticeResponse>("/api/robin/practice", 60_000);

  const practiceLine = useMemo(() => {
    if (!practice.data) return null;
    const list = practice.data.list ?? "neetcode150";
    const stats = statsFor(
      problemsInList(list),
      recordMap(practice.data.records),
      practice.data.today,
    );
    const solved = t("learn.progress.solved", { solved: stats.solved, total: stats.total });
    return stats.due > 0 ? `${solved} · ${t("coding.rail.due", { count: stats.due })}` : solved;
  }, [practice.data, t]);

  const entries: HubEntry[] = [
    {
      id: "problems",
      href: "/coding?track=problems",
      title: t("learn.entry.problems.title"),
      blurb: t("learn.entry.problems.blurb"),
      progress: practiceLine,
    },
    {
      id: "curriculum",
      href: "/coding?track=curriculum",
      title: t("learn.entry.curriculum.title"),
      blurb: t("learn.entry.curriculum.blurb"),
      progress: null,
    },
    {
      id: "capability-map",
      href: "/learn/map",
      title: t("learn.entry.capabilityMap.title"),
      blurb: t("learn.entry.capabilityMap.blurb"),
      progress: null,
    },
    {
      id: "gpt2-walkthrough",
      href: "/learn/gpt2",
      title: t("learn.entry.gpt2.title"),
      blurb: t("learn.entry.gpt2.blurb"),
      progress: null,
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

        <section className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          {entries.map((entry) => (
            <a
              key={entry.id}
              href={entry.href}
              className="pi-card ui-action flex flex-col gap-2 p-4"
              style={{ textDecoration: "none" }}
            >
              <span className="pi-label" style={{ fontSize: 13, color: "var(--text)" }}>
                {entry.title}
              </span>
              <span style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
                {entry.blurb}
              </span>
              {/* Reserved even while unknown, so the card does not jump when the
                  first poll lands. */}
              <span
                className="pi-eyebrow"
                style={{ fontSize: 10, fontVariantNumeric: "tabular-nums", minHeight: "1.2em" }}
              >
                {entry.progress ?? ""}
              </span>
            </a>
          ))}
        </section>

        <LearningShelf />
      </main>
    </div>
  );
}
