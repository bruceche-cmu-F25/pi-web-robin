"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import type { Paper } from "@/extension/robin/papers-domain";
import type { ResearchMessage, ResearchProject } from "@/extension/robin/research-domain";
import { PaperSheet } from "./PaperSheet";
import { ProjectDialog } from "./ProjectDialog";
import { NeedsPdf, Notebook, ReadingList, ReferenceReadings } from "./ResearchShelf";
import { PRIOR_WORK_READINGS, RESEARCH_READINGS } from "@/extension/robin/research";
import { ResearchThread } from "./ResearchThread";
import { HomeWorkspace } from "./ResearchHome";
import { GENERAL, paperSummary, researchHref, researchJson, researchRequest, type PaperSummary, type ProjectSummary } from "./research-client";
import { iconFallback } from "@/extension/robin/links";
import { linkKind, linkTitle } from "@/lib/research-link-kind";
import { useProjectNotes } from "./useProjectNotes";
import { useResearchThread } from "./useResearchThread";
import s from "./ResearchWorkspace.module.css";

const HEAT_REFERENCES = [["heat", "rw.ref.stack"], ["brief", "rw.ref.brief"], ["report", "rw.ref.report"], ["code", "rw.ref.code"], ["run", "rw.ref.run"], ["urrag", "rw.ref.urrag"]] as const;

/**
 * The research workspace: pick a project, say what you are after this week, ask. The agent finds, obtains
 * and reads papers; only papers it cannot obtain come back to the researcher, as one short list.
 */
export function ResearchWorkspace() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"new" | "edit" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const flushCurrent = useRef<(() => Promise<void>) | null>(null);
  const registerFlush = useCallback((flush: (() => Promise<void>) | null) => { flushCurrent.current = flush; }, []);
  const loadProjects = useCallback(async () => {
    try {
      const result = await researchRequest<{ projects: ProjectSummary[] }>("/api/research/projects");
      setProjects(result.projects); setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("rw.error")); }
  }, [t]);
  useEffect(() => { void loadProjects(); }, [loadProjects]);
  // /research is the research home; ?project= opens a project's tab.
  const requested = params.get("project");
  const named = (projects ?? []).filter((item) => !item.general);
  const project = requested && requested !== GENERAL ? named.find((item) => item.id === requested) ?? null : null;
  const home = !project;
  const visible = named.filter((item) => !item.archived || item.id === project?.id);
  const archived = named.filter((item) => item.archived && item.id !== project?.id);

  const currentId = project ? project.id : null;
  async function switchTo(id: string | null) {
    if (id === currentId) return;
    try { await flushCurrent.current?.(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t("rw.error")); return; }
    router.push(id ? researchHref(id) : "/research", { scroll: false });
    if (!id) return;
    void researchRequest("/api/research/projects", researchJson("PUT", { activeId: id })).catch(() => {});
  }
  function saved(next: ResearchProject) {
    setDialog(null);
    void loadProjects().then(() => { if (next.id !== currentId && !next.archived) void switchTo(next.id); });
  }

  if (!projects) return <div className={`robin-page robin-dashboard ${s.page}`}><main className={s.shell}>
    {error ? <p role="alert" className={s.error}>{error} <button className={s.button} onClick={() => void loadProjects()}>{t("rw.retry")}</button></p> : <p className={s.marginHint}>{t("rw.loading")}</p>}
  </main></div>;
  return <div className={`robin-page robin-dashboard ${s.page}`}>
    <main className={s.shell}>
      <nav className={s.switcher} aria-label={t("rw.projects")}>
        <div className={s.projectTabs} role="tablist">
          <button role="tab" aria-selected={home} className={`${s.projectTab} ${s.homeTab}`} onClick={() => void switchTo(null)}>{t("rw.home")}</button>
          <span className={s.tabRule} aria-hidden="true" />
          {visible.map((item) => <button key={item.id} role="tab" aria-selected={item.id === project?.id} className={s.projectTab} onClick={() => void switchTo(item.id)}>
            {item.name}{item.needsPdf ? <span className={s.badge} title={t("rw.needsPdf")}>{item.needsPdf}</span> : null}
          </button>)}
          {!!archived.length && <span className={s.archivedMenu}>
            <button className={s.projectTab} aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>{t("rw.archived")} · {archived.length}</button>
            {showArchived && <span className={s.archivedList}>{archived.map((item) => <button key={item.id} onClick={() => { setShowArchived(false); void switchTo(item.id); }}>{item.name}</button>)}</span>}
          </span>}
        </div>
        <button className={s.newProject} onClick={() => setDialog("new")}>+ {t("rw.project.new")}</button>
      </nav>
      {error && <p role="alert" className={s.error}>{error}</p>}
      {project ? <ProjectWorkspace key={project.id} project={project} projects={projects} onEdit={() => setDialog("edit")}
        onProjectsChange={loadProjects} registerFlush={registerFlush} onSwitch={switchTo} />
        : <HomeWorkspace projects={projects} onProjectsChange={loadProjects} onSwitch={switchTo} onNewProject={() => setDialog("new")} />}
      {dialog && <ProjectDialog project={dialog === "edit" ? project ?? undefined : undefined} onClose={() => setDialog(null)} onSaved={saved} />}
    </main>
  </div>;
}

