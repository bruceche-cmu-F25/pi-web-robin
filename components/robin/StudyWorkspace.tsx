"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { CURRICULUM, findItem, findTrack, type CurriculumItem } from "@/extension/robin/study";
import { AgentPanel } from "./AgentPanel";
import { CurriculumRail } from "./CurriculumRail";
import { PaneDivider } from "./PaneDivider";
import { SyllabusBoard } from "./SyllabusBoard";
import {
  WorkspaceHeader,
  WorkspacePane,
  WorkspacePaneSwitch,
  type WorkspaceChrome,
} from "./WorkspaceHeader";
import { usePaneWidths } from "./usePaneWidths";
import { mutate, usePolledResource } from "./usePolledResource";

interface StudyResponse {
  currentItemId: string | null;
  track: string | null;
}

const TRACK_STORAGE_KEY = "pi-study-track";

/** The three panes, in the order a phone steps through them. */
const PANES = [
  { id: "path", labelKey: "coding.pane.path" },
  { id: "syllabus", labelKey: "coding.pane.syllabus" },
  { id: "mentor", labelKey: "coding.mentor.title" },
] as const;

type Pane = (typeof PANES)[number]["id"];

/** Tool name → i18n key, for the line under a mentor reply saying what it read. */
const MENTOR_TOOL_KEYS: Record<string, string> = {
  study_current: "coding.tool.studyCurrent",
  study_outline: "coding.tool.studyOutline",
};

/**
 * The curriculum track: fixed path, syllabus, and mentor.
 *
 * The left rail answers the question the catalog alone could not: which module
 * comes next in the job-focused route. The center remains the full catalog for
 * the selected area, and resources still open in real tabs where tutorials
 * keep their own history, scroll position, and useful reading width.
 *
 * The same habits as the practice side otherwise, but not the same
 * bookkeeping. Nothing here is scored, counted, or marked read: a review
 * schedule is only as good as its record of what you solved, and reading does
 * not work that way — a progress bar over someone's reading measures the one
 * thing that does not matter.
 *
 * So the only server state is which resource was opened last, and it exists
 * for a mechanical reason: the tab it opened in is not ours to see into, so
 * the record written on the click is the mentor's only way of knowing what
 * "this page" means.
 */
