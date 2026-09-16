"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  chapterForStep, continueChapter, findChapter, nextChapter,
  type FsoChapter,
} from "@/extension/robin/fso";
import type { FsoNote, FsoSnapshot } from "@/extension/robin/fso-domain";
import { FULLSTACK_STEPS } from "@/extension/robin/learning";
import { AgentPanel } from "./AgentPanel";
import { FsoNoteEditor, FsoNotebook, type FsoNoteEditorHandle } from "./FsoNotes";
import { FsoRail } from "./FsoRail";
import { FsoRoadmap } from "./FsoRoadmap";
import { PaneDivider } from "./PaneDivider";
import { WorkspacePane, WorkspacePaneSwitch } from "./WorkspaceHeader";
import { usePaneWidths } from "./usePaneWidths";
import { mutate, usePolledResource } from "./usePolledResource";
import styles from "./FsoWorkspace.module.css";

type View = "roadmap" | "chapter" | "notebook";

const RAIL_STORAGE_KEY = "pi-fso-rail-open";
type Side = "notes" | "mentor";

const MOBILE_PANES = [
  { id: "contents", labelKey: "fso.contents" },
  { id: "page", labelKey: "fso.page" },
  { id: "notes", labelKey: "fso.notes.title" },
  { id: "mentor", labelKey: "coding.mentor.title" },
] as const;
type MobilePane = (typeof MOBILE_PANES)[number]["id"];

const MENTOR_TOOL_KEYS: Record<string, string> = {
  fso_current: "fso.tool.current",
  fso_notes: "fso.tool.notes",
};

function hrefFor(view: View, chapter: FsoChapter | null): string {
  if (view === "chapter" && chapter) return `/learn/fso?chapter=${encodeURIComponent(chapter.id)}`;
  if (view === "notebook") return "/learn/fso?view=notebook";
  return "/learn/fso";
}

/**
 * Full Stack Open, as one place: the roadmap to choose from, the chapter
 * itself framed in the middle, and beside it your notes and the mentor.
 *
 * Completion is the dashboard's course progress — the same step ids, the same
 * file — so ticking an exercise here moves "continue" there. Opening a chapter
 * is written down on the way past because the frame is cross-origin: that
 * write is how the mentor knows what "this page" is.
 */
