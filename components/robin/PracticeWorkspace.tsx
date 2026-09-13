"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsSplitLayout } from "@/hooks/useIsMobile";
import {
  PRACTICE_LISTS, findProblem, interleavedPracticeOrder, problemsInList, recordMap, embedUrl, leetcodeUrl, videoUrl, solutionsUrl,
  type CatalogProblem, type PracticeList, type PracticeRecord, type PracticeStatus,
} from "@/extension/robin/practice";
import { AgentPanel } from "./AgentPanel";
import { NeetCodeFrame, ROADMAP_URL } from "./NeetCodeFrame";
import { PaneDivider } from "./PaneDivider";
import { PracticeRecordBar, type PracticeAttemptInput } from "./PracticeRecordBar";
import { PracticeRoadmap } from "./PracticeRoadmap";
import { DIFFICULTY_COLOR } from "./practiceSurface";
import { WorkspaceHeader, WorkspacePane, WorkspacePaneSwitch } from "./WorkspaceHeader";
import { usePaneWidths } from "./usePaneWidths";
import { mutate, usePolledResource } from "./usePolledResource";
import styles from "./PracticeWorkspace.module.css";

interface PracticeResponse {
  records: PracticeRecord[];
  currentSlug: string | null;
  list: PracticeList | null;
  today: string;
}

const LIST_STORAGE_KEY = "pi-practice-list";
const PANES = [
  { id: "problem", labelKey: "coding.pane.problem" },
  { id: "coach", labelKey: "coding.coach.title" },
] as const;

const COACH_TOOL_KEYS: Record<string, string> = {
  practice_current: "coding.tool.current", practice_list: "coding.tool.list",
  practice_record: "coding.tool.record", practice_status: "coding.tool.status",
  practice_note: "coding.tool.note", practice_due: "coding.tool.due",
};

/** Explicit jumps avoid fighting the cross-origin editor's own scrollbars. */
function jumpTo(id: string) {
  const target = document.getElementById(id);
  target?.scrollIntoView({ block: "start" });
  target?.focus({ preventScroll: true });
}

/** Roadmap → topic selection → practice desk → record. Only selecting another
 * problem replaces the frame; browsing, focus and pane switches keep it mounted. */
