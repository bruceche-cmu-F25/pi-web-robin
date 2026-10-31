"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/hooks/useI18n";
import type { CourseLesson, COURSE_STAGES, COURSE_SOURCES } from "@/extension/robin/learning-course";
import type { VaultIndex } from "@/extension/robin/obsidian-browser-domain";
import { ROADMAP_STATUSES, type RoadmapRecord, type RoadmapStatus } from "@/extension/robin/learning-roadmap";
import styles from "./LearningCourse.module.css";

type Lesson = CourseLesson & { fingerprint: string };
type Course = { stages: typeof COURSE_STAGES; sources: typeof COURSE_SOURCES; lessons: Lesson[]; progress: RoadmapRecord[] };
const API = "/api/robin/learning/course";
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}
function Markdown({ children }: { children: string }) {
  return <div className={`markdown-body ${styles.prose}`}><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown></div>;
}

export function LearningCourse() {
  const { t } = useI18n();
  const [data, setData] = useState<Course | null>(null);
  const [selected, setSelected] = useState("");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [gaps, setGaps] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const dirty = useRef(false), busy = useRef(false), jump = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const guard = () => !busy.current && (!dirty.current || window.confirm(t("roadmap.discard")));
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    request<Course>(API, { signal: controller.signal }).then((course) => {
      if (controller.signal.aborted) return;
      setData(course);
      setSelected(new URLSearchParams(window.location.search).get("lesson") || course.lessons[0].id);
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!selected) return;
    const url = new URL(window.location.href);
    url.searchParams.set("lesson", selected);
    window.history.replaceState(null, "", url);
    if (jump.current) { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: "start" }); jump.current = false; }
  }, [selected]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty.current || busy.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  function choose(id: string) {
    if (id === selected || !guard()) return;
    dirty.current = false; jump.current = true; setOutlineOpen(false); setMapOpen(false); setSelected(id);
  }
  function refresh() {
    if (!guard()) return;
    dirty.current = false; setData(null); setRevision((value) => value + 1);
  }
  const lesson = data?.lessons.find((lesson) => lesson.id === selected);
  const record = data?.progress.find((record) => record.section === selected);
  const statusOf = (item: Lesson) => {
    const saved = data?.progress.find((record) => record.section === item.id);
    return saved?.fingerprint === item.fingerprint ? saved.status : "unassessed";
  };
  const filtered = data?.lessons.filter((item) => (!gaps || statusOf(item) === "gap")
    && `${item.title} ${item.question} ${item.explanation.map((part) => part.title).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  const index = data?.lessons.findIndex((lesson) => lesson.id === selected) ?? -1;

  return <div className={`robin-page robin-dashboard ${styles.page}`}>
    <main className={styles.main}>
      <header className={styles.header}>
        <div><p className="pi-eyebrow">LEARNING / SOFTWARE → AI → DELIVERY</p><h1>{t("course.title")}</h1><p>{t("course.intro")}</p><small>{t("course.language")}</small></div>
        <nav aria-label={t("roadmap.hub")}><a href="/learn">{t("roadmap.hub")}</a><a href="/learn/roadmap?view=notes">{t("course.notes")}</a></nav>
      </header>
      {error && <p role="alert" className={styles.warning}>{error}</p>}
      {!data && !error && <p role="status">{t("obsidian.loading")}</p>}
      <div className={styles.recordBar}>
        {data && <p>{t("course.progress", { confident: data.lessons.filter((item) => statusOf(item) === "confident").length, gaps: data.lessons.filter((item) => statusOf(item) === "gap").length })}</p>}
        <button type="button" onClick={refresh}>{t("course.refresh")}</button>
      </div>
      {data && <>
        <div className={styles.landscape} data-expanded={mapOpen}>
        <button type="button" className={styles.mapToggle} aria-expanded={mapOpen} aria-controls="course-landscape" onClick={() => setMapOpen(!mapOpen)}>{t("roadmap.outline")}</button>
        <nav id="course-landscape" className={styles.map} aria-label={t("roadmap.outline")} lang="zh-CN">
          {data.stages.map((stage, number) => <button type="button" key={stage.id} aria-pressed={lesson?.stage === stage.id} onClick={() => choose(data.lessons.find((item) => item.stage === stage.id)!.id)}>
            <span className={styles.stageNumber}>{String(number + 1).padStart(2, "0")}{stage.optional && <small>{t("course.optional")}</small>}</span>
            <strong>{stage.title}</strong><span>{stage.question}</span><small>{stage.description}</small>
          </button>)}
        </nav>
        </div>
        <div className={styles.layout}>
          <aside className={`robin-workspace-rail ${styles.outline}`} data-expanded={outlineOpen} aria-label={t("course.outline")}>
            <h2>{t("course.outline")}</h2>
            <button type="button" className={styles.outlineToggle} aria-expanded={outlineOpen} aria-controls="course-outline" onClick={() => setOutlineOpen(!outlineOpen)}>{t("course.outline")}</button>
            <div id="course-outline" className={styles.outlineContent}>
              <input type="search" value={query} aria-label={t("course.search")} placeholder={t("course.search")} onChange={(event) => setQuery(event.target.value)} />
              <div className={`robin-workspace-tabs robin-workspace-view-switch ${styles.filters}`}><button type="button" aria-pressed={!gaps} onClick={() => setGaps(false)}>{t("course.all")}</button><button type="button" aria-pressed={gaps} onClick={() => setGaps(true)}>{t("roadmap.gaps")}</button></div>
              {!filtered.length && <p role="status">{t(gaps && !query ? "roadmap.noGaps" : "course.noMatch")}</p>}
              {data.stages.map((stage) => {
                const lessons = filtered.filter((item) => item.stage === stage.id);
                return !!lessons.length && <section key={stage.id} lang="zh-CN"><h3>{stage.title}{stage.optional && <small> / {t("course.optional")}</small>}</h3>
                  <ol>{lessons.map((item) => <li key={item.id}><button type="button" aria-current={item.id === selected ? "page" : undefined} onClick={() => choose(item.id)}>
                    <span className={styles.lessonNumber}>{String(data.lessons.indexOf(item) + 1).padStart(2, "0")}</span><span>{item.title}<small data-status={statusOf(item)}>{t(`roadmap.${statusOf(item)}`)}</small></span>
                  </button></li>)}</ol>
                </section>;
              })}
              <nav className={styles.practiceLinks} aria-label={t("roadmap.training")}><a href="/learn/fso">{t("roadmap.fso")}</a><a href="/coding">{t("roadmap.coding")}</a><a href="/learn/gpt2">{t("roadmap.gpt2")}</a></nav>
            </div>
          </aside>
          {!lesson ? <p role="alert">{t("course.missing")}</p> : <article className={styles.lesson} lang="zh-CN" key={lesson.id}>
            <header className={styles.lessonHeader}>
              <p className="pi-eyebrow">{t("course.lesson", { number: index + 1, total: data.lessons.length })} / {data.stages.find((stage) => stage.id === lesson.stage)?.title}</p>
              <h2 ref={heading} tabIndex={-1}>{lesson.title}</h2><p className={styles.question}>{lesson.question}</p>
              <p className={styles.outcome}><strong>{t("course.goal")}</strong>{lesson.outcome}</p>
              {!!lesson.prerequisites.length && <details className={styles.prerequisites}><summary>{t("course.before")}</summary>{lesson.prerequisites.map((id) => <button type="button" key={id} onClick={() => choose(id)}>{data.lessons.find((lesson) => lesson.id === id)?.title}</button>)}</details>}
            </header>
            <section className={styles.takeaway}><h3>{t("course.takeaway")}</h3><p>{lesson.takeaway}</p></section>
            <figure className={styles.diagram}><ol>{lesson.diagram.nodes.map((node, number) => <li key={node.label}><span>{String(number + 1).padStart(2, "0")}</span><strong>{node.label}</strong><p>{node.detail}</p></li>)}</ol><figcaption>{lesson.diagram.caption}</figcaption></figure>
            <div className={styles.explanation}>{lesson.explanation.map((part, number) => <section key={part.title}><h3><span>{String(number + 1).padStart(2, "0")}</span>{part.title}</h3><Markdown>{part.body}</Markdown></section>)}</div>
            <section className={styles.worked}><p className="pi-eyebrow">{t("course.example")}</p><h3>{lesson.worked.title}</h3><Markdown>{lesson.worked.body}</Markdown></section>
            <section className={styles.misconception}><h3>{t("course.trap")}</h3><blockquote>{lesson.misconception.wrong}</blockquote><p>{lesson.misconception.right}</p></section>
            <KnowledgeCheck check={lesson.check} />
            <CoursePractice lesson={lesson} record={record} dirty={dirty} busy={busy} onSaved={(saved) => {
              setData((current) => current ? { ...current, progress: [...current.progress.filter((old) => old.section !== saved.section), saved] } : current);
            }} />
            <section className={styles.references}><h3>{t("course.references")}</h3><p>{t("course.provenance")}</p>
              <ul>{lesson.sources.map((id) => <li key={id}><a href={data.sources[id].url} target="_blank" rel="noopener noreferrer">{data.sources[id].title} ↗</a><small>{data.sources[id].focus}</small></li>)}</ul>
              <SourceNotes titles={lesson.notes} />
            </section>
            <footer className={styles.next}>
              {index > 0 && <button type="button" onClick={() => choose(data.lessons[index - 1].id)}><small>← {t("course.previous")}</small>{data.lessons[index - 1].title}</button>}
              {index < data.lessons.length - 1 && <button type="button" onClick={() => choose(data.lessons[index + 1].id)}><small>{t("course.next")} →</small>{data.lessons[index + 1].title}</button>}
              {lesson.id === "tools-multimodal" && <button type="button" className={styles.skip} onClick={() => choose("discovery")}>{t("course.skipTraining")} →</button>}
            </footer>
          </article>}
        </div>
      </>}
    </main>
  </div>;
}

function KnowledgeCheck({ check }: { check: CourseLesson["check"] }) {
  const { t } = useI18n();
  const [choice, setChoice] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  return <section className={styles.check} aria-labelledby="course-check"><h3 id="course-check">{t("course.check")}</h3>
    <fieldset><legend>{check.question}</legend>{check.choices.map((item, index) => <label key={item.text} data-selected={choice === index}>
      <input type="radio" name="course-check" value={index} checked={choice === index} onChange={() => { setChoice(index); setChecked(false); }} /><span>{item.text}</span>
    </label>)}</fieldset>
    <button type="button" disabled={choice === null} onClick={() => setChecked(true)}>{t("course.checkAnswer")}</button>
    {checked && choice !== null && <div role="status" className={styles.feedback}><strong>{t(choice === check.answer ? "course.correct" : "course.retry")}</strong><p>{check.choices[choice].feedback}</p></div>}
    <small>{t("course.checkLimit")}</small>
  </section>;
}

function CoursePractice({ lesson, record, dirty, busy, onSaved }: {
  lesson: Lesson; record?: RoadmapRecord; dirty: React.RefObject<boolean>; busy: React.RefObject<boolean>; onSaved: (record: RoadmapRecord) => void;
}) {
  const { t } = useI18n();
  const stale = !!record && record.fingerprint !== lesson.fingerprint;
  const [status, setStatus] = useState<RoadmapStatus>(stale ? "unassessed" : record?.status ?? "unassessed");
  const [evidence, setEvidence] = useState(record?.evidence ?? "");
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState("");
  function change() { dirty.current = true; setChanged(true); }
  return <section className={styles.practice} aria-labelledby="course-practice"><p className="pi-eyebrow">{t("course.practice")}</p><h3 id="course-practice">{lesson.exercise.title}</h3>
    <Markdown>{lesson.exercise.task}</Markdown>
    {stale && <p className={styles.warning} role="status">{t("course.stale")}</p>}
    <form onSubmit={async (event) => {
      event.preventDefault(); if (busy.current) return;
      busy.current = true; setSaving(true); setError("");
      try {
        const { record: saved } = await request<{ record: RoadmapRecord }>(API, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          lessonId: lesson.id, fingerprint: lesson.fingerprint, revision: record?.revision ?? 0, status, evidence,
        }) });
        dirty.current = false; setChanged(false); onSaved(saved);
      } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
      finally { busy.current = false; setSaving(false); }
    }}>
      <label htmlFor="course-answer">{t("course.evidence")}</label><textarea id="course-answer" aria-describedby="course-record-limit" placeholder={t("course.placeholder")} rows={7} maxLength={20_000} required={status === "confident"} disabled={saving} value={evidence} onChange={(event) => { setEvidence(event.target.value); change(); }} />
      <div className={styles.hints}>{lesson.exercise.hints.map((hint, number) => <details key={hint}><summary>{t("course.hint", { number: number + 1 })}</summary><p>{hint}</p></details>)}
        <details><summary>{t("course.solution")}</summary><Markdown>{lesson.exercise.solution}</Markdown></details>
      </div>
      <h4>{t("course.rubric")}</h4><ul>{lesson.exercise.rubric.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul>
      <label>{t("roadmap.status")}<select value={status} disabled={saving} onChange={(event) => { setStatus(event.target.value as RoadmapStatus); change(); }}>{ROADMAP_STATUSES.map((value) => <option key={value} value={value}>{t(`roadmap.${value}`)}</option>)}</select></label>
      <p id="course-record-limit" className={styles.muted}>{t("course.recordLimit")}</p>
      <div className={styles.saveRow}><button type="submit" disabled={saving || (status === "confident" && !evidence.trim())}>{t(saving ? "roadmap.saving" : "roadmap.save")}</button><span role="status">{changed ? t("roadmap.unsaved") : record && !stale ? t("roadmap.saved") : ""}</span></div>
      {error && <p role="alert" className={styles.warning}>{error}</p>}
    </form>
  </section>;
}

/** Lazy, read-only source lookup. Multiple vaults require a choice, never a merged search. */
function SourceNotes({ titles }: { titles: string[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [vaults, setVaults] = useState<Array<{ id: string; name: string }> | null>(null);
  const [vaultId, setVaultId] = useState("");
  const [catalog, setCatalog] = useState<VaultIndex | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    request<{ vaults: Array<{ id: string; name: string }> }>("/api/robin/obsidian/vault", { signal: controller.signal }).then(({ vaults }) => {
      if (controller.signal.aborted) return;
      setVaults(vaults); if (vaults.length === 1) setVaultId(vaults[0].id);
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [open]);
  useEffect(() => {
    setError(""); setCatalog(null);
    if (!vaultId) return;
    const controller = new AbortController();
    request<VaultIndex>(`/api/robin/learning/roadmap?${new URLSearchParams({ vaultId })}`, { signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setCatalog(data); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [vaultId]);
  const notes = catalog?.notes.filter((note) => titles.includes(note.title) || titles.includes(note.path.split("/").at(-1)!.replace(/\.md$/i, ""))) ?? [];
  return <details onToggle={(event) => { if (event.currentTarget.open) setOpen(true); }}><summary>{t("course.notes")}</summary>
    {error && <p role="alert">{error}</p>}
    {open && !vaults && !error && <p role="status">{t("obsidian.loading")}</p>}
    {vaults?.length === 0 && <p>{t("notes.obsidian.setup")}</p>}
    {!!vaults && vaults.length > 1 && <label>{t("notes.obsidian.vault")}<select value={vaultId} onChange={(event) => setVaultId(event.target.value)}><option value="">{t("notes.obsidian.choose")}</option>{vaults.map((vault) => <option key={vault.id} value={vault.id}>{vault.name}</option>)}</select></label>}
    {vaultId && !catalog && !error && <p role="status">{t("obsidian.loading")}</p>}
    {catalog?.limited && <p>{t("obsidian.limited")}</p>}{!!catalog?.skipped && <p>{t("obsidian.skipped", { count: catalog.skipped })}</p>}
    {catalog && !notes.length && <p>{t("course.sourceMissing")}</p>}
    <ul>{notes.map((note) => <li key={note.path}><a target="_blank" rel="noopener noreferrer" href={`/obsidian?${new URLSearchParams({ vault: vaultId, note: note.path, view: "read" })}`}>{note.title} ↗</a></li>)}</ul>
  </details>;
}
