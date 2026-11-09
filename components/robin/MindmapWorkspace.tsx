"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import { writeUrlState } from "@/lib/url-state";
import { applyMindmapOperations, findMindNode, flattenMindTree, mindmapMarkdown, mindmapSelectionRoots, validateMindTree, type MindNode, type MindmapDocument, type MindmapOperation, type MindmapProposal, type MindmapSummary } from "@/extension/robin/mindmap";
import { NoteMindmap } from "./NoteMindmap";
import { MindmapIcon } from "./MindmapIcon";
import { MindmapReply } from "./MindmapReply";
import { MindmapExplanations } from "./MindmapExplanations";
import { MINDMAP_API as ROOT, MapRequestError, mindmapRequest as request, downloadMindmapMarkdown as download } from "./mindmap-client";
import { noteMindmap } from "./note-mindmap";
import styles from "./NoteMindmap.module.css";

function changes(before: MindNode, after: MindNode): Set<string> {
  const positions = (root: MindNode) => {
    const result = new Map<string, string>();
    const visit = (node: MindNode, parent: string, index: number) => { result.set(node.id, JSON.stringify([node.label, node.url ?? null, parent, index])); node.children.forEach((child, n) => visit(child, node.id, n)); };
    visit(root, "", 0); return result;
  };
  const previous = positions(before);
  return new Set([...positions(after)].filter(([id, value]) => previous.get(id) !== value).map(([id]) => id));
}

