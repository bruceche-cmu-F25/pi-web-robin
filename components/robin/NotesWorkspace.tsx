"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type KeyboardEvent } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { ModelSelector, type ModelSelectorOption } from "@/components/ModelSelector";
import { useI18n } from "@/hooks/useI18n";
import { useIsSplitLayout } from "@/hooks/useIsMobile";
import type { NoteAttachment } from "@/extension/robin/note-attachments";
import type { NoteFinal } from "@/extension/robin/notes-agent-state";
import type { NoteDraft } from "@/extension/robin/notes-domain";
import { compressImageFile } from "@/lib/image-compress";
import type { ModelsData } from "@/lib/models-cache";
import { AgentPanel } from "./AgentPanel";
import { MarginNotes, NoteOutline, useEditorGeometry } from "./NoteMargins";
import { currentHeading, noteMarginItems, noteOutline, type MarginItem, type OutlineEntry } from "./note-margin";
import { requestRefresh } from "./refreshBus";
import { continueMarkdownBlock, countWords, indentMarkdownList, type TextEdit } from "./markdown-editing";
import { buildNotionTree, filterNotionTree, type NotionTreeNode, type NotionTreePage } from "./notion-tree";
import styles from "./NotesWorkspace.module.css";

const LEGACY_DRAFT_KEY = "pi-robin-notes-draft-v1";
const MODEL_KEY = "pi-robin-notes-model-v1";
const ACTIVE_DRAFT_KEY = "pi-robin-notes-active-draft-v1";
const DEFAULT_MODEL_ID = "gpt-5.6-sol";
const SAVE_DELAY_MS = 400;
const FINAL_POLL_MS = 2_500;
/** Browsers refuse a keepalive request whose body is over 64 KiB; leave room for headers. */
const KEEPALIVE_MAX_BYTES = 60_000;
const DATED_TITLE = /^Notes \d{4}-\d{2}-\d{2}$/;
/**
 * Hues for the top-level sections of the Notion tree, from the calendar's
 * families. Neighbours in this order are far apart on the wheel, and sage and
 * rose are left out: beside fern and clay they read as the same colour.
 */
const BRANCH_TONES = ["iris", "teal", "clay", "slate", "honey", "plum", "fern"] as const;

