"use client";

import { isValidElement, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import { useI18n } from "@/hooks/useI18n";
import type { VaultIndex, VaultNote } from "@/extension/robin/obsidian-browser-domain";
import { vaultLinkResolver, vaultPreview } from "@/extension/robin/obsidian-links";
import { ROADMAP_STATUSES, roadmapKey, type RoadmapRecord, type RoadmapSection, type RoadmapStatus } from "@/extension/robin/learning-roadmap";
import styles from "./LearningRoadmap.module.css";

const Mermaid = dynamic(() => import("@/components/MermaidBlock").then((module) => module.MermaidBlock), { ssr: false });
const API = "/api/robin/learning/roadmap";
type Catalog = VaultIndex & { progress: RoadmapRecord[] };
type Source = { note: VaultNote; sections: RoadmapSection[]; progress: RoadmapRecord[] };
type Selection = { vaultId: string; path: string; section: string };
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}
function locationSelection(): Selection {
  const params = new URLSearchParams(window.location.search);
  return { vaultId: params.get("vault") ?? "", path: params.get("note") ?? "", section: params.get("section") ?? "" };
}
function keepLocation(selection: Selection) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries({ vault: selection.vaultId, note: selection.path, section: selection.section })) {
    if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  }
  window.history.replaceState(null, "", url);
}