/** Independent documents. Hiding this workspace retains both editing and chat drafts. */
export function MindmapWorkspace({ active, model, footer, sourceNote }: {
  active: boolean; model: { provider: string; modelId: string } | null; footer: ReactNode;
  sourceNote: { title: string; text: string } | null;
}) {
  const { t } = useI18n();
  const search = useSearchParams();
  const [maps, setMaps] = useState<MindmapSummary[]>([]);
  const [doc, setDoc] = useState<MindmapDocument | null>(null);
  const docRef = useRef<MindmapDocument | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const focusRoot = useMemo(() => doc ? (focusId && findMindNode(doc.root, focusId)) || doc.root : null, [doc, focusId]);
  const viewSelection = useMemo(() => focusRoot ? selectedIds.filter((id) => findMindNode(focusRoot, id)) : [], [focusRoot, selectedIds]);
  const focusBranch = (id: string | null, selection: string[]) => { setFocusId(id); setSelectedIds(selection); };
  const [changedIds, setChangedIds] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [generating, setGenerating] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const [instruction, setInstruction] = useState("");
  const instructionRef = useRef("");
  const [mode, setMode] = useState<"edit" | "discuss">("edit");
  const [chatOpen, setChatOpen] = useState(true);
  const [reader, setReader] = useState<{ nodeId: string; generate: boolean } | null>(null);
  const readerTrigger = useRef<HTMLElement | null>(null);
  const readerToggle = useRef<HTMLButtonElement>(null);
  const explainedIds = useMemo(() => new Set(doc?.explanations.map((item) => item.nodeId) ?? []), [doc?.explanations]);
  const openReader = (nodeId: string, generate = false) => { readerTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setReader({ nodeId, generate }); };
  const closeReader = () => { setReader(null); requestAnimationFrame(() => (readerTrigger.current?.isConnected ? readerTrigger.current : readerToggle.current)?.focus({ preventScroll: true })); };
  useEffect(() => { if (!active) setReader(null); }, [active]);
  const chatToggle = useRef<HTMLButtonElement>(null);
  const buddy = useRef<HTMLElement>(null);
  const [pendingMessage, setPendingMessage] = useState<{ text: string; scope: string; mode: "edit" | "discuss" } | null>(null);
  const [seenReply, setSeenReply] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const createInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [unapplied, setUnapplied] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const onDirty = useCallback((value: boolean) => { dirtyRef.current = value; setDirty(value); }, []);
  const alive = useRef(true), loadVersion = useRef(0), initialized = useRef(false);
  const requestedId = useRef<string | null>(null);
  const retryWrite = useRef<{ method: string; data: Record<string, unknown>; clearDraft: boolean } | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [arrangeRevision, setArrangeRevision] = useState(0);
  const layoutVersion = useRef(0);
  const onLayoutChange = useCallback(() => { layoutVersion.current++; }, []);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => { const ids = new Set(viewSelection); return focusRoot ? flattenMindTree(focusRoot).filter((node) => ids.has(node.id)) : []; }, [focusRoot, viewSelection]);
  const scopeRoots = useMemo(() => focusRoot ? viewSelection.length ? mindmapSelectionRoots(focusRoot, viewSelection) : [focusRoot] : [], [focusRoot, viewSelection]);
  const scopeTitle = !scopeRoots.length ? t("mindmap.untitledNode") : scopeRoots.length === 1 ? scopeRoots[0].label : t("mindmap.branchScope", { count: scopeRoots.length });
  const scopeCount = useMemo(() => scopeRoots.reduce((count, node) => count + flattenMindTree(node).length, 0), [scopeRoots]);
  const latestReply = doc?.messages.filter((message) => message.role === "assistant").at(-1);
  const replyKey = latestReply ? `${doc?.id}:${latestReply.revision}` : "";
  useEffect(() => { if (active && chatOpen) setSeenReply(replyKey); }, [active, chatOpen, replyKey]);
  const focusBuddy = () => requestAnimationFrame(() => buddy.current?.focus({ preventScroll: true }));
  const closeBuddy = () => { setChatOpen(false); chatToggle.current?.focus({ preventScroll: true }); };
  const chooseOnCanvas = () => {
    setChatOpen(false);
    requestAnimationFrame(() => {
      const editor = buddy.current?.parentElement?.querySelector<HTMLTextAreaElement>('[data-editing="true"] textarea');
      (editor ?? document.getElementById("mindmap-node-locator"))?.focus({ preventScroll: true });
    });
  };

  const setDraft = (text: string, id = docRef.current?.id) => {
    instructionRef.current = text; setInstruction(text);
    if (!id) return;
    try { if (text) localStorage.setItem(`pi-mindmap-chat:${id}`, text); else localStorage.removeItem(`pi-mindmap-chat:${id}`); setStorageWarning(false); }
    catch { setStorageWarning(true); }
  };
  const accept = useCallback((next: MindmapDocument) => {
    const before = docRef.current;
    setChangedIds(before?.id === next.id ? changes(before.root, next.root) : new Set());
    docRef.current = next; requestedId.current = next.id; setDoc(next);
    setFocusId((id) => before?.id === next.id && id && findMindNode(next.root, id) ? id : null);
    setMaps((items) => [{ id: next.id, title: next.root.label, updatedAt: next.updatedAt }, ...items.filter((item) => item.id !== next.id)]);
    setSelectedIds((ids) => before?.id === next.id ? ids.filter((id) => flattenMindTree(next.root).some((node) => node.id === id)) : [next.root.id]);
    if (before?.id !== next.id) {
      let text = ""; try { text = localStorage.getItem(`pi-mindmap-chat:${next.id}`) ?? ""; } catch { /* Input still works without storage. */ }
      instructionRef.current = text; setInstruction(text); onDirty(false); setReader(null); setEditorEpoch((n) => n + 1);
    }
  }, [onDirty]);
  const mayLeave = useCallback(() => {
    if (savingRef.current) return false;
    if ((dirtyRef.current || controller.current || retryWrite.current) && !window.confirm(t("mindmap.leaveConfirm"))) return false;
    controller.current?.abort(); controller.current = null; setGenerating(false); setPendingMessage(null);
    if (dirtyRef.current) setEditorEpoch((n) => n + 1);
    onDirty(false); retryWrite.current = null; setRetryable(false); return true;
  }, [onDirty, t]);
  const open = useCallback(async (id: string, updateUrl = true, force = false) => {
    if (!force && id === docRef.current?.id) return;
    if (!mayLeave()) { writeUrlState({ mindmap: docRef.current?.id ?? null }, "replace"); return; }
    requestedId.current = id;
    const version = ++loadVersion.current; setLoading(true); setError(""); setUnapplied(""); setNotice(""); setConflict(false);
    try {
      const result = await request<{ map: MindmapDocument }>(`${ROOT}?id=${encodeURIComponent(id)}`);
      if (!alive.current || version !== loadVersion.current) return;
      accept(result.map); setEditorEpoch((n) => n + 1);
      if (updateUrl) writeUrlState({ view: "mindmap", mindmap: id });
    } catch (caught) { if (alive.current && version === loadVersion.current) setError(String(caught instanceof Error ? caught.message : caught)); }
    finally { if (alive.current && version === loadVersion.current) setLoading(false); }
  }, [accept, mayLeave]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void (async () => {
      try {
        const result = await request<{ maps: MindmapSummary[] }>(ROOT);
        if (!alive.current) return;
        setMaps(result.maps);
        const id = search.get("mindmap") || result.maps[0]?.id;
        if (id) await open(id, false);
      } catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : String(caught)); }
      finally { if (alive.current) setLoading(false); }
    })();
  }, [open, search]);
  useEffect(() => {
    const id = search.get("mindmap");
    if (active && !loading && id && id !== docRef.current?.id && id !== requestedId.current) void open(id, false);
  }, [active, loading, open, search]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => { if (dirtyRef.current || savingRef.current || retryWrite.current) { e.preventDefault(); e.returnValue = ""; } };
    const leave = (e: MouseEvent) => {
      if ((!dirtyRef.current && !savingRef.current && !retryWrite.current) || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element).closest?.("a[href]");
      if (!link || link.getAttribute("target") === "_blank" || link.hasAttribute("download")) return;
      if (!window.confirm(t("mindmap.leaveConfirm"))) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", leave, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", leave, true); };
  }, [t]);
  useEffect(() => { if (active && chatOpen) messagesEnd.current?.scrollIntoView({ block: "nearest" }); }, [replyKey, pendingMessage, active, chatOpen]);

  const write = async (method: string, data: Record<string, unknown>, clearDraft = false): Promise<boolean> => {
    if (savingRef.current) return false;
    savingRef.current = true; setSaving(true); setError(""); setConflict(false); setNotice("");
    retryWrite.current = { method, data, clearDraft }; setRetryable(false);
    try {
      const result = await request<{ map: MindmapDocument }>(ROOT, method, data);
      if (!alive.current) return false;
      accept(result.map);
      if ((data.operations as MindmapOperation[] | undefined)?.some((op) => op.kind === "arrange")) setArrangeRevision((n) => n + 1);
      retryWrite.current = null; setRetryable(false); setNotice(t("mindmap.saved")); onDirty(false);
      return true;
    } catch (caught) {
      if (alive.current) {
        setError(caught instanceof Error ? caught.message : String(caught));
        const stale = caught instanceof MapRequestError && caught.status === 409;
        setConflict(stale); setRetryable(!stale);
        if (stale) retryWrite.current = null;
      }
      return false;
    } finally { savingRef.current = false; if (alive.current) setSaving(false); }
  };
  const edit = async (operations: MindmapOperation[]) => {
    const current = docRef.current;
    if (!current || conflict || retryWrite.current || savingRef.current) return false;
    try { applyMindmapOperations(current.root, operations); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); return false; }
    return write("PATCH", { id: current.id, revision: current.revision, requestId: crypto.randomUUID(), action: "edit", operations });
  };
  const create = async (fromNote = false) => {
    if (!mayLeave()) return;
    try {
      let root: MindNode;
      if (fromNote && sourceNote) {
        const parsed = noteMindmap(sourceNote.title, sourceNote.text);
        if (parsed.truncated) throw new Error(t("mindmap.importLimit"));
        if (!parsed.root.children.length) throw new Error(t("mindmap.importEmpty"));
        root = validateMindTree(parsed.root);
      } else {
        if (!newTitle.trim()) { setCreating(true); requestAnimationFrame(() => createInput.current?.focus()); return; }
        root = validateMindTree({ id: "root", label: newTitle.trim(), children: [] });
      }
      const id = crypto.randomUUID();
      if (await write("POST", { id, root })) { setCreating(false); setNewTitle(""); writeUrlState({ view: "mindmap", mindmap: id }); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  const history = (action: "undo" | "redo") => {
    const current = docRef.current;
    if (!current || dirtyRef.current || retryWrite.current || savingRef.current || conflict || (action === "undo" ? !current.canUndo : !current.canRedo)) return;
    void write("PATCH", { id: current.id, revision: current.revision, requestId: crypto.randomUUID(), action });
  };
  const send = async () => {
    const current = docRef.current, message = instructionRef.current.trim();
    if (!current || !model || !message || controller.current || savingRef.current || dirtyRef.current || retryWrite.current || conflict) return;
    const initialLayoutVersion = layoutVersion.current;
    setPendingMessage({ text: message, scope: scopeTitle, mode });
    const abort = new AbortController(); controller.current = abort; setGenerating(true); setError(""); setUnapplied(""); setNotice("");
    try {
      const result = await request<{ proposal: MindmapProposal; revision: number }>(`${ROOT}/agent`, "POST", {
        id: current.id, revision: current.revision, message, mode, selectedIds: scopeRoots.map((node) => node.id), ...model,
      }, abort.signal);
      if (!alive.current || controller.current !== abort || abort.signal.aborted || docRef.current?.id !== current.id) return;
      if (docRef.current.revision !== current.revision || dirtyRef.current || savingRef.current || retryWrite.current || (result.proposal.operations.some((op) => op.kind === "arrange") && layoutVersion.current !== initialLayoutVersion)) {
        setUnapplied(result.proposal.reply); setError(t("mindmap.staleProposal")); return;
      }
      const ok = await write("PATCH", { id: current.id, revision: result.revision, requestId: crypto.randomUUID(), action: "edit", operations: result.proposal.operations, conversation: { user: message, reply: result.proposal.reply } }, true);
      if (!ok) setUnapplied(result.proposal.reply);
      else if (instructionRef.current === message) setDraft("");
    } catch (caught) {
      if (alive.current && controller.current === abort && !abort.signal.aborted) {
        setError(caught instanceof Error ? caught.message : String(caught));
        if (caught instanceof MapRequestError && caught.status === 409) setConflict(true);
      }
    } finally { if (controller.current === abort) { controller.current = null; if (alive.current) { setGenerating(false); setPendingMessage(null); } } }
  };
  const preparePrompt = (text: string, nextMode: "edit" | "discuss") => {
    if (instructionRef.current.trim()) return;
    setMode(nextMode); setDraft(text);
    document.getElementById("mindmap-instruction")?.focus({ preventScroll: true });
  };
  const remove = async () => {
    const current = docRef.current;
    if (!current || !mayLeave() || !window.confirm(t("mindmap.deleteConfirm", { title: current.root.label }))) return;
    savingRef.current = true; setSaving(true); setError("");
    try {
      await request(ROOT, "DELETE", { id: current.id, revision: current.revision });
      setMaps((items) => items.filter((item) => item.id !== current.id)); docRef.current = null; setDoc(null); setSelectedIds([]); setDraft("", current.id);
      writeUrlState({ mindmap: null });
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const blocked = saving || loading || conflict || retryable;
  return <div className={styles.workspace} hidden={!active}>
    <header className={styles.header}>
      <h1 className={styles.srOnly}>{t("notes.mindmap")}</h1>
      <span className={styles.mapMark}><MindmapIcon name="map" /></span>
      <select aria-label={t("mindmap.library")} value={doc?.id ?? ""} disabled={saving || loading} onChange={(e) => { if (e.target.value) void open(e.target.value); }}>
        <option value="">{t("mindmap.choose")}</option>{maps.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
      <div className={styles.actions}>
        <button type="button" disabled={saving || loading} onClick={() => { setCreating(!creating); requestAnimationFrame(() => createInput.current?.focus()); }}><MindmapIcon name="plus" /><span>{t("mindmap.new")}</span></button>
        <button ref={readerToggle} type="button" disabled={!doc || loading} aria-label={t("mindmap.explanations")} aria-haspopup="dialog" onClick={() => { if (doc) openReader(scopeRoots.length === 1 && explainedIds.has(scopeRoots[0].id) ? scopeRoots[0].id : doc.explanations[0]?.nodeId ?? scopeRoots[0]?.id ?? doc.root.id); }}><MindmapIcon name="document" /><span>{t("mindmap.explanations")}{doc?.explanations.length ? ` · ${doc.explanations.length}` : ""}</span></button>
        <span className={styles.separator} />
        <button type="button" aria-label={t("mindmap.undo")} title={`${t("mindmap.undo")} · ⌘/Ctrl Z`} disabled={!doc || blocked || dirty || !doc.canUndo} onClick={() => history("undo")}><MindmapIcon name="undo" /></button>
        <button type="button" aria-label={t("mindmap.redo")} title={`${t("mindmap.redo")} · ⌘/Ctrl ⇧ Z`} disabled={!doc || blocked || dirty || !doc.canRedo} onClick={() => history("redo")}><MindmapIcon name="redo" /></button>
        <details className={styles.documentMenu} onKeyDown={(e) => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}><summary aria-label={t("mindmap.more")}>···</summary><div>
          <button type="button" disabled={saving || loading || !sourceNote} title={t("mindmap.importHint")} onClick={() => void create(true)}>{t("mindmap.importNote")}</button>
          <button type="button" disabled={!doc} onClick={() => { if (doc) download(`${doc.root.label.replace(/[^\p{L}\p{N}_-]/gu, "_").slice(0, 80)}.md`, mindmapMarkdown(doc.root)); }}>{t("mindmap.export")}</button>
          <button type="button" className={styles.danger} disabled={!doc || saving || loading} onClick={() => void remove()}>{t("mindmap.delete")}</button>
        </div></details>
      </div>
      <button ref={chatToggle} className={styles.buddyToggle} type="button" aria-label={t("mindmap.chat")} aria-expanded={chatOpen} aria-controls="mindmap-buddy" data-working={generating} onClick={() => { if (chatOpen) closeBuddy(); else { setChatOpen(true); focusBuddy(); } }}><MindmapIcon name="chat" /><span>Agent Buddy</span>{generating ? <small>{t("mindmap.thinking")}</small> : !chatOpen && replyKey && replyKey !== seenReply ? <small>{t("mindmap.replyReady")}</small> : <MindmapIcon name={chatOpen ? "collapse" : "expand"} />}</button>
    </header>
    {creating && <form className={styles.createForm} onSubmit={(e) => { e.preventDefault(); void create(); }}>
      <label htmlFor="mindmap-new-title">{t("mindmap.newTitle")}</label><input ref={createInput} id="mindmap-new-title" value={newTitle} maxLength={500} disabled={saving} placeholder={t("mindmap.untitled")} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { setCreating(false); setNewTitle(""); } }} />
      <button type="submit" disabled={saving || !newTitle.trim()}>{t("mindmap.create")}</button><button type="button" disabled={saving} aria-label={t("mindmap.cancelEdit")} onClick={() => setCreating(false)}><MindmapIcon name="close" /></button>
    </form>}
    <div className={styles.feedback}>
      {loading ? <p role="status">{t("robin.common.loading")}</p> : saving ? <p role="status">{t("notes.save.saving")}</p> : dirty ? <p role="status">{t("mindmap.unsaved")}</p> : notice ? <p role="status">{notice}</p> : <p title={t("mindmap.independent")}>{t(dirty ? "mindmap.unsaved" : "mindmap.ready")}</p>}
      {error && <div role="alert">{error} {retryable && <button type="button" disabled={saving} onClick={() => { const pending = retryWrite.current; if (pending) void write(pending.method, pending.data, pending.clearDraft).then((ok) => { if (ok) { setUnapplied(""); const conversation = pending.data.conversation as { user: string } | undefined; if (pending.clearDraft && conversation?.user === instructionRef.current) setDraft(""); if (pending.method === "POST") writeUrlState({ view: "mindmap", mindmap: String(pending.data.id) }); } }); }}>{t("canvas.retry")}</button>} {doc && !saving && <button type="button" onClick={() => void open(doc.id, false, true)}>{t("mindmap.reload")}</button>}{!doc && !retryable && <button type="button" onClick={() => window.location.reload()}>{t("canvas.retry")}</button>}</div>}
      {storageWarning && <p role="alert">{t("mindmap.storageWarning")}</p>}
    </div>
    {!doc ? <div className={styles.empty}><h2>{t("mindmap.emptyTitle")}</h2><p>{t("mindmap.emptyHint")}</p><button type="button" disabled={loading || saving} onClick={() => void create()}>{t("mindmap.new")}</button></div>
      : <div className={styles.workbench} data-chat={chatOpen}>
        <NoteMindmap key={`${doc.id}:${editorEpoch}`} mapId={doc.id} active={active} root={doc.root} revision={doc.revision} selectedIds={viewSelection} onSelect={setSelectedIds} focusId={focusId} onFocus={focusBranch} changedIds={changedIds} busy={blocked} onEdit={edit} onDirty={onDirty} chatOpen={chatOpen} onHistory={history} arrangeRevision={arrangeRevision} onLayoutChange={onLayoutChange} onSummarize={(node) => openReader(node.id, true)} summarizing={generating} explainedIds={explainedIds} />
        <aside ref={buddy} id="mindmap-buddy" className={styles.chat} tabIndex={-1} hidden={!chatOpen} aria-label={t("mindmap.chat")} onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.stopPropagation(); closeBuddy(); } }}>
          <header><div className={styles.buddyTitle}><span className={styles.buddyMark}><MindmapIcon name="chat" /></span><h2 title={t("mindmap.buddyHint")}>Agent Buddy</h2></div><button type="button" aria-label={t("mindmap.closeBuddy")} title={t("mindmap.closeBuddy")} onClick={closeBuddy}><MindmapIcon name="collapse" /></button></header>
          <details className={styles.context} role="group" aria-label={t("mindmap.scope")} onKeyDown={(e) => { if (e.key === "Escape" && e.currentTarget.open) { e.preventDefault(); e.stopPropagation(); e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}>
            <summary className={styles.scopeSummary} title={scopeTitle}><span>{t("mindmap.scope")} · {scopeTitle}</span><MindmapIcon name="expand" /></summary>
            <div className={styles.scopeDetails}>
              <small>{!scopeRoots.length ? t("mindmap.saveFirst") : selected.length ? t("mindmap.selected", { count: selected.length }) : t(focusRoot?.id !== doc.root.id ? "mindmap.focusScope" : "mindmap.wholeMap")} · {t("mindmap.scopeCount", { count: scopeCount })}</small>
              {selected.length > 0 && <div className={styles.scopeChips}>
                {selected.slice(0, 4).map((node) => <button type="button" key={node.id} title={node.label} aria-label={t("mindmap.unselect", { label: node.label })} disabled={dirty || saving} onClick={() => setSelectedIds((ids) => ids.filter((id) => id !== node.id))}>{node.label}<MindmapIcon name="close" /></button>)}
                {selected.length > 4 && <small>{t("mindmap.moreSelected", { count: selected.length - 4 })}</small>}
                <button type="button" disabled={dirty || saving} onClick={() => setSelectedIds([])}>{t("mindmap.clearSelection")}</button>
              </div>}
            <div className={styles.contextActions}>
              <button type="button" title={t("mindmap.changeScopeHint")} onClick={chooseOnCanvas}><MindmapIcon name="select" />{t(dirty ? "mindmap.backToEdit" : "mindmap.changeScope")}</button>
              <button type="button" className={styles.buddyAction} title={t("mindmap.explanationSingleScope")} disabled={dirty || scopeRoots.length !== 1} onClick={() => openReader(scopeRoots[0].id, true)}><MindmapIcon name="document" />{t(explainedIds.has(scopeRoots[0]?.id) ? "mindmap.readExplanation" : "mindmap.explainSelection")}</button>
            </div>
            {scopeRoots.length > 1 && <p className={styles.composerHint}>{t("mindmap.explanationSingleScope")}</p>}
            </div>
          </details>
          <div className={styles.messages} aria-live="polite" aria-relevant="additions text">
            {!doc.messages.length && !pendingMessage && <div className={styles.welcome}><h3>{t("mindmap.welcome")}</h3><p>{t("mindmap.buddyWelcome")}</p></div>}
            {doc.messages.map((message, index) => <article key={`${message.revision}:${index}`} data-role={message.role}><small>{t(message.role === "user" ? "mindmap.you" : "mindmap.assistant")} · r{message.revision}</small><MindmapReply text={message.text} />{message.role === "assistant" && <button type="button" className={styles.replyAction} onClick={() => download(`mindmap-r${message.revision}.md`, message.text)}><MindmapIcon name="download" />{t("mindmap.exportReply")}</button>}</article>)}
            {pendingMessage && <article data-role="user" data-pending="true"><small>{t("mindmap.you")} · {t(pendingMessage.mode === "discuss" ? "mindmap.modeDiscuss" : "mindmap.modeEdit")}</small><MindmapReply text={pendingMessage.text} /></article>}
            {generating && pendingMessage && <div className={styles.generation} role="status"><strong>{t("mindmap.thinking")}</strong><span title={pendingMessage.scope}>{t("mindmap.processingScope", { label: pendingMessage.scope })}</span><small>{t("mindmap.selectionNext")}</small></div>}
            {unapplied && <article data-unapplied="true"><small>{t("mindmap.notApplied")}</small><MindmapReply text={unapplied} /></article>}
            <div ref={messagesEnd} />
          </div>
          <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <label className={styles.srOnly} htmlFor="mindmap-instruction">{t("mindmap.instruction")}</label>
            <textarea id="mindmap-instruction" value={instruction} maxLength={8000} placeholder={t(mode === "edit" ? "mindmap.promptEdit" : "mindmap.promptDiscuss")} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
            {(dirty || !model) && <p className={styles.composerHint}>{t(dirty ? "mindmap.saveFirst" : "mindmap.chooseModel")}</p>}
            <div className={styles.sendRow}>
              <div className={styles.chatModes} role="group" aria-label={t("mindmap.messageMode")}><button type="button" disabled={generating} aria-pressed={mode === "edit"} title={t("mindmap.editModeHint")} onClick={() => setMode("edit")}>{t("mindmap.modeEdit")}</button><button type="button" disabled={generating} aria-pressed={mode === "discuss"} title={t("mindmap.discussModeHint")} onClick={() => setMode("discuss")}>{t("mindmap.modeDiscuss")}</button></div>
              <details className={styles.quickActions} onKeyDown={(e) => { if (e.key === "Escape" && e.currentTarget.open) { e.preventDefault(); e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}>
                <summary title={t("mindmap.quickPrompts")} aria-label={t("mindmap.quickPrompts")}><MindmapIcon name="plus" /></summary>
                <div className={styles.suggestions}>
                  <small>{t(instruction.trim() ? "mindmap.keepDraft" : "mindmap.quickPrompts")}</small>
                  {(["mindmap.suggestExpand", "mindmap.suggestOrganize", "mindmap.suggestDiscuss", "mindmap.askOrganize"] as const).map((key) => <button type="button" key={key} disabled={blocked || dirty || generating || !!instruction.trim()} onClick={(e) => { preparePrompt(t(key === "mindmap.askOrganize" ? "mindmap.organizePrompt" : key), key === "mindmap.suggestDiscuss" ? "discuss" : "edit"); e.currentTarget.closest("details")?.removeAttribute("open"); }}>{t(key)}</button>)}
                </div>
              </details>
              <div className={styles.model}>{footer}</div>{generating ? <button type="button" aria-label={t("mindmap.stop")} title={t("mindmap.stop")} onClick={(e) => { e.preventDefault(); controller.current?.abort(); controller.current = null; setGenerating(false); setPendingMessage(null); setNotice(t("mindmap.stopped")); }}><MindmapIcon name="stop" /></button> : <button type="submit" aria-label={t("mindmap.send")} title={t("mindmap.sendHint")} disabled={!model || blocked || dirty || !instruction.trim()}><MindmapIcon name="send" /></button>}</div>
          </form>
        </aside>
      </div>}
    {active && doc && reader && <MindmapExplanations key={`${doc.id}:${reader.nodeId}`} doc={doc} nodeId={reader.nodeId} autoGenerate={reader.generate} model={model} blocked={blocked || dirty || generating} onSaved={accept} onSelect={(nodeId) => setReader({ nodeId, generate: false })} onClose={closeReader} onChooseModel={() => { setReader(null); setChatOpen(true); setNotice(t("mindmap.chooseModel")); focusBuddy(); }} />}
  </div>;
}
