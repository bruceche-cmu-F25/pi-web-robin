"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Idea } from "@/extension/robin/product-domain";
import type { ValidationBoard, ValidationProject } from "@/extension/robin/validation-shape";
import { usePolledResource } from "./usePolledResource";
import { useProductAgent } from "./ProductIncubatorShell";
import { NewProjectForm, ValidationProjectWorkspace } from "./ValidationWorkspace";
import { validationCopy } from "./validation-copy";
import styles from "./ValidationWorkspace.module.css";

/** The existing validation domain, in the lab's reading pane. No parallel editor or new storage. */
export function ProductExperiments({ idea, locale, active, view, experimentId, onSelect }: {
  idea: Idea; locale: string; active: boolean; view: "plan" | "evidence"; experimentId: string | null; onSelect: (id: string | null) => void;
}) {
  const copy = validationCopy(locale);
  const zh = locale.startsWith("zh");
  const { partnerHost } = useProductAgent();
  const board = usePolledResource<ValidationBoard>("/api/robin/validation", 30_000, active);
  const [visited, setVisited] = useState<string[]>([]);
  const [draftSource, setDraftSource] = useState<Idea | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);
  const projects = (board.data?.projects ?? []).filter(project => project.ideaId === idea.id);
  const known = Boolean(experimentId && (visited.includes(experimentId) || projects.some(project => project.id === experimentId)));
  useEffect(() => {
    if (active && known && experimentId) setVisited(current => current.includes(experimentId) ? current : [...current, experimentId]);
  }, [active, known, experimentId]);
  const initialize = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch("/api/robin/validation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "initialize" }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? copy.unavailable);
      board.updateData(() => body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : copy.unavailable); }
    finally { lock.current = false; setBusy(false); }
  };
  const created = (project: ValidationProject) => {
    board.updateData(current => ({ initialized: true, projects: [...(current?.projects ?? []).filter(p => p.id !== project.id), project] }));
    setVisited(current => [...current, project.id]); setDraftSource(null);
    if (activeRef.current) onSelect(project.id);
  };
  const showingProject = known && !!experimentId;
  return <div className={`${styles.frame} ${styles.embeddedFrame}`}>
    {(error || board.error) && <p role="alert" className={styles.error}>{error ?? board.error} <button type="button" onClick={() => void board.refresh()}>{copy.refresh}</button></p>}
    {!board.data && !board.error && <p role="status">{copy.loading}</p>}
    {board.data && !board.data.initialized && <section className={styles.empty}><p>{copy.initializeHint}</p><button type="button" disabled={busy} onClick={() => void initialize()}>{busy ? copy.saving : copy.initialize}</button></section>}
    {board.data?.initialized && <>
      <div className={styles.actions}><h2>{zh ? "一次只回答一个问题" : "One experiment, one question"}</h2>
        {showingProject ? <button type="button" onClick={() => onSelect(null)}>{zh ? "全部实验" : "All experiments"}</button> : <button type="button" disabled={!!draftSource} onClick={() => setDraftSource(structuredClone(idea))}>{zh ? "＋ 新实验" : "+ New experiment"}</button>}
        <a href="/api/robin/validation?export=1" download>{copy.export}</a>
      </div>
      <p className={styles.muted}>{zh ? "候选人群、标准、原始观察和人工结论。创建草稿不会启动外联。" : "Segments, criteria, original observations and your decision. Creating a draft never starts outreach."}</p>
      {experimentId && !known && <p role="alert">{zh ? "此实验不存在，或不属于当前想法。" : "This experiment is unavailable or belongs to a different idea."}</p>}
      <div hidden={showingProject}>
        {draftSource && <NewProjectForm copy={copy} initialIdea={draftSource} ideas={[draftSource]} fixedIdea loadError={null} onClose={() => setDraftSource(null)} onCreated={created} />}
        {!projects.length && !draftSource && <p className={styles.empty}>{zh ? "还没有实验。从最不确定的一件事开始。" : "No experiments yet. Start with your biggest uncertainty."}</p>}
        <ul className={styles.projectList}>{projects.map(project => <li key={project.id}>
          <button type="button" onClick={() => onSelect(project.id)}><strong>{project.name}</strong><span>{project.brief}</span></button><span className={styles.status}>{copy[project.status]}</span>
        </li>)}</ul>
      </div>
    </>}
    {/* Keep each visited editor mounted, including on Back/Forward. Its own dirty
        revision and message draft must not be replaced by another experiment. */}
    {visited.map(id => <div key={id} hidden={!active || id !== experimentId}>
      <ValidationProjectWorkspace id={id} expectedIdeaId={idea.id} copy={copy} locale={locale} active={active && id === experimentId} view={view} partnerHost={partnerHost} />
    </div>)}
    {partnerHost && createPortal(<div className={`${styles.frame} ${styles.partnerFrame}`} hidden={!active || showingProject}>
      <h2>{zh ? "从一个小实验开始" : "Start with a small experiment"}</h2><p>{zh ? "选择或创建实验后，在这里讨论人群和判断标准。讨论只保存未批准的草案，不调用研究或发送工具。" : "Choose or create an experiment to discuss its audience and criteria here. Discussion saves unapproved drafts only; it has no research or sending tools."}</p>
    </div>, partnerHost)}
  </div>;
}
