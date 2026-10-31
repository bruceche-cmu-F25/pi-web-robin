"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { diskBreakdown, formatMacBytes as bytes, type DiskEntry, type MacSnapshot, type MacDiskScan, type MacCleanupResult } from "@/extension/robin/mac-system";
import { usePolledResource, mutateResponse } from "./usePolledResource";
import styles from "./MacWorkspace.module.css";

const API = "/api/robin/mac";
const percent = (n: number | null | undefined) => n == null ? "—" : `${n.toFixed(1)}%`;
const memoryPercent = (s: MacSnapshot) => s.memory ? 100 * s.memory.used / s.memory.total : null;
const time = (date: string) => new Date(date).toLocaleTimeString();

/** Unmounting the sampler pauses network work without discarding the displayed history. */
function Sampler({ onSample, onError }: { onSample: (value: MacSnapshot) => void; onError: (error: string | null) => void }) {
  const { data, error } = usePolledResource<MacSnapshot>(API, 3000);
  useEffect(() => { if (data) onSample(data); }, [data, onSample]);
  useEffect(() => onError(error), [error, onError]);
  return null;
}
function Trend({ samples, metric }: { samples: MacSnapshot[]; metric: "cpu" | "gpu" | "memory" }) {
  const { t } = useI18n();
  const end = Date.parse(samples.at(-1)?.sampledAt ?? "");
  const windowMs = Math.min(180_000, Math.max(30_000, end - Date.parse(samples[0]?.sampledAt ?? "")));
  let path = "", previous = 0;
  for (const sample of samples) {
    const stamp = Date.parse(sample.sampledAt), value = metric === "memory" ? memoryPercent(sample) : sample[metric];
    if (value === null || stamp < end - windowMs) { previous = 0; continue; }
    const x = 300 * (stamp - end + windowMs) / windowMs, y = 68 - Math.max(0, Math.min(100, value)) * .64;
    path += `${previous && stamp - previous <= 6500 ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `;
    previous = stamp;
  }
  const last = samples.at(-1);
  const value = last ? metric === "memory" ? memoryPercent(last) : last[metric] : null;
  return <div className={styles.trendWrap}><div className={styles.trendScale} aria-hidden="true"><span>100%</span><span>0%</span></div><svg className={styles.trend} viewBox="0 0 304 72" preserveAspectRatio="none" aria-hidden="true"><path className={styles.gridline} d="M0 4H304M0 36H304M0 68H304" /><path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />{value !== null && <circle cx="300" cy={68 - Math.max(0, Math.min(100, value)) * .64} r="2.5" fill="currentColor" />}</svg><div className={styles.trendTimes}><span>−{Math.round(windowMs / 1000)}s</span><span>{t("mac.latest")}</span></div></div>;
}
function Metric({ name, value, hint, children }: { name: string; value: string; hint: string; children?: ReactNode }) {
  return <section className={styles.metric}><div className={styles.metricHeading}><h2>{name}</h2><strong>{value}</strong></div><p>{hint}</p>{children}</section>;
}
function FolderDistribution({ entries }: { entries: DiskEntry[] }) {
  const { t } = useI18n();
  const { total, measured } = diskBreakdown(entries);
  return <section className={styles.folders} aria-labelledby="mac-folders-title">
    <div className={styles.panelHeading}><h3 id="mac-folders-title">{t("mac.folders")}</h3><span className={styles.scopeTag}>{t("mac.partialScope")}</span></div>
    <div className={styles.distribution}>
      <div className={styles.donut}>
        <svg viewBox="0 0 200 200" aria-hidden="true"><circle className={styles.donutBase} cx="100" cy="100" r="82" />{measured.filter((item) => item.share > 0).map((item) => <circle className={styles.folderTone} data-folder={item.id} key={item.id} cx="100" cy="100" r="82" pathLength="100" strokeDasharray={`${item.share} ${100 - item.share}`} strokeDashoffset={-item.offset} transform="rotate(-90 100 100)" />)}</svg>
        <div className={styles.donutLabel}><span>{t("mac.measuredTotal")}</span><strong>{measured.length ? bytes(total) : "—"}</strong><small>{t("mac.measuredCount", { count: measured.length, total: entries.length })}</small></div>
      </div>
      <div className={styles.scopeExplanation}><strong>{t("mac.subsetTitle")}</strong><p>{t("mac.folderHint")}</p><p>{t("mac.folderHelp")}</p></div>
    </div>
    <div className={styles.folderColumns} aria-hidden="true"><span>{t("mac.folderName")}</span><span>{t("mac.measuredShare")}</span><span>{t("mac.size")}</span></div>
    {entries.map((item) => {
      const share = measured.find((entry) => entry.id === item.id)?.share;
      const issue = item.status === "missing" ? t("mac.missing") : t(`mac.issue.${item.issue ?? "failed"}`);
      return <details className={`${styles.folder} ${styles.folderTone}`} data-folder={item.id} key={item.id}>
        <summary><span className={styles.folderName}><i aria-hidden="true" /><span><strong>{t(`mac.folder.${item.id}`)}</strong><code>{item.path}</code></span></span><span className={styles.share}>{share === undefined ? "—" : share > 0 && share < .1 ? "<0.1%" : percent(share)}</span><span className={styles.folderSize}>{item.status === "ready" ? bytes(item.bytes) : t("mac.unmeasured")}<span aria-hidden="true" className={styles.expandMark}>+</span></span>{item.status !== "ready" && <span className={styles.folderIssue}>{issue}</span>}</summary>
        <div className={styles.folderDescription}><p>{t(`mac.folder.${item.id}Hint`)}</p><p>{t("mac.folderReadOnly")}</p></div>
      </details>;
    })}
  </section>;
}