type MobilePane = "notion" | "note" | "agent";
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type DraftPatch = Partial<Pick<NoteDraft, "title" | "text" | "notionParentId">>;
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
  const split = useIsSplitLayout();
  const [loaded, setLoaded] = useState(false);
  const [drafts, setDrafts] = useState<NoteDraft[]>([]);
  const [activeId, setActiveId] = useState("");
  const [preview, setPreview] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>("note");
  const [pages, setPages] = useState<NotionTreePage[]>([]);
  const [notionQuery, setNotionQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [notionError, setNotionError] = useState<string | null>(null);
  const [highlightedNotionId, setHighlightedNotionId] = useState("");
  const [models, setModels] = useState<ModelSelectorOption[]>([]);
  const [model, setModel] = useState<ModelRef | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  // A bar under the note until there is a conversation; then it takes half the column.
  const [agentCollapsed, setAgentCollapsed] = useState(true);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [includeConversation, setIncludeConversation] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  // "Prepare for Notion" runs on the server, so its state is read from there
  // per draft: leaving the page, or switching drafts, loses nothing.
  const [finals, setFinals] = useState<Record<string, NoteFinal>>({});
  const [clock, setClock] = useState(() => Date.now());
  // The files a note is written from; they go to Notion with it.
  const [noteFiles, setNoteFiles] = useState<Record<string, NoteAttachment[]>>({});
  const [uploading, setUploading] = useState(0);
  const [filesNotice, setFilesNotice] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [finalError, setFinalError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const saveTimers = useRef(new Map<string, number>());
  const pendingSaves = useRef(new Map<string, NoteDraft>());
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const finalsVersion = useRef(0);
  const startingFinal = useRef(false);
  const initialized = useRef(false);
  const draftsRef = useRef<NoteDraft[]>([]);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const marginRef = useRef<HTMLElement>(null);
  const [agentPending, setAgentPending] = useState<{ id: string; text: string } | undefined>();
  // To-dos already sent to Robin from this draft's margin, so their cards say so.
  const [addedTodos, setAddedTodos] = useState<ReadonlySet<string>>(new Set());

  const replaceDrafts = useCallback((value: NoteDraft[] | ((current: NoteDraft[]) => NoteDraft[])) => {
    const next = typeof value === "function" ? value(draftsRef.current) : value;
    draftsRef.current = next;
    setDrafts(next);
  }, []);

  const activeDraft = useMemo(() => drafts.find((draft) => draft.id === activeId) ?? null, [activeId, drafts]);
  const selectedPage = useMemo(() => pages.find((page) => page.id === activeDraft?.notionParentId), [activeDraft?.notionParentId, pages]);
  const activeFinal = activeId ? finals[activeId] : undefined;
  const finalizing = activeFinal?.status === "running";
  const finalPreview: FinalPreview | null = activeFinal?.status === "ready" && activeFinal.content
    ? { title: activeFinal.title || activeDraft?.title || "", content: activeFinal.content }
    : null;
  const finalFailure = activeFinal?.status === "error" ? activeFinal.error ?? null : null;
  const anyFinalRunning = Object.values(finals).some((final) => final.status === "running");
  const activeFiles = activeId ? noteFiles[activeId] ?? [] : [];
  // `busy` blocks everything; `locked` only freezes the draft that is being
  // prepared or reviewed, so another draft can be opened in the meantime.
  const busy = archiving || creatingDraft;
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
      setActiveId(body.draft.id);
      window.localStorage.setItem(ACTIVE_DRAFT_KEY, body.draft.id);
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
        const remembered = window.localStorage.getItem(ACTIVE_DRAFT_KEY);
        const nextId = items.some((draft) => draft.id === remembered) ? remembered! : items[0].id;
        setActiveId(nextId);
        window.localStorage.setItem(ACTIVE_DRAFT_KEY, nextId);
      } catch (caught) {
        setFinalError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setLoaded(true);
      }
    })();
  }, [createDraft, replaceDrafts]);

  /**
   * Write a draft's pending edits. Writes run one after another so a slow
   * older PATCH can never land after a newer one and roll the note back.
   */
  const writeDraft = useCallback((id: string, keepalive = false): Promise<void> => {
    const timer = saveTimers.current.get(id);
    if (timer) window.clearTimeout(timer);
    saveTimers.current.delete(id);
    const draft = pendingSaves.current.get(id);
    if (!draft) return saveQueue.current;
    pendingSaves.current.delete(id);
    const body = JSON.stringify({ id, title: draft.title, text: draft.text, notionParentId: draft.notionParentId });
    setSaveState("saving");
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        const response = await fetch("/api/robin/notes", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: keepalive && new TextEncoder().encode(body).length <= KEEPALIVE_MAX_BYTES,
        });
        if (!response.ok) {
          const result = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(result?.error ?? `Could not save draft (${response.status})`);
        }
        if (pendingSaves.current.size === 0) setSaveState("saved");
      } catch (caught) {
        // Keep the edit queued so the next keystroke or flush retries it.
        if (!pendingSaves.current.has(id)) pendingSaves.current.set(id, draft);
        setSaveState("error");
        setFinalError(caught instanceof Error ? caught.message : String(caught));
      }
    });
    return saveQueue.current;
  }, []);

  const flushSaves = useCallback((keepalive = false): Promise<void> => {
    for (const id of [...pendingSaves.current.keys()]) void writeDraft(id, keepalive);
    return saveQueue.current;
  }, [writeDraft]);

  /** Drop unsent edits for a draft that is about to stop existing, then wait out any write in flight. */
  const discardPending = useCallback((id: string): Promise<void> => {
    const timer = saveTimers.current.get(id);
    if (timer) window.clearTimeout(timer);
    saveTimers.current.delete(id);
    pendingSaves.current.delete(id);
    return saveQueue.current;
  }, []);

  // Closing the tab, backgrounding it on a phone, or leaving for another
  // workspace must not drop the last few keystrokes.
  useEffect(() => {
    const flush = () => { void flushSaves(true); };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [flushSaves]);

  const patchDraft = useCallback((id: string, patch: DraftPatch) => {
    const currentDraft = draftsRef.current.find((draft) => draft.id === id);
    if (!currentDraft) return;
    const updated = { ...currentDraft, ...patch, updatedAt: new Date().toISOString() };
    replaceDrafts((current) => current.map((draft) => draft.id === id ? updated : draft));
    pendingSaves.current.set(id, updated);
    setSaveState("dirty");
    const previous = saveTimers.current.get(id);
    if (previous) window.clearTimeout(previous);
    saveTimers.current.set(id, window.setTimeout(() => { void writeDraft(id); }, SAVE_DELAY_MS));
  }, [replaceDrafts, writeDraft]);

  const updateActive = useCallback((patch: DraftPatch) => {
    if (!activeId || locked) return;
    patchDraft(activeId, patch);
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

  useEffect(() => { void loadModels(); void loadNotion(); }, [loadModels, loadNotion]);

  const fullTree = useMemo(() => buildNotionTree(pages), [pages]);
  const tree = useMemo(() => filterNotionTree(fullTree, notionQuery), [fullTree, notionQuery]);
  // Toned from the unfiltered tree, so a search never repaints a section.
  const branchTones = useMemo(() => new Map(
    fullTree.filter((node) => node.children.length > 0)
      .map((node, index) => [node.id, BRANCH_TONES[index % BRANCH_TONES.length]]),
  ), [fullTree]);

  const selectDraft = (id: string) => {
    setActiveId(id);
    setPreview(false);
    setFinalError(null);
    window.localStorage.setItem(ACTIVE_DRAFT_KEY, id);
  };

  const switchDraft = (id: string) => {
    if (!busy) selectDraft(id);
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
    const current = draftsRef.current;
    const blank = current.find((draft) => draft.id === activeId && !draft.text.trim())
      ?? current.find((draft) => !draft.text.trim());
    if (blank) {
      const patch: DraftPatch = {};
      if (DATED_TITLE.test(blank.title) && blank.title !== defaultTitle()) patch.title = defaultTitle();
      if (!blank.notionParentId && notionParentId) patch.notionParentId = notionParentId;
      if (Object.keys(patch).length) patchDraft(blank.id, patch);
      selectDraft(blank.id);
    } else {
      await createDraft({ notionParentId });
    }
    setMobilePane("note");
    focusEditor();
  };

  const startNewDraft = async () => {
    try { await openBlankDraft(activeDraft?.notionParentId ?? ""); }
    catch (caught) { setFinalError(caught instanceof Error ? caught.message : String(caught)); }
  };

  const addToNote = (addition: string) => {
    const current = draftsRef.current.find((draft) => draft.id === activeId);
    if (!current || locked || !addition.trim()) return;
    const base = current.text.trimEnd();
    updateActive({ text: base ? `${base}\n\n${addition.trim()}\n` : `${addition.trim()}\n` });
    setPreview(false);
    setMobilePane("note");
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
    await discardPending(draft.id);
    const response = await fetch("/api/robin/notes", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: draft.id }) });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      setFinalError(body?.error ?? `Request failed (${response.status})`);
      return;
    }
    window.localStorage.removeItem(`pi-robin-agent-transcript:notes:${draft.id}`);
    const remaining = draftsRef.current.filter((item) => item.id !== draft.id);
    replaceDrafts(remaining);
    if (activeId === draft.id) {
      if (remaining[0]) switchDraft(remaining[0].id);
      else await startNewDraft();
    }
  };

  /** Local changes win over a poll that was already in flight when they happened. */
  const loadFinals = useCallback(async () => {
    const version = finalsVersion.current;
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

  useEffect(() => { void loadFinals(); }, [loadFinals]);

  useEffect(() => {
    if (!activeId) return;
    setFilesNotice(null);
    void (async () => {
      try {
        const response = await fetch(`/api/robin/notes/attachments?draftId=${encodeURIComponent(activeId)}`);
        const body = await response.json().catch(() => null) as { attachments?: NoteAttachment[] } | null;
        if (response.ok && body?.attachments) setNoteFiles((current) => ({ ...current, [activeId]: body.attachments! }));
      } catch { /* The row simply shows no files. */ }
    })();
  }, [activeId]);

  const fileUrl = (draftId: string, id: string) =>
    `/api/robin/notes/attachments?draftId=${encodeURIComponent(draftId)}&id=${encodeURIComponent(id)}`;

  /** Upload one at a time, so the server's per-note limit is met in order. */
  const attachFiles = async (files: File[]) => {
    if (!activeDraft || locked) return;
    const draftId = activeDraft.id;
    const accepted = files.filter((file) => (file.type.startsWith("image/") && file.type !== "image/svg+xml") || file.type === "application/pdf" || /\.pdf$/i.test(file.name));
    if (accepted.length === 0) return;
    setFilesNotice(null);
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
        setNoteFiles((current) => ({ ...current, [draftId]: [...(current[draftId] ?? []), body.attachment!] }));
        if (body.attachment.truncated) setFilesNotice(t("notes.files.truncated", { name: body.attachment.name }));
      } catch (caught) {
        setFilesNotice(`${file.name}: ${caught instanceof Error ? caught.message : String(caught)}`);
      } finally {
        setUploading((count) => count - 1);
      }
    }
  };

  const detachFile = async (file: NoteAttachment) => {
    if (!activeDraft || locked) return;
    const draftId = activeDraft.id;
    setNoteFiles((current) => ({ ...current, [draftId]: (current[draftId] ?? []).filter((item) => item.id !== file.id) }));
    const response = await fetch("/api/robin/notes/attachments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId, id: file.id }),
    }).catch(() => null);
    if (!response?.ok) setFilesNotice(t("notes.files.removeFailed", { name: file.name }));
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
    const poll = window.setInterval(() => { void loadFinals(); }, FINAL_POLL_MS);
    const tick = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [anyFinalRunning, loadFinals]);

  const startFinalization = async () => {
    if (!activeDraft || (!activeDraft.text.trim() && activeFiles.length === 0) || !selectedPage || !model || locked || startingFinal.current) return;
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
          notionParentTitle: selectedPage.title,
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
    setFinal(draftId, null);
    setPreview(false);
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
    if (!activeDraft || !selectedPage || !finalPreview || archiving) return;
    setArchiving(true);
    setFinalError(null);
    try {
      // Land the last edits first: if the archive fails, the server copy is current.
      await writeDraft(activeDraft.id);
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
      void discardPending(activeDraft.id);
      window.localStorage.removeItem(`pi-robin-agent-transcript:notes:${activeDraft.id}`);
      replaceDrafts((current) => current.filter((draft) => draft.id !== activeDraft.id));
      setPages((current) => [body.page!, ...current.filter((page) => page.id !== body.page!.id)]);
      setHighlightedNotionId(body.page.id);
      setFinal(activeDraft.id, null);
      setIncludeConversation(false);
      setPreview(false);
      await openBlankDraft(selectedPage.id);
    } catch (caught) {
      setFinalError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setArchiving(false);
    }
  };

  const modelFooter = (
    <div className={styles.modelFooter}>
      <span className="pi-eyebrow">{t("notes.model")}</span>
      <ModelSelector
        options={models}
        value={model}
        onChange={(provider, modelId) => {
          const next = { provider, modelId };
          setModel(next);
          window.localStorage.setItem(MODEL_KEY, JSON.stringify(next));
        }}
        disabled={models.length === 0 || locked}
        emptyLabel={t("notes.model.loading")}
        ariaLabel={t("notes.model")}
        variant="field"
        placement="up"
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
  const geometry = useEditorGeometry(editorRef, marginRef, activeDraft?.text ?? "", split && writing && Boolean(activeDraft));
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
  const saveLabel = saveState === "saving" ? t("notes.save.saving")
    : saveState === "saved" ? t("notes.save.saved")
      : saveState === "dirty" ? t("notes.save.unsaved")
        : saveState === "error" ? t("notes.save.error")
          : "";

  // Where this note is filed, and the button that files it: in the masthead
  // beside the page title on a desktop, under the sheet on a phone.
  const filing = (
    <section className={styles.filing} data-place={split ? "header" : "sheet"} aria-label={t("notes.notion.destination")}>
      <p data-empty={!selectedPage}><span className="pi-eyebrow">{t("notes.notion.destination")}</span><strong>{selectedPage?.title ?? t("notes.notion.chooseLeft")}</strong></p>
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
          <button type="button" data-primary="true" disabled={archiving} onClick={() => void archiveFinal()}>{archiving ? t("notes.archive.working") : t("notes.final.confirm")}</button>
        </div>
      ) : (
        <div className={styles.prepareActions}>
          <label><input type="checkbox" checked={includeConversation} onChange={(event) => setIncludeConversation(event.target.checked)} />{t("notes.final.includeConversation")}</label>
          <button type="button" data-primary="true" onClick={() => void startFinalization()} disabled={(!activeDraft?.text.trim() && activeFiles.length === 0) || !selectedPage || !model || uploading > 0}>{t("notes.final.prepare")}</button>
        </div>
      )}
    </section>
  );

  const agent = activeDraft ? (
    <AgentPanel
      mode="notes"
      endpoint="/api/robin/notes-agent"
      requestBody={{
        draftId: activeDraft.id,
        title: activeDraft.title,
        note: activeDraft.text,
        notionParentTitle: selectedPage?.title ?? "",
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
      // A phone gives the agent its own tab, so it never folds there.
      collapsed={split && agentCollapsed}
      onCollapsedChange={split ? setAgentCollapsed : undefined}
      onConversationChange={(hasTurns) => setAgentCollapsed(!hasTurns)}
    />
  ) : null;

  return (
    <div className={`robin-page robin-dashboard ${styles.page}`}>
      <header className={styles.header}>
        <div><span className="pi-eyebrow">Markdown · Notion</span><h1>{t("notes.title")}</h1></div>
        <p>{t("notes.subtitle")}</p>
        {split ? filing : null}
        {!split ? (
          <div className={styles.mobileTabs} role="tablist" aria-label={t("notes.views")}>
            {(["notion", "note", "agent"] as const).map((pane) => (
              <button key={pane} type="button" role="tab" aria-selected={mobilePane === pane} onClick={() => setMobilePane(pane)}>
                {t(pane === "notion" ? "notes.notion.short" : pane === "note" ? "notes.note" : "notes.agent.short")}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <div className={`${styles.workspace}${split && libraryCollapsed ? ` ${styles.libraryIsCollapsed}` : ""}`}>
        <aside className={styles.notionPane} hidden={!split && mobilePane !== "notion"} aria-label={t("notes.notion.library")}>
          {split && libraryCollapsed ? (
            <button type="button" className={styles.libraryExpand} onClick={() => setLibraryCollapsed(false)} aria-label={t("notes.notion.expand")} title={t("notes.notion.expand")}>›</button>
          ) : <>
          <section className={styles.drafts}>
            <header><h2 className="pi-eyebrow">{t("notes.drafts.title")}{loaded ? <span className={styles.count}>{drafts.length}</span> : null}</h2><button type="button" disabled={!loaded || busy} onClick={() => void startNewDraft()} aria-label={t("notes.new")} title={t("notes.new")}>＋</button></header>
            {!loaded ? <p>{t("robin.common.loading")}</p> : (
              <ul>{drafts.map((draft) => {
                const words = countWords(draft.text);
                const final = finals[draft.id]?.status;
                return (
                  <li key={draft.id} data-active={draft.id === activeId}>
                    <button type="button" disabled={busy} onClick={() => switchDraft(draft.id)} aria-current={draft.id === activeId ? "true" : undefined}>
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

          <div className={styles.notionHead}>
            <h2 className="pi-eyebrow">{t("notes.notion.library")}</h2>
            <div className={styles.notionHeadActions}>
              <button type="button" onClick={() => void loadNotion()} disabled={searching || locked} aria-label={t("notes.notion.refresh")} title={t("notes.notion.refresh")}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M18.5 9a7 7 0 0 0-12-2L4 9M5.5 15a7 7 0 0 0 12 2l2.5-2" /></svg>
              </button>
              {split ? <button type="button" onClick={() => setLibraryCollapsed(true)} aria-label={t("notes.notion.collapse")} title={t("notes.notion.collapse")}>‹</button> : null}
            </div>
          </div>
          <div className={styles.notionSearch}><input value={notionQuery} onChange={(event) => setNotionQuery(event.target.value)} placeholder={t("notes.notion.search")} aria-label={t("notes.notion.search")} /></div>
          <nav className={styles.tree} aria-label={t("notes.notion.tree")} aria-busy={searching}>
            {searching && pages.length === 0 ? <p>{t("robin.common.loading")}</p> : null}
            {!searching && tree.length === 0 ? <p>{notionError ?? t("notes.notion.empty")}</p> : null}
            <ul>{tree.map((node) => (
              <NotionTreeItem key={node.id} node={node} tone={branchTones.get(node.id)} selectedId={activeDraft?.notionParentId ?? ""} highlightedId={highlightedNotionId} onSelect={(page) => { updateActive({ notionParentId: page.id }); setHighlightedNotionId(""); }} openLabel={t("notes.notion.open")} destinationLabel={t("notes.notion.destinationTag")} locked={locked} searchActive={Boolean(notionQuery.trim())} />
            ))}</ul>
          </nav>
          {notionError ? <p className={styles.error} role="alert">{notionError}</p> : null}
          </>}
        </aside>

        <div className={`${styles.rightColumn}${split && agentCollapsed ? ` ${styles.agentIsCollapsed}` : ""}`} hidden={!split && mobilePane === "notion"}>
          <main className={styles.notePane} hidden={!split && mobilePane !== "note"}>
            <div className={styles.desk}>
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

            <div className={styles.sheet} data-dropping={dropping} {...sheetDrop}>
              <div className={styles.sheetHead}>
                <div className={styles.titleMeta}>
                  <span className="pi-eyebrow">{finalPreview ? t("notes.final.title") : activeWords ? t("notes.drafts.words", { count: activeWords }) : t("notes.drafts.empty")}</span>
                  {!finalPreview && saveLabel ? <span className={styles.saveState} data-state={saveState} role="status">{saveLabel}</span> : null}
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
                        <button type="button" onClick={() => void detachFile(file)} aria-label={t("notes.files.remove", { name: file.name })} title={t("notes.files.remove", { name: file.name })}>×</button>
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

              {finalError ?? finalFailure ? <p className={styles.error} role="alert">{finalError ?? finalFailure}</p> : null}
            </div>

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
            ) : filing}
            </div>
          </main>

          <section className={styles.agentPane} hidden={!split && mobilePane !== "agent"} aria-label={t("notes.agent.title")}>{agent}</section>
        </div>
      </div>
    </div>
  );
}