/** A project link as a chip: the service's own icon, the link's name, and which service it is. */
function LinkChip({ title, url }: { title: string; url: string }) {
  const kind = linkKind(url);
  const { letter, hue } = iconFallback({ title, url });
  const [icon, setIcon] = useState<"loading" | "loaded" | "failed">("loading");
  const [mounted, setMounted] = useState(false);
  // Insert the image after hydration so a cached response cannot load before React's handler attaches.
  useEffect(() => { setMounted(true); }, []);
  return <a className={s.linkChip} href={url} target="_blank" rel="noopener noreferrer" title={`${title}\n${url}`}>
    <span className={s.linkIcon} aria-hidden="true" data-loaded={icon === "loaded"} style={icon === "loaded" ? undefined : { background: `hsl(${hue} 22% 42%)` }}>
      {icon !== "loaded" && letter}
      {mounted && icon !== "failed" && (
        // Served from our own guarded cache; the browser never contacts the icon's origin.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/research/link-icon?url=${encodeURIComponent(url)}`} alt="" width={20} height={20} data-loaded={icon === "loaded"}
          onLoad={() => setIcon("loaded")} onError={() => setIcon("failed")} />
      )}
    </span>
    <span className={s.linkText}><strong>{linkTitle(title, url)}</strong><small>{kind.label}</small></span>
    <span className={s.linkArrow} aria-hidden="true">↗</span>
  </a>;
}