export function FsoWorkspace() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const panes = usePaneWidths(true);
  const fso = usePolledResource<FsoSnapshot>("/api/robin/fso", 15_000);

  const initialChapter = findChapter(searchParams.get("chapter")) ?? chapterForStep(searchParams.get("step"));
  const [view, setView] = useState<View>(!initialChapter && searchParams.get("view") === "notebook" ? "notebook" : "roadmap");
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [chapterConfirmed, setChapterConfirmed] = useState(false);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const openingRef = useRef(false);
  const requestedChapter = useRef<FsoChapter | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [side, setSide] = useState<Side | null>("notes");
  // The contents rail starts closed so the chapter gets the width; opening it is remembered.
  const [railOpen, setRailOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>("page");
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [localNotes, setLocalNotes] = useState<Record<string, FsoNote | null>>({});
  const [pending, setPending] = useState<{ id: string; text: string } | undefined>(undefined);
  const [frameLoading, setFrameLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const editorRef = useRef<FsoNoteEditorHandle>(null);

  const chapter = findChapter(chapterId);
  // The server's ticks with any in-flight click laid over them, so a checkbox answers immediately.
  const doneIds = useMemo(() => {
    const ids = new Set(fso.data?.fullstack.completedIds ?? []);
    for (const [id, done] of Object.entries(overrides)) {
      if (done) ids.add(id);
      else ids.delete(id);
    }
    return ids;
  }, [fso.data, overrides]);
  const isDone = useCallback((id: string) => doneIds.has(id), [doneIds]);
  const completedCount = FULLSTACK_STEPS.filter((step) => doneIds.has(step.id)).length;
  const current = fso.data ? continueChapter([...doneIds]) : null;

  const notes = useMemo(() => {
    const merged: Record<string, FsoNote> = { ...fso.data?.notes };
    for (const [id, note] of Object.entries(localNotes)) {
      if (note) merged[id] = note;
      else delete merged[id];
    }
    return merged;
  }, [fso.data, localNotes]);
  const notedIds = useMemo(() => new Set(Object.keys(notes)), [notes]);

  const navigate = useCallback((nextView: View, nextChapter: FsoChapter | null) => {
    setView(nextView);
    window.history.replaceState(null, "", hrefFor(nextView, nextChapter));
  }, []);

  // Every entry path confirms the same persisted identity before changing the
  // frame or URL. A failed response may still have committed on the server, so
  // keep the old frame/draft but pause the mentor until a selection is confirmed.
  const open = useCallback(async (next: FsoChapter) => {
    if (openingRef.current) return;
    openingRef.current = true;
    requestedChapter.current = next;
    setOpening(true);
    setChapterConfirmed(false);
    setChapterError(null);
    setPending(undefined);
    try {
      await editorRef.current?.flush();
      if (!mounted.current) return;
      const response = await fetch("/api/robin/fso", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapter: next.id }),
      });
      const body = await response.json().catch(() => null) as { openChapterId?: string; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
      if (body?.openChapterId !== next.id) throw new Error("Invalid chapter confirmation");
      if (!mounted.current) return;
      // Re-opening the same mounted frame will not fire another load event.
      if (next.id !== chapterId || view !== "chapter") setFrameLoading(true);
      setChapterId(next.id);
      navigate("chapter", next);
      if (isMobile) setMobilePane("page");
      setChapterConfirmed(true);
    } catch (caught) {
      if (mounted.current) setChapterError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      openingRef.current = false;
      if (mounted.current) setOpening(false);
    }
  }, [chapterId, isMobile, navigate, view]);

  // Later URL changes are our own replaceState, not a new initial selection.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current) return;
    deepLinked.current = true;
    if (initialChapter) void open(initialChapter);
  }, [initialChapter, open]);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(RAIL_STORAGE_KEY) === "1") setRailOpen(true);
    } catch {
      // Blocked storage only costs the remembered preference.
    }
  }, []);

  const toggleRail = () => {
    const next = !railOpen;
    setRailOpen(next);
    try {
      window.localStorage.setItem(RAIL_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // As above.
    }
  };

  const refreshFso = fso.refresh;
  const toggle = useCallback(async (id: string, done: boolean) => {
    setOverrides((previous) => ({ ...previous, [id]: done }));
    try {
      setActionError(null);
      await mutate("/api/robin/learning", "PATCH", { step: id, completed: done });
      await refreshFso();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setOverrides((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
    }
  }, [refreshFso]);

  const onNoteSaved = useCallback((id: string, note: FsoNote | null) => {
    setLocalNotes((previous) => ({ ...previous, [id]: note }));
  }, []);

  const askMentorAboutNotes = useCallback(() => {
    setSide("mentor");
    if (isMobile) setMobilePane("mentor");
    setPending({ id: String(Date.now()), text: t("fso.notes.askPrompt") });
  }, [isMobile, t]);

  const keepReply = useCallback((text: string) => {
    editorRef.current?.append(text);
    setSide("notes");
    if (isMobile) setMobilePane("notes");
  }, [isMobile]);

  const next = chapter ? nextChapter(chapter) : null;
  const inChapter = view === "chapter" && chapter !== null;
  const error = chapterError ?? actionError ?? fso.error;

  const center = view === "notebook" ? (
    <FsoNotebook notes={notes} onOpen={open} />
  ) : inChapter ? (
    <section className={styles.frame} aria-label={chapter.title}>
      <div className={styles.frameBar}>
        {!isMobile && (
          <button type="button" className="ui-action pi-chrome-label pi-bracket" style={{ fontSize: 10 }}
            data-state={railOpen ? "accent" : undefined} aria-expanded={railOpen} aria-controls="fso-rail"
            onClick={toggleRail}>
            {t("fso.contents")}
          </button>
        )}
        <div className={styles.frameTitle}>
          <span className={styles.nodeLetter}>{chapter.part}{chapter.letter}</span>
          <h2>{chapter.title}</h2>
        </div>
        <div className={styles.frameActions}>
          <label className={styles.readToggle} data-done={isDone(chapter.id)}>
            <input type="checkbox" checked={isDone(chapter.id)}
              onChange={(event) => void toggle(chapter.id, event.target.checked)} />
            {t(isDone(chapter.id) ? "fso.readDone" : chapter.external ? "fso.markCourse" : "fso.markRead")}
          </label>
          {next && (
            <button type="button" className="ui-action pi-chrome-label pi-bracket" style={{ fontSize: 10 }} onClick={() => open(next)}>
              {t("fso.next", { chapter: `${next.part}${next.letter}` })} →
            </button>
          )}
          <a href={chapter.url} target="_blank" rel="noopener noreferrer" className="ui-action flex min-h-9 items-center text-xs">
            {t("coding.frame.openTab")} ↗
          </a>
        </div>
      </div>
      <div className={styles.frameBody}>
        {chapter.external ? (
          <div className={styles.external}>
            <p className="pi-eyebrow">{t("fso.part", { part: chapter.part })} · courses.mooc.fi</p>
            <h3>{chapter.title}</h3>
            <p>{t("fso.externalBody")}</p>
            <a className={styles.primary} href={chapter.url} target="_blank" rel="noopener noreferrer">{t("fso.openCourse")} ↗</a>
          </div>
        ) : (
          <>
            {frameLoading && <p role="status" className={`pi-eyebrow ${styles.frameLoading}`}>{t("robin.common.loading")}</p>}
            <iframe
              key={chapter.url}
              src={chapter.url}
              title={chapter.title}
              onLoad={() => setFrameLoading(false)}
              allow="clipboard-write; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </>
        )}
      </div>
    </section>
  ) : (
    <FsoRoadmap isDone={isDone} current={current} notedIds={notedIds}
      completed={completedCount} total={FULLSTACK_STEPS.length} onOpen={open} />
  );

  const sideVisible = inChapter && (isMobile ? mobilePane === "notes" || mobilePane === "mentor" : side !== null);
  const sideTab: Side = isMobile ? (mobilePane === "mentor" ? "mentor" : "notes") : side ?? "notes";

  return (
    <div className={`robin-page flex flex-1 flex-col ${styles.workspace}`} aria-busy={opening} style={{ minWidth: 0, minHeight: 0 }}>
      <header className={styles.bar}>
        <a href="/learn" className={`pi-eyebrow ${styles.crumb}`}>{t("learn.title")} /</a>
        <span className={styles.barTitle}>Full Stack Open</span>
        {fso.data && (
          <span className={styles.barProgress}>
            <span className={styles.barMeter}><span style={{ width: `${(completedCount / FULLSTACK_STEPS.length) * 100}%` }} /></span>
            {completedCount}/{FULLSTACK_STEPS.length}
          </span>
        )}
        <nav className={styles.barNav} aria-label={t("fso.views")} inert={opening}>
          <button type="button" className="ui-action pi-chrome-label pi-bracket" style={{ fontSize: 10 }}
            data-state={view === "roadmap" ? "accent" : undefined} aria-current={view === "roadmap" ? "page" : undefined}
            onClick={() => navigate("roadmap", chapter)}>
            {t("fso.roadmap")}
          </button>
          {chapter && (
            <button type="button" className="ui-action pi-chrome-label pi-bracket" style={{ fontSize: 10 }}
              data-state={view === "chapter" ? "accent" : undefined} aria-current={view === "chapter" ? "page" : undefined}
              onClick={() => void open(chapter)}>
              {chapter.part}{chapter.letter}
            </button>
          )}
          <button type="button" className="ui-action pi-chrome-label pi-bracket" style={{ fontSize: 10 }}
            data-state={view === "notebook" ? "accent" : undefined} aria-current={view === "notebook" ? "page" : undefined}
            onClick={() => navigate("notebook", chapter)}>
            {t("fso.notebook.title")} · {notedIds.size}
          </button>
        </nav>
        {inChapter && (
          <div className={styles.barEnd}>
            {isMobile ? (
              <WorkspacePaneSwitch panes={MOBILE_PANES} active={mobilePane} onChange={setMobilePane} />
            ) : (["notes", "mentor"] as const).map((tab) => (
              <button key={tab} type="button" className="ui-action pi-chrome-label pi-bracket" style={{ fontSize: 10 }}
                data-state={side === tab ? "accent" : undefined} aria-expanded={side === tab} aria-controls="fso-side"
                onClick={() => setSide(side === tab ? null : tab)}>
                {t(tab === "notes" ? "fso.notes.title" : "coding.mentor.title")}
              </button>
            ))}
          </div>
        )}
        {opening && <p role="status" className="text-xs">{t("learn.daily.saving")}</p>}
        {error && <div role="alert" style={{ width: "100%", fontSize: 11, color: "var(--danger)" }}>
          {error}
          {chapterError && <button type="button" className="ui-action ml-3 min-h-11 text-xs" disabled={opening}
            onClick={() => { if (requestedChapter.current) void open(requestedChapter.current); }}>{t("fso.open.retry")}</button>}
        </div>}
      </header>

      <div className="flex flex-1" inert={opening} style={{ minHeight: 0 }}>
        {inChapter && (isMobile || railOpen) && (
          <WorkspacePane active={isMobile ? mobilePane === "contents" : null}>
            <FsoRail width={isMobile ? null : panes.rail.width} chapter={chapter} isDone={isDone} notedIds={notedIds}
              onToggle={(id, done) => void toggle(id, done)} onOpen={open} onRoadmap={() => navigate("roadmap", chapter)} />
          </WorkspacePane>
        )}
        {inChapter && !isMobile && railOpen && (
          <PaneDivider edge="left" label={t("coding.pane.rail")} title={t("coding.pane.resetHint")} {...panes.rail} />
        )}

        <WorkspacePane active={isMobile ? !inChapter || mobilePane === "page" : null}>
          <div className="flex flex-1 flex-col" style={{ minWidth: 0, minHeight: 0 }}>{center}</div>
        </WorkspacePane>

        {sideVisible && !isMobile && (
          <PaneDivider edge="right" label={t("coding.pane.panel")} title={t("coding.pane.resetHint")} {...panes.panel} />
        )}
        {/* Kept mounted once a chapter is open, so the mentor's transcript and
            an unsaved note survive switching tabs and views. */}
        {chapter && (
          <aside id="fso-side" className={styles.side} aria-label={t(sideTab === "notes" ? "fso.notes.title" : "coding.mentor.title")}
            style={!sideVisible ? { display: "none" } : isMobile ? { flex: 1, minWidth: 0 } : { width: panes.panel.width, flex: "0 0 auto" }}>
            <div className={styles.tabs} role="tablist">
              {(["notes", "mentor"] as const).map((tab) => (
                <button key={tab} type="button" role="tab" aria-selected={sideTab === tab}
                  onClick={() => (isMobile ? setMobilePane(tab) : setSide(tab))}>
                  {t(tab === "notes" ? "fso.notes.title" : "coding.mentor.title")}
                </button>
              ))}
            </div>
            <div className={styles.tabPanel} role="tabpanel" style={sideTab === "notes" ? undefined : { display: "none" }}>
              {/* Not before the notes have loaded: the editor starts from the
                  note it is given, and starting from nothing would save over it. */}
              {fso.data ? (
                <FsoNoteEditor key={chapter.id} ref={editorRef} chapter={chapter}
                  note={notes[chapter.id]} onSaved={onNoteSaved} onAskMentor={askMentorAboutNotes} />
              ) : (
                <p role="status" className={styles.empty}>{fso.error ?? t("robin.common.loading")}</p>
              )}
            </div>
            <div className={styles.tabPanel} role="tabpanel" style={sideTab === "mentor" ? undefined : { display: "none" }}>
              {!chapterConfirmed && <p role="status" className="p-3 text-xs" style={{ color: "var(--text-muted)" }}>{t("fso.mentor.paused")}</p>}
              <AgentPanel
                mode="mentor"
                disabled={!chapterConfirmed}
                titleKey="coding.mentor.title"
                placeholderKey="fso.mentor.placeholder"
                restartHintKey="coding.mentor.restartHint"
                emptyHintKey="fso.mentor.empty"
                toolKeys={MENTOR_TOOL_KEYS}
                pending={pending}
                replyAction={{ labelKey: "fso.mentor.keep", onReply: keepReply }}
              />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
