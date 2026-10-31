"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import type { ResearchProject } from "@/extension/robin/research-domain";
import { PaperSheet } from "./PaperSheet";
import { ProjectDialog } from "./ProjectDialog";
import { NeedsPdf, Notebook, ReadingList } from "./ResearchShelf";
import { ResearchThread } from "./ResearchThread";
import { ResearchNavigationPanel, ResearchSidebar, type ResearchNavigation } from "./ResearchSidebar";
import { ResearchDiscovery } from "./ResearchDiscovery";
import { HomeWorkspace } from "./ResearchHome";
import { ResearchResources } from "./ResearchDesk";
import rail from "./WorkspaceRail.module.css";
import { GENERAL, researchHref, researchJson, researchRequest, type ProjectSummary } from "./research-client";
import { useProjectNotes } from "./useProjectNotes";
import { SaveStatus } from "./SaveStatus";
import { useResearchReader, type SwitchResearchProject } from "./useResearchReader";
import s from "./ResearchWorkspace.module.css";

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
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
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

  const currentId = project ? project.id : null;
  async function switchTo(id: string | null, href?: string) {
    if (id === currentId) return;
    try { await flushCurrent.current?.(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t("rw.error")); return; }
    setExpandedGroups(previous => ({ ...previous, [currentId ?? GENERAL]: previous[currentId ?? GENERAL] ?? true, [id ?? GENERAL]: true }));
    router.push(href ?? (id ? researchHref(id) : "/research"), { scroll: false });
    if (!id) return;
    void researchRequest("/api/research/projects", researchJson("PUT", { activeId: id })).catch(() => {});
  }
  function saved(next: ResearchProject) {
    setDialog(null);
    void loadProjects().then(() => { if (next.id !== currentId && !next.archived) void switchTo(next.id); });
  }

  if (!projects) return <div className={`robin-page robin-dashboard robin-workspace-ground ${s.page}`}><main className={s.deskMain}>
    {error ? <p role="alert" className={s.error}>{error} <button className={s.button} onClick={() => void loadProjects()}>{t("rw.retry")}</button></p> : <p className={s.marginHint}>{t("rw.loading")}</p>}
  </main></div>;
  const navigation: ResearchNavigation = context => <>
    <ResearchSidebar projects={projects} currentId={currentId ?? GENERAL} context={context} expanded={expandedGroups}
      onExpanded={(id, open) => setExpandedGroups(previous => ({ ...previous, [id]: open }))}
      onSwitch={switchTo} onNewProject={() => setDialog("new")} />
    {error && <p role="alert" className={s.error}>{error}</p>}
  </>;
  return <div className={`robin-page robin-dashboard robin-workspace-ground ${s.page}`}>
    <div className={`pi-grid-surface robin-workspace-ground ${s.shell}`}>
        {project ? <ProjectWorkspace key={project.id} project={project} projects={projects} navigation={navigation} onEdit={() => setDialog("edit")}
          onProjectsChange={loadProjects} registerFlush={registerFlush} onSwitch={switchTo} />
          : <HomeWorkspace projects={projects} navigation={navigation} onProjectsChange={loadProjects} onSwitch={switchTo} onNewProject={() => setDialog("new")} />}
      {dialog && <ProjectDialog project={dialog === "edit" ? project ?? undefined : undefined} onClose={() => setDialog(null)} onSaved={saved} />}
    </div>
  </div>;
}

