"use client";

import { useI18n } from "@/hooks/useI18n";
import type { ReactNode } from "react";
import type { PaperSummary, ProjectSummary } from "./research-client";
import { linkKind, linkTitle } from "@/lib/research-link-kind";
import { WorkspaceRail } from "./WorkspaceRail";
import rail from "./WorkspaceRail.module.css";
import s from "./ResearchWorkspace.module.css";

/** The former reference page's grouped resource list, now using the current project's real links. */
export function ResearchResources({ project, papers, loading, onOpen, onLibrary, onAssistant, onEdit, children }: {
  project?: ProjectSummary; papers: PaperSummary[]; loading: boolean; onOpen: (id: string) => void;
  onLibrary: () => void; onAssistant: () => void; onEdit?: () => void; children?: ReactNode;
}) {
  const { t } = useI18n();
  return <WorkspaceRail title={t("rw.desk.resources")}>
    {project && <section aria-label={t("rw.project.links")}>
      <h2 className={rail.sectionTitle}>{t("rw.project.links")}</h2>
      <ul className={rail.entries}>
        {project.links.map(link => <li key={link.url}><a className={rail.entry} href={link.url} target="_blank" rel="noopener noreferrer">
          <span><strong>{linkTitle(link.title, link.url)}</strong><small>{linkKind(link.url).label}</small></span><span aria-hidden="true">↗</span>
        </a></li>)}
      </ul>
      {!project.links.length && <p className={rail.hint}>{t("rw.desk.linksEmpty")}</p>}
      {onEdit && <button type="button" className={s.queueLibrary} onClick={onEdit}>{t("rw.project.edit")}<span aria-hidden="true">→</span></button>}
    </section>}
    <ReadingQueue papers={papers} loading={loading} onOpen={onOpen} onLibrary={onLibrary} />
    <nav aria-label={t("rw.desk.ask")}>
      <button type="button" className={rail.entry} onClick={onAssistant}><span><strong>{t("rw.desk.ask")}</strong><small>{t("rw.view.addPaper")}</small></span><span aria-hidden="true">→</span></button>
    </nav>
    {children}
  </WorkspaceRail>;
}

/** A continuation list, not AI recommendations: only the user's reading and queued states. */
export function ReadingQueue({ papers, loading, onOpen, onLibrary }: {
  papers: PaperSummary[]; loading: boolean; onOpen: (id: string) => void; onLibrary: () => void;
}) {
  const { t } = useI18n();
  const available = papers.filter(paper => !paper.needsPdf);
  const reading = available.filter(paper => paper.status === "reading");
  const queued = available.filter(paper => paper.status === "queued");
  const next = [...reading, ...queued].slice(0, 3);
  return <section className={s.readingQueue} aria-labelledby="research-queue-title">
    <header className={s.deskSectionHead}>
      <div><h2 id="research-queue-title">{t("rw.desk.readNext")}</h2><p>{t("rw.desk.readHint")}</p></div>
    </header>
    <ul className={s.queueList}>
      {next.map(paper => <li key={paper.id}><button type="button" onClick={() => onOpen(paper.id)}>
        <span className={s.readingStatus} data-status={paper.status}>{t(`rw.paper.status.${paper.status}`)}</span>
        <strong>{paper.title}</strong>
        <span className={s.queueMeta}>{[paper.authors[0], paper.year].filter(Boolean).join(" · ")}<span aria-hidden="true">↗</span></span>
      </button></li>)}
    </ul>
    {!next.length && <p className={s.queueEmpty}>{t(loading ? "rw.loading" : "rw.desk.queueEmpty")}</p>}
    <button type="button" className={s.queueLibrary} onClick={onLibrary}>{t("rw.desk.openLibrary")}<span aria-hidden="true">→</span></button>
  </section>;
}
