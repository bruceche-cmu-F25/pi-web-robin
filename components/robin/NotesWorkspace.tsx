"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import { SaveStatus } from "./SaveStatus";
import { MarkdownBody } from "@/components/MarkdownBody";
import { ModelSelector, type ModelSelectorOption } from "@/components/ModelSelector";
import { useI18n } from "@/hooks/useI18n";
import { useIsSplitLayout } from "@/hooks/useIsMobile";
import type { NoteAttachment } from "@/extension/robin/note-attachments";
import type { NoteFinal } from "@/extension/robin/notes-agent-state";
import type { NoteDraft } from "@/extension/robin/notes-domain";
import type { ObsidianArchive, ObsidianVault } from "@/extension/robin/obsidian-domain";
import { compressImageFile } from "@/lib/image-compress";
import type { ModelsData } from "@/lib/models-cache";
import { writeUrlState } from "@/lib/url-state";
import { useNoteDrafts, type DraftPatch } from "./useNoteDrafts";
import { TextRecoveryNotice, TextRecoveryWarning } from "./TextRecoveryNotice";
import { AgentPanel } from "./AgentPanel";
import { CanvasLibrary } from "./CanvasLibrary";
import { CanvasWorkspace, type CanvasWorkspaceHandle } from "./CanvasWorkspace";
import type { CanvasSummary } from "@/extension/robin/canvas";
import { MarginNotes, NoteOutline, useEditorGeometry } from "./NoteMargins";
import { currentHeading, noteMarginItems, noteOutline, type MarginItem, type OutlineEntry } from "./note-margin";
import { requestRefresh } from "./refreshBus";
import { continueMarkdownBlock, countWords, indentMarkdownList, type TextEdit } from "./markdown-editing";
import { buildNotionTree, filterNotionTree, type NotionTreeNode, type NotionTreePage } from "./notion-tree";
import { MindmapWorkspace } from "./MindmapWorkspace";
import navigation from "./InformationInbox.module.css";
import styles from "./NotesWorkspace.module.css";

const LEGACY_DRAFT_KEY = "pi-robin-notes-draft-v1";
const MODEL_KEY = "pi-robin-notes-model-v1";
const ACTIVE_DRAFT_KEY = "pi-robin-notes-active-draft-v1";
const DEFAULT_MODEL_ID = "gpt-5.6-sol";
const FINAL_POLL_MS = 2_500;
const DATED_TITLE = /^Notes \d{4}-\d{2}-\d{2}$/;
/**
 * Hues for the top-level sections of the Notion tree, from the calendar's
 * families. Neighbours in this order are far apart on the wheel, and sage and
 * rose are left out: beside fern and clay they read as the same colour.
 */
const BRANCH_TONES = ["iris", "teal", "clay", "slate", "honey", "plum", "fern"] as const;

type NotesView = "notes" | "canvas" | "mindmap";
function notesView(search: { get: (key: string) => string | null }): NotesView {
  const view = search.get("view");
  return view === "mindmap" ? "mindmap" : view === "canvas" || search.get("canvas") ? "canvas" : "notes";
}
type MobilePane = "notion" | "note" | "agent";

function notePane(value: string | null): MobilePane {
  return value === "notion" || value === "agent" ? value : "note";
}
interface ModelRef { provider: string; modelId: string }
interface FinalPreview { title: string; content: string }

function defaultTitle(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return `Notes ${local}`;
}

function sameModel(a: ModelRef | null, b: ModelRef | null | undefined): boolean {
  return !!a && !!b && a.provider === b.provider && a.modelId === b.modelId;
}

function hasDescendant(node: NotionTreeNode, id: string): boolean {
  return Boolean(id) && node.children.some((child) => child.id === id || hasDescendant(child, id));
}

