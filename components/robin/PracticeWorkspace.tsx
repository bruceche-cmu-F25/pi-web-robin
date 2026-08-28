"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  PRACTICE_LISTS,
  findProblem,
  recordMap,
  suggestNext,
  problemsInList,
  type CatalogProblem,
  type PracticeList,
  type PracticeRecord,
  type PracticeStatus,
} from "@/extension/robin/practice";
import { AgentPanel } from "./AgentPanel";
import { NeetCodeFrame } from "./NeetCodeFrame";
import { PaneDivider } from "./PaneDivider";
import { PracticeRecordBar } from "./PracticeRecordBar";
import { RoadmapRail } from "./RoadmapRail";
import {
  WorkspaceHeader,
  WorkspacePane,
  WorkspacePaneSwitch,
  type WorkspaceChrome,
} from "./WorkspaceHeader";
import { usePaneWidths } from "./usePaneWidths";
import { mutate, usePolledResource } from "./usePolledResource";

interface PracticeResponse {
  records: PracticeRecord[];
  currentSlug: string | null;
  list: PracticeList | null;
  today: string;
}

const LIST_STORAGE_KEY = "pi-practice-list";
const RAIL_STORAGE_KEY = "pi-practice-rail";

/**
 * The three panes, in the order a phone steps through them: pick a problem,
 * work on it, ask about it.
 */
const PANES = [
  { id: "rail", labelKey: "coding.rail.show" },
  { id: "problem", labelKey: "coding.pane.problem" },
  { id: "coach", labelKey: "coding.coach.title" },
] as const;

type Pane = (typeof PANES)[number]["id"];

/** Tool name → i18n key, for the line under a coach reply saying what it touched. */
const COACH_TOOL_KEYS: Record<string, string> = {
  practice_current: "coding.tool.current",
  practice_list: "coding.tool.list",
  practice_record: "coding.tool.record",
  practice_status: "coding.tool.status",
  practice_note: "coding.tool.note",
  practice_due: "coding.tool.due",
};

/**
 * The problems track: roadmap, problem, coach.
 *
 * A workspace rather than a document, so unlike the dashboard it fills the
 * viewport and each column scrolls on its own — the frame in the middle is a
 * full application and must not be pushed around by a page scrollbar.
 *
 * Which problem is open is server state, not component state. It has to be:
 * the coach runs on the server and its only way of knowing what "this problem"
 * means is the record written when the rail was clicked.
 */
