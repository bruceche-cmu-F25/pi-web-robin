"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import { writeUrlState } from "@/lib/url-state";
import { applyMindmapOperations, flattenMindTree, mindmapMarkdown, validateMindTree, type MindNode, type MindmapDocument, type MindmapOperation, type MindmapProposal, type MindmapSummary } from "@/extension/robin/mindmap";
import { NoteMindmap } from "./NoteMindmap";
import { noteMindmap } from "./note-mindmap";
import styles from "./NoteMindmap.module.css";

const ROOT = "/api/robin/mindmaps";
class MapRequestError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }
async function request<T>(url: string, method = "GET", data?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method, cache: "no-store", signal, ...(data ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}) });
  const body = await response.json();
  if (!response.ok) throw new MapRequestError(body.error ?? `Request failed (${response.status})`, response.status);
  return body;
}
function changes(before: MindNode, after: MindNode): Set<string> {
  const positions = (root: MindNode) => {
    const result = new Map<string, string>();
    const visit = (node: MindNode, parent: string, index: number) => { result.set(node.id, JSON.stringify([node.label, parent, index])); node.children.forEach((child, n) => visit(child, node.id, n)); };
    visit(root, "", 0); return result;
  };
  const previous = positions(before);
  return new Set([...positions(after)].filter(([id, value]) => previous.get(id) !== value).map(([id]) => id));
}
function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const retryWrite = useRef<{ method: string; data: Record<string, unknown> } | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const messagesEnd = useRef<HTMLDivElement>(null);

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
    setMaps((items) => [{ id: next.id, title: next.root.label, updatedAt: next.updatedAt }, ...items.filter((item) => item.id !== next.id)]);
    setSelectedIds((ids) => before?.id === next.id ? ids.filter((id) => flattenMindTree(next.root).some((node) => node.id === id)) : [next.root.id]);
    if (before?.id !== next.id) {
      let text = ""; try { text = localStorage.getItem(`pi-mindmap-chat:${next.id}`) ?? ""; } catch { /* Input still works without storage. */ }
      instructionRef.current = text; setInstruction(text); onDirty(false); setEditorEpoch((n) => n + 1);
    }
  }, [onDirty]);
  const mayLeave = useCallback(() => {
    if (savingRef.current) return false;
    if ((dirtyRef.current || controller.current || retryWrite.current) && !window.confirm(t("mindmap.leaveConfirm"))) return false;
    controller.current?.abort(); controller.current = null; setGenerating(false);
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
  useEffect(() => { if (active && chatOpen) messagesEnd.current?.scrollIntoView({ block: "nearest" }); }, [doc?.messages.length, active, chatOpen]);

  const write = async (method: string, data: Record<string, unknown>): Promise<boolean> => {
    if (savingRef.current) return false;
    savingRef.current = true; setSaving(true); setError(""); setConflict(false); setNotice("");
    retryWrite.current = { method, data }; setRetryable(false);
    try {
      const result = await request<{ map: MindmapDocument }>(ROOT, method, data);
      if (!alive.current) return false;
      accept(result.map); retryWrite.current = null; setRetryable(false); setNotice(t("mindmap.saved")); onDirty(false);
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
        const label = window.prompt(t("mindmap.newTitle"), t("mindmap.untitled"));
        if (!label?.trim()) return;
        root = validateMindTree({ id: "root", label: label.trim(), children: [] });
      }
      const id = crypto.randomUUID();
      if (await write("POST", { id, root })) writeUrlState({ view: "mindmap", mindmap: id });
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  const history = (action: "undo" | "redo") => {
    const current = docRef.current;
    if (!current || dirtyRef.current || retryWrite.current) return;
    void write("PATCH", { id: current.id, revision: current.revision, requestId: crypto.randomUUID(), action });
  };
  const send = async () => {
    const current = docRef.current, message = instructionRef.current.trim();
    if (!current || !model || !message || controller.current || savingRef.current || dirtyRef.current || retryWrite.current || conflict) return;
    const abort = new AbortController(); controller.current = abort; setGenerating(true); setError(""); setUnapplied(""); setNotice("");
    try {
      const result = await request<{ proposal: MindmapProposal; revision: number }>(`${ROOT}/agent`, "POST", {
        id: current.id, revision: current.revision, message, mode, selectedIds, ...model,
      }, abort.signal);
      if (!alive.current || controller.current !== abort || abort.signal.aborted || docRef.current?.id !== current.id) return;
      if (docRef.current.revision !== current.revision || dirtyRef.current || savingRef.current || retryWrite.current) {
        setUnapplied(result.proposal.reply); setError(t("mindmap.staleProposal")); return;
      }
      const ok = await write("PATCH", { id: current.id, revision: result.revision, requestId: crypto.randomUUID(), action: "edit", operations: result.proposal.operations, conversation: { user: message, reply: result.proposal.reply } });
      if (!ok) setUnapplied(result.proposal.reply);
      else if (instructionRef.current === message) setDraft("");
    } catch (caught) {
      if (alive.current && controller.current === abort && !abort.signal.aborted) {
        setError(caught instanceof Error ? caught.message : String(caught));
        if (caught instanceof MapRequestError && caught.status === 409) setConflict(true);
      }
    } finally { if (controller.current === abort) { controller.current = null; if (alive.current) setGenerating(false); } }
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
  const selected = doc ? flattenMindTree(doc.root).filter((node) => selectedIds.includes(node.id)) : [];
  const blocked = saving || loading || conflict || retryable;
  return <div className={styles.workspace} hidden={!active}>
    <header className={styles.header}>
      <h1>{t("notes.mindmap")}</h1>
      <select aria-label={t("mindmap.library")} value={doc?.id ?? ""} disabled={saving || loading} onChange={(e) => { if (e.target.value) void open(e.target.value); }}>
        <option value="">{t("mindmap.choose")}</option>{maps.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
      <div className={styles.actions}>
        <button type="button" disabled={saving || loading} onClick={() => void create()}>{t("mindmap.new")}</button>
        <button type="button" disabled={saving || loading || !sourceNote} title={t("mindmap.importHint")} onClick={() => void create(true)}>{t("mindmap.importNote")}</button>
        <button type="button" disabled={!doc || blocked || dirty || !doc.canUndo} onClick={() => history("undo")}>{t("mindmap.undo")}</button>
        <button type="button" disabled={!doc || blocked || dirty || !doc.canRedo} onClick={() => history("redo")}>{t("mindmap.redo")}</button>
        <button type="button" disabled={!doc} onClick={() => { if (doc) download(`${doc.root.label.replace(/[^\p{L}\p{N}_-]/gu, "_").slice(0, 80)}.md`, mindmapMarkdown(doc.root)); }}>{t("mindmap.export")}</button>
        <button type="button" aria-pressed={chatOpen} onClick={() => setChatOpen(!chatOpen)}>{t("mindmap.chat")}</button>
        <button type="button" disabled={!doc || saving || loading} onClick={() => void remove()}>{t("mindmap.delete")}</button>
      </div>
    </header>
    <div className={styles.feedback}>
      {loading ? <p role="status">{t("robin.common.loading")}</p> : saving ? <p role="status">{t("notes.save.saving")}</p> : notice ? <p role="status">{notice}</p> : <p>{t("mindmap.independent")}</p>}
      {error && <div role="alert">{error} {retryable && <button type="button" disabled={saving} onClick={() => { const pending = retryWrite.current; if (pending) void write(pending.method, pending.data).then((ok) => { if (ok) { setUnapplied(""); const conversation = pending.data.conversation as { user: string } | undefined; if (conversation?.user === instructionRef.current) setDraft(""); if (pending.method === "POST") writeUrlState({ view: "mindmap", mindmap: String(pending.data.id) }); } }); }}>{t("canvas.retry")}</button>} {doc && !saving && <button type="button" onClick={() => void open(doc.id, false, true)}>{t("mindmap.reload")}</button>}{!doc && !retryable && <button type="button" onClick={() => window.location.reload()}>{t("canvas.retry")}</button>}</div>}
      {storageWarning && <p role="alert">{t("mindmap.storageWarning")}</p>}
    </div>
    {!doc ? <div className={styles.empty}><h2>{t("mindmap.emptyTitle")}</h2><p>{t("mindmap.emptyHint")}</p><button type="button" disabled={loading || saving} onClick={() => void create()}>{t("mindmap.new")}</button></div>
      : <div className={styles.workbench} data-chat={chatOpen}>
        <NoteMindmap key={`${doc.id}:${editorEpoch}`} root={doc.root} revision={doc.revision} selectedIds={selectedIds} onSelect={setSelectedIds} changedIds={changedIds} busy={blocked} onEdit={edit} onDirty={onDirty} />
        <aside className={styles.chat} hidden={!chatOpen} aria-label={t("mindmap.chat")}>
          <header><h2>{t("mindmap.chat")}</h2><div className={styles.actions}><button type="button" aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>{t("mindmap.modeEdit")}</button><button type="button" aria-pressed={mode === "discuss"} onClick={() => setMode("discuss")}>{t("mindmap.modeDiscuss")}</button></div></header>
          <div className={styles.messages} aria-live="polite" aria-relevant="additions text">
            {!doc.messages.length && <div className={styles.welcome}><h3>{t("mindmap.welcome")}</h3><p>{t("mindmap.examples")}</p></div>}
            {doc.messages.map((message, index) => <article key={`${message.revision}:${index}`} data-role={message.role}><small>{t(message.role === "user" ? "mindmap.you" : "mindmap.assistant")} · r{message.revision}</small><p>{message.text}</p></article>)}
            {generating && <p role="status">{t("mindmap.working")}</p>}
            {unapplied && <article data-unapplied="true"><small>{t("mindmap.notApplied")}</small><p>{unapplied}</p></article>}
            <div ref={messagesEnd} />
          </div>
          <div className={styles.selection}>
            <span>{selected.length ? t("mindmap.selected", { count: selected.length }) : t("mindmap.wholeMap")}</span>
            {selected.map((node) => <button type="button" key={node.id} title={node.label} aria-label={t("mindmap.unselect", { label: node.label })} disabled={dirty} onClick={() => setSelectedIds((ids) => ids.filter((id) => id !== node.id))}>{node.label}<span aria-hidden="true">×</span></button>)}
          </div>
          <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <label className={styles.srOnly} htmlFor="mindmap-instruction">{t("mindmap.instruction")}</label>
            <textarea id="mindmap-instruction" value={instruction} maxLength={8000} placeholder={t(mode === "edit" ? "mindmap.promptEdit" : "mindmap.promptDiscuss")} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
            <div className={styles.sendRow}><small>{t(dirty ? "mindmap.saveFirst" : !model ? "mindmap.chooseModel" : "mindmap.sendHint")}</small>{generating ? <button type="button" onClick={(e) => { e.preventDefault(); controller.current?.abort(); controller.current = null; setGenerating(false); setNotice(t("mindmap.stopped")); }}>{t("mindmap.stop")}</button> : <button type="submit" disabled={!model || blocked || dirty || !instruction.trim()}>{t("mindmap.send")}</button>}</div>
          </form>
          <div className={styles.model}>{footer}</div>
        </aside>
      </div>}
  </div>;
}
