"use client";

import { useI18n } from "@/hooks/useI18n";
import type { PaperSummary } from "./research-client";
import s from "./ResearchWorkspace.module.css";

/** Small, decorative navigation marks; the adjacent text always carries the meaning. */
export function ResearchMark({ kind }: { kind: "desk" | "folder" | "book" | "note" | "spark" | "archive" | "target" }) {
  const paths = {
    desk: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    folder: "M3 7V5h6l2 2h10v13H3z",
    book: "M12 5v16 M12 5C9 3 6 3 3 4v15c3-1 6-1 9 2 3-3 6-3 9-2V4c-3-1-6-1-9 1z",
    note: "M5 3h14v18H5z M9 8h6 M9 12h6 M9 16h4",
    spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
    archive: "M3 3h18v5H3z M5 8v13h14V8 M9 12h6",
    target: "M12 3a9 9 0 1 0 9 9 M12 7a5 5 0 1 0 5 5 M12 12l9-9 M16 3h5v5",
  };
  return <svg className={s.deskIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
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
      <span className={s.sectionMark}><ResearchMark kind="book" /></span>
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
