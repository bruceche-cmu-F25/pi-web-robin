"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import { MAX_RESUME_BYTES, MAX_RESUME_PDF_BYTES, RESUME_TEMPLATE, parseResumeProposal, type ResumeDocument, type ResumeProposal, type ResumePdfImport } from "@/extension/robin/resume";
import { clearTextRecovery, newRecoveryId, saveTextRecovery, type RecoveryReceipt } from "@/lib/text-recovery";
import { TextRecoveryNotice, TextRecoveryWarning } from "./TextRecoveryNotice";
import { resumeChanges, resumeLineRange } from "./resume-changes";
import { ResumePreview } from "./ResumePreview";
import styles from "./ResumeWorkspace.module.css";
import type { ResumeChoice } from "@/extension/robin/resume-domain";

const API = "/api/robin/resume";
async function request(init?: RequestInit, url = API) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(body?.error ?? `HTTP ${response.status}`);
  return body;
}
function savedDocument(value: unknown): ResumeDocument {
  const row = value as ResumeDocument | undefined;
  if (!row || typeof row.source !== "string" || typeof row.revision !== "string"
    || !(row.updatedAt === null || typeof row.updatedAt === "string")) throw new Error("Invalid resume response");
  return row;
}
function SourceDiff({ before, after, onJump }: { before: string; after: string; onJump?: (line: number) => void }) {
  const { t } = useI18n();
  const changes = useMemo(() => resumeChanges(before, after), [before, after]);
  return <details className={styles.diff} open>
    <summary>{t("resume.diff")}{changes && <> · +{changes.added} / −{changes.removed}</>}</summary>
    {changes ? <>
      <p className={styles.hint}>{t("resume.diffNumbers")}</p>
      <div className={styles.diffBody} tabIndex={0} aria-label={t("resume.diff")}>
        {changes.hunks.map((hunk, i) => <section key={i}>
          <div className={styles.hunkHead}><span>L{hunk.oldStart} → L{hunk.newStart}</span>
            <button type="button" disabled={!onJump} onClick={() => onJump?.(hunk.targetLine)}>{t("resume.jumpLine", { line: hunk.targetLine })}</button>
          </div>
          {hunk.lines.map((line, j) => <div key={j} className={styles.diffLine} data-kind={line.kind}>
            <span>{line.oldLine ?? ""}</span><span>{line.newLine ?? ""}</span>
            <span>{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : ""}</span><code>{line.text || " "}</code>
          </div>)}
        </section>)}
        {!changes.hunks.length && <p className={styles.hint}>{t("resume.noChange")}</p>}
      </div>
    </> : <><p>{t("resume.diffLimit")}</p>
      <h4>{t("resume.before")}</h4><pre tabIndex={0}>{before}</pre>
      <h4>{t("resume.after")}</h4><pre tabIndex={0}>{after}</pre></>}
  </details>;
}

