"use client";

import { useRef, useState } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import type { PaperSummary } from "./research-client";
import type { ResearchReading } from "@/extension/robin/research";
import { downloadMarkdown, researchJson, researchRequest, uploadPaperPdf } from "./research-client";
import type { ProjectNotes } from "./useProjectNotes";
import s from "./ResearchWorkspace.module.css";

export function paperState(paper: PaperSummary): "needsPdf" | "ready" | "abstract" | "unread" {
  if (paper.needsPdf) return "needsPdf";
  if (paper.hasAnalysis) return paper.coverage === "abstract" ? "abstract" : "ready";
  return "unread";
}

/** Papers the agent could not obtain: the one thing in the workspace that is waiting on the researcher. */
export function NeedsPdf({ papers, onUploaded, onOpen }: { papers: PaperSummary[]; onUploaded: (paper: PaperSummary) => void; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<PaperSummary | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (!papers.length) return null;
  async function upload(file: File) {
    if (!target) return;
    setBusy(target.id); setError("");
    try { await uploadPaperPdf(target, file); onUploaded(target); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t("rw.error")); }
    finally { setBusy(""); setTarget(null); }
  }
  return <section className={s.marginSection} aria-labelledby="research-needs-pdf">
    <h2 id="research-needs-pdf" className={s.marginTitle} data-tone="warning">{t("rw.needsPdf")} <span>{papers.length}</span></h2>
    <p className={s.marginHint}>{t("rw.needsPdfHint")}</p>
    <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
    <ul className={s.needsList}>
      {papers.map((paper) => <li key={paper.id}>
        <button type="button" className={s.needsTitle} onClick={() => onOpen(paper.id)}>{paper.title}</button>
        <div className={s.needsActions}>
          {(paper.downloadLinks ?? [paper.url]).slice(0, 2).map((url, index) => <a key={url} href={url} target="_blank" rel="noopener noreferrer">{t(index ? "rw.pdfLink" : "rw.sourceLink")} ↗</a>)}
          <button type="button" className={s.textButton} disabled={!!busy} onClick={() => { setTarget(paper); input.current?.click(); }}>{busy === paper.id ? t("rw.uploading") : t("rw.uploadPdf")}</button>
        </div>
      </li>)}
    </ul>
    {error && <p role="alert" className={s.error}>{error}</p>}
  </section>;
}