export function PracticeWorkspace(chrome: WorkspaceChrome) {
  const { t } = useI18n();
  const { data, error, refresh } = usePolledResource<PracticeResponse>("/api/robin/practice", 15_000);
  const [list, setList] = useState<PracticeList>("neetcode150");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  // The problem the newest click asked for. A slower earlier request must not
  // be allowed to drag the page back to the problem before it.
  const requestedSlug = useRef<string | null>(null);
  // Until the first response lands, the server's answer is unknown; adopting it
  // once avoids overriding a later click with a stale value.
  const [adopted, setAdopted] = useState(false);
  const panes = usePaneWidths(railOpen);
  /**
   * A phone gets one pane at a time.
   *
   * Three columns do not fit 375px: the widths that make the rail and the
   * coach readable on a desktop leave the frame between them at zero, and the
   * frame is the problem you came to solve. The rail's own show/hide toggle
   * cannot answer this — hiding it still leaves two columns fighting over a
   * screen with room for one.
   */
  const isMobile = useIsMobile();
  const [pane, setPane] = useState<Pane>("problem");

  useEffect(() => {
    const stored = window.localStorage.getItem(LIST_STORAGE_KEY);
    if (stored && (PRACTICE_LISTS as readonly string[]).includes(stored)) {
      setList(stored as PracticeList);
    }
    // Read after mount, not during render: the server has no localStorage and
    // would otherwise disagree with the first client paint.
    setRailOpen(window.localStorage.getItem(RAIL_STORAGE_KEY) !== "closed");
  }, []);

  const toggleRail = () => {
    setRailOpen((open) => {
      window.localStorage.setItem(RAIL_STORAGE_KEY, open ? "closed" : "open");
      return !open;
    });
  };

  /**
   * Adopt the open problem from the server once.
   *
   * Deliberately not the list: that is a browser preference, like the
   * calendar's view, and localStorage already answered for it above. The
   * server keeps a mirrored copy only so the coach's default matches what the
   * rail is showing — reading it back here would let the last machine to click
   * a problem silently reset this one's choice.
   */
  useEffect(() => {
    if (!data || adopted) return;
    setSelectedSlug(data.currentSlug);
    setAdopted(true);
  }, [data, adopted]);

  const records = useMemo(() => recordMap(data?.records ?? []), [data?.records]);
  const today = data?.today ?? "";
  const selected = useMemo(
    () => (selectedSlug ? findProblem(selectedSlug) : null),
    [selectedSlug],
  );
  const selectedRecord = selected ? records.get(selected.link) ?? null : null;

  /**
   * Open a problem — on the server first, then here.
   *
   * The selection is shown optimistically so the frame moves on the click, but
   * what the page ends up displaying is whatever the server says is open. They
   * are the same thing in the normal case; when two selections race, this is
   * what stops the frame and the coach from ending up on different problems,
   * which would be the one failure the user could not see.
   */
  /** Every write goes through here, so a failure reaches the page instead of the console. */
  const runAction = useCallback(async (action: () => Promise<void>) => {
    try {
      setActionError(null);
      await action();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const select = useCallback(async (problem: CatalogProblem, nextList: PracticeList = list) => {
    setSelectedSlug(problem.link);
    requestedSlug.current = problem.link;
    const response = await fetch("/api/robin/practice", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ problem: problem.link, current: true, list: nextList }),
    });
    const body = await response.json().catch(() => null) as PracticeResponse | { error?: string } | null;
    if (!response.ok || !body) {
      throw new Error((body as { error?: string })?.error ?? `Request failed (${response.status})`);
    }
    // Only the newest click gets to say what is open; an older reply landing
    // late would otherwise pull the frame back to the problem before it.
    if (requestedSlug.current === problem.link) {
      setSelectedSlug((body as PracticeResponse).currentSlug);
    }
    // On a phone the rail is a pane rather than a column, so picking a problem
    // has to move to it; on a desktop the frame beside the rail already did.
    setPane("problem");
    await refresh();
  }, [list, refresh]);

  const chooseList = (next: PracticeList) => {
    setList(next);
    window.localStorage.setItem(LIST_STORAGE_KEY, next);
    void runAction(() => mutate("/api/robin/practice", "PATCH", { list: next }));
  };

  // These two stay throwing: PracticeRecordBar needs to know a save failed so
  // it can keep the editor open with the text still in it.
  const setStatus = async (status: PracticeStatus) => {
    if (!selected) return;
    await mutate("/api/robin/practice", "PATCH", { problem: selected.link, status });
    await refresh();
  };

  const setNote = async (note: string) => {
    if (!selected) return;
    await mutate("/api/robin/practice", "PATCH", { problem: selected.link, note });
    await refresh();
  };

  const suggestion = useMemo(
    () => (today ? suggestNext(problemsInList(list), records, today) : null),
    [list, records, today],
  );

  return (
    <div className="robin-page flex flex-1 flex-col" style={{ minWidth: 0, minHeight: 0 }}>
      <WorkspaceHeader {...chrome}>
        {isMobile ? (
          <WorkspacePaneSwitch panes={PANES} active={pane} onChange={setPane} />
        ) : (
          <button
            type="button"
            onClick={toggleRail}
            className="ui-action pi-chrome-label pi-bracket"
            data-state={railOpen ? undefined : "accent"}
            style={{ fontSize: 10 }}
            aria-expanded={railOpen}
            aria-controls="roadmap-rail"
          >
            {railOpen ? t("coding.rail.hide") : t("coding.rail.show")}
          </button>
        )}
        {suggestion ? (
          <button
            type="button"
            onClick={() => void runAction(() => select(suggestion))}
            className="ui-action"
            style={{ fontSize: 11, color: "var(--text-dim)" }}
            title={t("coding.nextHint")}
          >
            {t("coding.next", { problem: suggestion.problem })}
          </button>
        ) : null}
        {/* Without this the rail just renders empty, which reads as "no
            problems" rather than "the store could not be read". */}
        {error ?? actionError ? (
          <p style={{ fontSize: 11, color: "var(--danger)" }}>{error ?? actionError}</p>
        ) : null}
      </WorkspaceHeader>

      <div className="flex flex-1" style={{ minHeight: 0 }}>
        {/* The rail is always rendered on a phone — there it is a pane, and the
            switcher rather than the toggle decides whether it is on screen. */}
        {isMobile || railOpen ? (
          <>
            <WorkspacePane active={isMobile ? pane === "rail" : null}>
              <RoadmapRail
                width={isMobile ? null : panes.rail.width}
                list={list}
                onListChange={chooseList}
                records={records}
                today={today}
                selected={selectedSlug}
                onSelect={(problem) => void runAction(() => select(problem))}
              />
            </WorkspacePane>
            {isMobile ? null : (
              <PaneDivider
                edge="left"
                label={t("coding.pane.rail")}
                title={t("coding.pane.resetHint")}
                {...panes.rail}
              />
            )}
          </>
        ) : null}

        <WorkspacePane active={isMobile ? pane === "problem" : null}>
          <NeetCodeFrame problem={selected} />
        </WorkspacePane>

        {isMobile ? null : (
          <PaneDivider
            edge="right"
            label={t("coding.pane.panel")}
            title={t("coding.pane.resetHint")}
            {...panes.panel}
          />
        )}

        <WorkspacePane active={isMobile ? pane === "coach" : null}>
          <div
            className="flex flex-col"
            style={isMobile
              ? { flex: 1, minWidth: 0, minHeight: 0 }
              : { width: panes.panel.width, flex: "0 0 auto", minHeight: 0 }}
          >
            {selected ? (
              <PracticeRecordBar
                key={selected.link}
                record={selectedRecord}
                onStatus={setStatus}
                onNote={setNote}
              />
            ) : null}
            <AgentPanel
              mode="coach"
              titleKey="coding.coach.title"
              placeholderKey="coding.coach.placeholder"
              restartHintKey="coding.coach.restartHint"
              toolKeys={COACH_TOOL_KEYS}
            />
          </div>
        </WorkspacePane>
      </div>
    </div>
  );
}
