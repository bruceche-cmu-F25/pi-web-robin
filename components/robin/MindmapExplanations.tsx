"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { MindmapDocument, MindmapProposal } from "@/extension/robin/mindmap";
import type { MindmapExplanationView } from "@/extension/robin/mindmap-explanation";
import { MINDMAP_API, MapRequestError, mindmapRequest, downloadMindmapMarkdown } from "./mindmap-client";
import { MindmapReply } from "./MindmapReply";
import { MindmapIcon } from "./MindmapIcon";
import styles from "./MindmapExplanations.module.css";

type Save = { id: string; revision: number; requestId: string; action: "explain"; nodeId: string; sourceHash: string; markdown: string };

/** A node-bound reading surface. No chat drafts, tree edits or undo snapshots live here. */
export function MindmapExplanations({ doc, nodeId, autoGenerate, model, blocked, onSaved, onSelect, onClose, onChooseModel }: {
  doc: MindmapDocument; nodeId: string; autoGenerate: boolean;
  model: { provider: string; modelId: string } | null; blocked: boolean;
  onSaved: (doc: MindmapDocument) => void; onSelect: (id: string) => void;
  onClose: () => void; onChooseModel: () => void;
}) {
  const { t, locale } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null), autoUsed = useRef(false);
  const [data, setData] = useState<MindmapExplanationView | null>(null);
  const [phase, setPhase] = useState<"loading" | "idle" | "generating" | "saving">("loading");
  const [ready, setReady] = useState(false), [error, setError] = useState(""), [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState<Save | null>(null);
  const busy = phase !== "idle", saved = data?.explanation;
  const items = data?.explanations ?? doc.explanations;
  const title = data?.node?.label ?? saved?.title ?? items.find((item) => item.nodeId === nodeId)?.title ?? "";
  const markdown = pending?.markdown ?? saved?.markdown;
  const readUrl = `${MINDMAP_API}?id=${encodeURIComponent(doc.id)}&explanation=${encodeURIComponent(nodeId)}`;

  const load = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setPhase("loading"); setReady(false); setError(""); setConflict(false);
    try {
      const result = await mindmapRequest<MindmapExplanationView>(readUrl, "GET", undefined, abort.signal);
      if (!abort.signal.aborted) { setData(result); setReady(true); }
    } catch (caught) { if (!abort.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { if (controller.current === abort) { controller.current = null; setPhase("idle"); } }
  }, [readUrl]);

  const persist = useCallback(async (payload: Save, abort: AbortController) => {
    setPhase("saving"); setError("");
    try {
      const result = await mindmapRequest<{ map: MindmapDocument }>(MINDMAP_API, "PATCH", payload, abort.signal);
      // A replay can return a newer version; read its actual text, never label our preview as that version.
      const confirmed = await mindmapRequest<MindmapExplanationView>(readUrl, "GET", undefined, abort.signal);
      if (abort.signal.aborted) return;
      setData(confirmed); setReady(true); setPending(null); setConflict(false); onSaved(result.map);
    } catch (caught) {
      if (!abort.signal.aborted) { setError(caught instanceof Error ? caught.message : String(caught)); setConflict(caught instanceof MapRequestError && caught.status === 409); }
    } finally { if (controller.current === abort) { controller.current = null; setPhase("idle"); } }
  }, [onSaved, readUrl]);

  const generate = useCallback(async (source: MindmapExplanationView) => {
    if (!model || blocked || !source.node || controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    setPhase("generating"); setError(""); setConflict(false);
    try {
      const result = await mindmapRequest<{ proposal: MindmapProposal; revision: number; sourceHash: string }>(`${MINDMAP_API}/agent`, "POST", {
        id: doc.id, revision: source.revision, mode: "explain", selectedIds: [nodeId], ...model,
        message: t("mindmap.explanationPrompt", { label: source.node.label }),
      }, abort.signal);
      if (abort.signal.aborted) return;
      const payload: Save = { id: doc.id, nodeId, revision: result.revision, requestId: crypto.randomUUID(), action: "explain", sourceHash: result.sourceHash, markdown: result.proposal.reply };
      setPending(payload);
      await persist(payload, abort);
    } catch (caught) {
      if (!abort.signal.aborted) { setError(caught instanceof Error ? caught.message : String(caught)); setConflict(caught instanceof MapRequestError && caught.status === 409); }
    } finally { if (controller.current === abort) { controller.current = null; setPhase("idle"); } }
  }, [blocked, doc.id, model, nodeId, persist, t]);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal(); closeButton.current?.focus({ preventScroll: true });
    return () => { controller.current?.abort(); controller.current = null; element?.close(); };
  }, []);
  useEffect(() => { void load(); return () => { controller.current?.abort(); controller.current = null; }; }, [load]);
  useEffect(() => {
    if (!ready || !data || doc.revision > data.revision || autoUsed.current) return;
    autoUsed.current = true;
    if (autoGenerate && !data.explanation) void generate(data);
  }, [autoGenerate, data, doc.revision, generate, ready]);
  useEffect(() => {
    // Buddy may finish a write while this read-only window is open.
    if (ready && data && !busy && !pending && doc.revision > data.revision) void load();
  }, [busy, data, doc.revision, load, pending, ready]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (pending || phase === "saving") { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [pending, phase]);

  const discardPreview = () => !pending || window.confirm(t("mindmap.explanationDiscard"));
  const close = () => {
    if (phase === "saving" || !discardPreview()) return;
    controller.current?.abort(); controller.current = null; onClose();
  };
  const select = (id: string) => { if (!busy && discardPreview()) onSelect(id); };
  const reload = () => { if (!busy && discardPreview()) { setPending(null); void load(); } };
  const stop = () => { controller.current?.abort(); controller.current = null; setPhase("idle"); setError(t("mindmap.explanationStopped")); };
  const date = saved ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(saved.generatedAt)) : "";

  return <dialog ref={dialog} className={styles.reader} aria-labelledby="mindmap-reader-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <header className={styles.header}>
      <div><h2 id="mindmap-reader-title">{t("mindmap.explanations")}</h2><p>{doc.root.label}</p></div>
      <button ref={closeButton} type="button" disabled={phase === "saving"} aria-label={t("mindmap.closeReader")} title={t("mindmap.closeReader")} onClick={close}><MindmapIcon name="close" /></button>
    </header>
    <div className={styles.body}>
      <nav className={styles.library} aria-label={t("mindmap.savedExplanations")}>
        <h3>{t("mindmap.savedExplanations")} <span>{items.length}</span></h3>
        {!items.some((item) => item.nodeId === nodeId) && <button type="button" aria-current="page" disabled={busy}><span>{title || t("mindmap.currentBranch")}</span><small>{t("mindmap.explanationEmpty")}</small></button>}
        {items.map((item) => <button key={item.nodeId} type="button" aria-current={item.nodeId === nodeId ? "page" : undefined} disabled={busy} onClick={() => select(item.nodeId)}><span>{item.title}</span><small>{t(item.missing ? "mindmap.explanationRemoved" : item.stale ? "mindmap.explanationOutdated" : "mindmap.explanationCurrent")}</small></button>)}
      </nav>
      <section className={styles.document} aria-label={t("mindmap.explanationDocument")} tabIndex={0}>
        <div className={styles.paper}>
          <div className={styles.metadata}><span>{t("mindmap.currentBranch")}</span><strong>{title || t("robin.common.loading")}</strong>{pending ? <small>{t("mindmap.explanationPreview")} · r{pending.revision}</small> : saved && <small><time dateTime={saved.generatedAt}>{date}</time> · r{saved.sourceRevision}</small>}</div>
          <div className={styles.tools}>
            {phase === "generating" ? <button type="button" onClick={stop}><MindmapIcon name="stop" />{t("mindmap.stop")}</button>
              : pending && !conflict ? <button type="button" className={styles.primary} disabled={busy} onClick={() => { if (controller.current) return; const abort = new AbortController(); controller.current = abort; void persist(pending, abort); }}>{t("mindmap.retryExplanationSave")}</button>
              : <button type="button" className={styles.primary} disabled={busy || blocked || !model || !ready || !data?.node || conflict || !!pending} onClick={() => { if (data) void generate(data); }}><MindmapIcon name="chat" />{t(saved ? "mindmap.regenerateExplanation" : "mindmap.generateExplanation")}</button>}
            {markdown && <button type="button" onClick={() => downloadMindmapMarkdown(`${(title || nodeId).replace(/[^\p{L}\p{N}_-]/gu, "_").slice(0, 80)}.md`, markdown)}><MindmapIcon name="download" />{t("mindmap.exportReply")}</button>}
            <button type="button" disabled={busy} onClick={reload}>{t("mindmap.refreshExplanation")}</button>
          </div>
          {!model && <p className={styles.hint}>{t("mindmap.explanationChooseModel")} <button type="button" onClick={() => { if (discardPreview()) onChooseModel(); }}>{t("mindmap.explanationModelAction")}</button></p>}
          {blocked && <p className={styles.hint}>{t("mindmap.explanationBlocked")}</p>}
          <div aria-live="polite" className={styles.status}>
            {phase === "loading" ? <p>{t("robin.common.loading")}</p> : phase === "generating" ? <p>{t("mindmap.explanationGenerating")}</p> : phase === "saving" ? <p>{t("notes.save.saving")}</p>
              : pending ? <p data-warning="true">{t("mindmap.explanationUnconfirmed")}</p>
              : saved?.missing ? <p data-warning="true">{t("mindmap.explanationRemovedHint")}</p>
              : saved?.stale ? <p data-warning="true">{t("mindmap.explanationStaleHint")}</p>
              : saved && <p>{t("mindmap.explanationSaved")}</p>}
          </div>
          {error && <p className={styles.error} role="alert">{error}{conflict && <> {t("mindmap.explanationConflict")}</>}</p>}
          {markdown ? <article className={styles.prose} aria-label={t("mindmap.explanationDocument")}><MindmapReply text={markdown} /></article>
            : !busy && ready && <div className={styles.empty}><h3>{t(data?.node ? "mindmap.explanationEmpty" : "mindmap.explanationRemoved")}</h3><p>{t(data?.node ? "mindmap.explanationEmptyHint" : "mindmap.explanationRemovedHint")}</p></div>}
          <p className={styles.boundary}>{t("mindmap.explanationBoundary")}</p>
        </div>
      </section>
    </div>
  </dialog>;
}
