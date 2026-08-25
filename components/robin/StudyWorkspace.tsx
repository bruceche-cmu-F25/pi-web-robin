"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { CURRICULUM, findTrack, type CurriculumItem } from "@/extension/robin/study";
import { AgentPanel } from "./AgentPanel";
import { PaneDivider } from "./PaneDivider";
import { SyllabusBoard } from "./SyllabusBoard";
import { WorkspaceHeader, type WorkspaceChrome } from "./WorkspaceHeader";
import { usePaneWidths } from "./usePaneWidths";
import { mutate, usePolledResource } from "./usePolledResource";

interface StudyResponse {
  currentItemId: string | null;
  track: string | null;
}

const TRACK_STORAGE_KEY = "pi-study-track";

/** Tool name → i18n key, for the line under a mentor reply saying what it read. */
const MENTOR_TOOL_KEYS: Record<string, string> = {
  study_current: "coding.tool.studyCurrent",
  study_outline: "coding.tool.studyOutline",
};

/**
 * The curriculum track: syllabus and mentor.
 *
 * Two columns where the practice side has three, because the third one had
 * nothing to hold. Problems need a middle pane — the editor is the work. A
 * curriculum does not: most of the catalog either refuses to be framed or is
 * a milestone rather than a page, so the frame stood empty most of the time,
 * and even when it filled, a tutorial reads better in a real tab than in a
 * pane. So the syllabus takes the room the frame was wasting and the
 * resources open where they belong.
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
  const [actionError, setActionError] = useState<string | null>(null);
  // The resource the newest click asked for. A slower earlier request must not
  // be allowed to drag the mark back to what was open before it.
  const requestedId = useRef<string | null>(null);
  // Until the first response lands, the server's answer is unknown; adopting it
  // once avoids overriding a later click with a stale value.
  const [adopted, setAdopted] = useState(false);
  // No rail on this track, so the mentor panel may take the room the rail
  // would otherwise be holding against it.
  const panes = usePaneWidths(false);

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
    window.localStorage.setItem(TRACK_STORAGE_KEY, next);
    void runAction(() => mutate("/api/robin/study", "PATCH", { track: next }));
  };

  return (
    <div className="flex h-full flex-col" style={{ minHeight: 0 }}>
      <WorkspaceHeader {...chrome}>
        {/* A failed write has to be visible: without this, clicking a resource
            that the server rejected would look like nothing happened. */}
        {error ?? actionError ? (
          <p style={{ fontSize: 11, color: "var(--danger)" }}>{error ?? actionError}</p>
        ) : null}
      </WorkspaceHeader>

      <div className="flex flex-1" style={{ minHeight: 0 }}>
        <SyllabusBoard
          track={track}
          onTrackChange={chooseTrack}
          selected={selectedId}
          onOpen={(item) => void runAction(() => select(item))}
        />

        <PaneDivider
          edge="right"
          label={t("coding.pane.panel")}
          title={t("coding.pane.resetHint")}
          {...panes.panel}
        />

        <div
          className="flex flex-col"
          style={{ width: panes.panel.width, flex: "0 0 auto", minHeight: 0 }}
        >
          <AgentPanel
            mode="mentor"
            titleKey="coding.mentor.title"
            placeholderKey="coding.mentor.placeholder"
            restartHintKey="coding.mentor.restartHint"
            toolKeys={MENTOR_TOOL_KEYS}
          />
        </div>
      </div>
    </div>
  );
}