/** Replace a range in the textarea as if typed, so Cmd+Z still undoes it. */
function applyEdit(textarea: HTMLTextAreaElement, edit: TextEdit) {
  textarea.setSelectionRange(edit.start, edit.end);
  const done = edit.text
    ? document.execCommand("insertText", false, edit.text)
    : document.execCommand("delete");
  if (!done) {
    textarea.setRangeText(edit.text, edit.start, edit.end);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
  textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
}

function NotionTreeItem({ node, tone, selectedId, highlightedId, onSelect, openLabel, destinationLabel, locked, searchActive, depth = 0 }: {
  node: NotionTreeNode;
  /** A top-level section's hue; everything under it inherits it through CSS. */
  tone?: string;
  selectedId: string;
  highlightedId: string;
  onSelect: (page: NotionTreePage) => void;
  openLabel: string;
  destinationLabel: string;
  locked: boolean;
  searchActive: boolean;
  depth?: number;
}) {
  // The archive destination and a just-created page must be visible, so their
  // branches open when they change — once, leaving the user free to fold them.
  const reveal = [selectedId, highlightedId].filter((id) => hasDescendant(node, id)).join(" ");
  const [expanded, setExpanded] = useState(depth === 0 || Boolean(reveal));
  const [revealed, setRevealed] = useState(reveal);
  if (reveal !== revealed) {
    setRevealed(reveal);
    if (reveal) setExpanded(true);
  }
  const hasChildren = node.children.length > 0;
  const open = searchActive || expanded;
  const selected = selectedId === node.id;
  return (
    <li style={tone ? { "--branch": `var(--todo-${tone})`, "--branch-line": `var(--event-${tone}-line)` } as CSSProperties : undefined}>
      <div className={styles.treeRow} data-parent={hasChildren} data-selected={selected} data-highlighted={highlightedId === node.id}>
        {hasChildren ? (
          <button type="button" className={styles.treeToggle} aria-label={open ? "Collapse" : "Expand"} aria-expanded={open} disabled={searchActive} onClick={() => setExpanded((value) => !value)}>
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d={open ? "m2.5 4 3.5 3.5L9.5 4" : "m4 2.5 3.5 3.5L4 9.5"} /></svg>
          </button>
        ) : <span className={styles.treeSpacer} aria-hidden="true" />}
        <button type="button" className={styles.treeTitle} disabled={locked} onClick={() => onSelect(node)} aria-current={selected ? "page" : undefined}>
          {node.title}
        </button>
        {selected ? <span className={styles.treeTag}>{destinationLabel}</span> : null}
        {node.url ? <a href={node.url} target="_blank" rel="noopener noreferrer" aria-label={`${openLabel}: ${node.title}`} title={`${openLabel}: ${node.title}`}>↗</a> : null}
      </div>
      {hasChildren && open ? (
        <ul>{node.children.map((child) => (
          <NotionTreeItem key={child.id} node={child} selectedId={selectedId} highlightedId={highlightedId} onSelect={onSelect} openLabel={openLabel} destinationLabel={destinationLabel} locked={locked} searchActive={searchActive} depth={depth + 1} />
        ))}</ul>
      ) : null}
    </li>
  );
}

export function NotesWorkspace() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const split = useIsSplitLayout();
  const [loaded, setLoaded] = useState(false);
  const notes = useNoteDrafts(t("notes.save.error"));
  const { drafts, replaceDrafts, getDrafts, patchDraft, flushSaves, recoveryWriter } = notes;
  const [activeId, setActiveId] = useState(() => searchParams.get("draft") ?? "");
  const [view, setView] = useState<NotesView>(() => notesView(searchParams));
  const [mapVisited, setMapVisited] = useState(() => notesView(searchParams) === "mindmap");
  useEffect(() => { if (view === "mindmap") setMapVisited(true); }, [view]);
  const [activeCanvasId, setActiveCanvasId] = useState(() => notesView(searchParams) === "canvas" ? searchParams.get("canvas") ?? "" : "");
  const lastCanvasId = useRef(activeCanvasId);
  const switchingView = useRef(false);
  const [switching, setSwitching] = useState(false);
  const [latestCanvas, setLatestCanvas] = useState<CanvasSummary | null>(null);
  const canvasRef = useRef<CanvasWorkspaceHandle>(null);
  const flushCanvas = useCallback(async () => canvasRef.current?.flush(), []);
  const [preview, setPreview] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>(() => notePane(searchParams.get("pane")));
  const [pages, setPages] = useState<NotionTreePage[]>([]);
  const [notionQuery, setNotionQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [notionError, setNotionError] = useState<string | null>(null);
  const [highlightedNotionId, setHighlightedNotionId] = useState("");
  const [models, setModels] = useState<ModelSelectorOption[]>([]);
  const [model, setModel] = useState<ModelRef | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [agentCollapsed, setAgentCollapsed] = useState(() => searchParams.get("pane") !== "agent");
  const [includeConversation, setIncludeConversation] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<"obsidian" | "notion">("obsidian");
  const [vaults, setVaults] = useState<ObsidianVault[]>([]);
  const [vaultId, setVaultId] = useState("");
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [archives, setArchives] = useState<ObsidianArchive[]>([]);
  const [archiveNotice, setArchiveNotice] = useState<ObsidianArchive | null>(null);
  const [rawReview, setRawReview] = useState<(FinalPreview & { draftId: string }) | null>(null);
  const archiveInFlight = useRef(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  // Preparing an archive runs on the server, so its state is read from there
  // per draft: leaving the page, or switching drafts, loses nothing.
  const [finals, setFinals] = useState<Record<string, NoteFinal>>({});
  const [clock, setClock] = useState(() => Date.now());
  // The files a note is written from; they are archived with it.
  const [noteFiles, setNoteFiles] = useState<Record<string, NoteAttachment[]>>({});
  const [uploading, setUploading] = useState(0);
  const [filesNotices, setFilesNotices] = useState<Record<string, string | null>>({});
  const filesNotice = filesNotices[activeId] ?? null;
  const setFilesNotice = (id: string, notice: string | null) => setFilesNotices(current => ({ ...current, [id]: notice }));
  const fileVersions = useRef(new Map<string, number>());
  const fileRemovals = useRef(new Set<string>());
  const [removingFiles, setRemovingFiles] = useState<ReadonlySet<string>>(new Set());
  const [dropping, setDropping] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [finalError, setFinalError] = useState<string | null>(null);
  const finalsVersion = useRef(0);
  const startingFinal = useRef(false);
  const initialized = useRef(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const marginRef = useRef<HTMLElement>(null);
  const [agentPending, setAgentPending] = useState<{ id: string; text: string } | undefined>();
  // To-dos already sent to Robin from this draft's margin, so their cards say so.
  const [addedTodos, setAddedTodos] = useState<ReadonlySet<string>>(new Set());

  const activeSave = notes.status(activeId);

  const activeDraft = useMemo(() => drafts.find((draft) => draft.id === activeId) ?? null, [activeId, drafts]);
  const selectedPage = useMemo(() => pages.find((page) => page.id === activeDraft?.notionParentId), [activeDraft?.notionParentId, pages]);
  const selectedVault = vaults.find((vault) => vault.id === vaultId);
  const destinationReady = archiveTarget === "obsidian" ? Boolean(selectedVault) : Boolean(selectedPage);
  const activeFinal = activeId ? finals[activeId] : undefined;
  const finalizing = activeFinal?.status === "running";
  const finalPreview: FinalPreview | null = rawReview?.draftId === activeId ? rawReview
    : activeFinal?.status === "ready" && activeFinal.content
      ? { title: activeFinal.title || activeDraft?.title || "", content: activeFinal.content }
      : null;
  const finalFailure = activeFinal?.status === "error" ? activeFinal.error ?? null : null;
  const anyFinalRunning = Object.values(finals).some((final) => final.status === "running");
  const activeFiles = activeId ? noteFiles[activeId] ?? [] : [];
  // `busy` blocks everything; `locked` only freezes the draft that is being
  // prepared or reviewed, so another draft can be opened in the meantime.
  const busy = archiving || creatingDraft || notes.removing;
  const locked = busy || finalizing || finalPreview !== null;

  const createDraft = useCallback(async (seed?: { title?: string; text?: string; notionParentId?: string }) => {
    setCreatingDraft(true);
    try {
      const response = await fetch("/api/robin/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: seed?.title ?? defaultTitle(), text: seed?.text ?? "", notionParentId: seed?.notionParentId ?? "" }),
      });
      const body = await response.json().catch(() => null) as { draft?: NoteDraft; error?: string } | null;
      if (!response.ok || !body?.draft) throw new Error(body?.error ?? `Request failed (${response.status})`);
      replaceDrafts((current) => [body.draft!, ...current]);
      return body.draft;
    } finally {
      setCreatingDraft(false);
    }
  }, [replaceDrafts]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void (async () => {
      try {
        const response = await fetch("/api/robin/notes");
        const body = await response.json().catch(() => null) as { drafts?: NoteDraft[]; error?: string } | null;
        if (!response.ok || !body) throw new Error(body?.error ?? `Request failed (${response.status})`);
        let items = body.drafts ?? [];
        if (items.length === 0) {
          let legacy: { title?: string; text?: string; notionParentId?: string } | undefined;
          try {
            const raw = window.localStorage.getItem(LEGACY_DRAFT_KEY);
            if (raw) legacy = JSON.parse(raw) as typeof legacy;
          } catch { /* Ignore malformed legacy state. */ }
          const created = await createDraft(legacy);
          items = [created];
          window.localStorage.removeItem(LEGACY_DRAFT_KEY);
        }
        replaceDrafts(items);
        const requested = searchParams.get("draft");
        const remembered = window.localStorage.getItem(ACTIVE_DRAFT_KEY);
        const nextId = items.some((draft) => draft.id === requested)
          ? requested!
          : items.some((draft) => draft.id === remembered) ? remembered! : items[0].id;
        setActiveId(nextId);
        window.localStorage.setItem(ACTIVE_DRAFT_KEY, nextId);
        writeUrlState({ draft: searchParams.get("canvas") ? null : nextId }, "replace");
      } catch (caught) {
        setFinalError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setLoaded(true);
      }
    })();
  }, [createDraft, replaceDrafts, searchParams]);

  useEffect(() => {
    setMobilePane(notePane(searchParams.get("pane")));
    const requestedView = notesView(searchParams);
    const requestedCanvas = requestedView === "canvas" ? searchParams.get("canvas") ?? "" : "";
    if (requestedCanvas !== activeCanvasId || requestedView !== view) {
      let cancelled = false;
      void flushCanvas().then(() => {
        if (!cancelled) {
          if (activeCanvasId) lastCanvasId.current = activeCanvasId;
          setActiveCanvasId(requestedCanvas);
          setView(requestedView);
        }
      }).catch(() => {
        if (!cancelled) writeUrlState({ canvas: activeCanvasId || null, view }, "replace");
      });
      return () => { cancelled = true; };
    }
    if (!loaded || activeCanvasId) return;
    const requested = searchParams.get("draft");
    if (!requested || requested === activeId || !drafts.some((draft) => draft.id === requested)) return;
    setActiveId(requested);
    setPreview(false);
    setFinalError(null);
    window.localStorage.setItem(ACTIVE_DRAFT_KEY, requested);
  }, [activeId, activeCanvasId, drafts, flushCanvas, loaded, searchParams, view]);

  const updateActive = useCallback((patch: DraftPatch) => {
    if (!activeId || locked) return false;
    return patchDraft(activeId, patch);
  }, [activeId, locked, patchDraft]);

  const loadModels = useCallback(async () => {
    try {
      const response = await fetch("/api/models");
      const body = await response.json().catch(() => null) as ModelsData | null;
      if (!response.ok || !body) throw new Error(`Request failed (${response.status})`);
      const options = body.modelList.map((entry) => ({ provider: entry.provider, modelId: entry.id, name: entry.name || entry.id }));
      setModels(options);
      let stored: ModelRef | null = null;
      try { stored = JSON.parse(window.localStorage.getItem(MODEL_KEY) ?? "null") as ModelRef | null; } catch { /* Use fallback. */ }
      setModel(options.find((entry) => sameModel(stored, entry)) ?? options.find((entry) => entry.modelId === DEFAULT_MODEL_ID) ?? body.defaultModel ?? options[0] ?? null);
      setModelError(body.modelError ?? null);
    } catch (caught) {
      setModelError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const loadNotion = useCallback(async () => {
    setSearching(true);
    setNotionError(null);
    try {
      const response = await fetch("/api/robin/notion");
      const body = await response.json().catch(() => null) as { pages?: NotionTreePage[]; error?: string } | null;
      if (!response.ok || !body) throw new Error(body?.error ?? `Request failed (${response.status})`);
      setPages(body.pages ?? []);
    } catch (caught) {
      setNotionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSearching(false);
    }
  }, []);

  const loadObsidian = useCallback(async () => {
    setVaultError(null);
    try {
      const response = await fetch("/api/robin/obsidian");
      const body = await response.json() as { vaults?: ObsidianVault[]; archives?: ObsidianArchive[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
      const available = body.vaults ?? [];
      setVaults(available);
      setArchives(body.archives ?? []);
      const remembered = window.localStorage.getItem("pi-robin-obsidian-vault");
      setVaultId((current) => available.some((vault) => vault.id === current) ? current
        : available.some((vault) => vault.id === remembered) ? remembered!
          : available.length === 1 ? available[0].id : "");
    } catch (caught) { setVaultError(caught instanceof Error ? caught.message : String(caught)); }
  }, []);

  useEffect(() => { void loadModels(); void loadObsidian(); }, [loadModels, loadObsidian]);
  useEffect(() => { if (archiveTarget === "notion") void loadNotion(); }, [archiveTarget, loadNotion]);

  const fullTree = useMemo(() => buildNotionTree(pages), [pages]);
  const tree = useMemo(() => filterNotionTree(fullTree, notionQuery), [fullTree, notionQuery]);
  // Toned from the unfiltered tree, so a search never repaints a section.
  const branchTones = useMemo(() => new Map(
    fullTree.filter((node) => node.children.length > 0)
      .map((node, index) => [node.id, BRANCH_TONES[index % BRANCH_TONES.length]]),
  ), [fullTree]);

  const selectDraft = (id: string, pane?: MobilePane) => {
    if (activeCanvasId) lastCanvasId.current = activeCanvasId;
    setActiveCanvasId("");
    const nextView = view === "mindmap" ? "mindmap" : "notes";
    setView(nextView);
    setActiveId(id);
    setPreview(false);
    setFinalError(null);
    if (pane) setMobilePane(pane);
    window.localStorage.setItem(ACTIVE_DRAFT_KEY, id);
    writeUrlState({ draft: id, canvas: null, view: nextView === "notes" ? null : nextView, pane });
  };

  const showMobilePane = (pane: MobilePane) => {
    setMobilePane(pane);
    writeUrlState({ pane });
  };

  const switchDraft = async (id: string) => {
    if (busy) return;
    try { await flushCanvas(); selectDraft(id); }
    catch { /* The canvas keeps its unsaved drawing and error visible. */ }
  };

  const selectCanvas = (id: string) => {
    lastCanvasId.current = id;
    setView("canvas");
    setActiveCanvasId(id);
    setMobilePane("note");
    writeUrlState({ view: "canvas", canvas: id, draft: null, pane: "note" });
  };

  const switchView = async (next: NotesView) => {
    if (switchingView.current || next === view) return;
    switchingView.current = true;
    setSwitching(true);
    try {
      await flushCanvas(); // A failed canvas save keeps its editor and retry action visible.
      void flushSaves(); // Note drafts remain mounted and retain their local recovery copy.
      if (activeCanvasId) lastCanvasId.current = activeCanvasId;
      const canvas = next === "canvas" ? lastCanvasId.current : "";
      setActiveCanvasId(canvas);
      setView(next);
      const pane = next === "canvas" && !canvas ? "notion" : "note";
      setMobilePane(pane);
      if (next === "canvas" && !canvas) setLibraryCollapsed(false);
      writeUrlState({ view: next === "notes" ? null : next, canvas: canvas || null, draft: next === "canvas" ? null : activeId || null, pane });
    } catch { /* CanvasEditor owns the actionable save error. */ }
    finally { switchingView.current = false; setSwitching(false); }
  };

  const focusEditor = (atEnd = false) => {
    window.requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus({ preventScroll: true });
      if (atEnd) {
        editor.setSelectionRange(editor.value.length, editor.value.length);
        editor.scrollTop = editor.scrollHeight;
      }
    });
  };

  /**
   * A blank draft already in the list is the new note; making another would
   * only pile up empty "Notes <date>" rows. A dated title left over from an
   * earlier day moves to today, and the note keeps the archive destination
   * in use, since a run of lecture notes usually lands on one Notion page.
   */
  const openBlankDraft = async (notionParentId: string) => {
    const current = getDrafts();
    const blank = current.find((draft) => draft.id === activeId && !draft.text.trim())
      ?? current.find((draft) => !draft.text.trim());
    if (blank) {
      const patch: DraftPatch = {};
      if (DATED_TITLE.test(blank.title) && blank.title !== defaultTitle()) patch.title = defaultTitle();
      if (!blank.notionParentId && notionParentId) patch.notionParentId = notionParentId;
      if (Object.keys(patch).length) patchDraft(blank.id, patch);
      selectDraft(blank.id, "note");
    } else {
      const created = await createDraft({ notionParentId });
      selectDraft(created.id, "note");
    }
    focusEditor();
  };

  const startNewDraft = async () => {
    try { await flushCanvas(); await openBlankDraft(activeDraft?.notionParentId ?? ""); }
    catch (caught) { setFinalError(caught instanceof Error ? caught.message : String(caught)); }
  };

  const addToNote = (addition: string) => {
    const current = getDrafts().find((draft) => draft.id === activeId);
    if (!current || locked || !addition.trim()) return;
    const base = current.text.trimEnd();
    updateActive({ text: base ? `${base}\n\n${addition.trim()}\n` : `${addition.trim()}\n` });
    setPreview(false);
    showMobilePane("note");
    focusEditor(true);
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void flushSaves();
      return;
    }
    // An IME confirming a candidate also sends Enter; that one belongs to the IME.
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.metaKey || event.ctrlKey) return;
    const editor = event.currentTarget;
    const edit = event.key === "Enter" && !event.shiftKey
      ? continueMarkdownBlock(editor.value, editor.selectionStart, editor.selectionEnd)
      : event.key === "Tab"
        ? indentMarkdownList(editor.value, editor.selectionStart, editor.selectionEnd, event.shiftKey)
        : null;
    if (!edit) return;
    event.preventDefault();
    applyEdit(editor, edit);
  };

  const deleteDraft = async (draft: NoteDraft) => {
    if (busy || !window.confirm(t("notes.drafts.deleteConfirm", { title: draft.title || t("notes.drafts.untitled") }))) return;
    setFinalError(null);
    try {
      if (!await notes.deleteDraft(draft.id)) return;
      window.localStorage.removeItem(`pi-robin-agent-transcript:notes:${draft.id}`);
      const remaining = getDrafts();
      if (activeId === draft.id) {
        if (activeCanvasId) { setActiveId(remaining[0]?.id ?? ""); return; }
        if (remaining[0]) void switchDraft(remaining[0].id);
        else await startNewDraft();
      }
    } catch (caught) {
      setFinalError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  /** Both later reads and local commands invalidate earlier polling snapshots. */
  const loadFinals = useCallback(async () => {
    const version = ++finalsVersion.current;
    try {
      const response = await fetch("/api/robin/notes-agent");
      const body = await response.json().catch(() => null) as { finals?: Record<string, NoteFinal> } | null;
      if (response.ok && body?.finals && version === finalsVersion.current) setFinals(body.finals);
    } catch { /* The next poll tries again. */ }
  }, []);

  const setFinal = (draftId: string, final: NoteFinal | null) => {
    finalsVersion.current += 1;
    setFinals((current) => {
      const next = { ...current };
      if (final) next[draftId] = final;
      else delete next[draftId];
      return next;
    });
  };

  useEffect(() => {
    void loadFinals();
    return () => { finalsVersion.current += 1; };
  }, [loadFinals]);

  useEffect(() => {
    if (!activeId) return;
    setFilesNotices(current => ({ ...current, [activeId]: null }));
    const version = (fileVersions.current.get(activeId) ?? 0) + 1;
    fileVersions.current.set(activeId, version);
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/robin/notes/attachments?draftId=${encodeURIComponent(activeId)}`);
        const body = await response.json().catch(() => null) as { attachments?: NoteAttachment[] } | null;
        if (!cancelled && version === fileVersions.current.get(activeId) && response.ok && body?.attachments) {
          setNoteFiles((current) => ({ ...current, [activeId]: body.attachments! }));
        }
      } catch { /* Keep the last known files on a failed read. */ }
    })();
    return () => { cancelled = true; };
  }, [activeId]);

  const fileUrl = (draftId: string, id: string) =>
    `/api/robin/notes/attachments?draftId=${encodeURIComponent(draftId)}&id=${encodeURIComponent(id)}`;

  /** Upload one at a time, so the server's per-note limit is met in order. */
  const attachFiles = async (files: File[]) => {
    if (!activeDraft || locked) return;
    const draftId = activeDraft.id;
    const accepted = files.filter((file) => (file.type.startsWith("image/") && file.type !== "image/svg+xml") || file.type === "application/pdf" || /\.pdf$/i.test(file.name));
    if (accepted.length === 0) return;
    setFilesNotice(draftId, null);
    setUploading((count) => count + accepted.length);
    for (const file of accepted) {
      try {
        const form = new FormData();
        form.set("draftId", draftId);
        form.set("file", file);
        if (file.type.startsWith("image/")) {
          const preview = await compressImageFile(file);
          form.set("preview", preview.data);
          form.set("previewMime", preview.mimeType);
        }
        const response = await fetch("/api/robin/notes/attachments", { method: "POST", body: form });
        const body = await response.json().catch(() => null) as { attachment?: NoteAttachment; error?: string } | null;
        if (!response.ok || !body?.attachment) throw new Error(body?.error ?? `Request failed (${response.status})`);
        // Invalidate earlier lists, and deduplicate a receipt already seen by a newer GET.
        fileVersions.current.set(draftId, (fileVersions.current.get(draftId) ?? 0) + 1);
        const attachment = body.attachment;
        setNoteFiles((current) => ({ ...current, [draftId]: [...(current[draftId] ?? []).filter(item => item.id !== attachment.id), attachment] }));
        if (body.attachment.truncated) setFilesNotice(draftId, t("notes.files.truncated", { name: body.attachment.name }));
      } catch (caught) {
        setFilesNotice(draftId, `${file.name}: ${caught instanceof Error ? caught.message : String(caught)}`);
      } finally {
        setUploading((count) => count - 1);
      }
    }
  };

  const detachFile = async (file: NoteAttachment) => {
    if (!activeDraft || locked) return;
    const draftId = activeDraft.id;
    const key = `${draftId}:${file.id}`;
    if (fileRemovals.current.has(key)) return;
    fileRemovals.current.add(key);
    setRemovingFiles(new Set(fileRemovals.current));
    setFilesNotice(draftId, null);
    try {
      const response = await fetch("/api/robin/notes/attachments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId, id: file.id }),
      });
      if (!response.ok) throw new Error("Attachment removal not confirmed");
      // Publish only the confirmed removal; an earlier GET cannot resurrect it.
      fileVersions.current.set(draftId, (fileVersions.current.get(draftId) ?? 0) + 1);
      setNoteFiles((current) => ({ ...current, [draftId]: (current[draftId] ?? []).filter((item) => item.id !== file.id) }));
    } catch {
      setFilesNotice(draftId, t("notes.files.removeFailed", { name: file.name }));
    } finally {
      fileRemovals.current.delete(key);
      setRemovingFiles(new Set(fileRemovals.current));
    }
  };

  const sheetDrop = {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (locked || !Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      setDropping(true);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      setDropping(false);
      void attachFiles(Array.from(event.dataTransfer.files));
    },
  };

  /** A pasted screenshot becomes an attachment; pasted text stays text. */
  const onEditorPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = Array.from(event.clipboardData.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    event.preventDefault();
    void attachFiles(images);
  };

  /** The finalizer marks where files go as attachment:ID; show them as the files themselves. */
  const withFileLinks = (markdown: string) => {
    const draftId = activeDraft?.id ?? "";
    return markdown.replace(/!?\[([^\]]*)\]\(attachment:([A-Za-z0-9_-]+)\)/g, (match, label: string, id: string) => {
      const file = activeFiles.find((item) => item.id === id);
      if (!file) return "";
      return file.kind === "image" ? `![${label}](${fileUrl(draftId, id)})` : `[📎 ${label || file.name}](${fileUrl(draftId, id)})`;
    });
  };

  useEffect(() => {
    if (!anyFinalRunning) return;
    let poll: number | undefined;
    let tick: number | undefined;
    const stop = () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
      poll = tick = undefined;
    };
    const start = () => {
      if (poll !== undefined) return;
      poll = window.setInterval(() => { void loadFinals(); }, FINAL_POLL_MS);
      tick = window.setInterval(() => setClock(Date.now()), 1_000);
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") { stop(); return; }
      setClock(Date.now());
      void loadFinals();
      start();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [anyFinalRunning, loadFinals]);

  const startFinalization = async () => {
    if (!activeDraft || (!activeDraft.text.trim() && activeFiles.length === 0) || !destinationReady || !model || locked || startingFinal.current) return;
    startingFinal.current = true;
    setFinalError(null);
    setClock(Date.now());
    try {
      const response = await fetch("/api/robin/notes-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "finalize",
          draftId: activeDraft.id,
          title: activeDraft.title,
          note: activeDraft.text,
          archiveDestination: archiveTarget === "obsidian" ? `Obsidian: ${selectedVault?.name}` : `Notion: ${selectedPage?.title}`,
          includeConversation,
          provider: model.provider,
          modelId: model.modelId,
        }),
      });
      const body = await response.json().catch(() => null) as { final?: NoteFinal; error?: string } | null;
      if (!response.ok || !body?.final) throw new Error(body?.error ?? `Request failed (${response.status})`);
      setFinal(activeDraft.id, body.final);
    } catch (caught) {
      setFinalError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      startingFinal.current = false;
    }
  };

  /** Stop a running finalize, or drop a finished one and go back to editing. */
  const clearFinal = async (action: "cancel" | "discard") => {
    if (!activeDraft) return;
    const draftId = activeDraft.id;
    setPreview(false);
    if (rawReview?.draftId === draftId) { setRawReview(null); return; }
    setFinal(draftId, null);
    try {
      const response = await fetch("/api/robin/notes-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, draftId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${response.status})`);
      }
    } catch (caught) {
      setFinalError(caught instanceof Error ? caught.message : String(caught));
      void loadFinals();
    }
  };

  const elapsed = activeFinal?.status === "running"
    ? Math.max(0, Math.floor((clock - Date.parse(activeFinal.startedAt)) / 1000))
    : 0;

  const archiveFinal = async () => {
    if (!activeDraft || !destinationReady || !finalPreview || archiving || archiveInFlight.current) return;
    archiveInFlight.current = true;
    setArchiving(true);
    setFinalError(null);
    try {
      if (archiveTarget === "obsidian") {
        const archive = await notes.archiveDraft(activeDraft.id, async () => {
          const response = await fetch("/api/robin/obsidian", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              confirmed: true, vaultId, draftId: activeDraft.id,
              title: finalPreview.title, content: finalPreview.content,
              expectedDraft: { title: activeDraft.title, text: activeDraft.text },
              attachmentIds: activeFiles.map((file) => file.id),
            }),
          });
          const body = await response.json() as { archive?: ObsidianArchive; error?: string };
          if (!response.ok || !body.archive) throw new Error(body.error ?? `Request failed (${response.status})`);
          return body.archive;
        });
        if (!archive) return;
        window.localStorage.removeItem(`pi-robin-agent-transcript:notes:${activeDraft.id}`);
        setArchives((current) => [archive, ...current.filter((item) => item.draftId !== activeDraft.id)]);
        setArchiveNotice(archive);
        setRawReview(null);
        setFinal(activeDraft.id, null);
        setIncludeConversation(false);
        setPreview(false);
        await openBlankDraft("");
        return;
      }
      if (!selectedPage) return;
      const page = await notes.archiveDraft(activeDraft.id, async () => {
        const response = await fetch("/api/robin/notion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentPageId: selectedPage.id,
            title: finalPreview.title,
            content: finalPreview.content,
            draftId: activeDraft.id,
            confirmed: true,
          }),
        });
        const body = await response.json().catch(() => null) as { page?: NotionTreePage; error?: string } | null;
        if (!response.ok || !body?.page) throw new Error(body?.error ?? `Request failed (${response.status})`);
        return body.page;
      });
      if (!page) return;
      window.localStorage.removeItem(`pi-robin-agent-transcript:notes:${activeDraft.id}`);
      setPages((current) => [page, ...current.filter((item) => item.id !== page.id)]);
      setHighlightedNotionId(page.id);
      setFinal(activeDraft.id, null);
      setIncludeConversation(false);
      setPreview(false);
      await openBlankDraft(selectedPage.id);
    } catch (caught) {
      setFinalError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      archiveInFlight.current = false;
      setArchiving(false);
    }
  };

  const modelFooter = (
    <div className={styles.modelFooter}>
      <ModelSelector
        options={models}
        value={model}
        onChange={(provider, modelId) => {
          const next = { provider, modelId };
          setModel(next);
          window.localStorage.setItem(MODEL_KEY, JSON.stringify(next));
        }}
        disabled={models.length === 0 || (view === "notes" && locked)}
        emptyLabel={t("notes.model.loading")}
        ariaLabel={t("notes.model")}
        variant="toolbar"
        placement="up"
        portal
      />
      {modelError ? <p role="status">{modelError}</p> : null}
    </div>
  );

  const activeWords = countWords(activeDraft?.text ?? "");

  // ── margins: an outline on the left, questions and to-dos on the right ──
  const writing = !finalPreview && !preview;
  const marginText = finalPreview?.content ?? activeDraft?.text ?? "";
  const outline = useMemo(() => noteOutline(marginText), [marginText]);
  const reviewing = finalPreview !== null;
  const marginItems = useMemo(() => (reviewing ? [] : noteMarginItems(activeDraft?.text ?? "")), [activeDraft?.text, reviewing]);
  const geometry = useEditorGeometry(editorRef, marginRef, activeDraft?.text ?? "", split && !activeCanvasId && writing && Boolean(activeDraft));
  const topLine = geometry
    ? Math.max(0, geometry.lineTops.filter((top) => geometry.paddingTop + top - geometry.scrollTop < 24).length - 1)
    : 0;
  const activeHeading = writing ? currentHeading(outline, topLine) : -1;
  const questionCount = marginItems.filter((item) => item.kind === "question").length;
  const todoCount = marginItems.length - questionCount;
  const todosKey = activeId ? `pi-robin-notes-todos-added:${activeId}` : "";

  useEffect(() => {
    if (!todosKey) return;
    try { setAddedTodos(new Set(JSON.parse(window.localStorage.getItem(todosKey) ?? "[]") as string[])); }
    catch { setAddedTodos(new Set()); }
  }, [todosKey]);

  const jumpTo = (entry: OutlineEntry, index: number) => {
    const editor = editorRef.current;
    if (writing && editor) {
      const offset = editor.value.split("\n").slice(0, entry.line).reduce((total, line) => total + line.length + 1, 0);
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(offset, offset);
      editor.scrollTop = Math.max(0, geometry?.lineTops[entry.line] ?? entry.line * 26);
      return;
    }
    previewRef.current?.querySelectorAll("h1, h2, h3")[index]?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const askAboutItem = (item: MarginItem) => {
    setAgentCollapsed(false);
    setAgentPending({ id: `${Date.now()}`, text: t("notes.margin.askPrompt", { question: item.text }) });
  };

  const addItemToTodos = async (item: MarginItem) => {
    try {
      const response = await fetch("/api/robin/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: item.text }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${response.status})`);
      }
      const next = new Set(addedTodos).add(item.text);
      setAddedTodos(next);
      try { window.localStorage.setItem(todosKey, JSON.stringify([...next])); } catch { /* The todo itself is saved. */ }
      requestRefresh();
    } catch (caught) {
      setFinalError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  // Desktop keeps filing in the masthead; phones disclose it below the sheet.
  const filing = (
    <section className={styles.filing} data-place={split ? "header" : "sheet"} aria-label={t("notes.notion.destination")}>
      <label className={styles.archiveDestination}>
        <span className="pi-eyebrow">{t("notes.notion.destination")}</span>
        <select aria-label={t("notes.notion.destination")} value={archiveTarget} disabled={locked} onChange={(event) => setArchiveTarget(event.target.value as "obsidian" | "notion")}>
          <option value="obsidian">Obsidian</option><option value="notion">Notion</option>
        </select>
      </label>
      <p data-empty={!destinationReady}><strong title={archiveTarget === "obsidian" ? selectedVault?.path : selectedPage?.title}>{archiveTarget === "obsidian" ? selectedVault?.name ?? t("notes.obsidian.choose") : selectedPage?.title ?? t("notes.notion.chooseLeft")}</strong></p>
      {finalizing ? (
        <div className={styles.primaryActions}>
          <p className={styles.working} role="status">
            <span>{t("notes.final.working", { time: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}` })}</span>
            <small>{t("notes.final.leaveHint")}</small>
          </p>
          <button type="button" className={styles.stopButton} onClick={() => void clearFinal("cancel")}>{t("notes.final.stop")}</button>
        </div>
      ) : finalPreview ? (
        <div className={styles.primaryActions}>
          <button type="button" disabled={archiving} onClick={() => void clearFinal("discard")}>{t("notes.final.back")}</button>
          <button type="button" data-primary="true" disabled={archiving} onClick={() => void archiveFinal()}>{archiving ? t("notes.archive.working") : t(archiveTarget === "obsidian" ? "notes.obsidian.confirm" : "notes.final.confirm")}</button>
        </div>
      ) : (
        <div className={styles.prepareActions}>
          <label><input type="checkbox" checked={includeConversation} onChange={(event) => setIncludeConversation(event.target.checked)} />{t("notes.final.includeConversation")}</label>
          {archiveTarget === "obsidian" ? <button type="button" data-primary="true" disabled={locked || !activeDraft?.title.trim() || (!activeDraft?.text.trim() && activeFiles.length === 0) || !destinationReady || uploading > 0} onClick={() => {
            if (activeDraft) { setRawReview({ draftId: activeDraft.id, title: activeDraft.title, content: activeDraft.text }); showMobilePane("note"); }
          }}>{t("notes.obsidian.review")}</button> : null}
          <button type="button" data-primary={archiveTarget === "notion" ? "true" : undefined} onClick={() => void startFinalization()} disabled={locked || (!activeDraft?.text.trim() && activeFiles.length === 0) || !destinationReady || !model || uploading > 0}>{t("notes.final.prepare")}</button>
        </div>
      )}
    </section>
  );

  const noteError = finalError ?? activeSave.error ?? finalFailure;
  const errorNotice = noteError ? <p className={styles.error} role="alert">{noteError}</p> : null;

  const agent = activeDraft ? (
    <AgentPanel
      mode="notes"
      endpoint="/api/robin/notes-agent"
      requestBody={{
        draftId: activeDraft.id,
        title: activeDraft.title,
        note: activeDraft.text,
        archiveDestination: archiveTarget === "obsidian" ? `Obsidian: ${selectedVault?.name ?? ""}` : `Notion: ${selectedPage?.title ?? ""}`,
        provider: model?.provider ?? "",
        modelId: model?.modelId ?? "",
      }}
      titleKey="notes.agent.title"
      placeholderKey="notes.agent.placeholder"
      restartHintKey="notes.agent.restartHint"
      emptyHintKey="notes.agent.empty"
      toolKeys={{}}
      replyAction={{ labelKey: "notes.agent.useReply", onReply: addToNote }}
      attachments
      disabled={!model || locked}
      footer={modelFooter}
      transcriptKey={`notes:${activeDraft.id}`}
      pending={agentPending}
    />
  ) : null;

  return (
    <div className={`${navigation.inbox} ${styles.page} ${styles.shell} robin-dashboard robin-workspace-ground`}>
      <header className={styles.header}>
          {view !== "mindmap" && <h1 className="sr-only">{t(view === "canvas" ? "canvas.title" : "notes.title")}</h1>}
          {split && view !== "mindmap" ? (
            <button
              type="button"
              className={styles.libraryToggle}
              onClick={() => setLibraryCollapsed((collapsed) => !collapsed)}
              aria-controls="notes-library"
              aria-expanded={!libraryCollapsed}
              aria-label={t(libraryCollapsed ? "notes.notion.expand" : "notes.notion.collapse")}
              title={t(libraryCollapsed ? "notes.notion.expand" : "notes.notion.collapse")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" /><path d="M9 4v16" /><path d={libraryCollapsed ? "m13 9 3 3-3 3" : "m16 9-3 3 3 3"} /></svg>
            </button>
          ) : null}
        <nav className={`robin-workspace-tabs ${navigation.sources} ${styles.viewTabs}`} aria-label={t("notes.views")}>
          {(["notes", "canvas", "mindmap"] as const).map((item) => <button key={item} type="button" aria-pressed={view === item} aria-controls="notes-workspace" disabled={switching} onClick={() => void switchView(item)}>
            {item === "notes" ? "Notes" : item === "canvas" ? "Canvas" : t("notes.mindmap")}
          </button>)}
        </nav>
        {split && view === "notes" ? filing : null}
        {split && view !== "mindmap" ? (
          <button
            type="button"
            className={`ui-action ${styles.agentToggle}`}
            onClick={() => setAgentCollapsed((collapsed) => !collapsed)}
            aria-controls="notes-agent"
            aria-expanded={!agentCollapsed}
            aria-label={t(agentCollapsed ? "notes.agent.expand" : "notes.agent.collapse")}
            title={t(agentCollapsed ? "notes.agent.expand" : "notes.agent.collapse")}
          >
            {t(agentCollapsed ? "notes.agent.expand" : "notes.agent.collapse")}
          </button>
        ) : null}
        {!split && view !== "mindmap" ? (
          <div className={styles.mobileTabs} role="tablist" aria-label={t("notes.views")}>
            {(["notion", "note", "agent"] as const).map((pane) => (
              <button key={pane} type="button" role="tab" aria-selected={mobilePane === pane} onClick={() => showMobilePane(pane)}>
                {t(pane === "notion" ? "notes.library" : pane === "note" ? activeCanvasId ? "canvas.title" : "notes.note" : "notes.agent.short")}
              </button>
            ))}
          </div>
        ) : null}
      </header>
    <div id="notes-workspace" className={`robin-page robin-dashboard ${styles.page}`}>
      {(view === "mindmap" || mapVisited) && <MindmapWorkspace active={view === "mindmap"} model={model} footer={modelFooter} sourceNote={activeDraft} />}
      <div className={styles.page} hidden={view === "mindmap"}>
      <div className={`${styles.workspace}${split && libraryCollapsed ? ` ${styles.libraryIsCollapsed}` : ""}`} data-agent-collapsed={split && agentCollapsed}>
        <aside id="notes-library" className={styles.notionPane} hidden={split ? libraryCollapsed : mobilePane !== "notion"} aria-label={t("notes.library")}>
          <section className={styles.obsidianLibrary} hidden={view !== "notes"}>
            <header><h2 className="pi-eyebrow">Obsidian</h2><button type="button" className="ui-action" disabled={locked} onClick={() => void loadObsidian()}>{t("notes.obsidian.refresh")}</button></header>
            <label>{t("notes.obsidian.vault")}<select value={vaultId} disabled={locked} onChange={(event) => {
              setVaultId(event.target.value);
              window.localStorage.setItem("pi-robin-obsidian-vault", event.target.value);
            }}><option value="">{t("notes.obsidian.choose")}</option>{vaults.map((vault) => <option key={vault.id} value={vault.id}>{vaults.length > 1 ? `${vault.name} — ${vault.path}` : vault.name}</option>)}</select></label>
            {selectedVault ? <p>{selectedVault.path}</p> : <p>{t("notes.obsidian.setup")}</p>}
            {vaultError ? <p role="alert">{vaultError}</p> : null}
            <p>{t("notes.obsidian.localHint")}</p>
            {archives.length > 0 ? <><h3 className="pi-eyebrow">{t("notes.obsidian.archives")}</h3><ul>{archives.slice(0, 20).map((archive) => <li key={archive.draftId}><a href={archive.url} title={`${archive.vaultPath}/${archive.relativePath}`}>{archive.title}</a></li>)}</ul></> : null}
          </section>
          <section className={styles.drafts} hidden={view === "canvas"}>
            <header><h2 className="pi-eyebrow">{t("notes.drafts.title")}{loaded ? <span className={styles.count}>{drafts.length}</span> : null}</h2><button type="button" disabled={!loaded || busy} onClick={() => void startNewDraft()} aria-label={t("notes.new")} title={t("notes.new")}>＋</button></header>
            {!loaded ? <p>{t("robin.common.loading")}</p> : (
              <ul>{drafts.map((draft) => {
                const words = countWords(draft.text);
                const final = finals[draft.id]?.status;
                return (
                  <li key={draft.id} data-active={!activeCanvasId && draft.id === activeId}>
                    <button type="button" disabled={busy} onClick={() => void switchDraft(draft.id)} aria-current={!activeCanvasId && draft.id === activeId ? "true" : undefined}>
                      <span>{draft.title || t("notes.drafts.untitled")}</span>
                      {final === "running" || final === "ready" ? (
                        <small data-final={final}>{t(final === "running" ? "notes.drafts.preparing" : "notes.drafts.ready")}</small>
                      ) : (
                        <small data-empty={words === 0}>{words ? t("notes.drafts.words", { count: words }) : t("notes.drafts.empty")}</small>
                      )}
                    </button>
                    <button type="button" disabled={busy} onClick={() => void deleteDraft(draft)} aria-label={t("notes.drafts.delete", { title: draft.title })}>×</button>
                  </li>
                );
              })}</ul>
            )}
          </section>

          <div hidden={view !== "canvas"}><CanvasLibrary selectedId={activeCanvasId} latest={latestCanvas} beforeChange={flushCanvas} onSelect={selectCanvas} onDeleted={(id) => {
            if (lastCanvasId.current === id) lastCanvasId.current = "";
            if (id === activeCanvasId) {
              setActiveCanvasId("");
              writeUrlState({ canvas: null, view: "canvas", draft: null });
            }
          }} /></div>

          {view === "notes" && archiveTarget === "notion" ? <><div className={styles.notionHead}>
            <h2 className="pi-eyebrow">{t("notes.notion.library")}</h2>
            <div className={styles.notionHeadActions}>
              <button type="button" onClick={() => void loadNotion()} disabled={searching || locked} aria-label={t("notes.notion.refresh")} title={t("notes.notion.refresh")}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M18.5 9a7 7 0 0 0-12-2L4 9M5.5 15a7 7 0 0 0 12 2l2.5-2" /></svg>
              </button>
            </div>
          </div>
          <div className={styles.notionSearch}><input value={notionQuery} onChange={(event) => setNotionQuery(event.target.value)} placeholder={t("notes.notion.search")} aria-label={t("notes.notion.search")} /></div>
          <nav className={styles.tree} aria-label={t("notes.notion.tree")} aria-busy={searching}>
            {searching && pages.length === 0 ? <p>{t("robin.common.loading")}</p> : null}
            {/* A failed load explains itself where the pages would be, once. */}
            {!searching && tree.length === 0 ? <p data-error={notionError ? true : undefined} role={notionError ? "alert" : undefined}>{notionError ?? t("notes.notion.empty")}</p> : null}
            <ul>{tree.map((node) => (
              <NotionTreeItem key={node.id} node={node} tone={branchTones.get(node.id)} selectedId={activeCanvasId ? "" : activeDraft?.notionParentId ?? ""} highlightedId={highlightedNotionId} onSelect={(page) => { updateActive({ notionParentId: page.id }); setHighlightedNotionId(""); }} openLabel={t("notes.notion.open")} destinationLabel={t("notes.notion.destinationTag")} locked={locked || Boolean(activeCanvasId)} searchActive={Boolean(notionQuery.trim())} />
            ))}</ul>
          </nav>
          {notionError && tree.length > 0 ? <p className={styles.error} role="alert">{notionError}</p> : null}</> : null}
        </aside>

        {view === "canvas" && !activeCanvasId ? <div className={styles.canvasEmpty} hidden={!split && mobilePane === "notion"}>
          <h2>Canvas</h2><p>{t("notes.canvas.choose")}</p>
          <button type="button" className="ui-action" onClick={() => { setLibraryCollapsed(false); showMobilePane("notion"); }}>{t("canvas.library")}</button>
        </div> : activeCanvasId ? (
          <CanvasWorkspace key={activeCanvasId} ref={canvasRef} id={activeCanvasId} split={split} mobilePane={mobilePane} model={model} footer={modelFooter} onSaved={setLatestCanvas} onShowCanvas={() => showMobilePane("note")} />
        ) : <div className={styles.rightColumn} hidden={!split && mobilePane === "notion"}>
          <main className={styles.notePane} hidden={!split && mobilePane !== "note"}>
            <div className={styles.desk}>
            {archiveNotice ? <p className={styles.archiveNotice} role="status">{t("notes.obsidian.saved")} · <a href={archiveNotice.url}>{t("notes.obsidian.open")}: {archiveNotice.title}</a></p> : null}
            <div className={styles.noteToolbar}>
              {!finalPreview ? (
                <div className={styles.viewToggle} role="group" aria-label={t("notes.editor.view")}>
                  <button type="button" aria-pressed={!preview} disabled={finalizing} onClick={() => setPreview(false)}>{t("notes.editor.write")}</button>
                  <button type="button" aria-pressed={preview} disabled={finalizing} onClick={() => setPreview(true)}>{t("notes.editor.preview")}</button>
                </div>
              ) : <span className={styles.finalBadge}>{t("notes.final.title")}</span>}
              <div className={styles.toolbarEnd}>
                <details className={styles.cheat}>
                  <summary className="ui-action pi-chrome-label pi-bracket">{t("notes.cheat.title")}</summary>
                  <div><h3>{t("notes.cheat.title")}</h3><dl>
                    <div><dt><code># Heading</code></dt><dd>{t("notes.cheat.heading")}</dd></div>
                    <div><dt><code>**bold** · *italic*</code></dt><dd>{t("notes.cheat.emphasis")}</dd></div>
                    <div><dt><code>- item · 1. item</code></dt><dd>{t("notes.cheat.list")}</dd></div>
                    <div><dt><code>- [ ] task</code></dt><dd>{t("notes.cheat.task")}</dd></div>
                    <div><dt><code>[text](url)</code></dt><dd>{t("notes.cheat.link")}</dd></div>
                    <div><dt><code>&gt; quote</code></dt><dd>{t("notes.cheat.quote")}</dd></div>
                    <div><dt><code>`code` · ```</code></dt><dd>{t("notes.cheat.code")}</dd></div>
                  </dl></div>
                </details>
                <button type="button" className={`ui-action pi-chrome-label pi-bracket ${styles.newNote}`} disabled={!loaded || busy} onClick={() => void startNewDraft()}>{t("notes.new")}</button>
              </div>
            </div>

            {activeId ? <TextRecoveryNotice key={activeId} scope="notes" id={activeId} writer={recoveryWriter} disabled={locked || !activeDraft}
              onRestore={(fields) => { setPreview(false); return updateActive(fields); }} /> : null}
            {activeSave.backupFailed ? <TextRecoveryWarning /> : null}
            <div className={styles.sheet} data-reading={preview || Boolean(finalPreview)} data-dropping={dropping} {...sheetDrop}>
              <div className={styles.sheetHead}>
                <div className={styles.titleMeta}>
                  <span className="pi-eyebrow">{finalPreview ? t("notes.final.title") : activeWords ? t("notes.drafts.words", { count: activeWords }) : t("notes.drafts.empty")}</span>
                  {!finalPreview && <SaveStatus state={activeSave.state} onRetry={() => void flushSaves(activeId)} />}
                </div>
                <input
                  className={styles.titleInput}
                  aria-label={t("notes.noteTitle")}
                  value={finalPreview?.title ?? activeDraft?.title ?? ""}
                  maxLength={200}
                  disabled={locked}
                  onChange={(event) => updateActive({ title: event.target.value })}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                      event.preventDefault();
                      void flushSaves();
                    } else if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                      event.preventDefault();
                      setPreview(false);
                      focusEditor();
                    }
                  }}
                />
                <div className={styles.noteFiles}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf,.pdf"
                    multiple
                    hidden
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      event.target.value = "";
                      void attachFiles(files);
                    }}
                  />
                  {activeFiles.map((file) => (
                    <span key={file.id} className={styles.noteFile}>
                      {file.kind === "image" && activeDraft ? (
                        // eslint-disable-next-line @next/next/no-img-element -- the draft's own file, served by Robin.
                        <img src={fileUrl(activeDraft.id, file.id)} alt="" />
                      ) : <span className={styles.pdfMark} aria-hidden="true">PDF</span>}
                      <a href={activeDraft ? fileUrl(activeDraft.id, file.id) : undefined} target="_blank" rel="noopener noreferrer" title={file.name}>{file.name}</a>
                      {file.pages ? <small>{t("notes.files.pages", { count: file.pages })}</small> : null}
                      {!locked ? (
                        <button type="button" disabled={removingFiles.has(`${activeId}:${file.id}`)} aria-busy={removingFiles.has(`${activeId}:${file.id}`)} onClick={() => void detachFile(file)} aria-label={t("notes.files.remove", { name: file.name })} title={t("notes.files.remove", { name: file.name })}>×</button>
                      ) : null}
                    </span>
                  ))}
                  {!locked ? (
                    <button type="button" className="ui-action pi-chrome-label pi-bracket" disabled={uploading > 0 || !activeDraft} onClick={() => fileInputRef.current?.click()}>
                      {uploading > 0 ? t("notes.files.uploading") : t("notes.files.add")}
                    </button>
                  ) : null}
                  <span className={styles.noteFilesHint} data-notice={Boolean(filesNotice)} role={filesNotice ? "status" : undefined}>
                    {filesNotice ?? (activeFiles.length === 0 && !locked ? t("notes.files.hint") : "")}
                  </span>
                </div>
              </div>

              {finalPreview ? (
                <article ref={previewRef} className={styles.preview}><MarkdownBody className="pi-prose">{withFileLinks(finalPreview.content)}</MarkdownBody></article>
              ) : preview ? (
                <article ref={previewRef} className={styles.preview}>{activeDraft?.text.trim() ? <MarkdownBody className="pi-prose">{activeDraft.text}</MarkdownBody> : <p className={styles.empty}>{t("notes.editor.empty")}</p>}</article>
              ) : (
                <textarea ref={editorRef} className={styles.editor} value={activeDraft?.text ?? ""} disabled={!activeDraft || locked} onChange={(event) => updateActive({ text: event.target.value })} onKeyDown={onEditorKeyDown} onPaste={onEditorPaste} placeholder={t("notes.editor.placeholder")} aria-label={t("notes.editor.label")} spellCheck />
              )}

              {split ? errorNotice : null}
            </div>
            {!split ? errorNotice : null}

            {split ? (
              <>
                <aside className={styles.marginLeft}>
                  <NoteOutline
                    outline={outline}
                    active={activeHeading}
                    onJump={jumpTo}
                    title={t("notes.margin.outline")}
                    emptyHint={t("notes.margin.outlineEmpty")}
                    stats={activeDraft?.text.trim() && !finalPreview ? [
                      t("notes.margin.stats", { lines: activeDraft.text.split("\n").length, words: activeWords }),
                      ...(marginItems.length ? [t("notes.margin.counts", { questions: questionCount, todos: todoCount })] : []),
                    ] : []}
                  />
                </aside>
                <aside ref={marginRef} className={styles.marginRight} aria-label={t("notes.margin.notes")}>
                  <MarginNotes
                    items={marginItems}
                    geometry={geometry}
                    labels={{
                      question: t("notes.margin.question"),
                      todo: t("notes.margin.todo"),
                      ask: t("notes.margin.ask"),
                      addTodo: t("notes.margin.addTodo"),
                      added: t("notes.margin.added"),
                    }}
                    added={addedTodos}
                    disabled={locked || !model}
                    onAsk={askAboutItem}
                    onAddTodo={(item) => void addItemToTodos(item)}
                  />
                </aside>
              </>
            ) : (
              <details
                key={`${activeId}:${finalizing ? "working" : finalPreview ? "review" : "draft"}`}
                className={styles.filingDisclosure}
                open={finalizing || Boolean(finalPreview)}
              >
                <summary>
                  <span>{finalizing ? t("notes.final.working", { time: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}` }) : finalPreview ? t("notes.final.title") : t("notes.filing.options")}</span>
                  <small>{archiveTarget === "obsidian" ? "Obsidian" : "Notion"}</small>
                </summary>
                {filing}
              </details>
            )}
            </div>
          </main>

          <section id="notes-agent" className={styles.agentPane} hidden={!split && mobilePane !== "agent"} aria-label={t("notes.agent.title")}>{agent}</section>
        </div>}
      </div>
      </div>
    </div>
    </div>
  );
}
