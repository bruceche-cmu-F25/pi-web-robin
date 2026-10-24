"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import type { ResearchProject } from "@/extension/robin/research-domain";
import { PaperSheet } from "./PaperSheet";
import { ProjectDialog } from "./ProjectDialog";
import { NeedsPdf, Notebook, ReadingList, ReferenceReadings } from "./ResearchShelf";
import { PRIOR_WORK_READINGS, RESEARCH_READINGS } from "@/extension/robin/research";
import { ResearchThread } from "./ResearchThread";
import { ResearchSessions } from "./ResearchSessions";
import { ResearchDiscovery } from "./ResearchDiscovery";
import { HomeWorkspace } from "./ResearchHome";
import { ReadingQueue, ResearchMark } from "./ResearchDesk";
import { GENERAL, researchHref, researchJson, researchRequest, type ProjectSummary } from "./research-client";
import { iconFallback } from "@/extension/robin/links";
import { linkKind, linkTitle } from "@/lib/research-link-kind";
import { useProjectNotes } from "./useProjectNotes";
import { useResearchReader, type SwitchResearchProject } from "./useResearchReader";
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
  const visible = named.filter((item) => !item.archived);
  const archived = named.filter((item) => item.archived);

  const currentId = project ? project.id : null;
  async function switchTo(id: string | null, href?: string) {
    if (id === currentId) return;
    try { await flushCurrent.current?.(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t("rw.error")); return; }
    router.push(href ?? (id ? researchHref(id) : "/research"), { scroll: false });
    if (!id) return;
    void researchRequest("/api/research/projects", researchJson("PUT", { activeId: id })).catch(() => {});
  }
  function saved(next: ResearchProject) {
    setDialog(null);
    void loadProjects().then(() => { if (next.id !== currentId && !next.archived) void switchTo(next.id); });
  }

  if (!projects) return <div className={`robin-page robin-dashboard ${s.page}`}><main className={s.deskMain}>
    {error ? <p role="alert" className={s.error}>{error} <button className={s.button} onClick={() => void loadProjects()}>{t("rw.retry")}</button></p> : <p className={s.marginHint}>{t("rw.loading")}</p>}
  </main></div>;
  return <div className={`robin-page robin-dashboard ${s.page}`}>
    <div className={s.shell}>
      <nav className={s.switcher} aria-label={t("rw.projects")}>
        <div className={s.deskBrand}>{t("rw.desk.brand")}</div>
        <div className={s.projectTabs} role="tablist" aria-label={t("rw.projects")}>
          <button role="tab" aria-selected={home} className={`${s.projectTab} ${s.homeTab}`} onClick={() => void switchTo(null)}><ResearchMark kind="desk" /><span>{t("rw.home")}</span></button>
          <span className={s.navLabel}>{t("rw.desk.activeProjects")}<span>{visible.length}</span></span>
          {visible.map((item) => <button key={item.id} role="tab" aria-selected={item.id === project?.id} className={s.projectTab} onClick={() => void switchTo(item.id)}>
            <ResearchMark kind="folder" /><span>{item.name}</span>{item.needsPdf ? <span className={s.badge} title={t("rw.needsPdf")}>{item.needsPdf}</span> : null}
          </button>)}
        </div>
        <button className={`pi-bracket ${s.newProject}`} aria-label={t("rw.project.new")} onClick={() => setDialog("new")}>{t("rw.project.new")}</button>
        <div className={s.archiveNav}>
          <button className={s.archiveToggle} aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}><ResearchMark kind="archive" /><span>{t("rw.archived")}</span><span>{archived.length}</span></button>
          {showArchived && <div className={s.archivedList}>
            {archived.map((item) => <button key={item.id} aria-current={item.id === project?.id ? "page" : undefined} onClick={() => void switchTo(item.id)}>{item.name}</button>)}
            {!archived.length && <p>{t("rw.desk.archiveEmpty")}</p>}
          </div>}
        </div>
        <p className={s.navFoot}>{t("rw.desk.filingHint")}</p>
      </nav>
      <main className={s.deskMain}>
        {error && <p role="alert" className={s.error}>{error}</p>}
        {project ? <ProjectWorkspace key={project.id} project={project} projects={projects} onEdit={() => setDialog("edit")}
          onProjectsChange={loadProjects} registerFlush={registerFlush} onSwitch={switchTo} />
          : <HomeWorkspace projects={projects} onProjectsChange={loadProjects} onSwitch={switchTo} onNewProject={() => setDialog("new")} />}
      </main>
      {dialog && <ProjectDialog project={dialog === "edit" ? project ?? undefined : undefined} onClose={() => setDialog(null)} onSaved={saved} />}
    </div>
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
  registerFlush: (flush: (() => Promise<void>) | null) => void; onSwitch: SwitchResearchProject;
}) {
  const { t } = useI18n();
  const params = useSearchParams();
  const [view, setView] = useState<"overview" | "papers" | "assistant">(() => params.has("conversation") ? "assistant" : "overview");
  const focusField = useRef<HTMLTextAreaElement>(null);
  const notes = useProjectNotes(project.id, useMemo(() => ({ error: t("rw.notesError"), limit: t("rw.notesLimit") }), [t]));
  useEffect(() => { registerFlush(notes.flush); return () => registerFlush(null); }, [notes.flush, registerFlush]);
  const { selected, papers, paper, loading, error, thread, titles, refresh, open, navigate, selectConversation, changed, uploaded, uploadPdf } =
    useResearchReader({ projectId: project.id, beforeAsk: notes.flush, onProjectsChange, onSwitch });
  const currentConversation = thread.state.conversation;
  const needs = papers.filter((item) => item.needsPdf);

  const briefLead = project.brief.trim().split(/\n\s*\n/)[0];
  return <>
    <header className={`${s.projectHead} ${s.projectIntro}`}>
      <p className={s.deskEyebrow}><ResearchMark kind={project.archived ? "archive" : "folder"} />{t(project.archived ? "rw.archived" : "rw.desk.activeProject")}</p>
      <div className={s.projectTitleRow}>
        <h1>{project.name}</h1>
        <button className={`pi-bracket ${s.textButton}`} aria-label={t("rw.project.edit")} onClick={onEdit}>{t("rw.project.edit")}</button>
      </div>
      {briefLead ? <p className={s.brief} title={project.brief}>{briefLead}</p>
        : <button className={s.briefEmpty} onClick={onEdit}>{t("rw.project.briefMissing")}</button>}
      {(!!project.links.length || project.reference === "heat") && <details className={s.projectResources} open>
      <summary>{t("rw.chat.resources")}</summary>
      {!!project.links.length && <ul className={s.links} aria-label={t("rw.project.links")}>
        {project.links.map((link) => <li key={link.url}><LinkChip title={link.title} url={link.url} /></li>)}
      </ul>}
      {project.reference === "heat" && <nav className={s.references} aria-label={t("rw.ref.title")}>
        <span>{t("rw.ref.title")}</span>
        {HEAT_REFERENCES.map(([path, key]) => <a key={path} href={`/research/${path}`}>{t(key)}</a>)}
      </nav>}
      </details>}
    </header>
    <nav className={s.workspaceNav} aria-label={t("rw.view.label")}>
      {(["overview", "papers", "assistant"] as const).map((item) => <button key={item} type="button" aria-pressed={view === item} aria-controls={`research-view-${item}`} onClick={() => setView(item)}>
        <ResearchMark kind={item === "overview" ? "desk" : item === "papers" ? "book" : "spark"} />{t(`rw.view.${item}`)}{item === "papers" && papers.length > 0 && <span>{papers.length}</span>}
        {item === "assistant" && thread.busy && <span>{t("rw.view.working")}</span>}
      </button>)}
    </nav>
    {error && <p role="alert" className={s.error}>{error} <button className={s.button} onClick={refresh}>{t("rw.retry")}</button></p>}
    {!!needs.length && view !== "papers" && <button type="button" className={s.needsBanner} onClick={() => setView("papers")}>{t("rw.needsBanner", { count: needs.length })} →</button>}
    <div id="research-view-overview" className={s.overview} hidden={view !== "overview"}>
    <section className={s.focus} aria-labelledby="research-focus-label">
      <div className={s.deskSectionHead}><span className={s.sectionMark}><ResearchMark kind="target" /></span><div><label id="research-focus-label" htmlFor="research-focus">{t("rw.focus")}</label><p>{t("rw.desk.focusPrompt")}</p></div></div>
      <textarea id="research-focus" ref={focusField} className={s.focusField} value={notes.objective} disabled={!notes.loaded || notes.capturing} maxLength={10_000}
        rows={Math.min(10, Math.max(2, notes.objective.split("\n").length))} placeholder={t("rw.focusPlaceholder")}
        onChange={(event) => notes.setObjective(event.target.value)} onBlur={notes.saveSoon} />
      <div className={s.focusFooter}>
        <span className={s.focusState} data-state={notes.saveState} aria-live="polite">{t(`rw.save.${notes.saveState}`)} · {t("rw.focusHint")}</span>
        <details className={s.focusHelp}><summary>{t("rw.desk.goalHelp")}</summary><p>{t("rw.plan.weekHint")}</p></details>
      </div>
    </section>
    <Notebook notes={notes} projectName={project.name} planning />
    <ReadingQueue papers={papers} loading={loading} onOpen={open} onLibrary={() => setView("papers")} />
    </div>
    <div id="research-view-assistant" className={s.workspacePanel} hidden={view !== "assistant"}>
      <div className={s.conversationColumn}>
      <ResearchSessions projectId={project.id} thread={thread} paperTitles={titles} onSelect={selectConversation} onOpenPaper={open} />
      <ResearchThread onUpload={uploadPdf} thread={thread} projectId={project.id} projectName={project.name} projectNames={new Map(projects.map((item) => [item.id, item.name]))} focus={notes.objective} paperTitles={titles}
        onOpenPaper={open} onNavigate={navigate} onKeep={(message) => notes.capture(message.id)} captures={notes.captureState.captures} onEditFocus={() => { setView("overview"); requestAnimationFrame(() => focusField.current?.focus()); }} />
      </div>
    </div>
    <div id="research-view-papers" className={s.workspacePanel} hidden={view !== "papers"}>
      <div className={s.paperWorkspace}>
        <div className={s.paperCollection}>
          <div className={s.sectionHeading}><h2>{t("rw.papers")}</h2><button type="button" className={s.textButton} onClick={() => setView("assistant")}>{t("rw.view.addPaper")}</button></div>
        <NeedsPdf papers={needs} onUploaded={(item) => { setView("assistant"); void uploaded(item); }} onOpen={open} />
        <ReadingList papers={papers} loading={loading} onOpen={open} currentPaperId={currentConversation?.paperId} />
        {project.reference === "heat" && <details className={s.discoveryDrawer}>
          <summary>{t("rw.readings")}</summary>
          <ReferenceReadings projectId={project.id} papers={papers} onOpen={(id) => { refresh(); open(id); }}
            lists={[{ title: t("research.readings.title"), readings: RESEARCH_READINGS }, { title: t("research.readings.priorWork"), readings: PRIOR_WORK_READINGS }]} />
        </details>}
        </div>
        <section className={s.catalogColumn} aria-label={t("rw.chat.catalogs")}>
          <h2 className={s.sectionTitle}>{t("rw.chat.catalogs")}</h2>
          <ResearchDiscovery projectId={project.id} beforeSearch={notes.flush} onAdded={refresh} onOpen={open} />
        </section>
      </div>
    </div>
    {selected && paper?.id === selected && <PaperSheet key={paper.id} paper={paper} project={project} projects={projects} thread={thread}
      onSelectConversation={(id) => selectConversation(id, true)}
      onChange={changed}
      onClose={() => open(null)} onNavigate={navigate} onRemoved={() => { open(null); refresh(); }} />}
  </>;
}