export function MacWorkspace() {
  const { t } = useI18n();
  const [samples, setSamples] = useState<MacSnapshot[]>([]);
  const [paused, setPaused] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [scan, setScan] = useState<MacDiskScan | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<"scan" | "trash" | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<MacCleanupResult | null>(null);
  const [expired, setExpired] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const operation = useRef(false);
  const confirm = useRef<HTMLDialogElement>(null);
  const onSample = useCallback((value: MacSnapshot) => setSamples((old) => old.at(-1)?.sampledAt === value.sampledAt ? old : [...old, value].filter((s) => Date.parse(s.sampledAt) >= Date.parse(value.sampledAt) - 180_000).slice(-61)), []);
  const current = samples.at(-1);
  const choices = scan?.caches.filter((entry) => selected.includes(entry.id)) ?? [];
  const selectedBytes = choices.reduce((total, item) => total + (item.bytes ?? 0), 0);
  const cacheSummary = diskBreakdown(scan?.caches ?? []);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!scan) return;
    const remaining = Date.parse(scan.expiresAt) - Date.now();
    const timer = setTimeout(() => setExpired(true), Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [scan]);
  useEffect(() => {
    if (busy !== "trash") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  async function scanDisk() {
    if (operation.current) return;
    operation.current = true; setBusy("scan"); setError(""); setStatus(""); setScan(null); setSelected([]); setExpired(false);
    const controller = new AbortController(); abort.current = controller;
    try {
      const response = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "scan" }), signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setScan(body); setResult(null);
    } catch (caught) {
      if (controller.signal.aborted) setStatus(t("mac.cancelled"));
      else setError(caught instanceof Error ? caught.message : String(caught));
    } finally { operation.current = false; setBusy(null); abort.current = null; }
  }
  async function moveToTrash() {
    if (operation.current || !scan || !choices.length || expired) return;
    operation.current = true; confirm.current?.close(); setBusy("trash"); setError(""); setStatus(""); setResult(null);
    try {
      const response = await mutateResponse(API, "POST", { action: "trash", scanId: scan.id, ids: selected, confirmed: true });
      setResult(await response.json());
    } catch (caught) { setError(`${t("mac.unknownOutcome")} ${caught instanceof Error ? caught.message : String(caught)}`); }
    finally { setScan(null); setSelected([]); setStatus(t("mac.rescan")); setBusy(null); operation.current = false; }
  }
  const disk = current?.disk;
  const occupied = disk && disk.total > 0 ? disk.used / disk.total : 0;
  return <div className={`robin-page ${styles.page}`}><main className={styles.main}>
    {!paused && <Sampler onSample={onSample} onError={setSampleError} />}
    <header className={styles.header}>
      <a href="/tools">{t("mac.back")}</a>
      <div className={styles.titleRow}><div><h1>{t("mac.title")}</h1><p>{t("mac.intro")}</p></div><button type="button" onClick={() => setPaused(!paused)}>{t(paused ? "mac.resume" : "mac.pause")}</button></div>
      <div className={styles.meta}><span>{current ? `${t("mac.host", { host: current.host })} / ${current.model}` : t("mac.loading")}</span><span>{t(paused ? "mac.paused" : "mac.live")}{current && ` / ${t("mac.updated", { time: time(current.sampledAt) })}`}</span></div>
    </header>
    {sampleError && <p className={styles.notice} role="alert">{current && t("mac.stale")} {sampleError}</p>}
    {current && !current.supported && <p className={styles.notice}>{t("mac.unsupported")}</p>}
    {current?.supported && <>
      <div className={styles.metrics}>
        <Metric name={t("mac.cpu")} value={percent(current.cpu)} hint={t("mac.cpuHint", { count: current.cores })}><Trend samples={samples} metric="cpu" /></Metric>
        <Metric name={t("mac.gpu")} value={percent(current.gpu)} hint={t(current.gpu === null ? "mac.gpuMissing" : "mac.gpuHint")}><Trend samples={samples} metric="gpu" /></Metric>
        <Metric name={t("mac.memory")} value={percent(memoryPercent(current))} hint={current.memory ? t("mac.usedOf", { used: bytes(current.memory.used), total: bytes(current.memory.total) }) : t("mac.unavailable")}><Trend samples={samples} metric="memory" /></Metric>
      </div>
      <div className={styles.meta}><span>{t("mac.history")}</span><span>{t("mac.compressed", { size: bytes(current.memory?.compressed) })} / {t("mac.swap", { used: bytes(current.swap?.used), total: bytes(current.swap?.total) })}</span></div>
      <details className={styles.details}><summary>{t("mac.samples")}</summary>
        <div className={styles.cores}>{current.perCore.map((value, index) => <label key={index}>CPU {index + 1}{value !== null && <meter min={0} max={100} value={value} aria-label={`CPU ${index + 1}`} />}{percent(value)}</label>)}</div>
        <table><thead><tr><th>{t("mac.time")}</th><th>CPU</th><th>GPU</th><th>{t("mac.memory")}</th></tr></thead><tbody>{samples.slice(-10).reverse().map((s) => <tr key={s.sampledAt}><td>{time(s.sampledAt)}</td><td>{percent(s.cpu)}</td><td>{percent(s.gpu)}</td><td>{percent(memoryPercent(s))}</td></tr>)}</tbody></table>
      </details>
      <section className={styles.scanSection} aria-labelledby="mac-scan-title">
        <div className={styles.sectionHead}><div><h2 id="mac-scan-title">{t("mac.disk")}</h2><p>{t("mac.scanHint")}</p></div><div className={styles.actions}><button type="button" className={styles.primary} disabled={!!busy} onClick={() => void scanDisk()}>{t(busy === "scan" ? "mac.scanning" : "mac.scan")}</button>{busy === "scan" && <button type="button" onClick={() => abort.current?.abort()}>{t("mac.cancel")}</button>}</div></div>
        <section className={styles.diskOverview} aria-label={t("mac.diskOverview")}>
          <div className={styles.diskHeadline}><div><span>{t("mac.diskOverview")}</span><strong>{bytes(disk?.total)}</strong></div><div><span>{t("mac.free")}</span><strong>{bytes(disk?.available)}</strong></div></div>
          <div className={styles.volumeBar} aria-hidden="true">{disk && <span style={{ width: `${occupied * 100}%` }} />}</div>
          <div className={styles.volumeLegend}><span>{t("mac.occupied")} <b>{bytes(disk?.used)}</b> / {percent(disk ? occupied * 100 : null)}</span><span>{t("mac.diskHint")}</span></div>
          {disk && disk.available / disk.total < .1 && <p className={styles.lowSpace}>{t("mac.low")}</p>}
        </section>
        <p role="status">{busy ? t(busy === "scan" ? "mac.scanning" : "mac.moving") : status}</p>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {!scan && !busy && !result && <p className={styles.empty}>{t("mac.scanEmpty")}</p>}
        {scan && <>
          <p className={styles.meta}>{t("mac.scanAt", { time: time(scan.scannedAt) })}</p>
          <div className={styles.scanGrid}>
            <FolderDistribution entries={scan.folders} />
            <section className={styles.caches} aria-labelledby="mac-caches-title">
              <div className={styles.panelHeading}><h3 id="mac-caches-title">{t("mac.caches")}</h3><span className={styles.scopeTag}>{t("mac.manualReview")}</span></div>
              <div className={styles.cacheTotal}><strong>{cacheSummary.measured.length ? bytes(cacheSummary.total) : "—"}</strong><span>{t("mac.candidateTotal")}<small>{t("mac.cacheOverlap")}</small></span></div>
              <p className={styles.cacheHint}>{t("mac.cacheHint")}</p>
              {!scan.canTrash && <p className={styles.notice}>{t("mac.trashUnavailable")}</p>}
              {scan.caches.map((item) => <label className={styles.cache} data-selected={selected.includes(item.id) || undefined} key={item.id}><input type="checkbox" checked={selected.includes(item.id)} disabled={!!busy || expired || !scan.canTrash || item.status !== "ready" || !item.bytes} onChange={(event) => setSelected((old) => event.target.checked ? [...old, item.id] : old.filter((id) => id !== item.id))} /><span><strong>{t(`mac.cache.${item.id}`)}</strong><code>{item.path}</code>{item.status !== "ready" && <small>{t(item.status === "missing" ? "mac.missing" : `mac.issue.${item.issue ?? "failed"}`)}</small>}</span><span>{bytes(item.bytes)}</span></label>)}
              <div className={styles.selection}><span>{t("mac.selected", { count: choices.length, size: bytes(selectedBytes) })}</span><button type="button" disabled={!choices.length || !!busy || expired || !scan.canTrash} onClick={() => confirm.current?.showModal()}>{t("mac.review")}</button></div>
              {expired && <p className={styles.notice}>{t("mac.expired")}</p>}
            </section>
          </div>
        </>}
        {result && <section className={styles.results} aria-labelledby="mac-result-title"><h3 id="mac-result-title">{t("mac.result")}</h3><ul>{result.items.map((item) => <li key={item.id}><code>{item.path}</code><span className={item.status === "failed" ? styles.error : undefined}>{t(item.status === "trashed" ? "mac.trashed" : "mac.failed")}</span></li>)}</ul></section>}
        <p className={styles.safety}>{t("mac.noFree")}</p>
      </section>
    </>}
    <details className={styles.details}><summary>{t("mac.sources")}</summary><p>{t("mac.sourceHint")}</p><div className={styles.actions}><a href="https://github.com/Atoll-Labs/Atoll" target="_blank" rel="noreferrer">Atoll / GPL-3.0</a><a href="https://github.com/exelban/stats" target="_blank" rel="noreferrer">Stats / MIT</a><a href="https://github.com/tw93/Mole" target="_blank" rel="noreferrer">Mole / GPL-3.0</a></div><p>{t("mac.memoryHint")}</p><p>{t("mac.diskHint")}</p><p>{t("mac.sizeHint")}</p></details>
    <dialog ref={confirm} className={styles.dialog} aria-labelledby="mac-confirm-title" aria-describedby="mac-confirm-hint">
      <h2 id="mac-confirm-title">{t("mac.confirmTitle")}</h2><p id="mac-confirm-hint">{t("mac.confirmHint")}</p>
      <ul>{choices.map((item) => <li key={item.id}><code>{item.path}</code><span>{bytes(item.bytes)}</span></li>)}</ul>
      <p>{t("mac.selected", { count: choices.length, size: bytes(selectedBytes) })}</p><p className={styles.safety}>{t("mac.noFree")}</p>
      {expired && <p role="alert">{t("mac.expired")}</p>}
      <div className={styles.actions}><button type="button" autoFocus onClick={() => confirm.current?.close()}>{t("mac.cancel")}</button><button type="button" disabled={expired || !!busy || !choices.length} onClick={() => void moveToTrash()}>{t("mac.trash")}</button></div>
    </dialog>
  </main></div>;
}
