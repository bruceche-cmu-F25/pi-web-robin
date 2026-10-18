"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import type { Paper } from "@/extension/robin/papers-domain";
import { PaperSheet } from "./PaperSheet";
import { NeedsPdf, paperState } from "./ResearchShelf";
import { ResearchThread } from "./ResearchThread";
import { GENERAL, paperSummary, researchHref, researchRequest, type PaperSummary, type ProjectSummary } from "./research-client";
import { useResearchThread } from "./useResearchThread";
import s from "./ResearchWorkspace.module.css";

const noFlush = async () => {};

/**
 * The research home: paste any paper link and get it read and summarised, or explore a topic, without
 * choosing a project first. Every paper in the library is listed here, tagged with its projects.
 */
export function HomeWorkspace({ projects, onProjectsChange, onSwitch, onNewProject }: {
  projects: ProjectSummary[]; onProjectsChange: () => Promise<void>; onSwitch: (id: string | null) => Promise<void>; onNewProject: () => void;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const selected = useSearchParams().get("paper");
  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [paper, setPaper] = useState<Paper | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const home: ProjectSummary = useMemo(() => projects.find((item) => item.general) ?? {
    id: GENERAL, name: t("rw.home"), brief: "", objective: "", links: [], general: true, createdAt: "", updatedAt: "", objectiveUpdatedAt: null,
    hasNotes: false, papers: 0, needsPdf: 0, read: 0, messages: 0,
  }, [projects, t]);
  const named = projects.filter((item) => !item.general && !item.archived);
  const projectName = useCallback((id: string) => projects.find((item) => item.id === id)?.name ?? "", [projects]);
  const refresh = useCallback(() => { setReload((n) => n + 1); void onProjectsChange(); }, [onProjectsChange]);
  const thread = useResearchThread({ projectId: GENERAL, locale, beforeAsk: noFlush, onChange: refresh, fallbackError: t("rw.error") });
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void researchRequest<{ papers: PaperSummary[] }>("/api/research/papers", { signal: controller.signal })
      .then((result) => { setPapers(result.papers); setError(""); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    if (!selected) { setPaper(null); return; }
    const controller = new AbortController();
    void researchRequest<{ paper: Paper }>(`/api/research/papers?id=${encodeURIComponent(selected)}`, { signal: controller.signal })
      .then((result) => setPaper(result.paper))
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [selected, reload]);
  const open = useCallback((id: string | null) => router.push(researchHref(GENERAL, id), { scroll: false }), [router]);
  const navigate = useCallback((href: string) => {
    const url = new URL(href, window.location.href);
    if (url.origin === window.location.origin && url.pathname === "/research") {
      const target = url.searchParams.get("project");
      if (target && target !== GENERAL) router.push(url.pathname + url.search);
      else open(url.searchParams.get("paper"));
    } else if (url.origin === window.location.origin) router.push(url.pathname + url.search);
    else if (["http:", "https:"].includes(url.protocol)) window.open(url.href, "_blank", "noopener,noreferrer");
  }, [open, router]);
  const titles = useMemo(() => new Map(papers.map((item) => [item.id, item.title])), [papers]);
  const needs = papers.filter((item) => item.needsPdf);
  const shown = papers.filter((item) => !item.needsPdf)
    .filter((item) => filter === "all" || (filter === "none" ? !(item.projectIds ?? []).some((id) => id !== GENERAL) : item.projectIds?.includes(filter)))
    .filter((item) => `${item.title} ${item.authors.join(" ")} ${item.tags}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  function uploaded(item: PaperSummary) {
    refresh();
    if (!thread.busy && !thread.elsewhere) void thread.send(t("rw.home.readUploaded", { title: item.title }), item.id);
  }

  return <>
    <header className={s.homeHead}>
      <h1>{t("rw.home.title")}</h1>
      <p>{t("rw.home.lede")}</p>
    </header>
    {error && <p role="alert" className={s.error}>{error}</p>}
    {!!needs.length && <a className={s.needsBanner} href="#research-needs-pdf">{t("rw.needsBanner", { count: needs.length })} ↓</a>}
    <div className={s.workGrid} data-home="true">
      <ResearchThread variant="home" thread={thread} projectId={GENERAL} projectName={home.name} paperTitles={titles} onOpenPaper={open} onNavigate={navigate} />
      <aside className={s.margin} aria-label={t("rw.margin")}>
        <NeedsPdf papers={needs} onUploaded={uploaded} onOpen={open} />
        <section className={s.marginSection} aria-labelledby="research-library-title">
          <h2 id="research-library-title" className={s.marginTitle}>{t("rw.library")} <span>{papers.length}</span></h2>
          {papers.length > 0 && <div className={s.libraryTools}>
            <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label={t("rw.library.filterProject")}>
              <option value="all">{t("rw.library.all")}</option>
              {named.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              <option value="none">{t("rw.library.unfiled")}</option>
            </select>
            {papers.length > 6 && <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("rw.filter")} aria-label={t("rw.filter")} />}
          </div>}
          <ul className={s.paperList}>
            {shown.map((item) => { const state = paperState(item); const tags = (item.projectIds ?? []).filter((id) => id !== GENERAL).map(projectName).filter(Boolean); return <li key={item.id}>
              <button type="button" className={s.paperRow} onClick={() => open(item.id)}>
                <span className={s.paperTitle}>{item.title}</span>
                <span className={s.paperMeta}><span className={s.stateDot} data-state={state} aria-hidden="true" />{t(`rw.state.${state}`)}{item.year ? ` · ${item.year}` : ""}</span>
                {!!tags.length && <span className={s.projectTags}>{tags.map((name) => <span key={name}>{name}</span>)}</span>}
              </button>
            </li>; })}
          </ul>
          {!shown.length && <p className={s.marginHint}>{t(loading ? "rw.loading" : papers.length ? "rw.noMatch" : "rw.home.libraryEmpty")}</p>}
        </section>
        <section className={s.marginSection} aria-labelledby="research-projects-title">
          <h2 id="research-projects-title" className={s.marginTitle}>{t("rw.projects")} <span>{named.length}</span></h2>
          <ul className={s.paperList}>
            {named.map((item) => <li key={item.id}><button type="button" className={s.paperRow} onClick={() => void onSwitch(item.id)}>
              <span className={s.paperTitle}>{item.name}</span>
              <span className={s.paperMeta}>{t("rw.home.projectCounts", { papers: item.papers, read: item.read })}{item.needsPdf ? ` · ${t("rw.home.projectNeeds", { count: item.needsPdf })}` : ""}</span>
            </button></li>)}
          </ul>
          <button type="button" className={s.textButton} onClick={onNewProject}>+ {t("rw.project.new")}</button>
        </section>
      </aside>
    </div>
    {selected && paper?.id === selected && <PaperSheet key={paper.id} paper={paper} project={home} projects={projects} thread={thread}
      onChange={(next) => { setPaper(next); setPapers((current) => current.map((item) => item.id === next.id ? paperSummary(next) : item)); refresh(); }}
      onClose={() => open(null)} onNavigate={navigate} onRemoved={() => { open(null); refresh(); }} />}
  </>;
}
