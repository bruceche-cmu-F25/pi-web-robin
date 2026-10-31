"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/hooks/useI18n";
import { graphBounds, graphCut, graphEdgePath, graphTextLayout, isKnowledgeNode, type LearningGraph as Graph, type LearningGraphNode } from "@/extension/robin/learning-graph";
import styles from "./LearningGraph.module.css";

type Selection = { vault: string; path: string; node: string };
type Catalog = { notes: Array<{ path: string; title: string }>; limited: boolean; skipped: number };
type Source = { graph: Graph; note: { path: string; modified: string; url: string } };
const API = "/api/robin/learning/graph";
async function request<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
function locationSelection(): Selection {
  const p = new URLSearchParams(window.location.search);
  return { vault: p.get("vault") || "", path: p.get("map") || "", node: p.get("node") || "" };
}
function keepLocation(s: Selection, replace = false) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries({ vault: s.vault, map: s.path, node: s.node })) {
    if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  }
  if (url.href !== window.location.href) window.history[replace ? "replaceState" : "pushState"](null, "", url);
}

export function LearningGraph() {
  const { t } = useI18n();
  const [vaults, setVaults] = useState<Array<{ id: string; name: string }> | null>(null);
  const [selection, setSelection] = useState<Selection>({ vault: "", path: "", node: "" });
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    request<{ vaults: Array<{ id: string; name: string }> }>("/api/robin/obsidian/vault", controller.signal).then(({ vaults: list }) => {
      if (controller.signal.aborted) return;
      setVaults(list);
      const initial = locationSelection();
      if (!initial.vault && list.length === 1) initial.vault = list[0].id;
      setSelection(initial);
    }).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    const back = () => setSelection(locationSelection());
    window.addEventListener("popstate", back);
    return () => { controller.abort(); window.removeEventListener("popstate", back); };
  }, [revision]);
  useEffect(() => {
    setCatalog(null); setSource(null);
    if (!selection.vault) return;
    const controller = new AbortController();
    setError("");
    request<Catalog>(`${API}?${new URLSearchParams({ vaultId: selection.vault })}`, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setCatalog(data);
      setSelection((current) => current.path || !data.notes.length ? current : { ...current,
        path: (data.notes.find((n) => /full stack/i.test(n.title)) ?? data.notes[0]).path });
    }).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [selection.vault, revision]);
  useEffect(() => {
    setSource(null);
    if (!selection.vault || !selection.path || !catalog) return;
    const controller = new AbortController();
    setError("");
    request<Source>(`${API}?${new URLSearchParams({ vaultId: selection.vault, path: selection.path })}`, controller.signal).then((data) => {
      if (!controller.signal.aborted) setSource(data);
    }).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [selection.vault, selection.path, catalog, revision]);
  useEffect(() => { if (source) keepLocation(selection, true); }, [selection, source]);
  function choose(next: Selection) { setError(""); keepLocation(next); setSelection(next); }
  const nodes = source?.graph.nodes.filter(isKnowledgeNode) ?? [];

  return <div className={`robin-page robin-dashboard ${styles.page}`}>
    <header className={styles.header}>
      <div><h1>{t("graph.title")}</h1><p>{t("graph.intro")}</p></div>
      <nav aria-label={t("roadmap.hub")}><a href="/learn">{t("roadmap.hub")}</a><a href="/learn/roadmap?view=course">{t("graph.course")}</a><a href="/learn/roadmap?view=notes">{t("graph.notes")}</a></nav>
    </header>
    <div className={styles.toolbar}>
      {vaults && vaults.length > 1 && <label>{t("notes.obsidian.vault")}<select value={selection.vault} onChange={(e) => choose({ vault: e.target.value, path: "", node: "" })}>
        <option value="">{t("notes.obsidian.choose")}</option>{vaults.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select></label>}
      <nav className={styles.routes} aria-label={t("graph.routes")}>
        {catalog?.notes.map((note) => <button key={note.path} type="button" aria-pressed={selection.path === note.path}
          onClick={() => choose({ ...selection, path: note.path, node: "" })}>{note.title}</button>)}
      </nav>
      {source && <label className={styles.find}><span className={styles.srOnly}>{t("graph.find")}</span><select aria-label={t("graph.find")} value={selection.node}
        onChange={(e) => choose({ ...selection, node: e.target.value })}><option value="">{t("graph.find")}</option>
        {nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
      </select></label>}
      <button type="button" onClick={() => setRevision((n) => n + 1)}>{t("graph.refresh")}</button>
    </div>
    {error && <p className={styles.notice} role="alert">{error}</p>}
    {!vaults && !error && <p role="status">{t("obsidian.loading")}</p>}
    {vaults?.length === 0 && <p className={styles.notice}>{t("notes.obsidian.setup")}</p>}
    {selection.vault && !source && !error && (!catalog || catalog.notes.length > 0) && <p role="status">{t("obsidian.loading")}</p>}
    {catalog?.limited && <p className={styles.notice}>{t("obsidian.limited")}</p>}
    {!!catalog?.skipped && <p className={styles.notice}>{t("obsidian.skipped", { count: catalog.skipped })}</p>}
    {catalog && !catalog.notes.length && <p className={styles.notice}>{t("graph.empty")}</p>}
    {source && <>
      <p className={styles.meta}>{source.graph.title} · {t("graph.count", { count: nodes.length, ready: nodes.filter((n) => n.content).length })} · {t("graph.snapshot", { date: source.graph.retrievedOn })}
        <a href={source.graph.source} target="_blank" rel="noopener noreferrer">roadmap.sh ↗</a><a href={source.note.url}>{t("graph.edit")}</a></p>
      <ul className={styles.legend} aria-label={t("graph.legend")}>
        <li data-kind="topic">{t("graph.topic")}</li><li data-kind="subtopic">{t("graph.subtopic")}</li><li data-kind="button">{t("graph.resource")}</li>
      </ul>
      <GraphSheet key={`${selection.vault}:${selection.path}:${revision}`} source={source} selectedId={selection.node} onSelect={(node) => choose({ ...selection, node })} />
    </>}
  </div>;
}

function GraphSheet({ source, selectedId, onSelect }: { source: Source; selectedId: string; onSelect: (id: string) => void }) {
  const { t } = useI18n();
  const graph = useMemo(() => graphTextLayout(source.graph), [source.graph]);
  const bounds = graphBounds(graph);
  const selected = graph.nodes.find((n) => n.id === selectedId && isKnowledgeNode(n));
  const viewport = useRef<HTMLDivElement>(null), panel = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(800), [gap, setGap] = useState(0);
  useEffect(() => {
    const element = viewport.current!;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!panel.current || !selected) { setGap(0); return; }
    const element = panel.current;
    const observer = new ResizeObserver(() => setGap(Math.ceil(element.getBoundingClientRect().height) + 24));
    observer.observe(element);
    return () => observer.disconnect();
  }, [selected]);
  useEffect(() => {
    if (!selected || !gap) return;
    panel.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, [selected, gap, width]);
  function close() {
    const button = viewport.current?.querySelector<HTMLButtonElement>(`[data-node="${selectedId}"]`);
    onSelect("");
    requestAnimationFrame(() => { button?.focus(); button?.scrollIntoView({ block: "nearest", inline: "nearest" }); });
  }
  const cut = selected ? graphCut(graph, selected) : Infinity;
  const space = selected ? gap : 0;
  const shifted = graph.nodes.map((n) => ({ ...n, x: n.x - bounds.left,
    y: n.y - bounds.top + (n.y >= cut ? space : 0),
    height: n.height + (n.y < cut && n.y + n.height > cut ? space : 0) }));
  const byId = new Map(shifted.map((n) => [n.id, n]));
  const panelWidth = Math.max(1, Math.min(720, width - 32));
  const sheetWidth = Math.max(bounds.width, panelWidth + 32);
  const panelLeft = Math.min(sheetWidth - panelWidth - 16, Math.max(16, (viewport.current?.scrollLeft ?? 0) + (width - panelWidth) / 2));
  const knowledge = shifted.filter(isKnowledgeNode).sort((a, b) => a.y - b.y || a.x - b.x);
  const boxStyle = (n: LearningGraphNode) => ({ left: n.x, top: n.y, width: n.width, height: n.height,
    fontSize: n.fontSize ?? 17, textAlign: n.align ?? "center" } as const);
  return <div className={styles.viewport} ref={viewport} tabIndex={0} aria-label={t("graph.canvas")}>
    {selectedId && !selected && <p role="alert" className={styles.notice}>{t("graph.missing")} <button onClick={() => onSelect("")}>{t("graph.close")}</button></p>}
    <div className={styles.sheet} style={{ width: sheetWidth, height: bounds.height + space }}>
      <svg aria-hidden="true" className={styles.lines} width={sheetWidth} height={bounds.height + space}>
        {shifted.filter((n) => n.type === "section").map((n) => <rect key={n.id} x={n.x} y={n.y} width={n.width} height={n.height} className={styles.section} />)}
        {graph.edges.map((e) => <path key={e.id} data-edge={e.id} d={graphEdgePath(byId.get(e.source)!, byId.get(e.target)!, e.sourceHandle, e.targetHandle)} strokeDasharray={e.dashed ? "2 7" : undefined} />)}
        {shifted.filter((n) => n.type === "horizontal" || n.type === "vertical").map((n) => <line key={n.id}
          x1={n.type === "vertical" ? n.x + n.width / 2 : n.x} y1={n.type === "horizontal" ? n.y + n.height / 2 : n.y}
          x2={n.type === "vertical" ? n.x + n.width / 2 : n.x + n.width} y2={n.type === "horizontal" ? n.y + n.height / 2 : n.y + n.height}
          strokeDasharray={n.dashed ? "2 7" : undefined} />)}
      </svg>
      {shifted.filter((n) => !isKnowledgeNode(n) && !["section", "horizontal", "vertical"].includes(n.type)).map((n) => n.type === "button" && n.href
        ? <a className={styles.decoration} data-graph-item={n.id} data-kind={n.type} style={boxStyle(n)} key={n.id} href={n.href} target="_blank" rel="noopener noreferrer"><span>{n.label}</span></a>
        : <div className={styles.decoration} data-graph-item={n.id} data-kind={n.type} style={boxStyle(n)} key={n.id}><span>{n.label}</span></div>)}
      {knowledge.map((n) => <button type="button" key={n.id} className={styles.node} style={boxStyle(n)} data-kind={n.type} data-node={n.id} data-graph-item={n.id}
        aria-expanded={selectedId === n.id} aria-controls={selectedId === n.id ? "graph-reading" : undefined}
        onClick={() => selectedId === n.id ? close() : onSelect(n.id)}><span>{n.label}</span></button>)}
      {selected && <section ref={panel} className={styles.reading} id="graph-reading" aria-labelledby="graph-reading-title"
        style={{ top: cut - bounds.top, left: panelLeft, width: panelWidth }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
        <header><h2 id="graph-reading-title">{selected.label}</h2><button type="button" onClick={close}>{t("graph.close")}</button></header>
        {selected.content ? <div className={styles.prose}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: () => null,
          a: ({ href, children }) => <a href={/^https?:\/\//i.test(href ?? "") ? href : undefined} target="_blank" rel="noopener noreferrer">{children}</a>,
        }}>{selected.content}</ReactMarkdown></div> : <p className={styles.pending}>{t("graph.pending")}</p>}
        <footer><span>{t("graph.fromNote")}</span><a href={source.note.url}>{t("graph.edit")}</a></footer>
      </section>}
    </div>
  </div>;
}
