"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { MAX_RECORDING_BYTES, RECORDING_EXTENSIONS, recordingTime, type Recording, type RecordingConfig } from "@/extension/robin/recordings";
import { useAudioRecorder } from "./useAudioRecorder";
import styles from "./RecordingsWorkspace.module.css";

const API = "/api/robin/recordings";
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body as T;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
function download(text: string, title: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${title.replace(/[\\/:*?"<>|]/g, "_") || "transcript"}.txt`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RecordingsWorkspace() {
  const { t, locale } = useI18n();
  const recorder = useAudioRecorder();
  const [records, setRecords] = useState<Recording[]>([]);
  const [selected, setSelected] = useState<Recording | null>(null);
  const [config, setConfig] = useState<RecordingConfig | null>(null);
  const configured = config?.ready === true;
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [upload, setUpload] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [feedbackScope, setFeedbackScope] = useState<"page" | "capture" | "transcribe" | "editor">("page");
  const [loaded, setLoaded] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const stopAfterChunk = useRef(false);
  const running = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const configPanel = useRef<HTMLDetailsElement>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  function showEditor() {
    // Only explicit selection/save moves the viewport; segment completion never does.
    requestAnimationFrame(() => {
      editorHeading.current?.focus({ preventScroll: true });
      editorHeading.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  }
  const file = upload ?? recorder.file;
  const activeMic = ["requesting", "recording", "paused", "stopping"].includes(recorder.phase);
  const dirty = !!selected && (title !== selected.title || text !== selected.text);
  const complete = !!selected && selected.parts.length === selected.chunks;
  const select = useCallback((record: Recording | null) => {
    setSelected(record); setTitle(record?.title ?? ""); setText(record?.text ?? "");
  }, []);
  const put = (record: Recording) => {
    setRecords((previous) => [record, ...previous.filter((item) => item.id !== record.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    select(record);
  };

  useEffect(() => {
    let live = true;
    void request<{ recordings: Recording[]; config: RecordingConfig }>(API).then((body) => {
      if (!live) return;
      setRecords(body.recordings); setConfig(body.config); select(body.recordings[0] ?? null);
    }).catch((err) => { if (live) setError(String(err.message)); }).finally(() => { if (live) setLoaded(true); });
    return () => { live = false; stopAfterChunk.current = true; };
  }, [select]);
  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!dirty && !busy && !activeMic && !file) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, busy, activeMic, file]);
  const canLeaveText = () => !dirty || window.confirm(t("recordings.unsavedConfirm"));
  async function act(label: string, action: () => Promise<void>, scope: typeof feedbackScope = "editor") {
    if (running.current) return;
    running.current = true; setBusy(label); setError(""); setNotice(""); setFeedbackScope(scope);
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : t("recordings.error")); }
    finally { running.current = false; setBusy(""); }
  }
  async function refresh() {
    if (!canLeaveText()) return;
    const setupFocused = configPanel.current?.contains(document.activeElement);
    await act(t("recordings.loading"), async () => {
      const body = await request<{ recordings: Recording[]; config: RecordingConfig }>(API);
      setRecords(body.recordings); setConfig(body.config); setLoaded(true);
      select(body.recordings.find((item) => item.id === selected?.id) ?? body.recordings[0] ?? null);
      if (setupFocused && body.config.ready) requestAnimationFrame(() => configPanel.current?.querySelector("summary")?.focus());
    }, "page");
  }
  async function saveAudio() {
    if (!file || !canLeaveText()) return;
    await act(t("recordings.uploading"), async () => {
      const form = new FormData(); form.append("file", file);
      form.append("title", newTitle.trim() || t("recordings.defaultName", { date: new Date().toLocaleString(locale) }));
      const body = await request<{ recording: Recording }>(API, { method: "POST", body: form });
      put(body.recording); setUpload(null); setNewTitle("");
      if (fileInput.current) fileInput.current.value = "";
      if (recorder.file) await recorder.discard();
      setNotice(t("recordings.saved")); setFeedbackScope("transcribe"); showEditor();
    }, "capture");
  }
  async function transcribe() {
    if (!selected || !configured) return;
    await act(t("recordings.loading"), async () => {
      setTranscribing(true); stopAfterChunk.current = false; setStopping(false);
      let current = selected;
      try {
        // Read fresh progress first: another tab or a lost response may have finished a segment.
        current = (await request<{ recording: Recording }>(`${API}/${current.id}`)).recording;
        put(current);
        while (current.parts.length < current.chunks && !stopAfterChunk.current) {
          setBusy(t("recordings.transcribing", { segment: current.parts.length + 1, total: current.chunks }));
          current = (await request<{ recording: Recording }>(`${API}/${current.id}`, json("POST", {}))).recording;
          put(current);
        }
        setNotice(t(current.parts.length === current.chunks ? "recordings.finished" : "recordings.progressSaved"));
      } finally { setTranscribing(false); setStopping(false); }
    }, "transcribe");
  }

  const feedback = <div className={styles.feedback}>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <p role="status" aria-atomic="true" className={busy ? styles.working : styles.success}>
      {busy ? (transcribing && stopping ? t("recordings.stopping") : busy) : notice}
    </p>
  </div>;

  return (
    <div className={`robin-page robin-dashboard ${styles.page}`}>
      <main className={styles.main}>
        <header className={styles.heading}>
          <div className={styles.actions}><a href="/tools">← {t("toolbox.back")}</a></div>
          <span className="pi-eyebrow">{t("recordings.eyebrow")}</span>
          <h1>{t("recordings.title")}</h1>
          <p>{t("recordings.intro")}</p>
        </header>
        {feedbackScope === "page" && feedback}
        <section className={styles.card} aria-labelledby="record-capture">
          <h2 id="record-capture" className="pi-section-title">{t("recordings.capture")}</h2>
          <p className={styles.hint}>{t("recordings.limits")}</p>
          <label className={styles.field}>{t("recordings.name")}<input value={newTitle} maxLength={200} disabled={!!busy} onChange={(e) => setNewTitle(e.target.value)} /></label>
          {activeMic && <div className={styles.micStatus} data-phase={recorder.phase}>
            <span className={styles.recordDot} aria-hidden="true" />
            <span role="status">{t(recorder.phase === "requesting" ? "recordings.requestingMic" : recorder.phase === "stopping" ? "recordings.finishingAudio" : recorder.phase === "paused" ? "recordings.micPaused" : "recordings.micLive")}</span>
            {recorder.phase !== "requesting" && <span className={styles.timer} aria-label={t("recordings.elapsed")}>{recordingTime(recorder.seconds)}</span>}
          </div>}
          <div className={styles.actions}>
            {activeMic ? <>
              <button type="button" className={styles.danger} onClick={recorder.stop} disabled={!["recording", "paused"].includes(recorder.phase)}>{t("recordings.stop")}</button>
              <button type="button" onClick={recorder.pause} disabled={!["recording", "paused"].includes(recorder.phase)}>{t(recorder.phase === "paused" ? "recordings.resume" : "recordings.pause")}</button>
            </> : <>
              <button type="button" className="pi-bracket" aria-label={t("recordings.start")} onClick={() => void recorder.start()} disabled={!!busy || !!file || !["idle", "ready"].includes(recorder.phase)}>{t("recordings.start")}</button>
              <label className={styles.field}>{t("recordings.upload")}<input ref={fileInput} type="file" accept={RECORDING_EXTENSIONS.map((ext) => `.${ext}`).join(",")} disabled={!!busy || !!recorder.file || recorder.phase === "loading"} onChange={(event) => {
                const next = event.target.files?.[0]; if (!next) return;
                if (!next.size || next.size > MAX_RECORDING_BYTES || !RECORDING_EXTENSIONS.includes(next.name.split(".").at(-1)?.toLowerCase() ?? "")) {
                  setFeedbackScope("capture"); setNotice(""); setError(t("recordings.invalidFile")); event.target.value = ""; return;
                }
                setUpload(next); setNewTitle(next.name.replace(/\.[^.]+$/, "").slice(0, 200)); setError("");
              }} /></label>
            </>}
          </div>
          <p className={styles.hint}>{t("recordings.recordHint")}</p>
          {feedbackScope === "capture" && feedback}
          {recorder.issue && <p role="alert" className={styles.error}>{t(`recordings.${recorder.issue}`)}</p>}
          {file && <div className={styles.draft}>
            <div className={styles.draftHeading}><strong>{file.name}</strong><span className={styles.hint}>{(file.size / 1024 / 1024).toFixed(1)} MB</span></div>
            <p className={styles.hint}>{t("recordings.localDraft")}</p>
            <audio controls src={preview || undefined} aria-label={t("recordings.capture")} />
            <div className={styles.actions}>
              <button type="button" className="pi-bracket" aria-label={t("recordings.saveAudio")} disabled={!!busy} onClick={() => void saveAudio()}>{t("recordings.saveAudio")}</button>
              <a href={preview} download={file.name}>{t("recordings.downloadAudio")}</a>
              <button type="button" disabled={!!busy} onClick={() => {
                if (!window.confirm(t("recordings.discardConfirm"))) return;
                void act(t("recordings.saving"), async () => {
                  if (recorder.file) await recorder.discard();
                  setUpload(null); if (fileInput.current) fileInput.current.value = "";
                }, "capture");
              }}>{t("recordings.discard")}</button>
            </div>
          </div>}
        </section>
        {config && <details ref={configPanel} id="recording-local-setup" tabIndex={-1} open={!configured} className={styles.setup}>
          <summary><span className="pi-section-title">{t("recordings.localTitle")}</span><span className={configured ? styles.success : styles.hint}>{t(configured ? "recordings.readyBadge" : "recordings.setupBadge")}</span></summary>
          <div className={styles.setupBody}>
            <p className={styles.hint}>{t("recordings.privacy")}</p>
            <p className={styles.hint}>{t("recordings.localHint", { model: config.model })}</p>
            {configured ? <p>{t("recordings.localReady")}</p> : <>
              <p>{t(config.reason === "missing-engine" ? "recordings.missingEngine" : "recordings.missingModel")}</p>
              <code className={styles.hint}>node --experimental-strip-types scripts/setup-local-transcription.ts</code>
              <div className={styles.actions}><button type="button" disabled={!!busy} onClick={() => void refresh()}>{t("recordings.checkLocal")}</button></div>
            </>}
          </div>
        </details>}
        <div className={styles.workspace}>
          <section className={styles.library} aria-labelledby="record-library">
            <div className={styles.actions}><h2 id="record-library" className="pi-section-title">{t("recordings.library")}</h2><button type="button" disabled={!!busy} onClick={() => void refresh()}>{t("recordings.refresh")}</button></div>
            {!loaded ? <p>{t("recordings.loading")}</p> : !records.length && <p className={styles.hint}>{t("recordings.empty")}</p>}
            {records.map((record) => <button type="button" key={record.id} className={styles.entry} aria-pressed={record.id === selected?.id} disabled={!!busy} onClick={() => { if (canLeaveText()) { select(record); setError(""); setNotice(""); if (window.matchMedia("(max-width: 720px)").matches) showEditor(); } }}>
              <strong>{record.title}</strong>
              <span>{new Date(record.createdAt).toLocaleDateString(locale)} · {recordingTime(record.seconds)}</span>
              <span>{t("recordings.progress", { done: record.parts.length, total: record.chunks })}</span>
            </button>)}
          </section>
          {selected && <section className={`${styles.card} ${styles.editor}`} aria-labelledby="record-transcript">
            <div className={styles.editorHeading}>
              <h2 ref={editorHeading} tabIndex={-1} id="record-transcript" className="pi-section-title">{t("recordings.transcript")}</h2>
              <span id="recording-edit-state" className={dirty ? styles.unsaved : styles.hint}>{t(dirty ? "recordings.unsaved" : complete ? "recordings.editable" : "recordings.readOnly")}</span>
            </div>
            <label className={styles.field}>{t("recordings.name")}<input value={title} maxLength={200} disabled={!!busy || !complete} onChange={(e) => setTitle(e.target.value)} /></label>
            <audio key={selected.id} controls preload="metadata" src={`${API}/${selected.id}?audio=1`} aria-label={selected.title} />
            <div className={styles.actions}>
              <a href={`${API}/${selected.id}?audio=1`} download={`${selected.title}.${selected.fileName.split(".").at(-1)}`}>{t("recordings.downloadAudio")}</a>
              {!complete && <button type="button" className="pi-bracket" aria-label={t("recordings.transcribe")} aria-describedby={!configured ? "recording-setup-needed" : undefined} disabled={!!busy || !configured} onClick={() => void transcribe()}>{t("recordings.transcribe")}</button>}
              {transcribing && <button type="button" disabled={stopping} onClick={() => { stopAfterChunk.current = true; setStopping(true); }}>{t(stopping ? "recordings.stopping" : "recordings.stopAfterChunk")}</button>}
            </div>
            {!complete && !configured && <div>
              <p id="recording-setup-needed" className={styles.hint}>{t("recordings.setupNeeded")}</p>
              <button type="button" disabled={!!busy || !config} aria-controls="recording-local-setup" onClick={() => {
                const panel = configPanel.current;
                if (!panel) return;
                panel.open = true;
                panel.focus({ preventScroll: true });
                panel.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
              }}>{t("recordings.openSettings")}</button>
            </div>}
            <div className={styles.progressBlock}>
              <div className={styles.progressTrack} role="progressbar" aria-label={t("recordings.transcript")} aria-valuemin={0} aria-valuemax={selected.chunks} aria-valuenow={selected.parts.length} aria-valuetext={t("recordings.progress", { done: selected.parts.length, total: selected.chunks })}>
                <span key={selected.id} style={{ transform: `scaleX(${selected.chunks ? selected.parts.length / selected.chunks : 0})` }} />
              </div>
              <p className={styles.hint}>{t("recordings.progress", { done: selected.parts.length, total: selected.chunks })}{!complete && ` · ${t(selected.parts.length ? "recordings.partial" : "recordings.notStarted")}`}</p>
            </div>
            {feedbackScope === "transcribe" && feedback}
            {transcribing && <p className={styles.hint}>{t("recordings.processingHint")}</p>}
            {complete && !text && <p className={styles.hint}>{t("recordings.noSpeech")}</p>}
            <label className={styles.field}>{t("recordings.transcript")}<textarea rows={16} value={text} aria-describedby="recording-edit-state" readOnly={!complete || !!busy} onChange={(e) => setText(e.target.value)} /></label>
            {feedbackScope === "editor" && feedback}
            <div className={styles.actions}>
              <button type="button" disabled={!!busy || !dirty || !complete || !title.trim()} onClick={() => void act(t("recordings.saving"), async () => {
                put((await request<{ recording: Recording }>(`${API}/${selected.id}`, json("PATCH", { revision: selected.revision, title, text }))).recording); setNotice(t("recordings.saved"));
              })}>{t("recordings.saveText")}</button>
              <button type="button" disabled={!text || !!busy} onClick={() => void act(t("recordings.copying"), async () => { await navigator.clipboard.writeText(text); setNotice(t("recordings.copied")); })}>{t("recordings.copy")}</button>
              <button type="button" disabled={!text} onClick={() => download(text, title)}>{t("recordings.export")}</button>
              <button type="button" className={styles.danger} disabled={!!busy} onClick={() => {
                if (!window.confirm(t("recordings.deleteConfirm"))) return;
                void act(t("recordings.saving"), async () => {
                  await request(`${API}/${selected.id}`, json("DELETE", { revision: selected.revision }));
                  const remaining = records.filter((item) => item.id !== selected.id); setRecords(remaining); select(remaining[0] ?? null);
                  setNotice(t("recordings.deleted")); setFeedbackScope("page");
                });
              }}>{t("recordings.delete")}</button>
            </div>
          </section>}
        </div>
      </main>
    </div>
  );
}
