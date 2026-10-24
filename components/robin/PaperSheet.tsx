"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { MarkdownBody } from "@/components/MarkdownBody";
import type { Paper, PaperStatus } from "@/extension/robin/papers-domain";
import { PaperExport } from "./PaperExport";
import { PaperPdf } from "./PaperPdf";
import { researchJson, researchRequest, uploadPaperPdf, type ProjectSummary } from "./research-client";
import { RunStatus, submitsOnEnter, ThreadMessage } from "./ResearchThread";
import { useResearchQuestion, type ResearchThread } from "./useResearchThread";
import { ResearchSessions } from "./ResearchSessions";
import s from "./ResearchWorkspace.module.css";

type Draft = { note: string; tags: string; revision: number };
const QUICK = ["simple", "method", "weakness", "apply", "quiz"] as const;

/**
 * Reading and asking happen side by side. The selected paper conversation owns its own history,
 * separate from other papers and from other conversations about this paper.
 */
export function PaperSheet({ paper, project, projects, thread, onChange, onClose, onNavigate, onRemoved, onSelectConversation }: {
  paper: Paper; project: ProjectSummary; projects: ProjectSummary[]; thread: ResearchThread;
  onSelectConversation: (id: string) => void | Promise<void>;
  onChange: (paper: Paper) => void; onClose: () => void; onNavigate: (href: string) => void; onRemoved: () => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const answers = useRef<HTMLDivElement>(null);
  const storageKey = `pi-research-draft:${paper.id}`;
  const [draft, setDraft] = useState<Draft>({ note: paper.note, tags: paper.tags, revision: paper.revision });
  const { question, setQuestion, clearSubmitted, draftReady } = useResearchQuestion(`pi-research-paper-question:${project.id}:${thread.state.conversation?.id ?? paper.id}`);
  const [tab, setTab] = useState<"reading" | "abstract" | "source">("reading");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const [pane, setPane] = useState<"read" | "ask">("read");
  const previous = useRef(paper);
  const dirty = draft.note !== paper.note || draft.tags !== paper.tags;
  const stale = dirty && draft.revision !== paper.revision;
  const askDisabled = !thread.ready || !draftReady || thread.busy || thread.elsewhere || !!busy || !!thread.state.conversation?.archived;

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null") as (Draft & { unsaved?: boolean }) | null;
      if (saved?.unsaved && typeof saved.note === "string" && typeof saved.tags === "string" && typeof saved.revision === "number") setDraft({ note: saved.note.slice(0, 50_000), tags: saved.tags.slice(0, 500), revision: saved.revision });
    } catch { /* Drafts are a convenience. */ }
    return () => element?.close();
  }, [storageKey]);
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify({ ...draft, unsaved: dirty })); } catch { /* Optional. */ } }, [draft, dirty, storageKey]);
  useEffect(() => {
    const before = previous.current; previous.current = paper;
    if (before.revision === paper.revision) return;
    setDraft((current) => current.note === before.note && current.tags === before.tags ? { note: paper.note, tags: paper.tags, revision: paper.revision } : current);
  }, [paper]);
  const scoped = thread.state.messages;
  useEffect(() => { const node = answers.current; if (node) node.scrollTop = node.scrollHeight; }, [scoped.length, thread.pending]);

  async function flush(): Promise<Paper> {
    if (!dirty) return paper;
    if (stale) throw new Error(t("rw.paper.stale"));
    const result = await researchRequest<{ paper: Paper }>("/api/research/papers", researchJson("PATCH", { id: paper.id, revision: draft.revision, patch: { note: draft.note, tags: draft.tags } }));
    onChange(result.paper); setDraft((current) => ({ ...current, revision: result.paper.revision }));
    return result.paper;
  }
  async function run(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(label); setError(""); setNotice("");
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t("rw.error")); }
    finally { setBusy(""); }
  }
  function close() { void run("saving", async () => { await flush(); onClose(); }); }
  async function sendQuestion(text: string) {
    setPane("ask");
    const replacesDraft = !question.trim() || question === text;
    if (await thread.send(text, paper.id) && replacesDraft) clearSubmitted();
  }
  async function ask(text: string) {
    if (askDisabled || !text.trim()) return;
    try { await flush(); } catch (failure) { setError(failure instanceof Error ? failure.message : t("rw.error")); return; }
    await sendQuestion(text);
  }
  function supply(file?: File, text?: string) {
    void run("importing", async () => {
      const saved = await flush();
      const next = file ? await uploadPaperPdf(saved, file)
        : (await researchRequest<{ paper: Paper }>("/api/research/papers/source", researchJson("POST", { id: paper.id, revision: saved.revision, text }))).paper;
      onChange(next); setPaste("");
      // Advance our own source write without discarding edits typed during the upload.
      // A concurrently changed server note is still a conflict, not an implicit rebase.
      setDraft((current) => current.revision === saved.revision && next.note === saved.note && next.tags === saved.tags
        ? { ...current, revision: next.revision } : current);
      // Notes already flushed above; ask() would repeat that save through an old render.
      if (!askDisabled) await sendQuestion(t("rw.paper.readUploaded"));
      else setNotice(t("rw.paper.uploadedLater"));
    });
  }
  const coverage = !paper.source ? paper.abstract ? t("rw.coverage.abstract") : t("rw.coverage.none")
    : paper.source.kind === "pdf" ? t("rw.coverage.pdf", { pages: paper.source.pages ?? "?" }) : t("rw.coverage.pasted");
  const pages = paper.source?.kind === "pdf" ? [...paper.source.text.matchAll(/--- page (\d+) ---\n([\s\S]*?)(?=--- page \d+ ---|$)/g)].map((match) => ({ number: match[1], text: match[2] })) : [];
  const connections = Object.entries({ ...(paper.analysis?.heatConnection ? { heat: { text: paper.analysis.heatConnection, objective: paper.analysis.objective } } : {}), ...paper.analysis?.connections })
    .filter(([id]) => projects.some((item) => item.id === id && !item.general) || id === "heat")
    .sort(([a], [b]) => (a === project.id ? -1 : b === project.id ? 1 : 0));
  const projectName = (id: string) => projects.find((item) => item.id === id)?.name ?? id;
  const general = !!project.general;
  const memberOf = paper.projectIds ?? ["heat"];
  const addable = projects.filter((item) => !item.general && !item.archived && !memberOf.includes(item.id));
  const readable = !paper.analysis || paper.analysis.outdated;

  return <dialog ref={dialog} className={s.sheet} aria-labelledby="research-paper-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className={s.sheetBar}>
      <button type="button" className={`${s.button} ${s.sheetBack}`} disabled={busy === "saving"} onClick={close} aria-label={t("rw.paper.back")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14" /></svg>
        {t("rw.back")}
      </button>
      <span className={s.crumb}>{general ? t("rw.home") : project.name} / {t("rw.papers")}</span>
      <div className={s.paneSwitch} role="tablist" aria-label={t("rw.paper.panes")}>
        <button role="tab" aria-selected={pane === "read"} onClick={() => setPane("read")}>{t("rw.paper.read")}</button>
        <button role="tab" aria-selected={pane === "ask"} onClick={() => setPane("ask")}>{t("rw.paper.ask")}{scoped.length ? ` · ${Math.ceil(scoped.length / 2)}` : ""}</button>
      </div>
    </div>
    <div className={s.sheetGrid} data-pane={pane}>
      <article className={s.reading}>
        <header className={s.paperHeader}>
          <div className={s.eyebrow}>{[paper.provider, paper.year].filter(Boolean).join(" · ")}</div>
          <h2 id="research-paper-title">{paper.title}</h2>
          {!!paper.authors.length && <p className={s.authors}>{paper.authors.slice(0, 8).join(", ")}{paper.authors.length > 8 ? " …" : ""}</p>}
          <div className={s.paperLinks}>
            {paper.url && <a href={paper.url} target="_blank" rel="noopener noreferrer">{t("rw.sourceLink")} ↗</a>}
            {paper.pdfUrl && <a href={paper.pdfUrl} target="_blank" rel="noopener noreferrer">{t("rw.pdfLink")} ↗</a>}
            <span className={s.coverage} data-full={!!paper.source && !paper.source.truncated}>{coverage}{paper.source?.truncated ? ` · ${t("rw.coverage.truncated")}` : ""}</span>
          </div>
        </header>
        {error && <p role="alert" className={s.error}>{error}</p>}
        {notice && <p role="status" className={s.notice}>{notice}</p>}
        {stale && <div role="alert" className={s.error}>{t("rw.paper.stale")}<div className={s.actions}>
          <button className={s.button} onClick={() => setDraft({ ...draft, revision: paper.revision })}>{t("rw.paper.keepMine")}</button>
          <button className={s.button} onClick={() => setDraft({ note: paper.note, tags: paper.tags, revision: paper.revision })}>{t("rw.paper.useSaved")}</button>
        </div></div>}

        {paper.access && <section className={s.needsBlock}>
          <strong>{t("rw.paper.needsPdf")}</strong>
          <p>{t("rw.paper.needsPdfHint")}</p>
          <div className={s.paperLinks}>{[...new Set([...paper.access.links, paper.pdfUrl].filter(Boolean))].slice(0, 4).map((url) => <a key={url} href={url} target="_blank" rel="noopener noreferrer">{t(url === paper.pdfUrl || /\.pdf($|\?)/i.test(url) ? "rw.pdfLink" : "rw.sourceLink")} · {new URL(url).hostname} ↗</a>)}</div>
          <div className={s.actions}>
            <button className={`${s.button} ${s.primary}`} disabled={!!busy} onClick={() => upload.current?.click()}>{busy === "importing" ? t("rw.uploading") : t("rw.uploadPdf")}</button>
          </div>
          <details><summary>{t("rw.paper.pasteInstead")}</summary>
            <textarea className={s.pasteBox} value={paste} onChange={(event) => setPaste(event.target.value)} maxLength={100_000} placeholder={t("rw.paper.pastePlaceholder")} />
            <button className={s.button} disabled={!!busy || !paste.trim()} onClick={() => supply(undefined, paste)}>{t("rw.paper.useText")}</button>
          </details>
          <details><summary>{t("rw.paper.attempts")}</summary>{paper.access.attempts.map((attempt, index) => <p key={index} className={s.attempt}>{attempt.url}: {attempt.error}</p>)}</details>
        </section>}
        <input type="file" ref={upload} accept="application/pdf,.pdf" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) supply(file); }} />

        {readable && !paper.access && <div className={s.readCta}>
          <p>{t(paper.analysis?.outdated ? "rw.paper.outdated" : "rw.paper.notRead")}</p>
          <button className={`${s.button} ${s.primary}`} disabled={askDisabled} onClick={() => void ask(general ? t("rw.home.readPrompt") : t("rw.paper.readPrompt", { project: project.name }))}>{t("rw.paper.readForMe")}</button>
        </div>}

        <div className={s.tabs} role="tablist">
          {(["reading", "abstract", "source"] as const).map((value) => <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{t(`rw.paper.tab.${value}`)}</button>)}
        </div>
        {tab === "reading" ? paper.analysis ? <div className={s.prose}>
          <h3>{t("rw.paper.inBrief")}</h3><MarkdownBody>{paper.analysis.abstractExplanation}</MarkdownBody>
          <h3>{t("rw.paper.summary")}</h3><MarkdownBody>{paper.analysis.summary}</MarkdownBody>
          {connections.map(([id, connection]) => <section key={id} className={s.connection} data-current={id === project.id}>
            <h3>{t("rw.paper.connection", { project: projectName(id) })}</h3>
            <MarkdownBody>{connection.text}</MarkdownBody>
            {connection.objective && <p className={s.attempt}>{t("rw.paper.focusThen")}: {connection.objective.replace(/\s+/g, " ").slice(0, 240)}</p>}
          </section>)}
          {!general && !connections.some(([id]) => id === project.id) && <button className={s.textButton} disabled={askDisabled} onClick={() => void ask(t("rw.quick.apply.prompt", { project: project.name }))}>{t("rw.paper.relateHere", { project: project.name })} →</button>}
          <p className={s.attempt}>{paper.analysis.coverage}</p>
        </div> : <p className={s.marginHint}>{t("rw.paper.noReading")}</p>
          : tab === "abstract" ? <p className={s.sourceText}>{paper.abstract || t("rw.paper.noAbstract")}</p>
          : <>
            <PaperPdf key={`${paper.id}:${paper.source?.loadedAt ?? ""}`} paperId={paper.id} onUpload={() => upload.current?.click()} disabled={!!busy} />
            <details className={s.fold}>
              <summary>{t("rw.pdf.extracted")}</summary>
              {pages.length > 1 && <select className={s.pageJump} defaultValue="" aria-label={t("rw.paper.jump")} onChange={(event) => dialog.current?.querySelector(`[data-page="${event.target.value}"]`)?.scrollIntoView({ block: "start" })}>
                <option value="" disabled>{t("rw.paper.jump")}</option>{pages.map((page) => <option key={page.number} value={page.number}>{t("rw.paper.page", { page: page.number })}</option>)}
              </select>}
              {pages.length ? pages.map((page) => <section key={page.number} data-page={page.number} className={s.sourcePage}><h4>{t("rw.paper.page", { page: page.number })}</h4><p className={s.sourceText}>{page.text}</p></section>)
                : <p className={s.sourceText}>{paper.source?.text || t("rw.paper.noText")}</p>}
            </details>
          </>}

        <details className={s.fold} open={dirty || !!paper.note || undefined}>
          <summary>{t("rw.paper.myNotes")}{dirty ? " *" : ""}</summary>
          <textarea className={s.noteEditor} aria-label={t("rw.paper.myNotes")} value={draft.note} maxLength={50_000} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder={t("rw.paper.notesPlaceholder")} />
          <div className={s.noteRow}>
            <input value={draft.tags} maxLength={500} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder={t("rw.paper.tags")} aria-label={t("rw.paper.tags")} />
            <select aria-label={t("rw.paper.status")} value={paper.status} disabled={!!busy} onChange={(event) => {
              const status = event.target.value as PaperStatus;
              void run("saving", async () => { const saved = await flush(); onChange((await researchRequest<{ paper: Paper }>("/api/research/papers", researchJson("PATCH", { id: paper.id, revision: saved.revision, patch: { status } }))).paper); });
            }}>{(["queued", "reading", "read"] as const).map((status) => <option key={status} value={status}>{t(`rw.paper.status.${status}`)}</option>)}</select>
            <button className={s.button} disabled={!!busy || !dirty || stale} onClick={() => void run("saving", async () => { await flush(); setNotice(t("rw.saved")); })}>{t("rw.save")}</button>
          </div>
        </details>
        <details className={s.fold} open={exporting || undefined} onToggle={(event) => setExporting((event.target as HTMLDetailsElement).open)}>
          <summary>{t("rw.paper.toObsidian")}</summary>
          {exporting && <PaperExport key={`${paper.id}:${paper.revision}`} paper={paper} onChange={onChange} />}
        </details>
        <div className={s.membership}>
          {!!addable.length && <select value="" disabled={!!busy} aria-label={t("rw.paper.addTo")} onChange={(event) => {
            const target = event.target.value; if (!target) return;
            void run("saving", async () => { onChange((await researchRequest<{ paper: Paper }>("/api/research/papers", researchJson("PATCH", { id: paper.id, addToProject: target }))).paper); setNotice(t("rw.paper.added", { project: projectName(target) })); });
          }}><option value="">{t("rw.paper.addTo")}</option>{addable.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
          {!general && <button className={s.textButton} disabled={!!busy} onClick={() => void run("removing", async () => {
          await researchRequest("/api/research/papers", researchJson("PATCH", { id: paper.id, removeFromProject: project.id })); onRemoved();
        })}>{t("rw.paper.remove", { project: project.name })}</button>}
        </div>
      </article>

      <aside className={s.askPane} aria-label={t("rw.paper.ask")}>
        <ResearchSessions projectId={project.id} paperId={paper.id} paperTitles={new Map([[paper.id, paper.title]])} thread={thread} onSelect={async (id) => { await flush(); await onSelectConversation(id); }} />
        <h3 className={s.marginTitle}>{t("rw.paper.askTitle")}</h3>
        <div className={s.askTranscript} ref={answers}>
          {!scoped.length && !thread.pending && <p className={s.marginHint}>{t("rw.paper.askEmpty")}</p>}
          {scoped.map((message) => <ThreadMessage key={message.id} message={message} paperTitle={paper.title} onNavigate={onNavigate} />)}
          {thread.pending?.paperId === paper.id && scoped.at(-1)?.text !== thread.pending.text && <ThreadMessage message={{ id: "pending", role: "user", text: thread.pending.text, paperId: paper.id, at: "" }} paperTitle={paper.title} onNavigate={onNavigate} />}
        </div>
        <RunStatus thread={thread} projectName={projectName} />
        {thread.error && <p role="alert" className={s.error}>{thread.error}</p>}
        <div className={s.quick}>{QUICK.filter((key) => !general || key !== "apply").map((key) => <button key={key} type="button" disabled={askDisabled} onClick={() => void ask(t(`rw.quick.${key}.prompt`, { project: project.name }))}>{t(`rw.quick.${key}`)}</button>)}</div>
        <form className={s.composer} onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
          <textarea className={s.question} rows={2} value={question} disabled={!thread.ready || !draftReady || !!thread.state.conversation?.archived} maxLength={10_000} aria-label={t("rw.paper.askTitle")} placeholder={t("rw.paper.askPlaceholder")}
            onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (submitsOnEnter(event)) { event.preventDefault(); void ask(question); } }} />
          <div className={s.composerFooter}><span>{t("rw.composerHint")}</span><button className={`${s.button} ${s.primary}`} disabled={askDisabled || !question.trim()}>{t("rw.send")}</button></div>
        </form>
      </aside>
    </div>
  </dialog>;
}
