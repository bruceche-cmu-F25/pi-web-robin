"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { formatClock, formatLength, watchUrl } from "@/extension/robin/podcasts";
import { VIDEO_SUMMARY_EXAMPLE, VIDEO_SUMMARY_STAGES, videoIdFromUrl, videoSummaryMarkdown, type VideoSummaryEvent, type VideoSummaryResult, type VideoSummaryStage } from "@/extension/robin/video-summary";
import { usePolledResource } from "./usePolledResource";
import styles from "./VideoSummaryWorkspace.module.css";

const API = "/api/robin/video-summary";
export function VideoSummaryWorkspace() {
  const { t, locale } = useI18n();
  const language = locale.startsWith("zh") ? "zh" : "en";
  const history = usePolledResource<{ results: VideoSummaryResult[] }>(API);
  const [url, setUrl] = useState(VIDEO_SUMMARY_EXAMPLE);
  const [result, setResult] = useState<VideoSummaryResult | null>(null);
  const [stage, setStage] = useState<VideoSummaryStage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const running = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function run() {
    if (running.current) return;
    setError(""); setNotice("");
    try { videoIdFromUrl(url); } catch (error) { setError((error as Error).message); return; }
    running.current = true; setBusy(true); setStage(null); setResult(null);
    const controller = new AbortController(); abort.current = controller;
    const timer = setTimeout(() => controller.abort(), 320_000);
    let completed = false;
    try {
      const response = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }), signal: controller.signal });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || t("videoSummary.failed"));
      }
      if (!response.body) throw new Error(t("videoSummary.failed"));
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let pending = "", bytes = 0;
      const consume = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as VideoSummaryEvent;
        if ("error" in event) throw new Error(event.error);
        if ("stage" in event) setStage(event.stage);
        if ("result" in event) {
          completed = true;
          setResult(event.result); setNotice(t("videoSummary.done"));
          history.updateData(current => ({ results: [event.result, ...(current?.results ?? []).filter(item => item.summary.videoId !== event.result.summary.videoId)].slice(0, 50) }));
          requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
        }
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) { pending += decoder.decode(); consume(pending); break; }
          bytes += value.byteLength;
          if (bytes > 256_000) throw new Error(t("videoSummary.failed"));
          pending += decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = pending.indexOf("\n")) !== -1) { consume(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (!completed) throw new Error(t("videoSummary.failed"));
    } catch (error) {
      setError(`${t("videoSummary.failed")} ${error instanceof Error ? error.message : ""}`);
    } finally { clearTimeout(timer); running.current = false; abort.current = null; setBusy(false); }
  }
  function download() {
    if (!result) return;
    const blob = new Blob([videoSummaryMarkdown(result, language)], { type: "text/markdown;charset=utf-8" });
    const href = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = href; link.download = `video-${result.summary.videoId}.md`; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  async function copy() {
    if (!result) return;
    try { await navigator.clipboard.writeText(videoSummaryMarkdown(result, language)); setNotice(t("toolbox.copied")); }
    catch { setError(t("toolbox.copyError")); }
  }
  const index = stage === null ? -1 : VIDEO_SUMMARY_STAGES.indexOf(stage);
  return <div className={`robin-page robin-dashboard robin-workspace-ground ${styles.page}`}><main className={styles.main}>
    <header className={styles.header}><a href="/tools">← {t("toolbox.back")}</a><h1>{t("toolbox.video-summary")}</h1><p>{t("videoSummary.intro")}</p></header>
    <section className={styles.panel}>
      <form onSubmit={event => { event.preventDefault(); void run(); }}>
        <label className={styles.field} htmlFor="video-summary-url">{t("videoSummary.url")}</label>
        <div className={styles.inputRow}><input id="video-summary-url" type="url" required maxLength={2048} value={url} disabled={busy} autoComplete="off" spellCheck={false} aria-describedby="video-summary-privacy" onChange={event => setUrl(event.target.value)} /><button className="ui-action ui-action--primary" type="submit" disabled={busy}>{t(busy ? "toolbox.processing" : "videoSummary.run")}</button></div>
        <button className="ui-action" type="button" disabled={busy} onClick={() => setUrl(VIDEO_SUMMARY_EXAMPLE)}>{t("videoSummary.example")}</button>
        <p id="video-summary-privacy" className={styles.meta}>{t("videoSummary.privacy")}</p>
        <p className={styles.meta}>{t("videoSummary.limit")}</p>
      </form>
      <ol className={styles.pipeline} aria-label={t("toolbox.processing")}>{VIDEO_SUMMARY_STAGES.map((item, i) => <li key={item} aria-current={busy && stage === item ? "step" : undefined} data-state={result && !busy ? "done" : busy && i < index ? "done" : busy && i === index ? "active" : undefined}><span aria-hidden="true">{result && !busy || busy && i < index ? "✓" : i + 1}</span>{t(`videoSummary.${item}`)}</li>)}</ol>
      <p role="status">{busy ? t(stage ? `videoSummary.${stage}` : "videoSummary.working") : notice}</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </section>
    <div className={styles.layout}>
      <section className={styles.history} aria-labelledby="video-summary-history"><h2 id="video-summary-history">{t("videoSummary.history")}</h2><button className="ui-action" type="button" onClick={() => void history.refresh()}>{t("videoSummary.refresh")}</button>
        {history.loading && <p role="status">{t("videoSummary.loading")}</p>}
        {history.error && <p role="alert" className={styles.error}>{history.error}</p>}
        {!history.loading && !history.error && history.data?.results.length === 0 && <p>{t("videoSummary.empty")}</p>}
        <ul>{history.data?.results.map(item => <li key={item.summary.videoId}><button type="button" disabled={busy} aria-pressed={result?.summary.videoId === item.summary.videoId} onClick={() => { setResult(item); setError(""); setNotice(""); requestAnimationFrame(() => heading.current?.focus({ preventScroll: true })); }}><span>{item.details?.title ?? item.summary.videoId}</span><small>{item.details?.author} · {new Date(item.summary.generatedAt).toLocaleDateString(locale)}</small></button></li>)}</ul>
      </section>
      {result && <article className={styles.result} aria-labelledby="video-summary-result"><header><p className={styles.meta}>{result.details?.author}{result.details?.lengthSeconds ? ` · ${formatLength(result.details.lengthSeconds)}` : ""}</p><h2 id="video-summary-result" ref={heading} tabIndex={-1}>{result.details?.title ?? result.summary.videoId}</h2><a href={watchUrl(result.summary.videoId)} target="_blank" rel="noopener noreferrer">{t("videoSummary.original")} ↗</a></header>
        <p className={styles.meta}>{t("videoSummary.source")}</p>
        {result.summary.truncated && <p className={styles.error}>{t("videoSummary.partial")}</p>}
        <p className={styles.tldr}>{result.summary.tldr[language]}</p>
        <h3>{t("videoSummary.points")}</h3><ol className={styles.points}>{result.summary.points.map((point, i) => <li key={i}>{point.at !== null && <a className={styles.timestamp} href={watchUrl(result.summary.videoId, point.at)} target="_blank" rel="noopener noreferrer">{formatClock(point.at)} ↗</a>}<p>{point[language]}</p></li>)}</ol>
        <footer className={styles.actions}><button className="ui-action" type="button" onClick={download}>{t("videoSummary.download")}</button><button className="ui-action" type="button" onClick={() => void copy()}>{t("toolbox.copy")}</button><time className={styles.meta} dateTime={result.summary.generatedAt}>{new Date(result.summary.generatedAt).toLocaleString(locale)}</time></footer>
      </article>}
    </div>
  </main></div>;
}