export function ResumeWorkspace() {
  const { t, locale } = useI18n();
  const [selectedId, setSelectedId] = useState(() => typeof window === "undefined" ? "main" : new URLSearchParams(window.location.search).get("resume") ?? "main");
  const [resumes, setResumes] = useState<ResumeChoice[]>([]);
  const [naming, setNaming] = useState<"new" | "rename" | null>(null);
  const [newName, setNewName] = useState("");
  const [copyCurrent, setCopyCurrent] = useState(false);
  const [managing, setManaging] = useState(false);
  const [saved, setSaved] = useState<ResumeDocument | null>(null);
  const [source, setSource] = useState("");
  const sourceRef = useRef("");
  const [hasProfile, setHasProfile] = useState(false);
  const [useProfile, setUseProfile] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [conversation, setConversation] = useState<{ role: "user" | "agent"; text: string; result?: "applied" | "conflict" | "unchanged" }[]>([]);
  const conversationView = useRef<HTMLDivElement>(null);
  const [jobDescription, setJobDescription] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [agentError, setAgentError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [generating, setGenerating] = useState(false);
  const [convertingPdf, setConvertingPdf] = useState("");
  const generation = useRef<AbortController | null>(null);
  const generationVersion = useRef(0);
  const [proposal, setProposal] = useState<(ResumeProposal & {
    before: string; sessionId: string; imported?: ResumePdfImport;
    state: "applied" | "conflict" | "unchanged" | "undone";
  }) | null>(null);
  const [undo, setUndo] = useState<{ before: string; after: string } | null>(null);
  const [serverVersion, setServerVersion] = useState<ResumeDocument | null>(null);
  const [comparing, setComparing] = useState(false);
  const compareLock = useRef(false);
  const file = useRef<HTMLInputElement>(null);
  const pdfFile = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lineNumbers = useMemo(() => Array.from({ length: source.split("\n").length }, (_, i) => i + 1).join("\n"), [source]);
  const proposalView = useRef<HTMLElement>(null);
  const [writer] = useState(newRecoveryId);
  const receipt = useRef<RecoveryReceipt | undefined>(undefined);
  const drafts = useRef(new Map<string, { source: string; receipt?: RecoveryReceipt; pending: boolean }>());
  const [hasPending, setHasPending] = useState(false);
  const [backupFailed, setBackupFailed] = useState(false);
  const dirty = saved !== null && source !== saved.source;
  const oversized = new TextEncoder().encode(source).length > MAX_RESUME_BYTES;

  useEffect(() => {
    const controller = new AbortController();
    setLoadError("");
    void request({ signal: controller.signal }, `${API}?id=${encodeURIComponent(selectedId)}`).then((body) => {
      const doc = savedDocument(body.document);
      if (controller.signal.aborted) return;
      const draft = drafts.current.get(selectedId);
      receipt.current = draft?.receipt;
      setBackupFailed(Boolean(draft?.pending && !draft.receipt));
      setSaved(doc); setSource(draft?.source ?? doc.source); sourceRef.current = draft?.source ?? doc.source;
      setResumes(body.resumes);
      setHasProfile(body.hasProfile === true); setUseProfile(body.hasProfile === true);
    }).catch((error) => { if (!controller.signal.aborted) setLoadError(String(error.message)); });
    return () => controller.abort();
  }, [loadAttempt, selectedId]);
  useEffect(() => () => generation.current?.abort(), []);
  useEffect(() => { if (conversationView.current) conversationView.current.scrollTop = conversationView.current.scrollHeight; }, [conversation]);
  useEffect(() => {
    // Announce a requested result, but never steal focus while the user is typing.
    if (!proposal || document.activeElement?.tagName === "TEXTAREA") return;
    proposalView.current?.focus({ preventScroll: true });
    proposalView.current?.scrollIntoView({ block: "start" });
  }, [proposal]);
  useEffect(() => {
    if (!dirty && !hasPending && !saving && !generating) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, hasPending, saving, generating]);

  function editSource(value: string): boolean {
    if (value === saved?.source) {
      clearTextRecovery(receipt.current);
      receipt.current = undefined;
      drafts.current.delete(selectedId);
      setHasPending([...drafts.current.values()].some((draft) => draft.pending));
      setBackupFailed(false); setSource(value); sourceRef.current = value; setNotice("");
      return true;
    }
    const next = saveTextRecovery("resume", selectedId, `${writer}:source`, { source: value }, receipt.current);
    if (next) receipt.current = next;
    drafts.current.set(selectedId, { source: value, receipt: receipt.current, pending: value !== saved?.source });
    setHasPending([...drafts.current.values()].some((draft) => draft.pending));
    setBackupFailed(!next);
    setSource(value); sourceRef.current = value; setNotice("");
    return Boolean(next);
  }
  async function save() {
    if (!saved || saveLock.current || oversized) return;
    saveLock.current = true; setSaving(true); setError(""); setNotice("");
    const snapshot = sourceRef.current, recovery = receipt.current;
    try {
      const body = await request({ method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: snapshot, revision: saved.revision }) }, `${API}?id=${encodeURIComponent(selectedId)}`);
      const doc = savedDocument(body.document);
      if (doc.source !== snapshot) throw new Error("Save did not acknowledge the submitted source");
      setSaved(doc); setServerVersion(null);
      setResumes((current) => current.map((item) => item.id === selectedId ? { ...item, updatedAt: doc.updatedAt } : item));
      clearTextRecovery(recovery);
      if (receipt.current === recovery) receipt.current = undefined;
      drafts.current.set(selectedId, { source: sourceRef.current, receipt: receipt.current, pending: sourceRef.current !== doc.source });
      setHasPending([...drafts.current.values()].some((draft) => draft.pending));
      if (sourceRef.current === snapshot) setBackupFailed(false);
    } catch (error) { setError(error instanceof Error ? error.message : t("resume.error")); }
    finally { saveLock.current = false; setSaving(false); }
  }
  function stopGeneration() {
    if (!generation.current) return;
    generationVersion.current++;
    generation.current.abort();
    setNotice("resume.cancelled");
  }
  async function generate(pdf?: File) {
    if (!saved || generation.current || (!pdf && (!instruction.trim() || oversized))) return;
    if (pdf && ((!/\.pdf$/i.test(pdf.name) && pdf.type !== "application/pdf") || !pdf.size || pdf.size > MAX_RESUME_PDF_BYTES)) {
      setError(t("resume.pdfInvalid")); return;
    }
    const controller = new AbortController(); generation.current = controller;
    const version = ++generationVersion.current;
    const before = sourceRef.current;
    const message = instruction.trim();
    const history = conversation.slice(-8).map((turn) => ({ role: turn.role, text: turn.text.slice(0, 2000) }));
    setGenerating(true); setConvertingPdf(pdf?.name ?? ""); setError(""); setAgentError(""); setNotice("");
    try {
      const upload = new FormData();
      if (pdf) { upload.set("file", pdf); upload.set("locale", locale); }
      const body = pdf
        ? await request({ method: "POST", body: upload, signal: controller.signal }, `${API}/import`)
        : await request({ method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ source: before, instruction: message, history, jobDescription, useProfile, locale }) });
      if (controller.signal.aborted || version !== generationVersion.current) return;
      const revision = parseResumeProposal(JSON.stringify(body.proposal ?? null));
      if (typeof body.sessionId !== "string") throw new Error("Invalid agent response");
      if (pdf && (!body.imported || typeof body.imported.text !== "string" || typeof body.imported.name !== "string"
        || !Number.isInteger(body.imported.pages))) throw new Error("Invalid PDF conversion response");
      const state = revision.source === null || revision.source === before ? "unchanged"
        : sourceRef.current !== before ? "conflict" : "applied";
      if (state === "applied" && revision.source !== null) {
        setUndo({ before, after: revision.source });
        editSource(revision.source);
        setNotice("resume.applied");
      }
      if (pdf || revision.source !== null) setProposal({ ...revision, before, state, sessionId: body.sessionId, ...(pdf ? { imported: body.imported } : {}) });
      if (!pdf) {
        setConversation((turns) => [...turns, { role: "user", text: message }, { role: "agent", text: [revision.summary, ...revision.questions].join("\n"), result: state }]);
        setInstruction((current) => current === message ? "" : current);
      }
    } catch (error) {
      if (controller.signal.aborted || version !== generationVersion.current) setNotice("resume.cancelled");
      else (pdf ? setError : setAgentError)(error instanceof Error ? error.message : t("resume.error"));
    } finally { if (generation.current === controller) { generation.current = null; setGenerating(false); setConvertingPdf(""); } }
  }
  function jumpToLine(line: number) {
    const focusLine = () => {
      const textarea = editor.current;
      if (!textarea) return;
      const range = resumeLineRange(textarea.value, line);
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(range.start, range.end);
      textarea.scrollIntoView({ block: "center" });
      textarea.scrollTop = Math.max(0, (range.line - 1) * parseFloat(getComputedStyle(textarea).lineHeight) - textarea.clientHeight / 3);
      textarea.scrollLeft = 0;
      if (gutter.current) gutter.current.scrollTop = textarea.scrollTop;
    };
    focusLine();
  }
  async function compareSaved() {
    if (compareLock.current || saveLock.current) return;
    compareLock.current = true; setComparing(true);
    try { setServerVersion(savedDocument((await request(undefined, `${API}?id=${encodeURIComponent(selectedId)}`)).document)); }
    catch (error) { setError(error instanceof Error ? error.message : t("resume.error")); }
    finally { compareLock.current = false; setComparing(false); }
  }
  async function importFile(selected: File) {
    try {
      if (!/\.tex$/i.test(selected.name) || selected.size > MAX_RESUME_BYTES) throw new Error(t("resume.importError"));
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await selected.arrayBuffer());
      if (text.includes("\0")) throw new Error(t("resume.importError"));
      if (sourceRef.current && !window.confirm(t("resume.replace"))) return;
      editSource(text); setUndo(null); setError("");
    } catch { setError(t("resume.importError")); }
  }
  function selectResume(id: string) {
    if (id === selectedId || (!saved && !loadError) || saving || generating) return;
    setSaved(null); setLoadError(""); setError(""); setNotice(""); setAgentError(""); setProposal(null); setUndo(null);
    setServerVersion(null); setConversation([]); setInstruction(""); setJobDescription(""); setBackupFailed(false);
    setNaming(null); setSelectedId(id);
    const url = new URL(window.location.href);
    if (id === "main") url.searchParams.delete("resume"); else url.searchParams.set("resume", id);
    window.history.replaceState(window.history.state, "", url);
  }
  async function manageResume(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saved || !newName.trim() || managing || saving || generating) return;
    setManaging(true); setError("");
    try {
      const creating = naming === "new";
      const copiedSource = copyCurrent ? sourceRef.current : "";
      const body = await request({ method: creating ? "POST" : "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creating ? { name: newName, source: "" } : { id: selectedId, name: newName }) }, `${API}/documents`);
      setResumes(body.resumes); setNaming(null); setNewName(""); setCopyCurrent(false);
      if (creating) {
        if (copiedSource) {
          const backup = saveTextRecovery("resume", body.document.id, `${writer}:source`, { source: copiedSource });
          drafts.current.set(body.document.id, { source: copiedSource, receipt: backup ?? undefined, pending: true });
          setHasPending(true);
        }
        selectResume(body.document.id);
      }
    } catch (error) { setError(error instanceof Error ? error.message : t("resume.error")); }
    finally { setManaging(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([sourceRef.current], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "resume.tex";
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className={`robin-page robin-dashboard ${styles.page}`}>
    <div className={styles.content}>
      <header className={styles.header}><div><h1>{t("resume.title")}</h1><p>{t("resume.intro")}</p></div>
        <div className={styles.actions}>
          <button type="button" className="ui-action--primary" disabled={!saved || !dirty || saving || oversized || comparing} onClick={() => void save()}>{t(saving ? "resume.saving" : "resume.save")}</button>
          <button type="button" disabled={!saved || generating} onClick={() => pdfFile.current?.click()}>{t("resume.pdfUpload")}</button>
          <button type="button" disabled={!saved} onClick={() => {
            const preview = document.getElementById("resume-preview"); preview?.focus({ preventScroll: true }); preview?.scrollIntoView({ block: "start" });
          }}>{t("resume.preview.title")}</button>
          <details className={styles.fileActions} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
            <summary>{t("resume.files")}</summary>
            <div>
              <button type="button" disabled={!saved} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); file.current?.click(); }}>{t("resume.import")}</button>
              <button type="button" disabled={!saved || !source} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); download(); }}>{t("resume.download")}</button>
            </div>
          </details>
        </div>
        <input ref={pdfFile} type="file" accept=".pdf,application/pdf" hidden onChange={(event) => {
          const selected = event.target.files?.[0]; event.target.value = ""; if (selected) void generate(selected);
        }} />
        <input ref={file} type="file" accept=".tex,text/plain,application/x-tex" hidden onChange={(event) => {
          const selected = event.target.files?.[0]; event.target.value = ""; if (selected) void importFile(selected);
        }} />
      </header>
      <div className={styles.resumePicker}>
        <label htmlFor="resume-choice">{t("resume.choose")}</label>
        <select id="resume-choice" value={selectedId} disabled={!saved || saving || generating || managing} onChange={(event) => selectResume(event.target.value)}>
          {resumes.map((item) => <option key={item.id} value={item.id}>{item.id === "main" && item.name === "My resume" ? t("resume.default") : item.name}</option>)}
        </select>
        <button type="button" disabled={!saved || saving || generating || managing} onClick={() => { setNaming("new"); setNewName(""); }}>{t("resume.new")}</button>
        <button type="button" disabled={!saved || saving || generating || managing} onClick={() => { setNaming("rename"); setNewName(resumes.find((item) => item.id === selectedId)?.name ?? ""); }}>{t("resume.rename")}</button>
        {saved && <span role="status">{t(dirty ? "resume.dirty" : saved.updatedAt ? "resume.saved" : "resume.initial")}</span>}
      </div>
      {naming && <form className={styles.nameForm} onSubmit={(event) => void manageResume(event)}>
        <label htmlFor="resume-name">{t(naming === "new" ? "resume.newName" : "resume.rename")}</label>
        <input id="resume-name" autoFocus required maxLength={80} value={newName} onChange={(event) => setNewName(event.target.value)} />
        {naming === "new" && <label className={styles.copyOption}><input type="checkbox" checked={copyCurrent} onChange={(event) => setCopyCurrent(event.target.checked)} />{t("resume.copy")}</label>}
        <button type="submit" disabled={managing || !newName.trim()}>{t(naming === "new" ? "resume.create" : "resume.rename")}</button>
        <button type="button" onClick={() => setNaming(null)}>{t("resume.cancelName")}</button>
      </form>}
      <p className={styles.hint}>{t("resume.pdfHint")}</p>
      {convertingPdf && <div className={styles.importStatus} role="status"><span>{t("resume.pdfConverting", { name: convertingPdf })}</span>
        <button type="button" onClick={stopGeneration}>{t("resume.cancel")}</button></div>}
      {!saved ? <section role={loadError ? "alert" : "status"}>
        <p>{t(loadError ? "resume.loadError" : "resume.loading")}</p>
        {loadError && <><p>{loadError}</p><button type="button" onClick={() => setLoadAttempt((n) => n + 1)}>{t("resume.retry")}</button>
          {selectedId !== "main" && <button type="button" onClick={() => selectResume("main")}>{t("resume.backToMain")}</button>}</>}
      </section> : <>
        <TextRecoveryNotice key={selectedId} scope="resume" id={selectedId} writer={writer} disabled={saving} className={styles.recovery}
          onRestore={(fields) => typeof fields.source === "string" && editSource(fields.source)} />
        {backupFailed && <TextRecoveryWarning />}
        {error && <div role="alert" className={styles.error}><p>{t("resume.error")}</p><p>{error}</p>
          <button type="button" disabled={comparing || saving} onClick={() => void compareSaved()}>{t("resume.compare")}</button></div>}
        {oversized && <p role="alert" className={styles.error}>{t("resume.limit")}</p>}
        {notice && <p role="status">{t(notice)}</p>}
        {serverVersion && <section className={styles.server} aria-label={t("resume.server")}>
          <h2>{t("resume.server")}</h2><SourceDiff before={serverVersion.source} after={source} onJump={jumpToLine} />
          <p>{t("resume.conflictHint")}</p><div className={styles.actions}>
            <button type="button" disabled={saving} onClick={() => {
              if (!window.confirm(t("resume.replace"))) return;
              editSource(serverVersion.source); setSaved(serverVersion); setServerVersion(null); setError("");
            }}>{t("resume.loadSaved")}</button>
            <button type="button" disabled={saving} onClick={() => { setSaved(serverVersion); setServerVersion(null); setError(""); }}>{t("resume.keepDraft")}</button>
          </div>
        </section>}
        <nav className={styles.mobileViews} aria-label={t("resume.views")}>
          {(["preview", "buddy", "source"] as const).map((view) => <button key={view} type="button" onClick={() => {
            const target = document.getElementById(view === "preview" ? "resume-preview" : view === "source" ? "resume-source-panel" : "resume-buddy");
            target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: "start" });
          }}>{t(`resume.view.${view}`)}</button>)}
        </nav>
        <div className={styles.columns}>
          <div className={styles.editor}>
            <div className={styles.previewPane}><ResumePreview source={source} /></div>
            <section id="resume-source-panel" tabIndex={-1} className={styles.sourcePane} aria-label={t("resume.source")}>
            <div className={styles.sectionHead}><label htmlFor="resume-source">{t("resume.source")}</label>
              <span role="status">{t(saving ? "resume.saving" : dirty ? "resume.dirty" : saved.updatedAt ? "resume.saved" : "resume.initial")}</span></div>
            <div className={styles.codeEditor}>
              <div ref={gutter} className={styles.gutter} aria-hidden="true"><pre>{lineNumbers}</pre></div>
              <textarea ref={editor} id="resume-source" value={source} onChange={(event) => editSource(event.target.value)}
                onScroll={(event) => { if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop; }}
                wrap="off" placeholder={t("resume.empty")} spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-describedby="resume-compile" />
            </div>
            <div className={styles.actions}>
              {!source && <button type="button" onClick={() => editSource(RESUME_TEMPLATE)}>{t("resume.template")}</button>}
              {undo && <button type="button" disabled={source !== undo.after} onClick={() => {
                if (sourceRef.current !== undo.after) return;
                editSource(undo.before); setUndo(null);
                setProposal((current) => current?.state === "applied" && current.source === undo.after ? { ...current, state: "undone" } : current);
                editor.current?.focus();
              }}>{t("resume.undo")}</button>}
            </div>
            <p id="resume-compile" className={styles.hint}>{t("resume.compile")}</p>
            </section>
          </div>
          <aside id="resume-buddy" tabIndex={-1} className={styles.assistantColumn} aria-labelledby="resume-agent-title">
          <section className={styles.agent}>
            <div className={styles.chatSurface}>
            <div className={styles.chatHeader}><h2 id="resume-agent-title">Agent Buddy</h2><span>{t("resume.currentDraft")}</span></div>
            <div ref={conversationView} className={styles.conversation} role="log" aria-label={t("resume.agent")} aria-live="polite">
              {conversation.length === 0 && <p className={styles.hint}>{t("resume.buddyWelcome")}</p>}
              {conversation.map((turn, i) => <article key={i} data-role={turn.role}><strong>{t(turn.role === "user" ? "resume.you" : "resume.agent")}</strong><p>{turn.text}</p>{i === conversation.length - 1 && turn.result && <small>{t(`resume.result.${turn.result}`)}</small>}</article>)}
              {generating && !convertingPdf && <p role="status">{t("resume.generating")}</p>}
            </div>
            <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void generate(); }}>
              <label className={styles.srOnly} htmlFor="resume-instruction">{t("resume.instruction")}</label>
              <textarea id="resume-instruction" rows={2} value={instruction} maxLength={8000} disabled={generating}
                placeholder={t("resume.instructionHint")} onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
              <details className={styles.agentOptions}>
                <summary>{t("resume.context")}{useProfile && hasProfile && " · CV"}{jobDescription.trim() && " · JD"}</summary>
                <label className={styles.check}><input type="checkbox" checked={useProfile} disabled={!hasProfile || generating}
                  onChange={(event) => setUseProfile(event.target.checked)} />{t("resume.useProfile")}</label>
                {!hasProfile && <p className={styles.hint}>{t("resume.noProfile")}</p>}
                <label htmlFor="resume-jd">{t("resume.jd")}</label>
                <textarea id="resume-jd" rows={6} value={jobDescription} maxLength={30000} disabled={generating}
                  placeholder={t("resume.jdHint")} onChange={(event) => setJobDescription(event.target.value)} />
              </details>
              <div className={styles.composerActions}>
                {generating ? <button type="button" aria-label={t("resume.cancel")} title={t("resume.cancel")} onClick={stopGeneration}><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" /></svg></button>
                  : <button type="button" className="ui-action--primary" aria-label={t("resume.generate")} title={t("resume.generate")}
                    disabled={!instruction.trim() || oversized || (!source.trim() && !useProfile)} onClick={() => void generate()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 7-7 7 7M12 5v14" /></svg></button>}
              </div>
            </form>
            {agentError && <p role="alert" className={styles.error}>{agentError}</p>}
            </div>
            <details className={styles.boundary}><summary>{t("resume.privacy")}</summary><p className={styles.hint}>{t("resume.boundary")}</p></details>
            {proposal && <section ref={proposalView} tabIndex={-1} className={styles.proposal} aria-label={t("resume.proposal")}>
              <h3>{t("resume.proposal")}</h3>
              {proposal.imported && <><p className={styles.hint}>{t("resume.pdfImported", { name: proposal.imported.name, pages: proposal.imported.pages })}</p>
                <p className={styles.hint}>{t("resume.pdfAccuracy")}</p>
                <details className={styles.diff}><summary>{t("resume.pdfExtracted")}</summary><pre tabIndex={0}>{proposal.imported.text}</pre></details></>}
              <p className={styles.summary}>{proposal.summary}</p>
              {proposal.questions.length > 0 && <><h4>{t("resume.questions")}</h4><ul>{proposal.questions.map((question, i) => <li key={i}>{question}</li>)}</ul></>}
              {proposal.state === "conflict" && <p role="status" className={styles.error}>{t("resume.stale")}</p>}
              {proposal.state === "undone" && <p role="status">{t("resume.undone")}</p>}
              {proposal.state === "applied" && source !== proposal.source && <p className={styles.hint}>{t("resume.editedAfter")}</p>}
              {proposal.source !== null && proposal.source !== proposal.before ? <>
                <SourceDiff before={proposal.before} after={proposal.source}
                  onJump={proposal.state === "applied" && source === proposal.source ? jumpToLine : undefined} />
                <p className={styles.hint}>{t("resume.checkFacts")}</p>
              </> : <p>{t("resume.noChange")}</p>}
              <div className={styles.actions}>
                <button type="button" onClick={() => setProposal(null)}>{t("resume.discard")}</button>
              </div>
              <a href={`/?session=${encodeURIComponent(proposal.sessionId)}`} target="_blank" rel="noopener noreferrer">{t("resume.record")}</a>
            </section>}
          </section>
          </aside>
        </div>
      </>}
    </div>
  </div>;
}
