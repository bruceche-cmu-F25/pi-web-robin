"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import { useI18n } from "@/hooks/useI18n";
import { useIsSplitLayout } from "@/hooks/useIsMobile";
import type { ObsidianVault } from "@/extension/robin/obsidian-domain";
import type { VaultEntry, VaultIndex, VaultNote } from "@/extension/robin/obsidian-browser-domain";
import { vaultLinkResolver, vaultPreview } from "@/extension/robin/obsidian-links";
import { folderOf, folderTone, neighborhood, noteNeighbors } from "./obsidian-graph";
import styles from "./ObsidianWorkspace.module.css";

const Graph = dynamic(() => import("./ObsidianGraph"), { ssr: false });
const API = "/api/robin/obsidian/vault";
const EMPTY: VaultEntry[] = [];
type View = "library" | "graph" | "read";
async function get<T>(params: Record<string, string>, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${API}?${new URLSearchParams(params)}`, { signal, cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}
function keepLocation(vaultId: string, path: string, view?: View) {
  const url = new URL(window.location.href);
  if (vaultId) url.searchParams.set("vault", vaultId); else url.searchParams.delete("vault");
  if (path) url.searchParams.set("note", path); else url.searchParams.delete("note");
  if (view) url.searchParams.set("view", view);
  window.history.replaceState(null, "", url);
}
function FileTree({ notes, selected, choose, prefix = "" }: {
  notes: VaultEntry[]; selected: string; choose: (path: string) => void; prefix?: string;
}) {
  const folders = new Map<string, VaultEntry[]>(), files: VaultEntry[] = [];
  for (const note of notes) {
    const rest = note.path.slice(prefix.length), slash = rest.indexOf("/");
    if (slash < 0) files.push(note);
    else {
      const folder = rest.slice(0, slash);
      if (!folders.has(folder)) folders.set(folder, []);
      folders.get(folder)!.push(note);
    }
  }
  return <ul className={styles.tree}>
    {[...folders].map(([folder, children]) => <li key={folder}><details open={selected.startsWith(`${prefix}${folder}/`) || undefined}>
      <summary>{folder} <small>{children.length}</small></summary>
      <FileTree notes={children} selected={selected} choose={choose} prefix={`${prefix}${folder}/`} />
    </details></li>)}
    {files.map((note) => <li key={note.path}><button type="button" title={note.path} aria-current={note.path === selected ? "page" : undefined} onClick={() => choose(note.path)}>{note.title}</button></li>)}
  </ul>;
}
function NoteBody({ content, navigate }: { content: string; navigate: (href: string) => void }) {
  const { t } = useI18n();
  const preview = useMemo(() => vaultPreview(content), [content]);
  return <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm, remarkFrontmatter]} skipHtml components={{
    a: ({ href, children }) => href && /^https?:\/\//i.test(href)
      ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      : <button type="button" className={styles.inlineLink} onClick={() => href && navigate(href)}>{children}</button>,
    img: ({ alt }) => <span className={styles.muted}>[{alt || t("obsidian.attachment")}]</span>,
  }}>{preview}</ReactMarkdown></div>;
}

export function ObsidianWorkspace() {
  const { t, locale } = useI18n();
  const inline = useIsSplitLayout();
  const [vaults, setVaults] = useState<ObsidianVault[]>([]);
  const [vaultId, setVaultId] = useState("");
  const [index, setIndex] = useState<VaultIndex | null>(null);
  const [path, setPath] = useState("");
  const [note, setNote] = useState<VaultNote | null>(null);
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "connected" | "isolated">("all");
  const [sort, setSort] = useState("recent");
  const [view, setView] = useState<View>("library");
  const [graphStarted, setGraphStarted] = useState(false);
  const [pane, setPane] = useState<"files" | "work" | "preview">("work");
  const [scope, setScope] = useState(0);
  const [focus, setFocus] = useState(false);
  const [revision, setRevision] = useState(0);
  const [discovering, setDiscovering] = useState(true);
  const [error, setError] = useState("");
  const [noteError, setNoteError] = useState("");
  const [notice, setNotice] = useState("");
  const reader = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setDiscovering(true); setError("");
    get<{ vaults: ObsidianVault[] }>({}, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setVaults(data.vaults);
      const url = new URL(window.location.href);
      const requested = url.searchParams.get("vault");
      setVaultId((previous) => {
        const id = previous || requested;
        return data.vaults.some((vault) => vault.id === id) ? id! : data.vaults.length === 1 ? data.vaults[0].id : "";
      });
      const nextPath = url.searchParams.get("note") || "";
      setPath(nextPath);
      const mode = url.searchParams.get("view");
      const nextView = mode === "graph" || mode === "read" || mode === "library" ? mode : nextPath ? "read" : "library";
      setView(nextView); if (nextView === "graph") setGraphStarted(true);
    }).catch((failure) => { if (!controller.signal.aborted) setError(String(failure.message)); })
      .finally(() => { if (!controller.signal.aborted) setDiscovering(false); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    setIndex(null);
    if (!vaultId) return;
    const controller = new AbortController(); setError("");
    get<VaultIndex>({ vaultId }, controller.signal).then((data) => { if (!controller.signal.aborted) setIndex(data); })
      .catch((failure) => { if (!controller.signal.aborted) setError(String(failure.message)); });
    return () => controller.abort();
  }, [vaultId, revision]);
  useEffect(() => {
    setNote(null); setNoteError(""); setNotice("");
    if (!vaultId || !path) return;
    const controller = new AbortController();
    get<{ note: VaultNote }>({ vaultId, path }, controller.signal).then((data) => { if (!controller.signal.aborted) setNote(data.note); })
      .catch((failure) => { if (!controller.signal.aborted) setNoteError(String(failure.message)); });
    return () => controller.abort();
  }, [vaultId, path, revision]);
  useEffect(() => {
    if (!focus) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setFocus(false); };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, [focus]);

  const notes = index?.notes ?? EMPTY;
  const neighbors = useMemo(() => noteNeighbors(notes), [notes]);
  const folders = useMemo(() => [...new Set(notes.map((entry) => folderOf(entry.path)))].sort(), [notes]);
  const filtered = useMemo(() => notes.filter((entry) => {
    const degree = neighbors.get(entry.path)?.size ?? 0;
    return (folder === null || folderOf(entry.path) === folder) && (filter === "all" || (filter === "connected" ? degree > 0 : degree === 0))
      && entry.path.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim());
  }), [notes, neighbors, folder, filter, query]);
  const ordered = useMemo(() => [...filtered].sort((a, b) => {
    const primary = sort === "recent" ? b.modified.localeCompare(a.modified) : sort === "links" ? (neighbors.get(b.path)?.size ?? 0) - (neighbors.get(a.path)?.size ?? 0) : a.title.localeCompare(b.title);
    return primary || a.path.localeCompare(b.path);
  }), [filtered, sort, neighbors]);
  const selected = notes.find((entry) => entry.path === path);
  const backlinks = notes.filter((entry) => entry.links.includes(path));
  const outgoing = notes.filter((entry) => selected?.links.includes(entry.path));
  const graphNotes = useMemo(() => {
    if (!scope || !path) return filtered;
    const ids = neighborhood(neighbors, path, scope);
    return filtered.filter((entry) => ids.has(entry.path));
  }, [filtered, scope, path, neighbors]);
  const choose = useCallback((next: string) => { setPath(next); setPane("preview"); setFocus(false); keepLocation(vaultId, next); }, [vaultId]);
  const openNote = useCallback((next: string) => { setPath(next); setView("read"); setPane("work"); setFocus(false); keepLocation(vaultId, next, "read"); }, [vaultId]);
  function changeView(next: View) {
    setView(next); setPane("work"); setFocus(false);
    if (next === "graph") setGraphStarted(true);
    keepLocation(vaultId, path, next);
  }
  function navigate(href: string) {
    const wiki = href.startsWith("?wiki=");
    const target = wiki ? new URLSearchParams(href.slice(1)).get("wiki") ?? "" : href;
    const resolved = vaultLinkResolver(notes.map((entry) => entry.path))(path, target, wiki);
    if (!resolved) { setNotice(t("obsidian.missing", { target })); return; }
    if (resolved === path && target.includes("#")) {
      let heading = target.slice(target.indexOf("#") + 1);
      try { heading = decodeURIComponent(heading); } catch { /* Keep original target. */ }
      const normalize = (text: string) => text.toLowerCase().replace(/[\s_-]+/g, "");
      const element = [...(reader.current?.querySelectorAll("h1,h2,h3,h4,h5,h6") ?? [])].find((element) => normalize(element.textContent ?? "") === normalize(heading));
      if (element) { element.scrollIntoView({ block: "start" }); setNotice(""); }
      else setNotice(t("obsidian.missing", { target }));
    } else if (view === "read") openNote(resolved); else choose(resolved);
  }
  function linkList(entries: VaultEntry[]) {
    return entries.length ? <ul className={styles.linkList}>{entries.map((entry) => <li key={entry.path}><button type="button" onClick={() => view === "read" ? openNote(entry.path) : choose(entry.path)}>
      <span>{entry.title}</span><small>{entry.path}</small>
    </button></li>)}</ul> : <p className={styles.muted}>{t("obsidian.noLinks")}</p>;
  }
  const noteContent = !path ? <p className={styles.empty}>{t("obsidian.exploreHint")}</p>
    : noteError ? <p role="alert" className={styles.error}>{noteError} <button type="button" onClick={() => setRevision((value) => value + 1)}>{t("obsidian.retry")}</button></p>
      : !note ? <p role="status" className={styles.empty}>{t("obsidian.loading")}</p>
        : <div ref={reader}>
          {notice && <p role="status" className={styles.warning}>{notice}</p>}
          <NoteBody content={note.content} navigate={navigate} />
        </div>;
  const connected = notes.filter((entry) => neighbors.get(entry.path)?.size).length;

  return <main className={`robin-dashboard ${styles.workspace}`}>
    <header className={styles.header}>
      <div className={styles.brand}><h1>Obsidian</h1><span className={styles.badge}>{t("obsidian.readonly")}</span></div>
      <div className={styles.controls}>
        <select aria-label={t("notes.obsidian.vault")} value={vaultId} onChange={(event) => {
          setVaultId(event.target.value); setPath(""); setIndex(null); setNote(null); setQuery(""); setFolder(null); setFilter("all"); setScope(0); setPane("work"); setFocus(false);
          keepLocation(event.target.value, "", view);
        }}><option value="">{t("notes.obsidian.choose")}</option>{vaults.map((vault) => <option key={vault.id} value={vault.id}>{vault.name}</option>)}</select>
        <button type="button" aria-label={t("notes.obsidian.refresh")} className="ui-action pi-bracket" disabled={discovering} onClick={() => setRevision((value) => value + 1)}>{t("notes.obsidian.refresh")}</button>
      </div>
    </header>
    <div className={styles.topbar}>
      <nav className={styles.switcher} aria-label={t("notes.views")}>{(["library", "graph", "read"] as const).map((id) => <button type="button" key={id} aria-pressed={view === id} onClick={() => changeView(id)}>
        <svg viewBox="0 0 20 20" aria-hidden="true">{id === "library" ? <path d="M2 2h6v6H2zM12 2h6v6h-6zM2 12h6v6H2zM12 12h6v6h-6z" /> : id === "graph" ? <><path d="m5 5 10 3-5 8-5-11z" /><circle cx="5" cy="5" r="2" /><circle cx="15" cy="8" r="2" /><circle cx="10" cy="16" r="2" /></> : <path d="M3 2h10l4 4v12H3zM7 8h6M7 12h6" />}</svg>
        {t(`obsidian.${id}`)}</button>)}</nav>
      <input type="search" aria-label={t("obsidian.search")} placeholder={t("obsidian.search")} value={query} onChange={(event) => setQuery(event.target.value)} />
      {view === "graph" && <button type="button" className={styles.focusToggle} aria-pressed={focus} onClick={() => { setFocus(!focus); setPane("work"); }}>{t(focus ? "obsidian.exitFocus" : "obsidian.focusMode")}</button>}
    </div>
    {error && <p role="alert" className={styles.error}>{t("obsidian.error")} {error}</p>}
    {!discovering && !vaults.length && !error && <p className={styles.empty}>{t("notes.obsidian.setup")}</p>}
    {(discovering || (vaultId && !index && !error)) && <p role="status" className={styles.empty}>{t("obsidian.loading")}</p>}
    {index?.limited && <p role="status" className={styles.warning}>{t("obsidian.limited")}</p>}
    {!!index?.skipped && <p className={styles.warning}>{t("obsidian.skipped", { count: index.skipped })}</p>}
    {vaultId && index && <>
      <nav className={styles.mobileTabs} aria-label={t("obsidian.connections")}>
        {(["files", "work", "preview"] as const).map((id) => <button type="button" key={id} aria-pressed={pane === id} onClick={() => { setPane(id); if (id !== "work") setFocus(false); }}>{t(id === "work" ? `obsidian.${view}` : `obsidian.${id}`)}</button>)}
      </nav>
      <div className={styles.columns} data-focus={focus}>
        <aside className={styles.files} data-visible={pane === "files"}>
          <h2 className="pi-eyebrow">{t("obsidian.collections")}</h2>
          <div className={styles.filters}>
            {(["all", "connected", "isolated"] as const).map((id) => <button type="button" key={id} aria-pressed={filter === id && folder === null} onClick={() => { setFilter(id); setFolder(null); }}>
              <span>{t(id === "all" ? "obsidian.allNotes" : `obsidian.${id}`)}</span><small>{id === "all" ? notes.length : id === "connected" ? connected : notes.length - connected}</small>
            </button>)}
          </div>
          <div className={styles.folders}>{folders.map((name) => <button type="button" key={name} aria-pressed={folder === name} onClick={() => { setFolder(folder === name ? null : name); setFilter("all"); }}>
            <i style={{ background: `var(--todo-${folderTone(name)})` }} /><span>{name || t("obsidian.root")}</span><small>{notes.filter((entry) => folderOf(entry.path) === name).length}</small>
          </button>)}</div>
          <details className={styles.directory}><summary>{t("obsidian.showFiles")}</summary><FileTree notes={filtered} selected={path} choose={openNote} /></details>
          <p className={styles.privacy}>{t("obsidian.local")}</p>
        </aside>
        <section className={styles.work} data-visible={pane === "work"}>
          {view === "library" && <div className={styles.library}>
            <header className={styles.libraryHeader}><div><p className="pi-eyebrow">{folder === null ? t("obsidian.allNotes") : folder || t("obsidian.root")}</p><h2>{t("obsidian.libraryIntro")}</h2></div>
              <select aria-label={t("obsidian.sort")} value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">{t("obsidian.recent")}</option><option value="links">{t("obsidian.byLinks")}</option><option value="title">{t("obsidian.byTitle")}</option></select>
            </header>
            <div className={styles.resultLine}><span>{t("obsidian.filtered", { count: filtered.length })}</span>{(query || folder !== null || filter !== "all") && <button type="button" onClick={() => { setQuery(""); setFolder(null); setFilter("all"); }}>{t("obsidian.resetFilters")}</button>}</div>
            <div className={styles.cards}>{ordered.map((entry) => <button type="button" key={entry.path} className={styles.card} aria-label={`${entry.title} · ${entry.path}`} aria-pressed={entry.path === path} onClick={() => choose(entry.path)} style={{ "--folder-color": `var(--todo-${folderTone(folderOf(entry.path))})` } as CSSProperties}>
              <span className={styles.cardFolder}><i />{folderOf(entry.path) || t("obsidian.root")}</span>
              <h3>{entry.title}</h3><p>{entry.excerpt || t("notes.editor.empty")}</p>
              <span className={styles.cardFooter}><time dateTime={entry.modified}>{new Date(entry.modified).toLocaleDateString(locale, { month: "short", day: "numeric" })}</time><span>{t("obsidian.degree", { count: neighbors.get(entry.path)?.size ?? 0 })}</span></span>
            </button>)}</div>
            {!filtered.length && <p className={styles.empty}>{t(notes.length ? "obsidian.noMatches" : "obsidian.empty")}</p>}
          </div>}
          {graphStarted && <div className={styles.canvasHost} hidden={view !== "graph"}>
            <div className={styles.graphScope}><label>{t("obsidian.scope")} <select value={scope} onChange={(event) => setScope(Number(event.target.value))}>
              <option value={0}>{t("obsidian.global")}</option><option value={1} disabled={!path}>{t("obsidian.neighborhood")}</option><option value={2} disabled={!path}>{t("obsidian.twoHops")}</option>
            </select></label><span>{t("obsidian.filtered", { count: graphNotes.length })}</span></div>
            <Graph key={vaultId} notes={graphNotes} selected={path} choose={choose} open={openNote} active={view === "graph" && (inline || pane === "work")} />
          </div>}
          {view === "read" && <article className={styles.reader}>
            {note && <div className={styles.noteMeta}><span>{note.path}</span><a className="ui-action" href={note.url}>{t("obsidian.open")}</a></div>}
            {noteContent}
            {note && <><details className={styles.source}><summary>{t("obsidian.source")}</summary><pre>{note.content}</pre></details><p className={styles.privacy}>{t("obsidian.previewHint")}</p></>}
          </article>}
        </section>
        <aside className={styles.inspector} data-visible={pane === "preview"} aria-label={t("obsidian.preview")}>
          <header className={styles.inspectorHeader}><h2 className="pi-eyebrow">{t(view === "read" ? "obsidian.connections" : "obsidian.preview")}</h2>{path && <button type="button" aria-label={t("obsidian.closePreview")} onClick={() => { setPath(""); setScope(0); setPane("work"); keepLocation(vaultId, ""); }}>×</button>}</header>
          {path ? <>
            {view !== "read" && <><div className={styles.previewActions}><button type="button" className="ui-action pi-bracket" aria-label={t("obsidian.fullRead")} onClick={() => openNote(path)}>{t("obsidian.fullRead")}</button>{note && <a href={note.url} className="ui-action">{t("obsidian.open")}</a>}</div>
              <div className={styles.previewBody}>{noteContent}</div></>}
            {note && <div className={styles.previewMeta}><span>{note.path}</span><time dateTime={note.modified}>{t("obsidian.updated", { date: new Date(note.modified).toLocaleDateString(locale) })}</time></div>}
            <div className={styles.connections}><h3>{t("obsidian.backlinks")} <small>{backlinks.length}</small></h3>{linkList(backlinks)}
              <h3>{t("obsidian.outgoing")} <small>{outgoing.length}</small></h3>{linkList(outgoing)}
              {!!selected?.unresolved.length && <details className={styles.unresolved}><summary>{t("obsidian.unresolved")} · {selected.unresolved.length}</summary><ul>{selected.unresolved.map((target) => <li key={target}>{target}</li>)}</ul></details>}
            </div>
          </> : <div className={styles.inspectorEmpty}><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M20 25 50 50 80 20M50 50 25 80M50 50 80 75" /><circle cx="20" cy="25" r="4" /><circle cx="80" cy="20" r="4" /><circle cx="25" cy="80" r="4" /><circle cx="80" cy="75" r="4" /><circle cx="50" cy="50" r="7" /></svg><p>{t("obsidian.exploreHint")}</p></div>}
        </aside>
      </div>
    </>}
  </main>;
}
