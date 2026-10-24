"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { localDate } from "@/extension/robin/dates";
import { type ToolboxTool, type ToolboxCapabilities } from "@/extension/robin/toolbox";
import { canvasBlob, cleanText, convertImage, developerTool, editPdf, generateQr, imageCanvas, readQr, renamedFiles, tableConvert, textOutput, wifiPayload, zipFiles, type ToolOutput } from "./toolbox-browser";
import styles from "./ToolboxWorkspace.module.css";

// Same 24px stroke vocabulary as the dashboard: visible labels carry the meaning.
const toolIcons: Record<ToolboxTool | "recordings", string> = {
  recordings: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8",
  audio: "M3 10v4M7 6v12M12 3v18M17 6v12M21 10v4",
  video: "M3 5h12v14H3zM15 10l6-3v10l-6-3",
  image: "M3 3h18v18H3zM3 16l5-5 4 4 3-3 6 6M15 6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z",
  pdf: "M14 2H5v20h14V7l-5-5ZM14 2v5h5M8 12h8M8 16h8",
  subtitles: "M3 5h18v14H3zM10 10H7v4h3M17 10h-3v4h3",
  ocr: "M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M8 9V7h8v2M12 7v10M9 17h6",
  text: "M3 4h18M3 8h12M3 12h6M10 17l6-6 5 5-6 6h-3l-3-3 1-2ZM13 14l5 5M3 22h18",
  rename: "M3 6h9M3 12h5M3 18h6M12 14l7-7 3 3-7 7-4 1 1-4ZM17 9l3 3",
  qr: "M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6v-3M21 12v2M12 3v3M3 12h3M12 12h3M12 18v3",
  dev: "M8 6l-6 6 6 6M16 6l6 6-6 6M14 3l-4 18",
  csv: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 9v12",
};
function ToolIcon({ name }: { name: keyof typeof toolIcons }) {
  return <svg className={styles.toolIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={toolIcons[name]} /></svg>;
}

const toolGroups: { id: string; tools: (keyof typeof toolIcons)[] }[] = [
  { id: "media", tools: ["recordings", "audio", "video", "subtitles"] },
  { id: "documents", tools: ["image", "pdf", "ocr", "rename"] },
  { id: "data", tools: ["text", "qr", "csv", "dev"] },
];
const API = "/api/robin/toolbox";
const initialMode: Record<ToolboxTool, string> = { audio: "mp3", video: "720p", image: "jpeg", pdf: "merge", subtitles: "srt", ocr: "txt", text: "dedupe", rename: "zip", qr: "generate", dev: "json", csv: "csv" };
const defaults = { mode: "mp3", start: "0", end: "", bitrate: "192", edge: "1920", quality: "82", crop: "none", pages: "", rotation: "90", pattern: "{n}-{name}", find: "", replace: "", date: "", outputFormat: "json", columns: "", ssid: "", password: "" };
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className={styles.field}><span>{label}</span>{children}</label>; }
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ToolboxWorkspace() {
  const { t } = useI18n();
  const [tool, setTool] = useState<ToolboxTool>("audio");
  const [catalogOpen, setCatalogOpen] = useState(true);
  const [settings, setSettings] = useState(defaults);
  const [files, setFiles] = useState<File[]>([]);
  const [input, setInput] = useState("");
  const [compare, setCompare] = useState("");
  const [dedupe, setDedupe] = useState(false);
  const [safeCsv, setSafeCsv] = useState(true);
  const [names, setNames] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [preview, setPreview] = useState("");
  const [capabilities, setCapabilities] = useState<ToolboxCapabilities | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const running = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const local = ["audio", "video", "subtitles", "ocr"].includes(tool);
  const ready = !local || !!(tool === "subtitles" ? capabilities?.subtitles : tool === "ocr" ? capabilities?.ocr : capabilities?.media);
  const hasData = !!(files.length || input || compare || output || settings.ssid || settings.password);
  const needsFile = !["text", "dev", "csv"].includes(tool) && !(tool === "qr" && settings.mode !== "read");
  const multi = ["pdf", "rename", "ocr"].includes(tool);

  async function checkEngine(signal?: AbortSignal) {
    try { const r = await fetch(API, { signal }); if (!r.ok) throw new Error(); setCapabilities(await r.json()); }
    catch { if (!signal?.aborted) setCapabilities(null); }
    finally { if (!signal?.aborted) setChecked(true); }
  }
  useEffect(() => { const controller = new AbortController(); void checkEngine(controller.signal); return () => { controller.abort(); abort.current?.abort(); }; }, []);
  useEffect(() => {
    if (!output) { setPreview(""); return; }
    const url = URL.createObjectURL(output.blob); setPreview(url); return () => URL.revokeObjectURL(url);
  }, [output]);
  useEffect(() => {
    if (!hasData && !busy) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, [hasData, busy]);
  function invalidate() { setOutput(null); setNames([]); setRows([]); setError(""); setStatus(""); }
  function change(key: keyof typeof defaults, value: string) {
    setSettings((previous) => ({ ...previous, [key]: value, ...(tool === "video" && key === "mode" && value === "gif" && !previous.end ? { end: String(Number(previous.start || 0) + 10) } : {}) })); invalidate();
  }
  function reset(next: ToolboxTool) {
    if (busy || (hasData && !window.confirm(t("toolbox.confirm")))) return false;
    setTool(next); setSettings({ ...defaults, mode: initialMode[next], date: localDate() });
    setFiles([]); setInput(""); setCompare(""); setDedupe(false); setSafeCsv(true); invalidate();
    if (fileInput.current) fileInput.current.value = "";
    return true;
  }
  function openTool(next: ToolboxTool) {
    if (busy || (next !== tool && !reset(next))) return;
    setCatalogOpen(false);
    requestAnimationFrame(() => heading.current?.focus());
  }
  function showCatalog() {
    if (busy) return;
    workspace.current?.querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => media.pause());
    setCatalogOpen(true);
    requestAnimationFrame(() => document.getElementById(`toolbox-card-${tool}`)?.focus());
  }
  function acceptFiles(incoming: File[]) {
    if (busy) return;
    if (!incoming.length || incoming.some((f) => !f.size) || (!multi && incoming.length > 1) || incoming.length > 100 || incoming.reduce((n, f) => n + f.size, 0) > 100 * 1024 * 1024) { setError(t("toolbox.limit")); if (fileInput.current) fileInput.current.value = ""; return; }
    setFiles(incoming); invalidate();
  }
  function moveFile(index: number, offset: number) {
    const next = [...files]; [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setFiles(next); invalidate();
  }
  const textField = (key: keyof typeof defaults, label: string, type = "text") => <Field label={t(`toolbox.${label}`)}><input type={type} value={settings[key]} onChange={(e) => change(key, e.target.value)} /></Field>;
  const select = (key: keyof typeof defaults, label: string, values: string[], translate = false) => <Field label={t(`toolbox.${label}`)}><select aria-label={t(`toolbox.${label}`)} value={settings[key]} onChange={(e) => change(key, e.target.value)}>{values.map((value) => <option key={value} value={value}>{translate ? t(`toolbox.op.${value}`) : value.toUpperCase()}</option>)}</select></Field>;
  async function serverRun(file: File, signal: AbortSignal): Promise<ToolOutput> {
    let source: File = file;
    if (tool === "ocr") {
      const canvas = await imageCanvas(file);
      try { source = new File([await canvasBlob(canvas, "image/png")], "image.png", { type: "image/png" }); }
      finally { canvas.width = canvas.height = 1; }
    }
    signal.throwIfAborted();
    const form = new FormData(); form.append("file", source);
    form.append("options", JSON.stringify({ kind: tool, format: settings.mode, start: Number(settings.start || 0), ...(settings.end ? { end: Number(settings.end) } : {}), bitrate: Number(settings.bitrate) }));
    const response = await fetch(API, { method: "POST", body: form, signal });
    if (!response.ok) { const body = await response.json(); throw new Error(body.error || t("toolbox.error")); }
    const blob = await response.blob();
    const name = /filename="([a-z0-9.-]+)"/i.exec(response.headers.get("content-disposition") || "")?.[1] || "result.bin";
    return { blob, name, ...(blob.type.startsWith("text/") ? { text: await blob.text() } : {}) };
  }
  async function run(previewOnly = false) {
    if (running.current) return;
    if (needsFile && !files.length) { setError(t("toolbox.needFile")); return; }
    running.current = true; setBusy(true); setError(""); setStatus(t("toolbox.busy")); setOutput(null); setRows([]);
    const controller = new AbortController(); abort.current = controller;
    try {
      // Paint immediate feedback before browser-side work; progress is never fabricated.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      let result: ToolOutput | null = null;
      if (local) {
        if (!ready) throw new Error(t("toolbox.unavailable"));
        if (tool === "ocr") {
          if (files.length > 10) throw new Error(t("toolbox.limit"));
          const parts: string[] = [];
          for (const [i, file] of files.entries()) {
            setStatus(t("toolbox.batch", { done: i + 1, total: files.length }));
            const part = await serverRun(file, controller.signal);
            parts.push(files.length > 1 ? `# ${file.name}\n${part.text || t("toolbox.noText")}` : part.text || "");
          }
          result = textOutput(parts.join("\n\n"), "recognized.txt");
        } else result = await serverRun(files[0], controller.signal);
      } else if (tool === "image") result = await convertImage(files[0], settings.mode, Number(settings.edge), Number(settings.quality) / 100, settings.crop);
      else if (tool === "pdf") result = await editPdf(files, settings.mode, settings.pages, Number(settings.rotation));
      else if (tool === "text") result = textOutput(cleanText(input, settings.mode));
      else if (tool === "dev") result = textOutput(await developerTool(input, settings.mode, compare));
      else if (tool === "qr") result = settings.mode === "read" ? textOutput(await readQr(files[0])) : await generateQr(settings.mode === "wifi" ? wifiPayload(settings.ssid, settings.password) : input);
      else if (tool === "csv") {
        const table = tableConvert(input, settings.mode, settings.outputFormat, settings.columns, dedupe, safeCsv);
        setRows(table.rows.slice(0, 21)); result = textOutput(table.text, `result.${settings.outputFormat}`);
      } else if (tool === "rename") {
        if (files.length > 100 || files.reduce((n, f) => n + f.size, 0) > 50 * 1024 * 1024) throw new Error(t("toolbox.limit"));
        const renamed = renamedFiles(files.map((f) => f.name), settings.pattern, settings.find, settings.replace, settings.date || localDate());
        setNames(renamed);
        if (!previewOnly) result = await zipFiles(await Promise.all(files.map(async (file, i) => ({ name: renamed[i], data: new Uint8Array(await file.arrayBuffer()) }))));
      }
      controller.signal.throwIfAborted();
      setOutput(result); setStatus(result?.text === "" ? t("toolbox.noText") : t("toolbox.done"));
      if (result) requestAnimationFrame(() => resultHeading.current?.focus({ preventScroll: true }));
    } catch (err) { if (controller.signal.aborted) setStatus(t("toolbox.cancelled")); else { setStatus(""); setError(err instanceof Error ? err.message : t("toolbox.error")); } }
    finally { abort.current = null; running.current = false; setBusy(false); }
  }
  const accept = tool === "pdf" ? ".pdf" : ["image", "ocr", "qr"].includes(tool) ? ".png,.jpg,.jpeg,.webp" : tool === "rename" ? undefined : ".mp3,.wav,.m4a,.mp4,.mov,.mkv,.webm,.avi,.ogg,.flac,.aac";

  return <div className={`robin-page robin-dashboard ${styles.page}`}><main className={styles.main}>
    <header className={styles.heading} data-compact={!catalogOpen || undefined}>
      <a href="/dashboard#dashboard-tools">← {t("robin.dashboard.backToTools")}</a>
      <div><h1>{t("toolbox.title")}</h1>{catalogOpen && <p>{t("toolbox.intro")}</p>}</div>
    </header>
    <nav className={styles.catalog} aria-label={t("toolbox.select")} hidden={!catalogOpen}>
      {toolGroups.map((group) => <section key={group.id} className={styles.group} data-tool-group={group.id} aria-labelledby={`toolbox-group-${group.id}`}>
        <div className={styles.groupHeading}><h2 id={`toolbox-group-${group.id}`}>{t(`toolbox.group.${group.id}`)}</h2></div>
        <div className={styles.cards}>{group.tools.map((id) => {
          const name = id === "recordings" ? "speech" : id;
          const resume = id === tool && hasData;
          const content = <><span className={styles.iconTile}><ToolIcon name={id} /></span><span className={styles.cardTitle} id={`toolbox-label-${id}`}>{t(`toolbox.${name}`)}</span><span className={styles.cardDescription} id={`toolbox-description-${id}`}>{t(`toolbox.card.${name}`)}</span>{resume && <span className={styles.cardFooter}>{t("toolbox.resume")}</span>}</>;
          const labels = { "aria-labelledby": `toolbox-label-${id}`, "aria-describedby": `toolbox-description-${id}` };
          return id === "recordings"
            ? <a key={id} className={styles.toolCard} {...labels} href={busy ? undefined : "/recordings"} role="link" aria-disabled={busy || undefined} tabIndex={busy ? -1 : undefined}>{content}</a>
            : <button key={id} id={`toolbox-card-${id}`} className={styles.toolCard} {...labels} type="button" data-resume={resume || undefined} disabled={busy} onClick={() => openTool(id)}>{content}</button>;
        })}</div>
      </section>)}
    </nav>
    <div ref={workspace} className={styles.workspace} data-tool-group={toolGroups.find((group) => group.tools.includes(tool))?.id} hidden={catalogOpen}>
    <div className={styles.workspaceNav}><button type="button" disabled={busy} aria-label={t("toolbox.allTools")} onClick={showCatalog}>← {t("toolbox.allTools")}</button></div>
    <section className={styles.panel} aria-labelledby="toolbox-tool-title">
      <div className={styles.panelHeading}><div className={styles.toolHeading}><span className={styles.iconTile}><ToolIcon name={tool} /></span><h2 ref={heading} id="toolbox-tool-title" tabIndex={-1} className="pi-section-title">{t(`toolbox.${tool}`)}</h2></div><span className={styles.location}>{t(local ? "toolbox.local" : "toolbox.browser")}</span></div>
      <p className={styles.hint}>{t(`toolbox.${tool}Hint`)}</p>
      {local && !ready && <div className={styles.notice}><p>{t(checked ? "toolbox.unavailable" : "toolbox.checking")}</p><div className={styles.actions}><button type="button" disabled={busy} onClick={() => void checkEngine()}>{t("toolbox.recheck")}</button><a href="/recordings">{t("toolbox.recordings")}</a></div></div>}
      <fieldset disabled={busy} className={styles.fields}>
        {needsFile && <div className={styles.drop} data-dragging={dragging || undefined} onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); acceptFiles(Array.from(e.dataTransfer.files)); }}>
          <Field label={t("toolbox.files")}><input key={tool} ref={fileInput} type="file" accept={accept} multiple={multi} onChange={(e) => acceptFiles(Array.from(e.target.files || []))} /></Field>
        </div>}
        {needsFile && files.length > 0 && <ol className={styles.files}>{files.map((file, i) => <li key={`${i}-${file.name}`}><span>{file.name}<small>{(file.size / 1024 / 1024).toFixed(2)} MB</small></span><div className={styles.actions}>{multi && <><button type="button" aria-label={`${t("toolbox.up")} · ${file.name}`} disabled={busy || i === 0} onClick={() => moveFile(i, -1)}>↑</button><button type="button" aria-label={`${t("toolbox.down")} · ${file.name}`} disabled={busy || i === files.length - 1} onClick={() => moveFile(i, 1)}>↓</button></>}<button type="button" aria-label={`${t("toolbox.remove")} · ${file.name}`} onClick={() => { setFiles(files.filter((_, n) => n !== i)); invalidate(); if (fileInput.current) fileInput.current.value = ""; }}>×</button></div></li>)}</ol>}
        <div className={styles.grid}>
          {tool === "audio" && <>{select("mode", "format", ["mp3", "m4a", "wav", "flac"])}{select("bitrate", "bitrate", ["128", "192", "256"])}</>}
          {tool === "video" && select("mode", "operation", ["720p", "1080p", "mute", "gif"], true)}
          {tool === "subtitles" && select("mode", "format", ["srt", "vtt"])}
          {["audio", "video", "subtitles"].includes(tool) && <>{textField("start", "start", "number")}{textField("end", "end", "number")}</>}
          {tool === "image" && <>{select("mode", "format", ["jpeg", "png", "webp"])}{textField("edge", "edge", "number")}{textField("quality", "quality", "number")}{select("crop", "crop", ["none", "square", "wide"], true)}</>}
          {tool === "pdf" && <>{select("mode", "operation", ["merge", "extract", "split", "rotate"], true)}{settings.mode !== "merge" && textField("pages", "pages")}{settings.mode === "rotate" && select("rotation", "rotation", ["90", "180", "270"])}</>}
          {tool === "text" && select("mode", "operation", ["dedupe", "blank", "trim", "unwrap", "spacing"], true)}
          {tool === "rename" && <>{textField("pattern", "pattern")}{textField("date", "date", "date")}{textField("find", "find")}{textField("replace", "replace")}</>}
          {tool === "qr" && <>{select("mode", "operation", ["generate", "wifi", "read"], true)}{settings.mode === "wifi" && <>{textField("ssid", "ssid")}{textField("password", "password", "password")}</>}</>}
          {tool === "dev" && select("mode", "operation", ["json", "minify", "diff", "url-encode", "url-decode", "base64-encode", "base64-decode", "seconds", "milliseconds", "iso"], true)}
          {tool === "csv" && <>{select("mode", "from", ["csv", "tsv", "json"])}{select("outputFormat", "format", ["csv", "tsv", "json"])}{textField("columns", "columns")}</>}
        </div>
        {tool === "csv" && <div className={styles.checks}><label><input type="checkbox" checked={dedupe} onChange={(e) => { setDedupe(e.target.checked); invalidate(); }} />{t("toolbox.dedupe")}</label><label><input type="checkbox" checked={safeCsv} onChange={(e) => { setSafeCsv(e.target.checked); invalidate(); }} />{t("toolbox.safeCsv")}</label></div>}
        {(["text", "dev", "csv"].includes(tool) || (tool === "qr" && settings.mode === "generate")) && <Field label={t("toolbox.input")}><textarea rows={8} maxLength={2_000_000} value={input} spellCheck={false} onChange={(e) => { setInput(e.target.value); invalidate(); }} /></Field>}
        {tool === "dev" && settings.mode === "diff" && <Field label={t("toolbox.compare")}><textarea rows={8} maxLength={2_000_000} value={compare} spellCheck={false} onChange={(e) => { setCompare(e.target.value); invalidate(); }} /></Field>}
        <div className={styles.actions}>{tool === "rename" && <button type="button" onClick={() => void run(true)}>{t("toolbox.preview")}</button>}<button type="button" className={`pi-bracket ${styles.runButton}`} aria-label={t("toolbox.run")} disabled={busy || !ready} onClick={() => void run()}>{t("toolbox.run")}</button><button type="button" onClick={() => reset(tool)}>{t("toolbox.clear")}</button></div>
      </fieldset>
      <div className={styles.feedback}>{error && <p role="alert">{error}</p>}<p role="status" className={busy ? styles.working : undefined}>{status}</p>{busy && local && <button type="button" onClick={() => abort.current?.abort()}>{t("toolbox.cancel")}</button>}</div>
      {!!names.length && <ol className={styles.names}>{names.map((name, i) => <li key={i}><span>{files[i]?.name}</span><span>→ {name}</span></li>)}</ol>}
      {!!rows.length && <div className={styles.table}><table><thead><tr>{rows[0].map((cell, i) => <th key={i}>{cell}</th>)}</tr></thead><tbody>{rows.slice(1).map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>}
      {output && <section className={styles.result} aria-labelledby="toolbox-result"><h3 ref={resultHeading} id="toolbox-result" tabIndex={-1}>{t("toolbox.result")} <small>{output.name} · {(output.blob.size / 1024).toFixed(1)} KB</small></h3>
        {output.text !== undefined && <Field label={t("toolbox.result")}><textarea rows={12} value={output.text} onChange={(e) => setOutput(textOutput(e.target.value, output.name, output.blob.type))} /></Field>}
        {/* Blob previews are local, untrusted text is never HTML, and Next Image cannot optimize blob URLs. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview && output.blob.type.startsWith("image/") && <img src={preview} alt={t("toolbox.result")} className={styles.image} />}
        {preview && output.blob.type.startsWith("audio/") && <audio controls src={preview} />}
        {preview && output.blob.type.startsWith("video/") && <video controls src={preview} />}
        <div className={styles.actions}><button type="button" onClick={() => saveBlob(output.blob, output.name)}>{t("toolbox.download")}</button>{output.text !== undefined && <button type="button" onClick={() => void navigator.clipboard.writeText(output.text!).then(() => setStatus(t("toolbox.copied"))).catch(() => setError(t("toolbox.error")))}>{t("toolbox.copy")}</button>}</div>
      </section>}
    </section>
    <p className={styles.hint}>{t("toolbox.privacy")}</p>
    </div>
    <footer className={styles.footer}>
    {catalogOpen && <p>{t("toolbox.assurances")}</p>}
    <details className={styles.advanced}><summary>{t("toolbox.advanced")}</summary><p>{t("toolbox.advancedHint")}</p></details>
    </footer>
  </main></div>;
}
