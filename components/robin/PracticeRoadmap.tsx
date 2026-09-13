"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  PRACTICE_LISTS, PRACTICE_ROUND_TARGET, dailyPracticePlan, groupByPattern,
  isDue, practiceProgress, problemsInList, statsFor,
  type CatalogProblem, type PracticeList, type PracticeRecord,
} from "@/extension/robin/practice";
import { PracticeDailyPlan } from "./PracticeDailyPlan";
import { PracticeTracker } from "./PracticeTracker";
import { DIFFICULTY_COLOR } from "./practiceSurface";
import type { EventColorKey } from "@/extension/robin/eventColors";
import {
  PRACTICE_TREE, TOPIC_FAMILIES, TREE_WIDTH, TREE_HEIGHT, NODE_HEIGHT, nodeTop, ancestorsOf, familyHue, neighbourOf,
  type Direction, type PracticeTreeNode, type TopicFamily,
} from "./practice-roadmap";
import styles from "./PracticeRoadmap.module.css";

interface Props {
  list: PracticeList;
  onListChange: (list: PracticeList) => void;
  records: Map<string, PracticeRecord>;
  today: string;
  selected: CatalogProblem | null;
  pending: boolean;
  loaded: boolean;
  onSelect: (problem: CatalogProblem) => void;
}

const NODE_BY_PATTERN = new Map<string, PracticeTreeNode>(PRACTICE_TREE.map((node) => [node.pattern, node]));

/** One hue's calendar tokens as local custom properties, so the CSS can pick the alpha per state. */
function hueVars(hue: EventColorKey): CSSProperties {
  return {
    "--hue": `var(--event-${hue})`,
    "--hue-faint": `var(--event-${hue}-faint)`,
    "--hue-soft": `var(--event-${hue}-soft)`,
    "--hue-line": `var(--event-${hue}-line)`,
    "--hue-ink": `var(--todo-${hue})`,
  } as CSSProperties;
}
const topicHue = (pattern: string) => hueVars(familyHue(NODE_BY_PATTERN.get(pattern)?.family ?? "search"));

const RING_RADIUS = 7;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** Solved share of a topic; a finished topic closes into a filled mark. */
function ProgressRing({ value }: { value: number }) {
  const done = value >= 1;
  return (
    <svg viewBox="0 0 18 18" className={styles.ring} data-done={done} aria-hidden="true">
      <circle cx="9" cy="9" r={RING_RADIUS} className={styles.ringTrack} />
      {value > 0 && <circle cx="9" cy="9" r={RING_RADIUS} className={styles.ringValue} transform="rotate(-90 9 9)"
        strokeDasharray={RING_LENGTH} strokeDashoffset={RING_LENGTH * (1 - Math.min(1, value))} />}
      {done && <path d="M5.6 9.2l2.2 2.2 4.4-4.6" className={styles.ringCheck} />}
    </svg>
  );
}

