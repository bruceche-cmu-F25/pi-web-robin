"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { MarkdownBody } from "./MarkdownBody";
import { ModelSelector, type ModelSelectorOption } from "./ModelSelector";
import type { KnowledgeSource, KnowledgeScope } from "@/lib/knowledge-source";
import type { KnowledgeProposal } from "@/extension/robin/knowledge-domain";
import type { ObsidianVault } from "@/extension/robin/obsidian-domain";
import type { ModelsData } from "@/lib/models-cache";
import styles from "./KnowledgeCaptureDialog.module.css";

interface Capture { id: string; project: string; createdAt: string; saved: number; total: number }
interface Props { sessionId: string; leafId: string | null; initialProject: string; onClose: () => void; onSaved: () => void }

export function KnowledgeCaptureDialog({ sessionId, leafId, initialProject, onClose, onSaved }: Props) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [scope, setScope] = useState<KnowledgeScope>("all");
  const [source, setSource] = useState<KnowledgeSource | null>(null);
  const [vaults, setVaults] = useState<ObsidianVault[]>([]);
  const [vaultId, setVaultId] = useState("");
  const [project, setProject] = useState(initialProject);
  const [models, setModels] = useState<ModelSelectorOption[]>([]);
  const [model, setModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [proposal, setProposal] = useState<KnowledgeProposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"prepare" | "save" | "history" | null>(null);
  const [regenerate, setRegenerate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = `/api/sessions/${encodeURIComponent(sessionId)}/knowledge`;

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { request.current?.abort(); element?.close(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/models", { signal: controller.signal }).then(async (response) => {
      const body = await response.json() as ModelsData;
      if (!response.ok) throw new Error("Could not load models");
      const options = body.modelList.map((entry) => ({ provider: entry.provider, modelId: entry.id, name: entry.name || entry.id }));
      setModels(options);
      setModel(body.defaultModel ?? options[0] ?? null);
    }).catch((caught) => { if (!controller.signal.aborted) setError(String(caught)); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ scope, ...(leafId ? { leafId } : {}) });
    void fetch(`${endpoint}?${query}`, { signal: controller.signal }).then(async (response) => {
      const body = await response.json() as { source: KnowledgeSource; vaults: ObsidianVault[]; captures: Capture[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not load conversation");
      if (controller.signal.aborted) return;
      setSource(body.source);
      setCaptures(body.captures);
      setVaults(body.vaults);
      let remembered = "";
      try { remembered = localStorage.getItem("pi-robin-obsidian-vault") ?? ""; } catch { /* Optional preference. */ }
      setVaultId((current) => body.vaults.some((vault) => vault.id === current) ? current
        : body.vaults.some((vault) => vault.id === remembered) ? remembered : body.vaults.length === 1 ? body.vaults[0].id : "");
    }).catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, leafId, scope]);

  async function run(action: "prepare" | "save" | "history", proposalId?: string) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(action);
    setError(null);
    try {
      const response = action === "history"
        ? await fetch(`${endpoint}?${new URLSearchParams({ proposalId: proposalId! })}`, { signal: controller.signal })
        : await fetch(endpoint, {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify(action === "save" ? { action, proposalId: proposal?.id, confirmed: true }
            : { action, scope, leafId: source?.leafId, fingerprint: source?.fingerprint, vaultId, project,
              provider: model?.provider, modelId: model?.modelId, regenerate }),
        });
      const body = await response.json() as { proposal?: KnowledgeProposal; error?: string };
      if (body.proposal) {
        setProposal(body.proposal);
        const current = body.proposal;
        setCaptures((items) => [{ id: current.id, project: current.project, createdAt: current.createdAt, saved: current.notes.filter((note) => note.saved).length, total: current.notes.length }, ...items.filter((item) => item.id !== current.id)]);
        if (current.notes.some((note) => note.saved)) onSaved();
      }
      if (!response.ok) throw new Error(body.error ?? "Request failed");
      if (!body.proposal) throw new Error("No proposal returned");
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      request.current = null;
      setBusy(null);
    }
  }
  const selectedVault = vaults.find((vault) => vault.id === vaultId);
  const saved = proposal?.notes.filter((note) => note.saved).length ?? 0;
  const complete = Boolean(proposal && saved === proposal.notes.length);
  const tooLong = Boolean(source && source.chars > 80_000);
  const close = () => { if (busy !== "save") { request.current?.abort(); onClose(); } };

  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby="knowledge-heading" onCancel={(event) => { event.preventDefault(); close(); }} onKeyDown={(event) => {
    // Modal keystrokes must not reach the shell's stop-agent/new-session shortcuts.
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close(); }
  }}>
    <header className={styles.header}>
      <div><span className="pi-eyebrow">Obsidian · Markdown</span><h2 id="knowledge-heading">{t("knowledge.title")}</h2></div>
      <button type="button" className="ui-action" disabled={busy === "save"} onClick={close} aria-label={t("chat.close")}>×</button>
    </header>
    <div className={styles.body}>
      {proposal ? <>
        <p className={styles.destination}>{proposal.project} · {proposal.vaultPath}</p>
        <details><summary>{t("knowledge.projectHub")} <code>{proposal.hubPath}</code></summary><MarkdownBody>{proposal.hubMarkdown}</MarkdownBody></details>
        <p>{t("knowledge.provenance", { count: proposal.source.entryIds.length })} · <a href={proposal.source.url} target="_blank" rel="noreferrer">{t("knowledge.source")}</a></p>
        {saved > 0 ? <p role="status">{t(complete ? "knowledge.saved" : "knowledge.partial", { saved, total: proposal.notes.length })}</p> : <p>{t("knowledge.reviewHint")}</p>}
        {proposal.notes.map((note) => <section key={note.id} className={styles.note}>
          <header><h3>{note.title}</h3><span className="pi-eyebrow">{t(note.saved ? "knowledge.savedNote" : note.action === "append" ? "knowledge.append" : "knowledge.create")}</span></header>
          <code className={styles.path}>{note.path}</code>
          {note.action === "append" ? <details><summary>{t("knowledge.existing")}</summary><pre>{note.before}</pre></details> : null}
          <MarkdownBody>{note.markdown}</MarkdownBody>
          {note.saved ? <a href={note.url}>{t("notes.obsidian.open")}</a> : null}
        </section>)}
      </> : <>
        <p>{t("knowledge.hint")}</p>
        <div className={styles.fields}>
          <label>{t("knowledge.scope")}<select value={scope} disabled={Boolean(busy)} onChange={(event) => setScope(event.target.value as KnowledgeScope)}>
            <option value="all">{t("knowledge.all")}</option><option value="recent12">{t("knowledge.recent12")}</option><option value="recent4">{t("knowledge.recent4")}</option>
          </select></label>
          <label>{t("notes.obsidian.vault")}<select value={vaultId} disabled={Boolean(busy)} onChange={(event) => setVaultId(event.target.value)}>
            <option value="">{t("notes.obsidian.choose")}</option>{vaults.map((vault) => <option key={vault.id} value={vault.id}>{vaults.length > 1 ? vault.path : vault.name}</option>)}
          </select></label>
          <label>{t("knowledge.project")}<input value={project} maxLength={120} disabled={Boolean(busy)} onChange={(event) => setProject(event.target.value)} /></label>
          <div><span className={styles.fieldLabel}>{t("notes.model")}</span><ModelSelector options={models} value={model} onChange={(provider, modelId) => setModel({ provider, modelId })} disabled={Boolean(busy)} ariaLabel={t("notes.model")} variant="field" /></div>
        </div>
        {selectedVault ? <p className={styles.path}>{selectedVault.path}</p> : !loading && !vaults.length ? <p>{t("notes.obsidian.setup")}</p> : null}
        <p className={styles.warning}>{t("knowledge.privacy")}</p>
        {loading ? <p role="status">{t("robin.common.loading")}</p> : tooLong ? <p role="alert">{t("knowledge.tooLong")}</p> : source ? <details>
          <summary>{t("knowledge.sourceCount", { count: source.messages.length, total: source.totalMessages })}</summary>
          <p><code>{source.leafId}</code> · {source.sessionName}</p>
          {source.messages.map((message) => <section key={message.id}><span className="pi-eyebrow">{message.role} · {message.id}</span><pre>{message.text}</pre></section>)}
        </details> : null}
        {captures.length > 0 ? <section><h3>{t("knowledge.history")}</h3><ul className={styles.history}>{captures.map((capture) => <li key={capture.id}>
          <button type="button" className="ui-action" disabled={Boolean(busy)} onClick={() => void run("history", capture.id)}>{capture.project} · {capture.createdAt.slice(0, 10)} · {t("knowledge.historyCount", { saved: capture.saved, total: capture.total })}</button>
        </li>)}</ul></section> : null}
      </>}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {busy ? <p role="status">{t(busy === "prepare" ? "knowledge.preparing" : busy === "save" ? "notes.archive.working" : "robin.common.loading")}</p> : null}
    </div>
    <footer className={styles.footer}>
      {proposal ? <>
        <button type="button" className="ui-action ui-action--outline" disabled={Boolean(busy)} onClick={() => { setProposal(null); setError(null); setRegenerate(true); }}>{t("knowledge.regenerate")}</button>
        {complete ? <a href="/notes">{t("knowledge.openNotes")}</a> : <button type="button" className="ui-action ui-action--outline" data-state="accent" disabled={Boolean(busy)} onClick={() => void run("save")}>{t("knowledge.confirm")}</button>}
      </> : <button type="button" className="ui-action ui-action--outline" data-state="accent" disabled={Boolean(busy) || loading || tooLong || !source?.messages.length || !vaultId || !project.trim() || !model} onClick={() => void run("prepare")}>{t("knowledge.prepare")}</button>}
      <button type="button" className="ui-action" disabled={busy === "save"} onClick={close}>{t(busy === "prepare" ? "knowledge.cancel" : "chat.close")}</button>
    </footer>
  </dialog>, document.body);
}