export function ReadingList({ papers, loading, onOpen }: { papers: PaperSummary[]; loading: boolean; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const shown = papers.filter((paper) => !paper.needsPdf)
    .filter((paper) => `${paper.title} ${paper.authors.join(" ")} ${paper.tags}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section id="research-papers" className={s.marginSection} aria-labelledby="research-papers-title">
    <h2 id="research-papers-title" className={s.marginTitle}>{t("rw.papers")} <span>{papers.length}</span></h2>
    {papers.length > 6 && <input className={s.filter} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("rw.filter")} aria-label={t("rw.filter")} />}
    <ul className={s.paperList}>
      {shown.map((paper) => { const state = paperState(paper); return <li key={paper.id}>
        <button type="button" className={s.paperRow} onClick={() => onOpen(paper.id)}>
          <span className={s.paperTitle}>{paper.title}</span>
          <span className={s.paperMeta}><span className={s.stateDot} data-state={state} aria-hidden="true" />{t(`rw.state.${state}`)}{paper.year ? ` · ${paper.year}` : ""}{paper.archived ? ` · ${t("rw.inObsidian")}` : ""}</span>
        </button>
      </li>; })}
    </ul>
    {!shown.length && <p className={s.marginHint}>{t(loading ? "rw.loading" : papers.length ? "rw.noMatch" : "rw.papersEmpty")}</p>}
  </section>;
}

export function Notebook({ notes, projectName }: { notes: ProjectNotes; projectName: string }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  return <section id="research-notebook" className={s.marginSection} aria-labelledby="research-notebook-title">
    <h2 id="research-notebook-title" className={s.marginTitle}>{t("rw.notebook")}
      <span aria-live="polite" data-state={notes.saveState}>{notes.saveState === "saved" ? "" : t(`rw.save.${notes.saveState}`)}</span></h2>
    <div className={s.marginActions}>
      <button type="button" className={s.textButton} disabled={!notes.loaded || notes.capturing} onClick={() => { if (editing) notes.saveSoon(); setEditing(!editing); }}>{t(editing ? "rw.done" : "rw.edit")}</button>
      <button type="button" className={s.textButton} disabled={!notes.loaded || (!notes.note.trim() && !notes.objective.trim())}
        onClick={() => downloadMarkdown(`${projectName} notes`, `# ${projectName}\n\n## ${t("rw.focus")}\n\n${notes.objective}\n\n## ${t("rw.notebook")}\n\n${notes.note}\n`)}>{t("rw.download")}</button>
    </div>
    {editing ? <textarea className={s.noteEditor} aria-label={t("rw.notebook")} value={notes.note} maxLength={100_000} autoFocus
      onChange={(event) => notes.setNote(event.target.value)} onBlur={notes.saveSoon} placeholder={t("rw.notebookPlaceholder")} />
      : notes.note.trim() ? <div className={`${s.prose} ${s.noteView}`}><MarkdownBody>{notes.note}</MarkdownBody></div>
        : <p className={s.marginHint}>{t("rw.notebookEmpty")}</p>}
  </section>;
}

const normalizeUrl = (url: string) => { try { const u = new URL(url); u.search = ""; u.hash = ""; return u.href.replace(/\/$/, ""); } catch { return url; } };
/**
 * A project's authored reading list (HEAT's takeover readings). A paper opens in the reading sheet — the
 * first click files it into the library under this project — so the agent can read and discuss it.
 * Non-paper links (a code repository) simply open.
 */
export function ReferenceReadings({ projectId, lists, papers, onOpen }: {
  projectId: string; lists: Array<{ title: string; readings: readonly ResearchReading[] }>; papers: PaperSummary[]; onOpen: (id: string) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const inLibrary = new Map(papers.map((paper) => [normalizeUrl(paper.url), paper]));
  async function open(reading: ResearchReading) {
    const known = inLibrary.get(normalizeUrl(reading.url));
    if (known) { onOpen(known.id); return; }
    setBusy(reading.id); setError("");
    try {
      const { paper } = await researchRequest<{ paper: { id: string } }>(`/api/research/papers?project=${encodeURIComponent(projectId)}`,
        researchJson("POST", { title: reading.title, url: reading.url, authors: [], year: "", abstract: "", pdfUrl: "", provider: reading.source }));
      onOpen(paper.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("rw.error")); }
    finally { setBusy(""); }
  }
  return <section className={s.marginSection} aria-labelledby="research-reference-readings">
    <h2 id="research-reference-readings" className={s.marginTitle}>{t("rw.readings")} <span>{lists.reduce((sum, list) => sum + list.readings.length, 0)}</span></h2>
    <p className={s.marginHint}>{t("rw.readingsHint")}</p>
    {lists.map((list) => <details key={list.title} className={s.readingGroup} open>
      <summary>{list.title} <span>{list.readings.length}</span></summary>
      <ul className={s.paperList}>
        {list.readings.map((reading) => {
          const paper = inLibrary.get(normalizeUrl(reading.url));
          const isPaper = reading.source !== "GitHub";
          return <li key={reading.id}>
            {isPaper ? <button type="button" className={s.paperRow} disabled={!!busy} onClick={() => void open(reading)}>
              <span className={s.paperTitle}>{reading.title}</span>
              <span className={s.paperMeta}><span className={s.stateDot} data-state={paper ? paperState(paper) : "unread"} aria-hidden="true" />
                {busy === reading.id ? t("rw.loading") : paper ? t(`rw.state.${paperState(paper)}`) : t("rw.state.unread")} · {reading.source}</span>
            </button> : <a className={s.paperRow} href={reading.url} target="_blank" rel="noopener noreferrer">
              <span className={s.paperTitle}>{reading.title} ↗</span>
              <span className={s.paperMeta}>{reading.source}</span>
            </a>}
          </li>;
        })}
      </ul>
    </details>)}
    {error && <p role="alert" className={s.error}>{error}</p>}
  </section>;
}