export function PracticeWorkspace({ initialProblem, initialList }: {
  initialProblem?: string | null;
  initialList?: string | null;
}) {
  const { t } = useI18n();
  const { data, error, refresh } = usePolledResource<PracticeResponse>("/api/robin/practice", 15_000);
  const [list, setList] = useState<PracticeList>("neetcode150");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [coachOpen, setCoachOpen] = useState(true);
  const [pane, setPane] = useState<(typeof PANES)[number]["id"]>("problem");
  const [actionError, setActionError] = useState<string | null>(null);
  const [adopted, setAdopted] = useState(false);
  const [pending, setPending] = useState(false);
  const selecting = useRef(false);
  const focusTrigger = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef(focusMode);
  const panes = usePaneWidths(false);
  const stacked = !useIsSplitLayout();

  useEffect(() => {
    const stored = initialList && (PRACTICE_LISTS as readonly string[]).includes(initialList)
      ? initialList : window.localStorage.getItem(LIST_STORAGE_KEY);
    if (stored && (PRACTICE_LISTS as readonly string[]).includes(stored)) setList(stored as PracticeList);
  }, [initialList]);

  // Hiding the roadmap changes the scroll height; keep the desk in view in
  // either direction without moving/re-keying the iframe or stealing its focus.
  useEffect(() => {
    if (previousFocus.current === focusMode) return;
    previousFocus.current = focusMode;
    if (selectedSlug) document.getElementById("practice-desk")?.scrollIntoView({ block: "start" });
  }, [focusMode, selectedSlug]);

  useEffect(() => {
    if (!focusMode) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setFocusMode(false);
      focusTrigger.current?.focus();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [focusMode]);

  const records = useMemo(() => recordMap(data?.records ?? []), [data?.records]);
  const selected = useMemo(() => selectedSlug ? findProblem(selectedSlug) : null, [selectedSlug]);
  const problems = useMemo(() => interleavedPracticeOrder(problemsInList(list)), [list]);
  const selectedIndex = selected ? problems.findIndex((problem) => problem.link === selected.link) : -1;
  const nextProblem = selectedIndex >= 0 ? problems[selectedIndex + 1] ?? null : null;
  const selectedRecord = selected ? records.get(selected.link) ?? null : null;
  const externalUrl = selected ? embedUrl(selected) ?? leetcodeUrl(selected) : ROADMAP_URL;
  const walkthrough = selected ? videoUrl(selected) : null;
  const solution = selected ? solutionsUrl(selected) : null;

  const runAction = useCallback(async (action: () => Promise<unknown>) => {
    try {
      setActionError(null);
      await action();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  // Serialize selection writes so the coach's stored current problem cannot
  // race the visible frame. Failed selection leaves the existing editor intact.
  const select = useCallback(async (problem: CatalogProblem, nextList: PracticeList = list) => {
    if (selecting.current) return false;
    selecting.current = true;
    setPending(true);
    try {
      const response = await fetch("/api/robin/practice", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem: problem.link, current: true, list: nextList }),
      });
      const body = await response.json().catch(() => null) as PracticeResponse | { error?: string } | null;
      if (!response.ok || !body || !("currentSlug" in body) || body.currentSlug !== problem.link) {
        throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${response.status})`);
      }
      setSelectedSlug(body.currentSlug);
      setPane("problem");
      await refresh();
      return true;
    } finally {
      selecting.current = false;
      setPending(false);
    }
  }, [list, refresh]);

  // Deep links select through the same server write, but entry still starts at
  // the complete roadmap. Continue is always available for the selected problem.
  useEffect(() => {
    if (!data || adopted) return;
    setAdopted(true);
    if (!initialProblem) {
      setSelectedSlug(data.currentSlug);
      return;
    }
    const problem = findProblem(initialProblem);
    if (!problem) {
      setActionError(t("learn.daily.invalidProblem"));
      return;
    }
    const nextList = initialList && (PRACTICE_LISTS as readonly string[]).includes(initialList)
      ? initialList as PracticeList : list;
    setList(nextList);
    window.localStorage.setItem(LIST_STORAGE_KEY, nextList);
    void runAction(() => select(problem, nextList));
  }, [data, adopted, initialProblem, initialList, list, runAction, select, t]);

  const openProblem = (problem: CatalogProblem) => void runAction(async () => {
    if (await select(problem)) requestAnimationFrame(() => jumpTo("practice-desk"));
  });

  const chooseList = (next: PracticeList) => {
    setList(next);
    window.localStorage.setItem(LIST_STORAGE_KEY, next);
    void runAction(() => mutate("/api/robin/practice", "PATCH", { list: next }));
  };

  const setStatus = async (status: PracticeStatus) => {
    if (!selected) return;
    await mutate("/api/robin/practice", "PATCH", { problem: selected.link, status });
    await refresh();
  };
  const recordAttempt = async (attempt: PracticeAttemptInput) => {
    if (!selected) return;
    await mutate("/api/robin/practice", "POST", { problem: selected.link, ...attempt });
    await refresh();
  };
  const setNote = async (note: string) => {
    if (!selected) return;
    await mutate("/api/robin/practice", "PATCH", { problem: selected.link, note });
    await refresh();
  };

  return (
    <div className={`robin-page robin-typography ${styles.workspace}`} data-practice-focus={focusMode}>
      <div hidden={focusMode}>
        <WorkspaceHeader compact>
          <span className="text-sm">{t("coding.map.practice")}</span>
          {selected && <button type="button" className="ui-action pi-bracket min-h-11 ml-auto text-xs" data-state="accent"
            onClick={() => jumpTo("practice-desk")}>
            {t("coding.map.continue", { problem: selected.problem })} ↓
          </button>}
        </WorkspaceHeader>
      </div>
      {(error ?? actionError) && <p role="alert" className={styles.error}>{error ?? actionError}</p>}
      <div hidden={focusMode}>
        <PracticeRoadmap list={list} onListChange={chooseList} records={records} today={data?.today ?? ""}
          selected={selected} pending={pending} loaded={data !== null} onSelect={openProblem} />
      </div>

      <section id="practice-desk" tabIndex={-1} hidden={!selected} aria-labelledby="practice-problem-title" className={styles.stage}>
        <header className={styles.deskHeader}>
          <div className={styles.identity}>
            <p className="pi-eyebrow">03 / {t("coding.map.practice")}</p>
            <h2 id="practice-problem-title">{selected?.problem}</h2>
            {selected && <span className={styles.difficulty} style={{ color: DIFFICULTY_COLOR[selected.difficulty] }}>{selected.difficulty}</span>}
          </div>
          <div className={styles.deskActions}>
            <button type="button" className="ui-action min-h-11 text-xs" hidden={focusMode} onClick={() => jumpTo("practice-roadmap")}><span aria-hidden="true">↑ </span>{t("coding.map.back")}</button>
            {nextProblem && <button type="button" className="ui-action min-h-11 text-xs" disabled={pending}
              onClick={() => openProblem(nextProblem)}>{t("coding.next", { problem: nextProblem.problem })} <span aria-hidden="true">→</span></button>}
            <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="ui-action min-h-11 text-xs">{t("coding.frame.openTab")} ↗</a>
            {!focusMode && <details className={styles.resources}>
              <summary className="ui-action min-h-11 cursor-pointer text-xs">{t("coding.frame.resources")}</summary>
              <nav aria-label={t("coding.frame.resources")}>
                {selected && <a href={leetcodeUrl(selected)} target="_blank" rel="noopener noreferrer" className="ui-action">LeetCode ↗</a>}
                {walkthrough && <a href={walkthrough} target="_blank" rel="noopener noreferrer" className="ui-action">{t("coding.frame.video")} ↗</a>}
                {solution && <a href={solution} target="_blank" rel="noopener noreferrer" className="ui-action">{t("coding.frame.solution")} ↗</a>}
              </nav>
            </details>}
            {!stacked && <button type="button" hidden={focusMode} className="ui-action min-h-11 text-xs"
              aria-expanded={coachOpen} aria-controls="practice-coach" onClick={() => setCoachOpen((value) => !value)}>
              {t(coachOpen ? "coding.map.hideCoach" : "coding.map.showCoach")}
            </button>}
            <button ref={focusTrigger} type="button" className="ui-action ui-action--outline min-h-11 px-3 text-xs"
              aria-pressed={focusMode} onClick={() => setFocusMode((value) => !value)}>
              {t(focusMode ? "coding.focus.exit" : "coding.focus.enter")}
            </button>
            <button type="button" className={`ui-action min-h-11 px-3 text-xs ${styles.primary}`} onClick={() => {
              setFocusMode(false);
              requestAnimationFrame(() => jumpTo("practice-record"));
            }}>{t("coding.record.log")}</button>
          </div>
          {stacked && !focusMode && <WorkspacePaneSwitch panes={PANES} active={pane} onChange={setPane} />}
        </header>
        <div className={styles.desk}>
          <WorkspacePane active={focusMode ? true : stacked ? pane === "problem" : null}>
            {selected && <NeetCodeFrame problem={selected} />}
          </WorkspacePane>
          {!stacked && !focusMode && coachOpen && <PaneDivider
            edge="right" label={t("coding.pane.panel")} title={t("coding.pane.resetHint")} {...panes.panel} />}
          <WorkspacePane active={focusMode || (!stacked && !coachOpen) ? false : stacked ? pane === "coach" : null}>
            <div id="practice-coach" className={styles.coach} style={stacked
              ? { flex: 1 } : { width: panes.panel.width, maxWidth: "45%", flex: "0 0 auto" }}>
              {selected && <AgentPanel mode="coach" titleKey="coding.coach.title" emptyHintKey="coding.coach.empty"
                placeholderKey="coding.coach.placeholder" restartHintKey="coding.coach.restartHint" toolKeys={COACH_TOOL_KEYS} />}
            </div>
          </WorkspacePane>
        </div>
      </section>

      <section hidden={focusMode || !selected} className={styles.record} aria-label={t("coding.map.reflect")}>
        <p className="pi-eyebrow">04 / {t("coding.map.reflect")}</p>
        {selected && <PracticeRecordBar key={selected.link} slug={selected.link} today={data?.today ?? ""} record={selectedRecord} onStatus={setStatus} onNote={setNote}
          onRecord={recordAttempt} onClose={() => jumpTo("practice-desk")} />}
      </section>
    </div>
  );
}