export function LearningRoadmap() {
  const { t } = useI18n();
  const [vaults, setVaults] = useState<Array<{ id: string; name: string }> | null>(null);
  const [selection, setSelection] = useState<Selection>({ vaultId: "", path: "", section: "" });
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [gaps, setGaps] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const dirty = useRef(false), busy = useRef(false);
  const guard = () => !busy.current && (!dirty.current || window.confirm(t("roadmap.discard")));

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    request<{ vaults: Array<{ id: string; name: string }> }>("/api/robin/obsidian/vault", { signal: controller.signal }).then(({ vaults: found }) => {
      if (controller.signal.aborted) return;
      setVaults(found);
      const current = locationSelection();
      const vaultId = found.some((vault) => vault.id === current.vaultId) ? current.vaultId : found.length === 1 ? found[0].id : "";
      const next = { ...current, vaultId };
      setSelection(next);
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    setCatalog(null);
    if (!selection.vaultId) return;
    const controller = new AbortController();
    request<Catalog>(`${API}?${new URLSearchParams({ vaultId: selection.vaultId })}`, { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return;
      setCatalog(data);
      setSelection((current) => {
        if (current.path || !data.notes.length) return current;
        return { ...current, path: data.notes[0].path, section: "" };
      });
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [selection.vaultId, revision]);
  useEffect(() => { if (vaults) keepLocation(selection); }, [selection, vaults]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.current || busy.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  function choose(path: string, section = "", vaultId = selection.vaultId) {
    if (!guard()) return;
    dirty.current = false; setError(""); setOutlineOpen(false);
    const next = { vaultId, path, section }; setSelection(next);
    if (vaultId !== selection.vaultId) { setCatalog(null); setQuery(""); setGaps(false); }
  }
  function refresh() { if (guard()) { dirty.current = false; setError(""); setRevision((value) => value + 1); } }
  function saveRecord(record: RoadmapRecord) {
    setCatalog((current) => current ? { ...current, progress: [...current.progress.filter((old) => roadmapKey(old.vaultId, old.path, old.section) !== roadmapKey(record.vaultId, record.path, record.section)), record] } : current);
  }
  const notes = catalog?.notes ?? [];
  const filtered = notes.filter((note) => `${note.path} ${note.title}`.toLowerCase().includes(query.trim().toLowerCase()));
  const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");
  const folders = [...new Set(filtered.map((note) => folderOf(note.path)))];
  const weak = (catalog?.progress ?? []).filter((record) => record.status === "gap");
  const selected = notes.find((note) => note.path === selection.path);
  const paths = [...new Set(notes.flatMap((note) => [note.path, ...note.links]))];

  return <div className={`robin-page robin-dashboard ${styles.page}`}>
    <main className={styles.main}>
      <header className={styles.header}>
        <div><h1>{t("roadmap.title")}</h1><p>{t("roadmap.intro")}</p></div>
        <nav aria-label={t("roadmap.hub")}><a href="/learn/roadmap">{t("roadmap.open")}</a><a href="/learn">{t("roadmap.hub")}</a></nav>
      </header>
      <div className={styles.toolbar}>
        {vaults?.length === 1 ? <p className={styles.vaultName}>Obsidian / {vaults[0].name}</p> : <label>{t("notes.obsidian.vault")}<select value={selection.vaultId} onChange={(event) => choose("", "", event.target.value)}>
          <option value="">{t("notes.obsidian.choose")}</option>{vaults?.map((vault) => <option key={vault.id} value={vault.id}>{vault.name}</option>)}
        </select></label>}
        <button type="button" onClick={refresh}>{t("roadmap.refresh")}</button>
      </div>
      {error && <p role="alert" className={styles.warning}>{error} <button type="button" onClick={refresh}>{t("obsidian.retry")}</button></p>}
      {!vaults && !error && <p role="status">{t("obsidian.loading")}</p>}
      {vaults?.length === 0 && <p>{t("notes.obsidian.setup")}</p>}
      {selection.vaultId && !catalog && !error && <p role="status">{t("obsidian.loading")}</p>}
      {catalog?.limited && <p className={styles.warning}>{t("obsidian.limited")}</p>}
      {!!catalog?.skipped && <p className={styles.warning}>{t("obsidian.skipped", { count: catalog.skipped })}</p>}
      {catalog && <div className={styles.layout}>
        <aside className={styles.landscape} aria-label={t("roadmap.outline")} data-expanded={outlineOpen}>
          <h2>{t("roadmap.outline")}</h2>
          <button type="button" className={styles.outlineToggle} aria-expanded={outlineOpen} aria-controls="roadmap-catalog" onClick={() => setOutlineOpen(!outlineOpen)}>{t("roadmap.outline")}</button>
          <div id="roadmap-catalog" className={styles.catalogContent}>
          <div className={styles.modes}><button type="button" aria-pressed={!gaps} onClick={() => setGaps(false)}>{t("roadmap.all")}</button><button type="button" aria-pressed={gaps} onClick={() => setGaps(true)}>{t("roadmap.gaps")}</button></div>
          {gaps ? <div className={styles.noteList}>
            {!weak.length && <p>{t("roadmap.noGaps")}</p>}
            {weak.map((record) => <button type="button" key={roadmapKey(record.vaultId, record.path, record.section)} onClick={() => choose(record.path, record.section)}>
              <span>{record.title || t("roadmap.overview")}</span><small>{record.path.split("/").at(-1)?.replace(/\.md$/i, "")}</small>
            </button>)}
          </div> : <>
            <input type="search" aria-label={t("roadmap.search")} placeholder={t("roadmap.search")} value={query} onChange={(event) => setQuery(event.target.value)} />
            {!notes.length && <p>{t("roadmap.noNotes")}</p>}
            {!!notes.length && !filtered.length && <p>{t("obsidian.noMatches")}</p>}
            {folders.map((folder) => <section key={folder} className={styles.noteList}>
              <h3>{folder.split("/").at(-1) || t("obsidian.root")}</h3>
              {filtered.filter((note) => folderOf(note.path) === folder).map((note) => <button type="button" key={note.path} aria-current={note.path === selection.path ? "page" : undefined} onClick={() => choose(note.path)}>{note.title.replace(/^\d+\s*[-–]\s*/, "")}</button>)}
            </section>)}
          </>}
          <section className={styles.training}><h3>{t("roadmap.training")}</h3><a href="/learn/fso">{t("roadmap.fso")}</a><a href="/coding">{t("roadmap.coding")}</a><a href="/learn/gpt2">{t("roadmap.gpt2")}</a></section>
          </div>
        </aside>
        {selection.path && <NoteStudy key={`${selection.vaultId}:${selection.path}:${revision}`} selection={selection} paths={paths}
          links={selected?.links ?? []} onChoose={choose} onSave={saveRecord} onRefresh={refresh} dirty={dirty} busy={busy} />}
      </div>}
      <p className={styles.privacy}>{t("roadmap.local")}</p>
    </main>
  </div>;
}

function NoteStudy({ selection, paths, links, onChoose, onSave, onRefresh, dirty, busy }: {
  selection: Selection; paths: string[]; links: string[];
  onChoose: (path: string, section?: string) => void; onSave: (record: RoadmapRecord) => void; onRefresh: () => void;
  dirty: React.RefObject<boolean>; busy: React.RefObject<boolean>;
}) {
  const { t } = useI18n();
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState("");
  const [practice, setPractice] = useState(false);
  const [notice, setNotice] = useState("");
  const reader = useRef<HTMLDivElement>(null);
  const { vaultId, path } = selection;
  useEffect(() => {
    const controller = new AbortController();
    request<Source>(`${API}?${new URLSearchParams({ vaultId, path })}`, { signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setSource(data); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [vaultId, path]);
  const section = source?.sections.find((section) => section.id === selection.section) ?? (!selection.section ? source?.sections[0] : undefined);
  const record = source?.progress.find((record) => record.section === section?.id);
  const stale = !!record && record.fingerprint !== section?.fingerprint;
  function navigate(href: string) {
    const wiki = href.startsWith("?wiki=");
    const target = wiki ? new URLSearchParams(href.slice(1)).get("wiki") ?? "" : href;
    const resolved = vaultLinkResolver([...paths, path])(path, target, wiki);
    if (!resolved) { setNotice(t("obsidian.missing", { target })); return; }
    if (resolved === path && target.includes("#")) {
      let heading = target.slice(target.indexOf("#") + 1);
      try { heading = decodeURIComponent(heading); } catch { /* Keep original heading. */ }
      const match = source?.sections.find((section) => section.title === heading);
      if (match) { onChoose(path, match.id); setNotice(""); return; }
      const element = [...(reader.current?.querySelectorAll("h1,h2,h3,h4,h5,h6") ?? [])].find((element) => element.textContent === heading);
      if (element) { element.scrollIntoView({ block: "start" }); return; }
      setNotice(t("obsidian.missing", { target })); return;
    }
    onChoose(resolved); setNotice("");
  }
  if (error) return <section className={styles.study}><p role="alert">{error}</p><button type="button" onClick={onRefresh}>{t("obsidian.retry")}</button></section>;
  if (!source) return <section className={styles.study} role="status">{t("obsidian.loading")}</section>;
  return <section className={styles.study} aria-label={path.split("/").at(-1)}>
    <header className={styles.sourceHeader}>
      <p title={path}>{path.split("/").at(-1)?.replace(/\.md$/i, "")}</p>
      <a href={`/obsidian?${new URLSearchParams({ vault: vaultId, note: path, view: "read" })}`}>{t("roadmap.source")}</a>
    </header>
    <label className={styles.chapterPicker}>{t("roadmap.sections")}<select value={section?.id ?? ""} onChange={(event) => onChoose(path, event.target.value)}>
      {!section && <option value="">{t("roadmap.missingSection")}</option>}
      {source.sections.map((item) => <option key={item.id} value={item.id}>{item.title || t("roadmap.overview")}</option>)}
    </select></label>
    {!section ? <p role="status">{t("roadmap.missingSection")}</p> : <>
      <div className={styles.modes} role="group" aria-label={t("roadmap.sections")}>
        <button type="button" aria-pressed={!practice} onClick={() => setPractice(false)}>{t("roadmap.read")}</button>
        <button type="button" aria-pressed={practice} onClick={() => setPractice(true)}>{t("roadmap.practice")}</button>
      </div>
      {notice && <p role="status" className={styles.warning}>{notice}</p>}
      {stale && <p role="status" className={styles.warning}>{t("roadmap.stale")}</p>}
      <div ref={reader} className={styles.reader}>
        {practice && <p className={styles.practiceHint}>{t(section.practice ? "roadmap.sourcePractice" : "roadmap.genericPractice")}</p>}
        {practice && !section.practice ? <><h2>{section.title || t("roadmap.overview")}</h2><ol>{["promptExplain", "promptBoundary", "promptBuild"].map((id) => <li key={id}>{t(`roadmap.${id}`)}</li>)}</ol></>
          : <RoadmapMarkdown content={practice ? section.practice : section.content} navigate={navigate} />}
      </div>
      <Assessment key={`${section.id}:${record?.revision ?? 0}`} section={section} record={record} selection={selection} dirty={dirty} busy={busy} stale={stale} onSaved={(record) => {
        setSource((current) => current ? { ...current, progress: [...current.progress.filter((old) => old.section !== record.section), record] } : current); onSave(record);
      }} />
    </>}
    {!!links.length && <details className={styles.connections}><summary>{t("roadmap.connections")}</summary>{links.map((link) => <button type="button" key={link} onClick={() => onChoose(link)}>{link.split("/").at(-1)?.replace(/\.md$/i, "")}</button>)}</details>}
  </section>;
}

function RoadmapMarkdown({ content, navigate }: { content: string; navigate: (href: string) => void }) {
  const { t } = useI18n();
  return <div className="markdown-body"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm, remarkFrontmatter]} components={{
    a: ({ href, children }) => href && /^https?:\/\//i.test(href)
      ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      : <button type="button" className={styles.inlineLink} onClick={() => href && navigate(href)}>{children}</button>,
    img: ({ alt }) => <span>[{alt || t("obsidian.attachment")}]</span>,
    pre: ({ children }) => {
      if (isValidElement<{ className?: string; children?: unknown }>(children) && children.props.className === "language-mermaid") {
        return <Mermaid code={String(children.props.children ?? "").trim()} defaultPreview />;
      }
      return <pre>{children}</pre>;
    },
  }}>{vaultPreview(content)}</ReactMarkdown></div>;
}

function Assessment({ section, record, selection, stale, dirty, busy, onSaved }: {
  section: RoadmapSection; record?: RoadmapRecord; selection: Selection; stale: boolean;
  dirty: React.RefObject<boolean>; busy: React.RefObject<boolean>; onSaved: (record: RoadmapRecord) => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<RoadmapStatus>(stale ? "unassessed" : record?.status ?? "unassessed");
  const [evidence, setEvidence] = useState(record?.evidence ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const evidenceId = "roadmap-evidence";
  function change() { dirty.current = true; setChanged(true); }
  return <form className={styles.assessment} onSubmit={async (event) => {
    event.preventDefault(); if (busy.current) return;
    busy.current = true; setSaving(true); setError("");
    try {
      const { record: saved } = await request<{ record: RoadmapRecord }>(API, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        vaultId: selection.vaultId, path: selection.path, section: section.id, fingerprint: section.fingerprint, status, evidence, revision: record?.revision ?? 0,
      }) });
      dirty.current = false; setChanged(false); onSaved(saved);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { busy.current = false; setSaving(false); }
  }}>
    <label>{t("roadmap.status")}<select value={status} disabled={saving} onChange={(event) => { setStatus(event.target.value as RoadmapStatus); change(); }}>
      {ROADMAP_STATUSES.map((value) => <option key={value} value={value}>{t(`roadmap.${value}`)}</option>)}
    </select></label>
    <label htmlFor={evidenceId}>{t("roadmap.evidence")}</label>
    <p id="roadmap-evidence-hint">{t("roadmap.evidenceHint")}</p>
    <textarea id={evidenceId} aria-describedby="roadmap-evidence-hint" value={evidence} maxLength={20_000} required={status === "confident"} disabled={saving} rows={5} onChange={(event) => { setEvidence(event.target.value); change(); }} />
    <div className={styles.saveRow}><button type="submit" disabled={saving || (status === "confident" && !evidence.trim())}>{t(saving ? "roadmap.saving" : "roadmap.save")}</button>
      <span role="status">{changed ? t("roadmap.unsaved") : record && !stale ? t("roadmap.saved") : ""}</span></div>
    {error && <p role="alert" className={styles.warning}>{error}</p>}
  </form>;
}
