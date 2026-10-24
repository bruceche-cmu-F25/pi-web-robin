"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import { PaperSheet } from "./PaperSheet";
import { NeedsPdf, paperState } from "./ResearchShelf";
import { ResearchThread } from "./ResearchThread";
import { ResearchSessions } from "./ResearchSessions";
import { ResearchDiscovery } from "./ResearchDiscovery";
import { ReadingQueue, ResearchMark } from "./ResearchDesk";
import { GENERAL, type ProjectSummary } from "./research-client";
import { useResearchReader, type SwitchResearchProject } from "./useResearchReader";
import s from "./ResearchWorkspace.module.css";

const noFlush = async () => {};

/**
 * Research home leads with projects and their goals; library and general discussion stay available
 * as separate surfaces. Hidden surfaces remain mounted to retain drafts, uploads and search results.
 */
export function HomeWorkspace({ projects, onProjectsChange, onSwitch, onNewProject }: {
  projects: ProjectSummary[]; onProjectsChange: () => Promise<void>; onSwitch: SwitchResearchProject; onNewProject: () => void;
}) {
  const { t } = useI18n();
  const params = useSearchParams();
  const [view, setView] = useState<"projects" | "papers" | "assistant">(() => params.has("conversation") ? "assistant" : "projects");
  const { selected, papers, paper, loading, error, thread, titles, refresh, open, navigate, selectConversation, changed, uploaded, uploadPdf } =
    useResearchReader({ projectId: GENERAL, onProjectsChange, onSwitch });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [readingStatus, setReadingStatus] = useState("all");
  const home: ProjectSummary = useMemo(() => projects.find((item) => item.general) ?? {
    id: GENERAL, name: t("rw.home"), brief: "", objective: "", links: [], general: true, createdAt: "", updatedAt: "", objectiveUpdatedAt: null,
    hasNotes: false, papers: 0, needsPdf: 0, read: 0, messages: 0,
  }, [projects, t]);
  const named = projects.filter((item) => !item.general && !item.archived);
  const archived = projects.filter((item) => !item.general && item.archived);
  const unfiled = papers.filter((item) => !(item.projectIds ?? []).some(id => id !== GENERAL)).length;
  const projectName = useCallback((id: string) => projects.find((item) => item.id === id)?.name ?? "", [projects]);
  const currentConversation = thread.state.conversation;
  const needs = papers.filter((item) => item.needsPdf);
  const filtered = papers.filter((item) => readingStatus === "all" || item.status === readingStatus)
    .filter((item) => filter === "all" || (filter === "none" ? !(item.projectIds ?? []).some((id) => id !== GENERAL) : item.projectIds?.includes(filter)))
    .filter((item) => `${item.title} ${item.authors.join(" ")} ${item.tags}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const shown = filtered.filter((item) => !item.needsPdf);

  return <>
    <header className={s.homeHead}>
      <p className={s.deskEyebrow}><ResearchMark kind="desk" />{t("rw.desk.personal")}</p>
      <h1>{t("rw.home.title")}</h1>
      <p>{t("rw.home.lede")}</p>
    </header>
    {error && <p role="alert" className={s.error}>{error}</p>}
    <nav className={s.workspaceNav} aria-label={t("rw.view.label")}>
      {(["projects", "papers", "assistant"] as const).map((item) => <button key={item} type="button" aria-pressed={view === item} aria-controls={`research-home-${item}`} onClick={() => setView(item)}>
        <ResearchMark kind={item === "projects" ? "desk" : item === "papers" ? "book" : "spark"} />{t(item === "projects" ? "rw.view.overview" : `rw.view.${item}`)}
        {item === "assistant" && thread.busy && <span>{t("rw.view.working")}</span>}
      </button>)}
    </nav>
    {!!needs.length && view !== "papers" && <button type="button" className={s.needsBanner} onClick={() => setView("papers")}>{t("rw.needsBanner", { count: needs.length })} →</button>}
    <section id="research-home-projects" className={`${s.workspacePanel} ${s.homeDesk}`} hidden={view !== "projects"} aria-label={t("rw.projects")}>
      <div className={s.projectCollection}>
      <div className={s.sectionHeading}><h2>{t("rw.desk.activeProjects")}</h2><span className={s.collectionCount}>{named.length}</span></div>
      <ul className={s.projectOverviewList}>
        {named.map((item) => <li key={item.id}><button type="button" onClick={() => void onSwitch(item.id)}>
          <span className={s.projectOverviewBrief}><span className={s.projectIdentity}><ResearchMark kind="folder" /><strong>{item.name}</strong><span aria-hidden="true">↗</span></span><span>{item.brief || t("rw.project.briefMissing")}</span></span>
          <span className={s.projectOverviewFocus}><small>{t("rw.focus")}</small><span>{item.objective || t("rw.view.noFocus")}</span></span>
          <span className={s.projectOverviewMeta}><span><ResearchMark kind="book" />{t("rw.view.paperCount", { count: item.papers })}</span>{item.hasNotes && <span><ResearchMark kind="note" />{t("rw.desk.hasNotes")}</span>}<span className={s.projectOpen}>{t("rw.desk.openProject")} →</span></span>
        </button></li>)}
      </ul>
      {!named.length && <p className={s.marginHint}>{t("rw.setup.hint")}</p>}
      {!named.length && <button type="button" className={s.textButton} onClick={onNewProject}>{t("rw.project.new")}</button>}
      </div>
      <aside className={s.homeAside}>
        <ReadingQueue papers={papers} loading={loading} onOpen={open} onLibrary={() => setView("papers")} />
        {unfiled > 0 && <button type="button" className={s.filingPrompt} onClick={() => { setFilter("none"); setReadingStatus("all"); setView("papers"); }}><ResearchMark kind="archive" /><span><strong>{t("rw.desk.unfiled", { count: unfiled })}</strong><small>{t("rw.desk.filePrompt")}</small></span><span aria-hidden="true">→</span></button>}
      </aside>
    </section>
    <div id="research-home-assistant" className={s.workspacePanel} hidden={view !== "assistant"}>
      <div className={s.conversationColumn}>
        <ResearchSessions projectId={GENERAL} thread={thread} paperTitles={titles} onSelect={selectConversation} onOpenPaper={open} />
        <ResearchThread onUpload={uploadPdf} variant="home" thread={thread} projectId={GENERAL} projectName={home.name} projectNames={new Map(projects.map((item) => [item.id, item.name]))} paperTitles={titles} onOpenPaper={open} onNavigate={navigate} />
      </div>
    </div>
    <div id="research-home-papers" className={`${s.workspacePanel} ${s.paperWorkspace}`} hidden={view !== "papers"}>
      <div className={s.paperCollection}>
        <NeedsPdf papers={filtered.filter(item => item.needsPdf)} onUploaded={(item) => { setView("assistant"); void uploaded(item); }} onOpen={open} />
        <section className={s.marginSection} aria-labelledby="research-library-title">
          <div className={s.sectionHeading}><h2 id="research-library-title">{t("rw.library")} · {papers.length}</h2>
            <button type="button" className={s.textButton} onClick={() => setView("assistant")}>{t("rw.view.addPaper")}</button></div>
          {papers.length > 0 && <div className={s.libraryTools}>
            <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label={t("rw.library.filterProject")}>
              <option value="all">{t("rw.library.all")}</option>
              {named.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              {!!archived.length && <optgroup label={t("rw.archived")}>{archived.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>}
              <option value="none">{t("rw.library.unfiled")}</option>
            </select>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("rw.filter")} aria-label={t("rw.filter")} />
          </div>}
          <div className={s.readingFilters} role="group" aria-label={t("rw.paper.status")}>
            {["all", "queued", "reading", "read"].map(status => <button type="button" key={status} aria-pressed={readingStatus === status} onClick={() => setReadingStatus(status)}>{t(status === "all" ? "rw.library.all" : `rw.paper.status.${status}`)}</button>)}
          </div>
          <ul className={s.paperList}>
            {shown.map((item) => { const state = paperState(item); const tags = (item.projectIds ?? []).filter((id) => id !== GENERAL).map(projectName).filter(Boolean); return <li key={item.id}>
              <button type="button" className={s.paperRow} aria-current={currentConversation?.paperId === item.id ? "true" : undefined} onClick={() => open(item.id)}>
                <span className={s.paperTitle}>{item.title}</span>
                <span className={s.paperMeta}><span className={s.readingStatus} data-status={item.status}>{t(`rw.paper.status.${item.status}`)}</span><span>{t(`rw.state.${state}`)}{item.year ? ` · ${item.year}` : ""}</span></span>
                {!!tags.length && <span className={s.projectTags}>{tags.map((name) => <span key={name}>{name}</span>)}</span>}
              </button>
            </li>; })}
          </ul>
          {!shown.length && <p className={s.marginHint}>{t(loading ? "rw.loading" : papers.length ? "rw.noMatch" : "rw.home.libraryEmpty")}</p>}
        </section>
      </div>
      <section className={s.catalogColumn} aria-label={t("rw.chat.catalogs")}>
        <h2 className={s.sectionTitle}>{t("rw.chat.catalogs")}</h2>
        <ResearchDiscovery projectId={GENERAL} general beforeSearch={noFlush} onAdded={refresh} onOpen={open} />
      </section>
    </div>
    {selected && paper?.id === selected && <PaperSheet key={paper.id} paper={paper} project={home} projects={projects} thread={thread}
      onSelectConversation={(id) => selectConversation(id, true)}
      onChange={changed}
      onClose={() => open(null)} onNavigate={navigate} onRemoved={() => { open(null); refresh(); }} />}
  </>;
}