export function StudyWorkspace(chrome: WorkspaceChrome) {
  const { t } = useI18n();
  const { data, error, refresh } = usePolledResource<StudyResponse>("/api/robin/study", 15_000);
  const [trackId, setTrackId] = useState<string>(CURRICULUM[0].id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedModuleId, setFocusedModuleId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [showOverview, setShowOverview] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  // The resource the newest click asked for. A slower earlier request must not
  // be allowed to drag the mark back to what was open before it.
  const requestedId = useRef<string | null>(null);
  // Until the first response lands, the server's answer is unknown; adopting it
  // once avoids overriding a later click with a stale value.
  const [adopted, setAdopted] = useState(false);
  const panes = usePaneWidths(true);
  /**
   * A phone gets one pane at a time. The mentor column is 360px wide before it
   * is readable, which on a 375px screen leaves the syllabus beside it about
   * ten pixels — one word per line, and the panel itself off the right edge.
   */
  const isMobile = useIsMobile();
  const [pane, setPane] = useState<Pane>("syllabus");
  // The roadmap gets the canvas by default. The mounted-but-hidden mentor keeps
  // its local transcript when the user closes it and opens it again.
  const [mentorOpen, setMentorOpen] = useState(false);

  useEffect(() => {
    // Read after mount, not during render: the server has no localStorage and
    // would otherwise disagree with the first client paint.
    const stored = window.localStorage.getItem(TRACK_STORAGE_KEY);
    if (stored && findTrack(stored)) setTrackId(stored);
  }, []);

  /**
   * Adopt the open resource from the server once.
   *
   * Deliberately not the track: that is a browser preference, and localStorage
   * already answered for it above. The server keeps a mirrored copy only so
   * the mentor's default matches the track on screen — reading it back here
   * would let the last machine to click a resource silently move this one.
   */
  useEffect(() => {
    if (!data || adopted) return;
    setSelectedId(data.currentItemId);
    setAdopted(true);
  }, [data, adopted]);

  const track = useMemo(() => findTrack(trackId) ?? CURRICULUM[0], [trackId]);
  const selectedLocation = useMemo(() => selectedId ? findItem(selectedId) : null, [selectedId]);
  const activeModuleId = showOverview
    ? null
    : focusedModuleId
      ?? (selectedLocation?.track.id === track.id ? selectedLocation.module.id : null)
      ?? track.modules[0]?.id
      ?? null;

  /** Every write goes through here, so a failure reaches the page instead of the console. */
  const runAction = useCallback(async (action: () => Promise<void>) => {
    try {
      setActionError(null);
      await action();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  /**
   * Record a resource as the one being read.
   *
   * The browser has already opened the tab by the time this runs — the anchor
   * is a plain anchor, and putting a round trip in front of it would mean a
   * blocked popup. What this does is tell the mentor where the user went, and
   * mark the row optimistically so the click is acknowledged before the write
   * lands. The server's answer still wins: when two clicks race, this is what
   * stops the marked row and the mentor from naming different things, which
   * would be the one failure the user could not see.
   */
  const select = useCallback(async (item: CurriculumItem, nextTrack: string = trackId) => {
    setSelectedId(item.id);
    setShowOverview(false);
    setFocusedModuleId(findItem(item.id)?.module.id ?? null);
    requestedId.current = item.id;
    const response = await fetch("/api/robin/study", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: item.id, track: nextTrack }),
    });
    const body = await response.json().catch(() => null) as StudyResponse | { error?: string } | null;
    if (!response.ok || !body) {
      throw new Error((body as { error?: string })?.error ?? `Request failed (${response.status})`);
    }
    if (requestedId.current === item.id) {
      setSelectedId((body as StudyResponse).currentItemId);
    }
    await refresh();
  }, [trackId, refresh]);

  const chooseTrack = (next: string) => {
    setTrackId(next);
    setShowOverview(false);
    setFocusedModuleId(findTrack(next)?.modules[0]?.id ?? null);
    setFocusRequest((request) => request + 1);
    window.localStorage.setItem(TRACK_STORAGE_KEY, next);
    void runAction(() => mutate("/api/robin/study", "PATCH", { track: next }));
  };

  const chooseModule = (nextTrack: string, moduleId: string) => {
    setTrackId(nextTrack);
    setShowOverview(false);
    setFocusedModuleId(moduleId);
    setFocusRequest((request) => request + 1);
    window.localStorage.setItem(TRACK_STORAGE_KEY, nextTrack);
    if (isMobile) setPane("syllabus");
    void runAction(() => mutate("/api/robin/study", "PATCH", { track: nextTrack }));
  };

  const chooseOverview = () => {
    setShowOverview(true);
    setFocusedModuleId(null);
    if (isMobile) setPane("syllabus");
  };

  return (
    <div className="robin-page flex flex-1 flex-col" style={{ minWidth: 0, minHeight: 0 }}>
      <WorkspaceHeader {...chrome}>
        {isMobile ? (
          <WorkspacePaneSwitch panes={PANES} active={pane} onChange={setPane} />
        ) : (
          <button
            type="button"
            onClick={() => setMentorOpen((open) => !open)}
            className="ui-action pi-chrome-label pi-bracket ml-auto"
            data-state={mentorOpen ? "accent" : undefined}
            style={{ fontSize: 10 }}
            aria-expanded={mentorOpen}
            aria-controls="study-mentor-panel"
          >
            {t(mentorOpen ? "coding.mentor.hide" : "coding.mentor.show")}
          </button>
        )}
        {/* A failed write has to be visible: without this, clicking a resource
            that the server rejected would look like nothing happened. */}
        {error ?? actionError ? (
          <p style={{ fontSize: 11, color: "var(--danger)" }}>{error ?? actionError}</p>
        ) : null}
      </WorkspaceHeader>

      <div className="flex flex-1" style={{ minHeight: 0 }}>
        <WorkspacePane active={isMobile ? pane === "path" : null}>
          <CurriculumRail
            width={isMobile ? null : panes.rail.width}
            overviewActive={showOverview}
            activeModuleId={activeModuleId}
            onOverview={chooseOverview}
            onSelect={chooseModule}
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

        <WorkspacePane active={isMobile ? pane === "syllabus" : null}>
          <SyllabusBoard
            track={track}
            onTrackChange={chooseTrack}
            selected={selectedId}
            overview={showOverview}
            focusedModuleId={activeModuleId}
            focusRequest={focusRequest}
            onModuleChange={chooseModule}
            onOpen={(item) => void runAction(() => select(item))}
          />
        </WorkspacePane>

        {!isMobile && mentorOpen ? (
          <PaneDivider
            edge="right"
            label={t("coding.pane.panel")}
            title={t("coding.pane.resetHint")}
            {...panes.panel}
          />
        ) : null}

        <WorkspacePane active={isMobile ? pane === "mentor" : null}>
          <div
            id="study-mentor-panel"
            className="flex flex-col"
            aria-hidden={!isMobile && !mentorOpen ? "true" : undefined}
            style={isMobile
              ? { flex: 1, minWidth: 0, minHeight: 0 }
              : mentorOpen
                ? { width: panes.panel.width, flex: "0 0 auto", minHeight: 0 }
                : { display: "none" }}
          >
            <AgentPanel
              mode="mentor"
              titleKey="coding.mentor.title"
              placeholderKey="coding.mentor.placeholder"
              restartHintKey="coding.mentor.restartHint"
              toolKeys={MENTOR_TOOL_KEYS}
            />
          </div>
        </WorkspacePane>
      </div>
    </div>
  );
}
