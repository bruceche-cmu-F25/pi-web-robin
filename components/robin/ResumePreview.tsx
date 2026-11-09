"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_RESUME_BYTES } from "@/extension/robin/resume";
import { useI18n } from "@/hooks/useI18n";
import styles from "./ResumeWorkspace.module.css";

type Preview = { source: string; pages: string[]; pdfUrl: string; diagnostics: string };

/** The current editor snapshot, never the last saved document. PDF bytes only live in this tab. */
export function ResumePreview({ source }: { source: string }) {
  const { t } = useI18n();
  const [automatic, setAutomatic] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const manualAttempt = useRef(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [phase, setPhase] = useState("empty");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [imageError, setImageError] = useState(false);
  const pdfUrl = useRef("");
  const current = preview?.source === source;
  const oversized = new TextEncoder().encode(source).length > MAX_RESUME_BYTES;
  useEffect(() => () => { if (pdfUrl.current) URL.revokeObjectURL(pdfUrl.current); }, []);
  useEffect(() => {
    const manual = attempt !== manualAttempt.current;
    manualAttempt.current = attempt;
    setError("");
    if (!source.trim() || oversized) { setPhase(oversized ? "oversized" : "empty"); return; }
    if (!automatic && !manual) { setPhase("paused"); return; }
    const controller = new AbortController();
    setPhase("waiting");
    const timer = window.setTimeout(async () => {
      setPhase("compiling");
      try {
        const response = await fetch("/api/robin/resume/preview", {
          method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
          body: JSON.stringify({ source }), signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
        if (!Array.isArray(body.pages) || body.pages.length < 1 || body.pages.length > 5
          || !body.pages.every((image: unknown) => typeof image === "string" && image.startsWith("data:image/jpeg;base64,"))
          || typeof body.pdf !== "string" || body.pdf.length > 12_000_000 || typeof body.diagnostics !== "string") throw new Error("Invalid preview response");
        if (controller.signal.aborted) return;
        const bytes = Uint8Array.from(atob(body.pdf), char => char.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        if (pdfUrl.current) URL.revokeObjectURL(pdfUrl.current);
        pdfUrl.current = url;
        setPreview({ source, pages: body.pages, pdfUrl: url, diagnostics: body.diagnostics });
        setPage(value => Math.min(value, body.pages.length)); setImageError(false); setPhase("ready");
      } catch (error) {
        if (!controller.signal.aborted) { setPhase("failed"); setError(error instanceof Error ? error.message : "Preview failed"); }
      }
    }, manual ? 0 : 900);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [source, oversized, automatic, attempt]);

  const compiling = phase === "compiling";
  const hasWarnings = Boolean(preview && /warning:|Missing character:|Overfull|Underfull/i.test(preview.diagnostics));
  // Source can change a render before the effect resets its phase; never label old pixels current.
  const visiblePhase = phase === "ready" && !current ? (automatic ? "waiting" : "paused") : phase;
  return <section id="resume-preview" tabIndex={-1} className={styles.preview} aria-labelledby="resume-preview-title">
    <div className={styles.sectionHead}><h2 id="resume-preview-title">{t("resume.preview.title")}</h2>
      <label className={styles.check}><input type="checkbox" checked={automatic} onChange={event => setAutomatic(event.target.checked)} />{t("resume.preview.auto")}</label>
    </div>
    <div className={styles.actions}>
      <button type="button" disabled={!source.trim() || oversized || compiling} onClick={() => setAttempt(value => value + 1)}>{t("resume.preview.refresh")}</button>
      <button type="button" disabled={!preview || !current || imageError} onClick={() => {
        if (!preview || !current) return;
        const anchor = document.createElement("a"); anchor.href = preview.pdfUrl; anchor.download = "resume.pdf";
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
      }}>{t("resume.preview.download")}</button>
    </div>
    {!error && <p role="status" aria-atomic="true" className={styles.hint}>{t(`resume.preview.${visiblePhase}`)}</p>}
    {current && hasWarnings && <p className={styles.previewStale}>{t("resume.preview.warnings")}</p>}
    {preview && !current && <p className={styles.previewStale} role="status">{t("resume.preview.stale")}</p>}
    {error && <div role="alert" className={styles.error}><p>{t("resume.preview.failed")}</p><pre className={styles.compileLog}>{error}</pre></div>}
    {!preview && source.trim() && <div className={styles.previewPaper} aria-hidden="true" />}
    {preview && <>
      <div className={styles.actions}>
        <button type="button" disabled={page <= 1} onClick={() => { setPage(value => value - 1); setImageError(false); }}>{t("resume.preview.previous")}</button>
        <span className={styles.pageCount}>{t("resume.preview.page", { page, total: preview.pages.length })}</span>
        <button type="button" disabled={page >= preview.pages.length} onClick={() => { setPage(value => value + 1); setImageError(false); }}>{t("resume.preview.next")}</button>
        <select aria-label={t("resume.preview.zoom")} value={zoom} onChange={event => setZoom(Number(event.target.value))}>
          {[100, 150, 200].map(value => <option key={value} value={value}>{value === 100 ? t("resume.preview.fit") : `${value}%`}</option>)}
        </select>
      </div>
      {imageError && <p role="alert" className={styles.error}>{t("resume.preview.imageFailed")}</p>}
      <div className={styles.previewPaper} tabIndex={0} aria-label={t("resume.preview.title")} aria-busy={compiling}>
        {/* Rasterized PDF pages also work on iOS; embedded PDF actions/scripts never execute. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview.pages[page - 1]} alt={t("resume.preview.page", { page, total: preview.pages.length })}
          style={{ width: `${zoom}%` }} onError={() => setImageError(true)} />
      </div>
      {preview.diagnostics && <details className={styles.diff}><summary>{t("resume.preview.log")}{!current && ` · ${t("resume.preview.previousLog")}`}</summary><pre>{preview.diagnostics}</pre></details>}
    </>}
    <details className={styles.previewHelp}><summary>{t("resume.preview.about")}</summary><p className={styles.hint}>{t("resume.preview.hint")}</p></details>
  </section>;
}
