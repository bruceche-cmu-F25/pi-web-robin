"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { MAX_RESUME_BYTES, MAX_RESUME_PDF_BYTES, RESUME_TEMPLATE, parseResumeProposal, type ResumeDocument, type ResumeProposal, type ResumePdfImport } from "@/extension/robin/resume";
import { clearTextRecovery, newRecoveryId, saveTextRecovery, type RecoveryReceipt } from "@/lib/text-recovery";
import { TextRecoveryNotice, TextRecoveryWarning } from "./TextRecoveryNotice";
import { resumeChanges, resumeLineRange } from "./resume-changes";
import { ResumePreview } from "./ResumePreview";
import styles from "./ResumeWorkspace.module.css";

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
  const [saved, setSaved] = useState<ResumeDocument | null>(null);
  const [source, setSource] = useState("");
  const sourceRef = useRef("");
  const [hasProfile, setHasProfile] = useState(false);
  const [useProfile, setUseProfile] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [generating, setGenerating] = useState(false);
  const [convertingPdf, setConvertingPdf] = useState("");
  const generation = useRef<AbortController | null>(null);
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
  const [backupFailed, setBackupFailed] = useState(false);
  const dirty = saved !== null && source !== saved.source;
  const oversized = new TextEncoder().encode(source).length > MAX_RESUME_BYTES;

  useEffect(() => {
    const controller = new AbortController();
    setLoadError("");
    void request({ signal: controller.signal }).then((body) => {
      const doc = savedDocument(body.document);
      if (controller.signal.aborted) return;
      setSaved(doc); setSource(doc.source); sourceRef.current = doc.source;
      setHasProfile(body.hasProfile === true); setUseProfile(body.hasProfile === true);
    }).catch((error) => { if (!controller.signal.aborted) setLoadError(String(error.message)); });
    return () => controller.abort();
  }, [loadAttempt]);
  useEffect(() => () => generation.current?.abort(), []);
  useEffect(() => {
    // Announce a requested result, but never steal focus while the user is typing.
    if (!proposal || document.activeElement?.tagName === "TEXTAREA") return;
    proposalView.current?.focus({ preventScroll: true });
    proposalView.current?.scrollIntoView({ block: "start" });
  }, [proposal]);
  useEffect(() => {
    if (!dirty && !saving && !generating) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, saving, generating]);

  function editSource(value: string): boolean {
    const next = saveTextRecovery("resume", "main", `${writer}:source`, { source: value }, receipt.current);
    if (next) receipt.current = next;
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
        body: JSON.stringify({ source: snapshot, revision: saved.revision }) });
      const doc = savedDocument(body.document);
      if (doc.source !== snapshot) throw new Error("Save did not acknowledge the submitted source");
      setSaved(doc); setServerVersion(null);
      clearTextRecovery(recovery);
      if (receipt.current === recovery) {
        receipt.current = undefined;
        if (sourceRef.current === snapshot) setBackupFailed(false);
      }
    } catch (error) { setError(error instanceof Error ? error.message : t("resume.error")); }
    finally { saveLock.current = false; setSaving(false); }
  }
  async function generate(pdf?: File) {
    if (!saved || generation.current || (!pdf && (!instruction.trim() || oversized))) return;
    if (pdf && ((!/\.pdf$/i.test(pdf.name) && pdf.type !== "application/pdf") || !pdf.size || pdf.size > MAX_RESUME_PDF_BYTES)) {
      setError(t("resume.pdfInvalid")); return;
    }
    const controller = new AbortController(); generation.current = controller;
    const before = sourceRef.current;
    setGenerating(true); setConvertingPdf(pdf?.name ?? ""); setError(""); setNotice("");
    try {
      const upload = new FormData();
      if (pdf) { upload.set("file", pdf); upload.set("locale", locale); }
      const body = pdf
        ? await request({ method: "POST", body: upload, signal: controller.signal }, `${API}/import`)
        : await request({ method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ source: before, instruction, jobDescription, useProfile, locale }) });
      if (controller.signal.aborted) return;
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
      setProposal({ ...revision, before, state, sessionId: body.sessionId, ...(pdf ? { imported: body.imported } : {}) });
    } catch (error) {
      if (controller.signal.aborted) setNotice("resume.cancelled");
      else setError(error instanceof Error ? error.message : t("resume.error"));
    } finally { generation.current = null; setGenerating(false); setConvertingPdf(""); }
  }
  function jumpToLine(line: number) {
    const textarea = editor.current;
    if (!textarea) return;
    const range = resumeLineRange(textarea.value, line);
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(range.start, range.end);
    textarea.scrollIntoView({ block: "center" });
    textarea.scrollTop = Math.max(0, (range.line - 1) * parseFloat(getComputedStyle(textarea).lineHeight) - textarea.clientHeight / 3);
    textarea.scrollLeft = 0;
    if (gutter.current) gutter.current.scrollTop = textarea.scrollTop;
  }
  async function compareSaved() {
    if (compareLock.current || saveLock.current) return;
    compareLock.current = true; setComparing(true);
    try { setServerVersion(savedDocument((await request()).document)); }
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
          <button type="button" disabled={!saved || generating} onClick={() => pdfFile.current?.click()}>{t("resume.pdfUpload")}</button>
          <button type="button" disabled={!saved} onClick={() => file.current?.click()}>{t("resume.import")}</button>
          <button type="button" disabled={!saved || !source} onClick={download}>{t("resume.download")}</button>
          <button type="button" disabled={!saved} onClick={() => {
            const preview = document.getElementById("resume-preview"); preview?.focus({ preventScroll: true }); preview?.scrollIntoView({ block: "start" });
          }}>{t("resume.preview.title")}</button>
          <button type="button" className="ui-action--primary" disabled={!saved || !dirty || saving || oversized || comparing} onClick={() => void save()}>{t(saving ? "resume.saving" : "resume.save")}</button>
        </div>
        <input ref={pdfFile} type="file" accept=".pdf,application/pdf" hidden onChange={(event) => {
          const selected = event.target.files?.[0]; event.target.value = ""; if (selected) void generate(selected);
        }} />
        <input ref={file} type="file" accept=".tex,text/plain,application/x-tex" hidden onChange={(event) => {
          const selected = event.target.files?.[0]; event.target.value = ""; if (selected) void importFile(selected);
        }} />
      </header>
      <p className={styles.hint}>{t("resume.pdfHint")}</p>
      {convertingPdf && <div className={styles.importStatus} role="status"><span>{t("resume.pdfConverting", { name: convertingPdf })}</span>
        <button type="button" onClick={() => generation.current?.abort()}>{t("resume.cancel")}</button></div>}
      {!saved ? <section role={loadError ? "alert" : "status"}>
        <p>{t(loadError ? "resume.loadError" : "resume.loading")}</p>
        {loadError && <><p>{loadError}</p><button type="button" onClick={() => setLoadAttempt((n) => n + 1)}>{t("resume.retry")}</button></>}
      </section> : <>
        <TextRecoveryNotice scope="resume" id="main" writer={writer} disabled={saving}
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
        <div className={styles.columns}>
          <section className={styles.editor}>
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
          <div className={styles.assistantColumn}>
          <ResumePreview source={source} />
          <section className={styles.agent} aria-labelledby="resume-agent-title">
            <h2 id="resume-agent-title">{t("resume.agent")}</h2><p className={styles.hint}>{t("resume.agentHint")}</p>
            <form onSubmit={(event) => { event.preventDefault(); void generate(); }}>
              <label htmlFor="resume-instruction">{t("resume.instruction")}</label>
              <textarea id="resume-instruction" rows={4} value={instruction} maxLength={8000} disabled={generating}
                placeholder={t("resume.instructionHint")} onChange={(event) => setInstruction(event.target.value)} />
              <label className={styles.check}><input type="checkbox" checked={useProfile} disabled={!hasProfile || generating}
                onChange={(event) => setUseProfile(event.target.checked)} />{t("resume.useProfile")}</label>
              {!hasProfile && <p className={styles.hint}>{t("resume.noProfile")}</p>}
              <details><summary>{t("resume.jd")}</summary>
                <textarea aria-label={t("resume.jd")} rows={6} value={jobDescription} maxLength={30000} disabled={generating}
                  placeholder={t("resume.jdHint")} onChange={(event) => setJobDescription(event.target.value)} />
              </details>
              <div className={styles.actions}>
                <button type="submit" className="ui-action--primary" disabled={generating || !instruction.trim() || oversized || (!source.trim() && !useProfile)}>{t(generating ? "resume.generating" : "resume.generate")}</button>
                {generating && <button type="button" onClick={() => generation.current?.abort()}>{t("resume.cancel")}</button>}
              </div>
            </form>
            <p className={styles.hint}>{t("resume.boundary")}</p>
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
          </div>
        </div>
      </>}
    </div>
  </div>;
}