export function PracticeRoadmap({ list, onListChange, records, today, selected, pending, loaded, onSelect }: Props) {
  const { t } = useI18n();
  const [pattern, setPattern] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [family, setFamily] = useState<TopicFamily | null>(null);
  const [query, setQuery] = useState("");
  const treeScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = treeScroll.current;
    if (!container) return;
    // The root is in the middle: a narrow screen must not open on empty space.
    // Only until the reader pans it themselves, and only when the width
    // changes — a height change (a keyboard opening) is not a reason to move.
    let width = -1;
    let panned = false;
    const pan = () => { panned = true; };
    const observer = new ResizeObserver(() => {
      if (panned || container.clientWidth === width) return;
      width = container.clientWidth;
      container.scrollLeft = Math.max(0, (container.scrollWidth - container.clientWidth) / 2);
    });
    observer.observe(container);
    for (const type of ["pointerdown", "wheel", "keydown"] as const) container.addEventListener(type, pan, { passive: true });
    return () => {
      observer.disconnect();
      for (const type of ["pointerdown", "wheel", "keydown"] as const) container.removeEventListener(type, pan);
    };
  }, []);
  const problems = useMemo(() => problemsInList(list), [list]);
  const groups = useMemo(() => groupByPattern(problems, records), [problems, records]);
  const stats = useMemo(() => statsFor(problems, records, today), [problems, records, today]);
  const plan = useMemo(() => dailyPracticePlan(problems, records, today), [problems, records, today]);
  const activePattern = groups.some((group) => group.pattern === pattern) ? pattern : null;
  const activeGroup = groups.find((group) => group.pattern === activePattern) ?? null;
  const search = query.trim().toLowerCase();
  const shown = problems.filter((problem) => search
    ? `${problem.problem} ${problem.pattern}`.toLowerCase().includes(search)
    : problem.pattern === activePattern);
  const visibleNodes = useMemo(
    () => PRACTICE_TREE.filter((node) => groups.some((group) => group.pattern === node.pattern)),
    [groups],
  );

  // Hover (or keyboard focus) traces the route into a topic and where it leads;
  // a selection keeps only its route lit so the tree never stays dimmed.
  const traced = hovered ?? activePattern;
  const route = useMemo(() => {
    if (!traced) return null;
    const ancestors = ancestorsOf(traced, visibleNodes);
    const children = new Set<string>(visibleNodes.filter((node) => (node.from as readonly string[]).includes(traced)).map((node) => node.pattern));
    return { ancestors, children };
  }, [traced, visibleNodes]);
  const onRoute = (name: string) => name === traced || !!route?.ancestors.has(name);
  const inFamily = (name: string) => NODE_BY_PATTERN.get(name)?.family === family;
  const related = (name: string) => onRoute(name) || !!route?.children.has(name);

  const nextInTopic = activeGroup && (
    activeGroup.problems.find((problem) => isDue(records.get(problem.link), today))
    ?? activeGroup.problems.find((problem) => records.get(problem.link)?.status !== "solved")
  );
  const suggestedPattern = (plan.reviews[0] ?? plan.newProblems[0])?.pattern ?? null;
  const activeFamily = activePattern ? NODE_BY_PATTERN.get(activePattern)?.family : undefined;
  const families = TOPIC_FAMILIES.filter((candidate) => visibleNodes.some((node) => node.family === candidate.id));

  const openTopic = (name: string | null) => {
    setPattern(name);
    setQuery("");
    if (!name) return;
    requestAnimationFrame(() => {
      const panel = document.getElementById("practice-topic-problems");
      if (!panel) return;
      // Beside the tree the panel is already in view; stacked, bring it up.
      const top = panel.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.6) panel.scrollIntoView({ block: "start" });
      panel.focus({ preventScroll: true });
    });
  };

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const current = (event.target as HTMLElement).closest<HTMLElement>("[data-pattern]")?.dataset.pattern;
    if (!current) return;
    const target = neighbourOf(current, event.key as Direction, visibleNodes);
    event.preventDefault();
    if (target) event.currentTarget.querySelector<HTMLElement>(`[data-pattern="${CSS.escape(target)}"]`)?.focus();
  };

  return (
    <section id="practice-roadmap" tabIndex={-1} className={styles.roadmap} aria-labelledby="practice-roadmap-title">
      <header className={styles.heading}>
        <div className={styles.titleBlock}>
          <p className="pi-eyebrow">01 / {t("coding.map.explore")}</p>
          <h1 id="practice-roadmap-title">{t("coding.map.title")}</h1>
          <p className={styles.intro}>{t("coding.map.description")}</p>
        </div>
        <div className={styles.summary}>
          <div className={styles.lists} role="group" aria-label={t("coding.rail.catalog")}>
            {PRACTICE_LISTS.map((candidate) => (
              <button key={candidate} type="button" disabled={pending} aria-pressed={candidate === list}
                onClick={() => { setPattern(null); setQuery(""); onListChange(candidate); }}>
                {t(`coding.list.${candidate}`)}
              </button>
            ))}
          </div>
          <p className={styles.total}>
            <strong>{loaded ? stats.solved : "—"}<small> / {stats.total}</small></strong>
            <span>{t("coding.status.solved")}</span>
            {loaded && stats.due > 0 && <span className={styles.due}>{t("coding.rail.due", { count: stats.due })}</span>}
          </p>
          {/* One segment per topic, sized by its problem count and filled by what is solved. */}
          <span className={styles.spectrum} aria-hidden="true" onPointerLeave={() => setHovered(null)}>
            {groups.map((group) => (
              <span key={group.pattern} style={{ ...topicHue(group.pattern), flexGrow: group.problems.length }}
                title={`${group.pattern} · ${loaded ? group.solved : "—"}/${group.problems.length}`}
                onPointerEnter={() => setHovered(group.pattern)}>
                <span style={{ width: `${loaded ? group.solved / group.problems.length * 100 : 0}%` }} />
              </span>
            ))}
          </span>
          <p className={styles.difficulties}>
            {(["Easy", "Medium", "Hard"] as const).map((difficulty) => (
              <span key={difficulty}>
                <i style={{ background: DIFFICULTY_COLOR[difficulty] }} aria-hidden="true" />
                {difficulty} {loaded ? stats.byDifficulty[difficulty].solved : "—"}/{stats.byDifficulty[difficulty].total}
              </span>
            ))}
          </p>
        </div>
      </header>

      <div className={styles.overview}>
        <div className={styles.treeColumn}>
          <ul className={styles.families} aria-label={t("coding.map.families")} onPointerLeave={() => setFamily(null)}>
            {families.map((candidate) => (
              <li key={candidate.id} style={hueVars(candidate.hue)} data-active={candidate.id === activeFamily}
                onPointerEnter={() => setFamily(candidate.id)}>
                {t(`coding.family.${candidate.id}`)}
              </li>
            ))}
          </ul>
          <div ref={treeScroll} className={styles.treeScroll} role="region" aria-label={t("coding.map.tree")} tabIndex={0}
            onKeyDown={moveFocus} onPointerLeave={() => setHovered(null)}>
            <div className={styles.tree} style={{ height: TREE_HEIGHT }} data-tracing={hovered !== null || family !== null}>
              <svg viewBox={`0 0 ${TREE_WIDTH} ${TREE_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true" className={styles.connections}>
                {visibleNodes.flatMap((node) => node.from.map((parent) => {
                  const source = visibleNodes.find((candidate) => candidate.pattern === parent);
                  if (!source) return null;
                  const y1 = nodeTop(source.row) + NODE_HEIGHT;
                  const y2 = nodeTop(node.row);
                  const bend = (y2 - y1) * 0.55;
                  const lit = family !== null ? inFamily(parent) && inFamily(node.pattern)
                    : route !== null && onRoute(parent) && (onRoute(node.pattern) || parent === traced);
                  return <path key={`${parent}-${node.pattern}`} data-lit={lit} style={topicHue(node.pattern)}
                    d={`M ${source.x} ${y1} C ${source.x} ${y1 + bend}, ${node.x} ${y2 - bend}, ${node.x} ${y2}`} />;
                }))}
              </svg>
              {visibleNodes.map((node) => {
                const group = groups.find((candidate) => candidate.pattern === node.pattern)!;
                const due = group.problems.filter((problem) => isDue(records.get(problem.link), today)).length;
                const current = selected?.pattern === node.pattern;
                return (
                  <button key={node.pattern} type="button" className={styles.node} data-pattern={node.pattern}
                    style={{ ...hueVars(familyHue(node.family)), left: `${node.x / TREE_WIDTH * 100}%`, top: nodeTop(node.row) }}
                    aria-pressed={node.pattern === activePattern} aria-controls="practice-topic-problems"
                    aria-label={`${node.pattern} · ${loaded ? t("coding.rail.progress", { solved: group.solved, total: group.problems.length }) : t("robin.common.loading")}${due ? ` · ${t("coding.rail.due", { count: due })}` : ""}${current ? ` · ${t("coding.map.current")}` : ""}`}
                    title={node.label === node.pattern ? undefined : node.pattern}
                    data-current={current} data-standalone={node.from.length === 0 && node.row > 0}
                    data-dim={family !== null ? node.family !== family : hovered !== null && !related(node.pattern)}
                    data-lit={family === null && traced !== null && onRoute(node.pattern)}
                    onPointerEnter={() => setHovered(node.pattern)}
                    onFocus={() => setHovered(node.pattern)} onBlur={() => setHovered(null)}
                    onClick={() => openTopic(node.pattern)}>
                    <span className={styles.nodeName}>{node.label}</span>
                    <span className={styles.nodeMeta}>
                      {loaded ? group.solved : "—"} / {group.problems.length}
                      {due > 0 && <span className={styles.due}> · {t("coding.rail.due", { count: due })}</span>}
                    </span>
                    <ProgressRing value={loaded && group.problems.length ? group.solved / group.problems.length : 0} />
                  </button>
                );
              })}
            </div>
          </div>
          <p className={styles.legend}>
            <span>{t("coding.map.legend")}</span>
            <span className={styles.keysHint}>{t("coding.map.keys")}</span>
            <span className={styles.panHint}>{t("coding.map.panHint")}</span>
            <a className="ui-action" href="https://neetcode.io/roadmap" target="_blank" rel="noopener noreferrer">NeetCode ↗</a>
          </p>
          {loaded && <PracticeTracker records={records} problems={problems} today={today} onSelect={onSelect} />}
        </div>

        <aside className={styles.side}>
          <div className={styles.daily}>
            {today ? <PracticeDailyPlan plan={plan} list={list} onSelect={onSelect} /> : <p>{t("robin.common.loading")}</p>}
          </div>

          <section id="practice-topic-problems" tabIndex={-1} className={styles.topicPanel} aria-labelledby="practice-topic-title" aria-busy={pending}
            data-hued={Boolean(activePattern && !search)} style={activePattern && !search ? topicHue(activePattern) : undefined}>
            <p className="pi-eyebrow">02 / {t("coding.map.choose")}</p>
            <div className={styles.search}>
              <label htmlFor="practice-search" className="sr-only">{t("coding.rail.search")}</label>
              <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4 14 14" /></svg>
              <input id="practice-search" type="search" value={query} placeholder={t("coding.rail.search")}
                onChange={(event) => setQuery(event.target.value)} />
            </div>
            <header className={styles.topicHeader}>
              <div>
                {activeFamily && !search && <p className={styles.familyTag}>{t(`coding.family.${activeFamily}`)}</p>}
                <h2 id="practice-topic-title">{search ? t("coding.map.searchResults") : activePattern ?? t("coding.map.pickTopic")}</h2>
              </div>
              {activePattern && !search && (
                <button type="button" className={styles.clear} onClick={() => setPattern(null)}
                  aria-label={t("coding.map.clearTopic")} title={t("coding.map.clearTopic")}>×</button>
              )}
            </header>

            {activeGroup && !search && (
              <div className={styles.topicSummary}>
                <p>
                  <span>{loaded ? t("coding.rail.progress", { solved: activeGroup.solved, total: activeGroup.problems.length }) : t("robin.common.loading")}</span>
                  {loaded && activeGroup.attempted > 0 && <span>{activeGroup.attempted} {t("coding.status.attempted")}</span>}
                </p>
                <span className={styles.totalTrack} aria-hidden="true">
                  <span style={{ width: `${activeGroup.solved / activeGroup.problems.length * 100}%` }} />
                </span>
                {loaded && (nextInTopic ? (
                  <button type="button" className={styles.nextButton} disabled={pending} onClick={() => onSelect(nextInTopic)}>
                    {t("coding.map.nextInTopic", { problem: nextInTopic.problem })} <span aria-hidden="true">→</span>
                  </button>
                ) : <p className={styles.muted}>{t("coding.map.topicDone")}</p>)}
              </div>
            )}

            {!search && !activePattern ? (
              <div className={styles.empty}>
                <p className={styles.muted}>{t("coding.map.pickHint")}</p>
                {suggestedPattern && (
                  <button type="button" className={styles.nextButton} style={topicHue(suggestedPattern)} onClick={() => openTopic(suggestedPattern)}>
                    {t("coding.map.suggestTopic", { topic: suggestedPattern })} <span aria-hidden="true">→</span>
                  </button>
                )}
              </div>
            ) : shown.length === 0 ? <p role="status" className={styles.muted}>{t("coding.rail.noResults")}</p> : (
              <ul className={styles.problems}>
                {shown.map((problem) => {
                  const record = records.get(problem.link);
                  const status = record?.status ?? "todo";
                  const rounds = practiceProgress(record).rounds;
                  const due = isDue(record, today);
                  return (
                    <li key={problem.link}>
                      <button type="button" className={styles.problem} disabled={pending || !loaded} onClick={() => onSelect(problem)}
                        aria-current={selected?.link === problem.link ? "true" : undefined} data-status={status}>
                        <span className={styles.status} aria-hidden="true" />
                        <span className={styles.problemTitle}>{problem.problem}</span>
                        <span className={styles.difficulty} style={{ color: DIFFICULTY_COLOR[problem.difficulty] }}>{problem.difficulty}</span>
                        <span className="sr-only">{t(`coding.status.${status}`)}</span>
                        <span className={styles.problemMeta} title={t("coding.record.rounds", { count: rounds, target: PRACTICE_ROUND_TARGET })}>
                          {due ? <span className={styles.due}>{t("coding.rail.dueMark")}</span> : rounds > 0 ? `${rounds}/${PRACTICE_ROUND_TARGET}` : ""}
                        </span>
                        {search && <small className={styles.problemPattern} style={topicHue(problem.pattern)}>{problem.pattern}</small>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