function ProjectWorkspace({ project, projects, navigation, onEdit, onProjectsChange, registerFlush, onSwitch }: {
  navigation: ResearchNavigation; project: ProjectSummary; projects: ProjectSummary[]; onEdit: () => void; onProjectsChange: () => Promise<void>;
  registerFlush: (flush: (() => Promise<void>) | null) => void; onSwitch: SwitchResearchProject;
}) {
  const { t } = useI18n();
  const focusField = useRef<HTMLTextAreaElement>(null);
  const notes = useProjectNotes(project.id, useMemo(() => ({ error: t("rw.notesError"), limit: t("rw.notesLimit") }), [t]));
  useEffect(() => { registerFlush(notes.flush); return () => registerFlush(null); }, [notes.flush, registerFlush]);
  const { view, setView, selected, papers, paper, loading, error, thread, titles, refresh, open, navigate, selectConversation, changed, uploaded, uploadPdf } =
    useResearchReader({ projectId: project.id, beforeAsk: notes.flush, onProjectsChange, onSwitch });
  const currentConversation = thread.state.conversation;
  const needs = papers.filter((item) => item.needsPdf);

  const briefLead = project.brief.trim().split(/\n\s*\n/)[0];
  return <>
    <ResearchNavigationPanel name={project.name}>
      {navigation({ thread, paperTitles: titles, onSelect: selectConversation, onOpenPaper: open, onOverview: () => setView("overview") })}
    </ResearchNavigationPanel>
    <main className={s.deskMain}>
    <header className={`${s.projectHead} ${s.projectIntro}`}>
      {project.archived && <p className={s.deskEyebrow}>{t("rw.archived")}</p>}
      <div className={s.projectTitleRow}>
        <h1>{project.name}</h1>
        <button className={`pi-bracket ${s.textButton}`} aria-label={t("rw.project.edit")} onClick={onEdit}>{t("rw.project.edit")}</button>
      </div>
      {briefLead ? <p className={s.brief} title={project.brief}>{briefLead}</p>
        : <button className={s.briefEmpty} onClick={onEdit}>{t("rw.project.briefMissing")}</button>}
    </header>
    <nav className={`robin-workspace-tabs robin-workspace-view-switch ${s.workspaceNav}`} aria-label={t("rw.view.label")}>
      {(["overview", "papers", "assistant"] as const).map((item) => <button key={item} type="button" aria-pressed={view === item} aria-controls={`research-view-${item}`} onClick={() => setView(item)}>
        {t(`rw.view.${item}`)}{item === "papers" && papers.length > 0 && <span>{papers.length}</span>}
        {item === "assistant" && thread.busy && <span>{t("rw.view.working")}</span>}
      </button>)}
    </nav>
    {error && <p role="alert" className={s.error}>{error} <button className={s.button} onClick={refresh}>{t("rw.retry")}</button></p>}
    {!!needs.length && view !== "papers" && <button type="button" className={s.needsBanner} onClick={() => setView("papers")}>{t("rw.needsBanner", { count: needs.length })} →</button>}
    <div className={`${rail.layout} ${s.deskLayout}`}>
    <ResearchResources project={project} papers={papers} loading={loading} onOpen={open} onLibrary={() => setView("papers")} onAssistant={() => setView("assistant")} onEdit={onEdit} />
    <div className={rail.content}>
    <div id="research-view-overview" className={s.overview} hidden={view !== "overview"}>
    <section className={s.focus} aria-labelledby="research-focus-label">
      <div className={s.deskSectionHead}><div><label id="research-focus-label" htmlFor="research-focus">{t("rw.focus")}</label><p>{t("rw.desk.focusPrompt")}</p></div></div>
      <textarea id="research-focus" ref={focusField} className={s.focusField} value={notes.objective} disabled={!notes.loaded || notes.capturing} maxLength={10_000}
        rows={Math.min(10, Math.max(2, notes.objective.split("\n").length))} placeholder={t("rw.focusPlaceholder")}
        onChange={(event) => notes.setObjective(event.target.value)} onBlur={notes.saveSoon} />
      <div className={s.focusFooter}>
        {notes.loaded && notes.saveState !== "loading" ? <SaveStatus state={notes.saveState} onRetry={notes.saveSoon} /> : <span role="status">{t(notes.saveState === "error" ? "rw.error" : "rw.loading")}</span>}
        <span className={s.focusState}>{t("rw.focusHint")}</span>
        <details className={s.focusHelp}><summary>{t("rw.desk.goalHelp")}</summary><p>{t("rw.plan.weekHint")}</p></details>
      </div>
    </section>
    <Notebook notes={notes} projectName={project.name} planning />
    </div>
    <div id="research-view-assistant" className={s.workspacePanel} hidden={view !== "assistant"}>
      <div className={s.conversationColumn}>
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
        </div>
        <section className={s.catalogColumn} aria-label={t("rw.chat.catalogs")}>
          <h2 className={s.sectionTitle}>{t("rw.chat.catalogs")}</h2>
          <ResearchDiscovery projectId={project.id} beforeSearch={notes.flush} onAdded={refresh} onOpen={open} />
        </section>
      </div>
    </div>
    </div>
    </div>
    </main>
    {selected && paper?.id === selected && <PaperSheet key={paper.id} paper={paper} project={project} projects={projects} thread={thread}
      onSelectConversation={(id) => selectConversation(id, true)}
      onChange={changed}
      onClose={() => open(null)} onNavigate={navigate} onRemoved={() => { open(null); refresh(); }} />}
  </>;
}