function ProjectWorkspace({ project, projects, onEdit, onProjectsChange, registerFlush, onSwitch }: {
  project: ProjectSummary; projects: ProjectSummary[]; onEdit: () => void; onProjectsChange: () => Promise<void>;
  registerFlush: (flush: (() => Promise<void>) | null) => void; onSwitch: (id: string | null) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const selected = useSearchParams().get("paper");
  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [paper, setPaper] = useState<Paper | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const focusField = useRef<HTMLTextAreaElement>(null);
  const notes = useProjectNotes(project.id, useMemo(() => ({ error: t("rw.notesError"), limit: t("rw.notesLimit") }), [t]));
  useEffect(() => { registerFlush(notes.flush); return () => registerFlush(null); }, [notes.flush, registerFlush]);
  const refresh = useCallback(() => { setReload((n) => n + 1); void onProjectsChange(); }, [onProjectsChange]);
  const thread = useResearchThread({ projectId: project.id, locale, beforeAsk: notes.flush, onChange: refresh, fallbackError: t("rw.error") });
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void researchRequest<{ papers: PaperSummary[] }>(`/api/research/papers?project=${encodeURIComponent(project.id)}`, { signal: controller.signal })
      .then((result) => { setPapers(result.papers); setError(""); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [project.id, reload]);
  useEffect(() => {
    if (!selected) { setPaper(null); return; }
    const controller = new AbortController();
    void researchRequest<{ paper: Paper }>(`/api/research/papers?id=${encodeURIComponent(selected)}`, { signal: controller.signal })
      .then((result) => setPaper(result.paper))
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [selected, reload]);
  const open = useCallback((id: string | null) => router.push(researchHref(project.id, id), { scroll: false }), [project.id, router]);
  const navigate = useCallback((href: string) => {
    const url = new URL(href, window.location.href);
    if (url.origin === window.location.origin && url.pathname === "/research") {
      const target = url.searchParams.get("project");
      if (target && target !== project.id) { void onSwitch(target); return; }
      open(url.searchParams.get("paper"));
    } else if (url.origin === window.location.origin) router.push(url.pathname + url.search);
    else if (["http:", "https:"].includes(url.protocol)) window.open(url.href, "_blank", "noopener,noreferrer");
  }, [onSwitch, open, project.id, router]);
  const keep = useCallback(async (message: ResearchMessage) => {
    const ids = new Set([...message.text.matchAll(/[?&]paper=([a-zA-Z0-9-]+)/g)].map((match) => match[1]));
    if (message.paperId) ids.add(message.paperId);
    const library = ids.size ? (await researchRequest<{ papers: PaperSummary[] }>("/api/research/papers")).papers : [];
    const sources = library.filter((item) => ids.has(item.id)).map((item) => `- [${item.title.replace(/[[\]]/g, "")}](<${item.url}>)`);
    const date = new Date().toLocaleDateString(locale === "en" ? "en-CA" : "zh-CN");
    await notes.append(`### ${date} · ${t("rw.keptHeading")}\n\n${message.text}${sources.length ? `\n\n${t("rw.sources")}:\n${sources.join("\n")}` : ""}`);
  }, [locale, notes, t]);
  const titles = useMemo(() => new Map(papers.map((item) => [item.id, item.title])), [papers]);
  if (paper && !titles.has(paper.id)) titles.set(paper.id, paper.title);
  const needs = papers.filter((item) => item.needsPdf);
  function uploaded(item: PaperSummary) {
    refresh();
    if (!thread.busy && !thread.elsewhere) void thread.send(t("rw.paper.readUploadedNamed", { title: item.title }), item.id);
  }

  const briefLead = project.brief.trim().split(/\n\s*\n/)[0];
  return <>
    <div className={s.top}>
    <header className={s.projectHead}>
      <div className={s.projectTitleRow}>
        <h1>{project.name}</h1>
        <button className={s.textButton} onClick={onEdit}>{t("rw.project.edit")}</button>
      </div>
      {briefLead ? <p className={s.brief} title={project.brief}>{briefLead}</p>
        : <button className={s.briefEmpty} onClick={onEdit}>{t("rw.project.briefMissing")}</button>}
      {!!project.links.length && <ul className={s.links} aria-label={t("rw.project.links")}>
        {project.links.map((link) => <li key={link.url}><LinkChip title={link.title} url={link.url} /></li>)}
      </ul>}
      {project.reference === "heat" && <nav className={s.references} aria-label={t("rw.ref.title")}>
        <span>{t("rw.ref.title")}</span>
        {HEAT_REFERENCES.map(([path, key]) => <a key={path} href={`/research/${path}`}>{t(key)}</a>)}
      </nav>}
    </header>
    <section className={s.focus} aria-labelledby="research-focus-label">
      <label id="research-focus-label" htmlFor="research-focus">{t("rw.focus")}</label>
      <textarea id="research-focus" ref={focusField} className={s.focusField} value={notes.objective} disabled={!notes.loaded || notes.capturing} maxLength={10_000}
        rows={Math.min(10, Math.max(2, notes.objective.split("\n").length))} placeholder={t("rw.focusPlaceholder")}
        onChange={(event) => notes.setObjective(event.target.value)} onBlur={notes.saveSoon} />
      <span className={s.focusState} data-state={notes.saveState} aria-live="polite">{t(`rw.save.${notes.saveState}`)} · {t("rw.focusHint")}</span>
    </section>
    </div>
    {error && <p role="alert" className={s.error}>{error} <button className={s.button} onClick={refresh}>{t("rw.retry")}</button></p>}
    {!!needs.length && <a className={s.needsBanner} href="#research-needs-pdf">{t("rw.needsBanner", { count: needs.length })} ↓</a>}
    <div className={s.workGrid}>
      <ResearchThread thread={thread} projectId={project.id} projectName={project.name} focus={notes.objective} paperTitles={titles}
        onOpenPaper={open} onNavigate={navigate} onKeep={keep} onEditFocus={() => focusField.current?.focus()} />
      <aside className={s.margin} aria-label={t("rw.margin")}>
        <NeedsPdf papers={needs} onUploaded={uploaded} onOpen={open} />
        <ReadingList papers={papers} loading={loading} onOpen={open} />
        {project.reference === "heat" && <ReferenceReadings projectId={project.id} papers={papers} onOpen={(id) => { refresh(); open(id); }}
          lists={[{ title: t("research.readings.title"), readings: RESEARCH_READINGS }, { title: t("research.readings.priorWork"), readings: PRIOR_WORK_READINGS }]} />}
        <Notebook notes={notes} projectName={project.name} />
      </aside>
    </div>
    {selected && paper?.id === selected && <PaperSheet key={paper.id} paper={paper} project={project} projects={projects} thread={thread}
      onChange={(next) => { setPaper(next); setPapers((current) => current.map((item) => item.id === next.id ? paperSummary(next) : item)); }}
      onClose={() => open(null)} onNavigate={navigate} onRemoved={() => { open(null); refresh(); }} />}
  </>;
}
