"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  PRACTICE_LISTS,
  groupByPattern,
  isDue,
  problemsInList,
  statsFor,
  type CatalogProblem,
  type PracticeList,
  type PracticeRecord,
} from "@/extension/robin/practice";

const STATUS_MARK: Record<string, string> = {
  todo: "·",
  attempted: "~",
  solved: "x",
};

interface Props {
  /** Set by the workspace, which owns the drag; see ./paneWidths.ts. */
  width: number;
  list: PracticeList;
  onListChange: (list: PracticeList) => void;
  records: Map<string, PracticeRecord>;
  today: string;
  selected: string | null;
  onSelect: (problem: CatalogProblem) => void;
}

/**
 * The roadmap, as a list rather than the graph NeetCode draws.
 *
 * The graph is the better picture and it is already one click away in the
 * frame; what a rail is better at is the thing the graph cannot show — where
 * you actually are. So this side is ordered by the roadmap's own teaching
 * order and carries the state: solved, attempted, due for review.
 */
export function RoadmapRail({ width, list, onListChange, records, today, selected, onSelect }: Props) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const problems = useMemo(() => problemsInList(list), [list]);
  const groups = useMemo(() => groupByPattern(problems, records), [problems, records]);
  const stats = useMemo(() => statsFor(problems, records, today), [problems, records, today]);

  const toggle = (pattern: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(pattern)) next.delete(pattern);
      else next.add(pattern);
      return next;
    });
  };

  return (
    <aside
      id="roadmap-rail"
      className="flex flex-col"
      // No border: the PaneDivider beside it is the line, and two would read
      // as a double rule.
      style={{ width, minWidth: width, maxWidth: width }}
    >
      <header
        className="flex flex-col gap-2 border-b px-3 py-2"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-baseline gap-2">
          {PRACTICE_LISTS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => onListChange(candidate)}
              className="ui-action pi-chrome-label pi-bracket"
              data-state={candidate === list ? "accent" : undefined}
              style={{ fontSize: 10 }}
            >
              {t(`coding.list.${candidate}`)}
            </button>
          ))}
        </div>
        <p className="pi-eyebrow" style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}>
          {t("coding.rail.progress", { solved: stats.solved, total: stats.total })}
          {stats.due > 0 ? ` · ${t("coding.rail.due", { count: stats.due })}` : ""}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.pattern);
          return (
            <section key={group.pattern}>
              <button
                type="button"
                onClick={() => toggle(group.pattern)}
                className="ui-action flex w-full items-baseline gap-2 px-3 py-1.5 text-left"
                aria-expanded={!isCollapsed}
              >
                <span className="pi-label truncate" style={{ fontSize: 11 }}>
                  {group.pattern}
                </span>
                <span
                  className="pi-eyebrow ml-auto"
                  style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}
                >
                  {group.solved}/{group.problems.length}
                </span>
              </button>

              {isCollapsed ? null : (
                <ul className="flex flex-col">
                  {group.problems.map((problem) => {
                    const record = records.get(problem.link);
                    const status = record?.status ?? "todo";
                    const due = isDue(record, today);
                    const active = selected === problem.link;
                    return (
                      <li key={problem.link}>
                        <button
                          type="button"
                          onClick={() => onSelect(problem)}
                          className="ui-action flex w-full items-baseline gap-2 py-1 pl-5 pr-3 text-left"
                          style={{
                            color: active
                              ? "var(--accent)"
                              : status === "solved"
                                ? "var(--text-dim)"
                                : "var(--text)",
                            borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
                          }}
                          aria-current={active ? "true" : undefined}
                          title={`${problem.problem} — ${problem.difficulty}`}
                        >
                          <span
                            aria-hidden
                            style={{ fontFamily: "var(--font-mono)", fontSize: 11, width: "1ch" }}
                          >
                            {STATUS_MARK[status]}
                          </span>
                          <span className="min-w-0 flex-1 truncate" style={{ fontSize: 12.5 }}>
                            {problem.problem}
                          </span>
                          {due ? (
                            <span
                              className="pi-eyebrow"
                              style={{ fontSize: 9, color: "var(--accent-amber)" }}
                              title={t("coding.rail.dueTitle")}
                            >
                              {t("coding.rail.dueMark")}
                            </span>
                          ) : null}
                          <span
                            className="pi-eyebrow"
                            style={{ fontSize: 9, color: "var(--text-dim)" }}
                          >
                            {problem.difficulty.slice(0, 1)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
