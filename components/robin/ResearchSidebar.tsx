"use client";

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useSearchParams } from "next/navigation";
import type { ResearchSessionSummary } from "@/extension/robin/research-domain";
import type { ResearchThread } from "./useResearchThread";
import { GENERAL, researchHref, researchJson, researchRequest, type ProjectSummary } from "./research-client";
import s from "./ResearchWorkspace.module.css";

export type ResearchSidebarContext = {
  thread: ResearchThread; paperTitles: Map<string, string>;
  onSelect: (id: string) => Promise<void>; onOpenPaper: (id: string) => void; onOverview: () => void;
};
export type ResearchNavigation = (context: ResearchSidebarContext) => ReactNode;

/** One mounted navigation tree: permanent on desktop, a disclosure above the desk on phones. */
export function ResearchNavigationPanel({ name, children }: { name: string; children: ReactNode }) {
  const { t } = useI18n();
  const selection = useSearchParams().toString();
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (content.current?.contains(document.activeElement) && window.matchMedia("(max-width: 760px)").matches) trigger.current?.focus({ preventScroll: true });
    setOpen(false);
  }, [selection]);
  return <aside className={`robin-workspace-rail ${s.switcher}`} onKeyDown={event => {
    if (event.key === "Escape" && open && !event.defaultPrevented) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" className={s.navigationToggle} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <span>{t("rw.projects")} · {name}</span><span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    <div ref={content} id={id} className={s.navigationContent} data-open={open}>{children}</div>
  </aside>;
}

/** A metadata tree, not more mounted readers: only expanded, inactive groups fetch a list. */
export function ResearchSidebar({ projects, currentId, context, expanded, onExpanded, onSwitch, onNewProject }: {
  projects: ProjectSummary[]; currentId: string; context: ResearchSidebarContext;
  expanded: Record<string, boolean>; onExpanded: (id: string, open: boolean) => void;
  onSwitch: (id: string | null, href?: string) => Promise<void>; onNewProject: () => void;
}) {
  const { t } = useI18n();
  const currentArchived = !!projects.find(project => project.id === currentId)?.archived;
  const [archived, setArchived] = useState(currentArchived);
  useEffect(() => { if (currentArchived) setArchived(true); }, [currentId, currentArchived]);
  const named = projects.filter(project => !project.general);
  const groups = [{ id: GENERAL, name: t("rw.home"), archived: false }, ...named.filter(project => !project.archived)];
  const old = named.filter(project => project.archived);
  const group = (project: { id: string; name: string }) => <SessionGroup key={project.id} project={project}
    current={project.id === currentId} context={context}
    open={expanded[project.id] ?? project.id === currentId} onToggle={open => onExpanded(project.id, open)}
    onSelect={async id => {
      if (project.id === currentId) await context.onSelect(id);
      else await onSwitch(project.id === GENERAL ? null : project.id, researchHref(project.id, null, id));
    }} onProject={async () => { if (project.id === currentId) context.onOverview(); else await onSwitch(project.id === GENERAL ? null : project.id); }} />;
  return <nav className={s.projectNavigation} aria-label={t("rw.projects")}>
    <header className={s.treeToolbar}><span>{t("rw.desk.brand")}</span>
      <button type="button" className={s.treeIconButton} aria-label={t("rw.project.new")} title={t("rw.project.new")} onClick={onNewProject}>+</button>
    </header>
    <div className={s.projectTree}>{groups.map(group)}</div>
    <details className={s.treeArchive} open={archived} onToggle={event => setArchived(event.currentTarget.open)}>
      <summary>{t("rw.archived")} <span>{old.length}</span></summary>
      {old.map(group)}
      {!old.length && <p className={s.treeHint}>{t("rw.desk.archiveEmpty")}</p>}
    </details>
  </nav>;
}

function SessionGroup({ project, current, context, open, onToggle, onSelect, onProject }: {
  project: { id: string; name: string }; current: boolean; context: ResearchSidebarContext;
  open: boolean; onToggle: (open: boolean) => void; onSelect: (id: string) => Promise<void>; onProject: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const selection = useRef(context.thread.state.conversation?.id);
  selection.current = context.thread.state.conversation?.id;
  const [loaded, setLoaded] = useState<ResearchSessionSummary[] | null>(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState(false);
  const [archive, setArchive] = useState(false);
  const [limit, setLimit] = useState(6);
  const [menu, setMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ item?: ResearchSessionSummary; title: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!open || current) return;
    const controller = new AbortController();
    setError("");
    void researchRequest<{ sessions: ResearchSessionSummary[] }>(`/api/research/sessions?project=${encodeURIComponent(project.id)}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setLoaded(result.sessions); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("rw.error")); });
    return () => controller.abort();
  }, [current, open, project.id, reload, t]);
  const sessions = current ? context.thread.state.sessions ?? [] : loaded ?? [];
  const ready = current ? context.thread.ready : loaded !== null;
  const selected = current ? context.thread.state.conversation : undefined;
  const run = context.thread.state.run;
  const label = (item: ResearchSessionSummary) => item.title || t(item.kind === "history" ? "rw.sessions.history" : item.paperId ? "rw.sessions.reading" : "rw.sessions.discussion");
  const matches = sessions.filter(item => (!!item.archived === archive || item.id === selected?.id) &&
    `${label(item)} ${current && item.paperId ? context.paperTitles.get(item.paperId) ?? "" : ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const shown = matches.filter((item, index) => index < limit || item.id === selected?.id || item.id === run?.conversationId);
  const activeCount = sessions.filter(item => !item.archived).length;
  async function refresh() { if (current) await context.thread.reload(); else setReload(value => value + 1); }
  async function select(item: ResearchSessionSummary) {
    try { await onSelect(item.id); }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : t("rw.error")); }
  }
  async function mutate(item?: ResearchSessionSummary, archived?: boolean) {
    if (busy) return;
    const origin = selection.current;
    setBusy(true); setError("");
    try {
      const result = await researchRequest<{ conversation: ResearchSessionSummary }>("/api/research/sessions", researchJson(item ? "PATCH" : "POST", item
        ? { projectId: project.id, id: item.id, revision: item.revision, patch: archived === undefined ? { title: editing?.title } : { archived } }
        : { projectId: project.id, title: editing?.title, paperId: selected?.paperId }));
      if (!mounted.current) return;
      setEditing(null); setMenu(null); setQuery("");
      await refresh();
      if (mounted.current && selection.current === origin) {
        if (!item) await onSelect(result.conversation.id);
        if (mounted.current) toggle.current?.focus({ preventScroll: true });
      }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : t("rw.error")); }
    finally { if (mounted.current) setBusy(false); }
  }
  function newConversation() { onToggle(true); setEditing({ title: "" }); setMenu(null); setError(""); }
  return <section className={s.treeGroup} aria-label={project.name} data-current={current}>
    <div className={s.treeGroupHeader}>
      <button ref={toggle} type="button" className={s.treeGroupToggle} aria-expanded={open} aria-controls={id} title={project.name} onClick={() => { onToggle(!open); setLimit(6); }}>
        <span className={s.treeChevron} aria-hidden="true">{open ? "▾" : "▸"}</span><span className={s.treeGroupName}>{project.name}</span>
        {run?.projectId === project.id ? <span className={s.treeRunning} role="img" aria-label={t("rw.sessions.running")} /> : ready && <span className={s.treeCount}>{activeCount}</span>}
      </button>
      <button type="button" className={s.treeIconButton} aria-label={t("rw.sessions.newIn", { project: project.name })} title={t("rw.sessions.new")} disabled={busy || (current && !ready)} onClick={newConversation}>+</button>
    </div>
    <div id={id} hidden={!open} className={s.treeChildren}>
      <div className={s.treeTools}>
        <a href={researchHref(project.id)} onClick={event => { if (plainClick(event)) { event.preventDefault(); void onProject(); } }}>{t("rw.view.overview")}</a>
        <button type="button" aria-expanded={search} aria-controls={`${id}-search`} onClick={() => { setSearch(!search); setQuery(""); }}>{t("rw.sessions.search")}</button>
      </div>
      {search && <input id={`${id}-search`} className={s.treeSearch} type="search" autoFocus value={query} aria-label={t("rw.sessions.search")} placeholder={t("rw.sessions.search")} onChange={event => { setQuery(event.target.value); setLimit(6); }} />}
      <ul className={s.treeSessions}>
        {shown.map(item => <li key={item.id}>
          <div className={s.treeSession} data-selected={item.id === selected?.id}>
            <a href={researchHref(project.id, null, item.id)} className={s.treeSessionLink} aria-current={item.id === selected?.id ? "page" : undefined}
              title={`${label(item)}\n${t("rw.sessions.messages", { count: item.messageCount })}${item.updatedAt ? ` · ${new Date(item.updatedAt).toLocaleString(locale)}` : ""}`}
              onClick={event => { if (plainClick(event)) { event.preventDefault(); void select(item); } }}>
              <span className={s.treeSessionTitle}>{label(item)}</span>
              {run?.conversationId === item.id ? <span className={s.treeRunning} role="img" aria-label={t("rw.sessions.running")} />
                : <span className={s.treeTime}>{item.archived ? t("rw.sessions.archived") : item.updatedAt && <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString(locale, { month: "numeric", day: "numeric" })}</time>}</span>}
            </a>
            <button type="button" className={s.treeIconButton} aria-expanded={menu === item.id} aria-controls={`${id}-${item.id}-actions`} aria-label={t("rw.sessions.actions", { title: label(item) })} title={t("rw.sessions.actions", { title: label(item) })} onClick={() => setMenu(menu === item.id ? null : item.id)}>⋯</button>
          </div>
          {menu === item.id && <div id={`${id}-${item.id}-actions`} className={s.treeRowActions} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setMenu(null); toggle.current?.focus(); } }}>
            <button type="button" disabled={busy} onClick={() => { setEditing({ item, title: label(item) }); setMenu(null); }}>{t("rw.sessions.rename")}</button>
            <button type="button" disabled={busy || run?.conversationId === item.id} onClick={() => void mutate(item, !item.archived)}>{t(item.archived ? "rw.sessions.restore" : "rw.sessions.archive")}</button>
            {current && item.paperId && <button type="button" onClick={() => context.onOpenPaper(item.paperId!)}>{t("rw.sessions.openPaper")} →</button>}
          </div>}
        </li>)}
      </ul>
      {!ready && !error && !(current && context.thread.error) && <p className={s.treeHint}>{t("rw.loading")}</p>}
      {current && !ready && context.thread.error && <a className={s.treeFooter} href={researchHref(project.id)}>{t("rw.sessions.discussion")} →</a>}
      {ready && !matches.length && <p className={s.treeHint}>{t("rw.noMatch")}</p>}
      {matches.length > shown.length && <button type="button" className={s.treeFooter} onClick={() => setLimit(value => value + 20)}>{t("rw.sessions.more", { count: matches.length - shown.length })}</button>}
      <button type="button" className={s.treeFooter} aria-pressed={archive} onClick={() => { setArchive(!archive); setLimit(6); }}>{t(archive ? "rw.sessions.active" : "rw.sessions.archived")} · {sessions.filter(item => !!item.archived === !archive).length}</button>
      {editing && <form className={s.treeForm} onSubmit={event => { event.preventDefault(); void mutate(editing.item); }}>
        <label className={s.field}>{t(editing.item ? "rw.sessions.rename" : "rw.sessions.newTitle")}
          <input autoFocus required maxLength={200} value={editing.title} disabled={busy} onChange={event => setEditing({ ...editing, title: event.target.value })} /></label>
        <div className={s.treeRowActions}>
          <button disabled={busy || !editing.title.trim()}>{t(busy ? "rw.saving" : "rw.save")}</button>
          <button type="button" disabled={busy} onClick={() => { setEditing(null); toggle.current?.focus(); }}>{t("rw.cancel")}</button>
        </div>
      </form>}
      {selected?.archived && <p className={s.treeHint}>{t("rw.sessions.archivedHint")}</p>}
      {error && <p role="alert" className={s.error}>{error} <button type="button" className={s.textButton} onClick={() => void refresh().catch(() => {})}>{t("rw.retry")}</button></p>}
    </div>
  </section>;
}

function plainClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}
