"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  embedUrl,
  leetcodeUrl,
  solutionsUrl,
  videoUrl,
  type CatalogProblem,
} from "@/extension/robin/practice";

export const ROADMAP_URL = "https://neetcode.io/roadmap";

/**
 * The embedded NeetCode pane.
 *
 * Everything about this component assumes the frame is a black box, because it
 * is: a cross-origin document reports nothing back — not its URL, not whether
 * the user solved anything, not even reliably whether it rendered. So the
 * chrome around it is ours, the problem identity comes from the rail that set
 * the src, and the escape hatches (open in a tab, LeetCode, the walkthrough)
 * are always visible rather than offered after a failure we cannot detect.
 */
export function NeetCodeFrame({ problem }: { problem: CatalogProblem | null }) {
  const { t } = useI18n();
  const embedded = problem ? embedUrl(problem) : ROADMAP_URL;
  const url = embedded ?? ROADMAP_URL;
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
  }, [url]);

  const links: Array<{ href: string; label: string }> = [];
  if (problem) {
    if (embedded) links.push({ href: embedded, label: t("coding.frame.openTab") });
    links.push({ href: leetcodeUrl(problem), label: t("coding.frame.leetcode") });
    const walkthrough = videoUrl(problem);
    if (walkthrough) links.push({ href: walkthrough, label: t("coding.frame.video") });
    const solutions = solutionsUrl(problem);
    if (solutions) links.push({ href: solutions, label: t("coding.frame.solution") });
  } else {
    links.push({ href: ROADMAP_URL, label: t("coding.frame.openTab") });
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col" style={{ minHeight: 0 }}>
      <header
        className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b px-3 py-2"
        style={{ borderColor: "var(--border)" }}
      >
        <h2 className="pi-label truncate" title={problem?.problem ?? t("coding.frame.roadmap")}>
          {problem?.problem ?? t("coding.frame.roadmap")}
        </h2>
        {problem ? (
          <span className="pi-eyebrow" style={{ fontSize: 10 }}>
            {problem.difficulty} · {problem.pattern}
          </span>
        ) : null}
        <nav className="ml-auto flex flex-wrap items-baseline gap-3">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="ui-action pi-chrome-label pi-bracket"
              style={{ fontSize: 10 }}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </header>

      {problem && !embedded ? (
        // NeetCode has no page of its own for this problem, and LeetCode sends
        // X-Frame-Options, so there is nothing that can legally be framed here.
        // Say that plainly instead of showing an empty rectangle.
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="pi-prose" style={{ color: "var(--text-muted)", maxWidth: "42ch" }}>
            {t("coding.frame.noEmbed")}
          </p>
          <a
            href={leetcodeUrl(problem)}
            target="_blank"
            rel="noopener noreferrer"
            className="ui-action pi-chrome-label pi-bracket"
            data-state="accent"
          >
            {t("coding.frame.leetcode")}
          </a>
        </div>
      ) : (
        <div className="relative flex-1" style={{ minHeight: 0 }}>
          {loading ? (
            <p
              className="pi-eyebrow absolute left-3 top-3"
              style={{ zIndex: 1, color: "var(--text-dim)" }}
            >
              {t("robin.common.loading")}
            </p>
          ) : null}
          <iframe
            // Re-keyed by URL so navigating replaces the document instead of
            // pushing onto the frame's own history, which we cannot see or pop.
            key={url}
            src={url}
            title="NeetCode"
            onLoad={() => setLoading(false)}
            className="h-full w-full border-0"
            allow="clipboard-write; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      )}
    </section>
  );
}
