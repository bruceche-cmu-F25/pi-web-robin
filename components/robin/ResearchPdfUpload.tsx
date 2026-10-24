"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { Paper } from "@/extension/robin/papers-domain";
import s from "./ResearchWorkspace.module.css";

type Uploaded = { paper: Paper; started: boolean };
export type ResearchPdfUploadHandler = (file: File, signal: AbortSignal) => Promise<Uploaded | null>;
/** Lives in the composer and survives the accepted turn selecting its paper conversation. */
export function ResearchPdfUpload({ onUpload, onOpen, onBusyChange }: {
  onUpload: ResearchPdfUploadHandler;
  onOpen: (id: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const operation = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Uploaded | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  async function upload(file: File) {
    if (operation.current) return;
    setError("");
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { setError(t("rw.upload.invalid")); return; }
    if (!file.size || file.size > 20 * 1024 * 1024) { setError(t("rw.upload.size")); return; }
    const controller = new AbortController(); operation.current = controller;
    setFilename(file.name); setBusy(true); setSaved(null);
    try {
      const result = await onUpload(file, controller.signal);
      if (!controller.signal.aborted) setSaved(result);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("rw.error"));
    } finally {
      if (operation.current === controller) operation.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return <section className={s.pdfUpload} aria-label={t("rw.upload.read")} aria-busy={busy}>
    <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (file) void upload(file);
    }} />
    <div className={s.pdfUploadRow}>
      <button type="button" className={s.button} disabled={busy} title={t("rw.upload.hint")} onClick={() => input.current?.click()}>
        {t(busy ? "rw.upload.processing" : "rw.upload.read")}
      </button>
      <span className={s.uploadLimit}>{t("rw.chat.pdfLimit")}</span>
    </div>
    <div aria-live="polite">
      {busy && <div className={s.attachmentStatus}><span className={s.fileMark} aria-hidden="true">PDF</span><div><strong>{filename}</strong><span>{t("rw.chat.extracting")}</span></div></div>}
      {saved && <div className={s.attachmentStatus} data-state={saved.started ? "sent" : "waiting"}>
        <span className={s.fileMark} aria-hidden="true">PDF</span>
        <div><button type="button" className={s.textButton} onClick={() => { setSaved(null); onOpen(saved.paper.id); }}>{t("rw.upload.open", { title: saved.paper.title })} →</button>
          <span>{t(saved.started ? "rw.upload.started" : "rw.upload.saved")}</span>
        </div>
      </div>}
    </div>
    {error && <p className={s.error} role="alert">{error}</p>}
  </section>;
}
