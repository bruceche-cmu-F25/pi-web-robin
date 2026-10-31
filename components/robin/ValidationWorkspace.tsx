"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { MarkdownBody } from "@/components/MarkdownBody";
import { writeUrlState } from "@/lib/url-state";
import { currentValidationPlan, emptyValidationCriteria, VALIDATION_CRITERIA_FIELDS, type ValidationBoard, type ValidationCandidate, type ValidationPlan, type ValidationPlanRevision, type ValidationProject } from "@/extension/robin/validation-shape";
import { usePolledResource } from "./usePolledResource";
import { validationCopy, type ValidationCopy } from "./validation-copy";
import styles from "./ValidationWorkspace.module.css";

const API = "/api/robin/validation";
type Fields = Record<string, unknown>;
type Act = (action: string, fields?: Fields, expectedRevision?: number) => Promise<boolean>;
const candidateFields = ["situation", "problem", "alternatives", "signals", "exclusions", "unknowns"] as const;
function blankCandidate(): ValidationCandidate { return { id: crypto.randomUUID(), name: "", situation: "", problem: "", alternatives: "", signals: "", exclusions: "", unknowns: "" }; }
function blankPlan(): ValidationPlan { return { candidates: [blankCandidate(), blankCandidate()], selectedCandidateId: null, offer: "", criteria: emptyValidationCriteria() }; }
function editablePlan(plan: ValidationPlanRevision): ValidationPlan {
  return { candidates: structuredClone(plan.candidates), selectedCandidateId: plan.selectedCandidateId, offer: plan.offer, criteria: { ...plan.criteria } };
}
async function json<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), signal });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `Request failed (${response.status})`);
  return value as T;
}
function useDepartureWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}
function TextField({ label, value, onChange, required = false, maxLength = 4000, rows = 3 }: {
  label: string; value: string; onChange: (value: string) => void; required?: boolean; maxLength?: number; rows?: number;
}) {
  const id = useId();
  return <div className={styles.field}><label htmlFor={id}>{label}</label><textarea id={id} value={value} onChange={e => onChange(e.target.value)} required={required} maxLength={maxLength} rows={rows} /></div>;
}
function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  const id = useId();
  return <div className={styles.field}><label htmlFor={id}>{label}</label><select id={id} value={value} onChange={e => onChange(e.target.value)}>{children}</select></div>;
}
function Status({ project, copy }: { project: Pick<ValidationProject, "status">; copy: ValidationCopy }) {
  return <span className={styles.status}>{copy[project.status]}</span>;
}

export function ValidationWorkspace() {
  const { locale } = useI18n();
  const copy = validationCopy(locale);
  const params = useSearchParams();
  const id = params.get("project");
  const sourceIdeaId = params.get("idea");
  const board = usePolledResource<ValidationBoard>(API, 30_000, !id);
  const [createOpen, setCreateOpen] = useState(false);
  const creating = createOpen || Boolean(sourceIdeaId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const initialize = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { board.updateData(() => null); const saved = await json<ValidationBoard>(API, { action: "initialize" }); board.updateData(() => saved); }
    catch (caught) { setError(caught instanceof Error ? caught.message : copy.unavailable); await board.refresh(); }
    finally { lock.current = false; setBusy(false); }
  };
  const select = (projectId: string | null) => writeUrlState({ project: projectId, idea: null });
  return <main className={`robin-page robin-dashboard ${styles.page}`}>
    <div className={styles.frame}>
      <header className={styles.header}>
        <div><a href="/product?view=ideas">{copy.back}</a><h1>{copy.title}</h1><p>{copy.intro}</p></div>
        <div className={styles.actions}>{id && <button type="button" onClick={() => { if (window.confirm(copy.leave)) select(null); }}>{copy.allProjects}</button>}
          {(id || board.data?.initialized) && <a href={`${API}?export=1`} download>{copy.export}</a>}</div>
      </header>
      <p className={styles.notice}>{copy.scope}</p>
      {id ? <ValidationProjectWorkspace key={id} id={id} copy={copy} locale={locale} /> : <>
        {(error || board.error) && <p role="alert" className={styles.error}>{error ?? board.error} <button onClick={() => void board.refresh()}>{copy.refresh}</button></p>}
        {!board.data && !board.error && !error && <p role="status">{copy.loading}</p>}
        {board.data && !board.data.initialized && <section className={styles.empty}><p>{copy.initializeHint}</p><button type="button" disabled={busy} onClick={() => void initialize()}>{busy ? copy.saving : copy.initialize}</button></section>}
        {board.data?.initialized && <>
          <div className={styles.actions}><h2>{copy.allProjects}</h2><button type="button" disabled={creating} onClick={() => setCreateOpen(true)}>{copy.newProject}</button></div>
          {creating && <NewProject key={sourceIdeaId ?? "new"} initialIdeaId={sourceIdeaId} copy={copy} onClose={() => { setCreateOpen(false); writeUrlState({ idea: null }, "replace"); }} onCreated={project => { setCreateOpen(false); select(project.id); }} />}
          {!board.data.projects.length && !creating && <p className={styles.empty}>{copy.empty}</p>}
          <ul className={styles.projectList}>{board.data.projects.map(project => <li key={project.id}>
            <button type="button" onClick={() => select(project.id)}><strong>{project.name}</strong><span>{project.brief}</span></button>
            <Status project={project} copy={copy} />
          </li>)}</ul>
        </>}
      </>}
    </div>
  </main>;
}

type SourceIdea = { id: string; name: string; note: string };
type NewProjectProps = { copy: ValidationCopy; onClose: () => void; onCreated: (project: ValidationProject) => void };
function NewProject({ initialIdeaId, ...props }: NewProjectProps & { initialIdeaId: string | null }) {
  const ideas = usePolledResource<{ ideas: SourceIdea[] }>("/api/robin/products", 60_000);
  const [initialIdea, setInitialIdea] = useState<SourceIdea | undefined>();
  useEffect(() => {
    if (initialIdea || !initialIdeaId) return;
    const source = ideas.data?.ideas.find(idea => idea.id === initialIdeaId);
    if (source) setInitialIdea(source);
  }, [initialIdea, initialIdeaId, ideas.data]);
  // Resolve the explicit source before mounting the editor. Polls can update the
  // choices, but never re-seed a user's draft. Opening this link writes nothing.
  if (initialIdeaId && !initialIdea) return <section className={styles.section}>
    <p role={ideas.error || ideas.data ? "alert" : "status"}>{ideas.error ?? (ideas.data ? props.copy.unavailable : props.copy.loading)}</p>
    <div className={styles.actions}><button type="button" onClick={() => void ideas.refresh()}>{props.copy.refresh}</button><button type="button" onClick={props.onClose}>{props.copy.cancel}</button></div>
  </section>;
  return <NewProjectForm {...props} initialIdea={initialIdea} ideas={ideas.data?.ideas ?? []} loadError={ideas.error} />;
}

export function NewProjectForm({ copy, onClose, onCreated, initialIdea, ideas, loadError, fixedIdea = false }: NewProjectProps & { initialIdea?: SourceIdea; ideas: SourceIdea[]; loadError: string | null; fixedIdea?: boolean }) {
  const [name, setName] = useState(initialIdea?.name ?? "");
  const [brief, setBrief] = useState(initialIdea?.note ?? "");
  const [ideaId, setIdeaId] = useState(initialIdea?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const pending = useRef<{ key: string; operationId: string } | null>(null);
  useDepartureWarning(!!name || !!brief || busy);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (lock.current) return;
    const input = { action: "create", name, brief, ideaId: ideaId || null };
    const key = JSON.stringify(input);
    if (pending.current?.key !== key) pending.current = { key, operationId: crypto.randomUUID() };
    lock.current = true; setBusy(true); setError(null);
    try { const { project } = await json<{ project: ValidationProject }>(API, { ...input, operationId: pending.current.operationId }); onCreated(project); }
    catch (caught) { setError(caught instanceof Error ? caught.message : copy.createFailed); }
    finally { lock.current = false; setBusy(false); }
  };
  return <form className={styles.section} onSubmit={submit}>
    <h2>{copy.newProject}</h2>
    {loadError && <p role="alert">{loadError}</p>}
    <fieldset disabled={busy}>
      {!fixedIdea && <SelectField label={copy.idea} value={ideaId} onChange={value => {
        const idea = ideas.find(item => item.id === value);
        if ((name || brief) && !window.confirm(copy.discard)) return;
        setIdeaId(value); setName(idea?.name ?? ""); setBrief(idea?.note ?? "");
      }}><option value="">{copy.newIdea}</option>{ideas.map(idea => <option key={idea.id} value={idea.id}>{idea.name}</option>)}</SelectField>}
      <label className={styles.field}><span>{copy.name}</span><input value={name} onChange={e => setName(e.target.value)} required maxLength={200} /></label>
      <TextField label={copy.brief} value={brief} onChange={setBrief} required maxLength={12000} rows={4} />
    </fieldset>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.actions}><button disabled={busy} type="submit">{busy ? copy.saving : copy.create}</button><button disabled={busy} type="button" onClick={() => { if ((!name && !brief) || window.confirm(copy.discard)) onClose(); }}>{copy.cancel}</button></div>
  </form>;
}

export function ValidationProjectWorkspace({ id, copy, locale, active = true, view = "all", partnerHost, expectedIdeaId }: {
  id: string; copy: ValidationCopy; locale: string; active?: boolean; view?: "all" | "plan" | "evidence";
  partnerHost?: HTMLDivElement | null; expectedIdeaId?: string;
}) {
  const discussionId = useId();
  const [dirtyParts, setDirtyParts] = useState<Record<string, boolean>>({});
  const dirty = Object.values(dirtyParts).some(Boolean);
  const resource = usePolledResource<{ project: ValidationProject }>(`${API}?id=${encodeURIComponent(id)}`, data => data?.project.discussion?.state === "running" ? 2000 : 30_000, active && !dirty);
  const candidate = resource.data?.project;
  const wrongIdea = expectedIdeaId !== undefined && candidate && candidate.ideaId !== expectedIdeaId;
  const project = wrongIdea ? undefined : candidate;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const stopLock = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const abort = useRef<AbortController | null>(null);
  const pending = useRef<{ key: string; operationId: string } | null>(null);
  const setDirty = useCallback((part: string, value: boolean) => setDirtyParts(parts => parts[part] === value ? parts : { ...parts, [part]: value }), []);
  useDepartureWarning(dirty || !!message || busy || thinking);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const act: Act = async (action, fields = {}, expectedRevision) => {
    if (!project || lock.current) return false;
    const input = { action, projectId: project.id, expectedRevision: expectedRevision ?? project.revision, ...fields };
    const key = JSON.stringify(input);
    if (pending.current?.key !== key) pending.current = { key, operationId: crypto.randomUUID() };
    lock.current = true; setBusy(true); setError(null);
    try {
      const saved = await json<{ project: ValidationProject }>(API, { ...input, operationId: pending.current.operationId });
      resource.updateData(() => saved); pending.current = null; return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : copy.createFailed); await resource.refresh(); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  const discuss = async (text: string) => {
    if (!project || lock.current || thinking || !text.trim() || dirty) return;
    lock.current = true; setThinking(true); setError(null);
    const controller = new AbortController(); abort.current = controller;
    try {
      const saved = await json<{ project: ValidationProject }>(`${API}/discuss`, { action: "discuss", projectId: id, expectedRevision: project.revision,
        operationId: crypto.randomUUID(), message: text, locale }, controller.signal);
      if (!controller.signal.aborted) { resource.updateData(() => saved); setMessage(""); }
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : copy.discussionFailed); }
    finally { lock.current = false; setThinking(false); if (abort.current === controller) abort.current = null; await resource.refresh(); }
  };
  const stop = async () => {
    if (stopLock.current) return;
    stopLock.current = true; setStopping(true); setError(null);
    try {
      // A start claims a new revision before model I/O. Read that receipt, not the old render.
      const latest = await json<{ project: ValidationProject }>(`${API}?id=${encodeURIComponent(id)}`);
      if (latest.project.discussion?.state === "running") {
        const saved = await json<{ project: ValidationProject }>(API, { action: "cancelDiscussion", operationId: crypto.randomUUID(), projectId: id, expectedRevision: latest.project.revision });
        resource.updateData(() => saved);
      } else resource.updateData(() => latest);
      abort.current?.abort();
    } catch (caught) { setError(caught instanceof Error ? caught.message : copy.unavailable); }
    finally { stopLock.current = false; setStopping(false); }
  };
  const running = thinking || project?.discussion?.state === "running";
  const conversation = project ? <section className={`chat-content ${styles.conversation} ${partnerHost ? styles.partnerConversation : ""}`} aria-labelledby={discussionId}>
          <h2 id={discussionId}>{copy.discuss}</h2><p className={styles.muted}>{copy.discussHint}</p>
          <div className={styles.messages}>{project.conversation.map((item, index) => <article key={index} className={`workspace-agent-message${item.role === "user" ? " chat-user-bubble" : ""}`} aria-label={item.role === "user" ? copy.user : copy.assistant}>
            {item.role === "assistant" && <div className="chat-message-label">{copy.assistant}</div>}
            <MarkdownBody className={item.role === "user" ? "markdown-user-message" : undefined} keepLineBreaks={item.role === "user"}>{item.text}</MarkdownBody>
          </article>)}</div>
          {project.discussion?.state === "failed" && <p role="status" className={styles.notice}>{copy.discussionFailed}</p>}
          {project.discussion?.state === "cancelled" && <p role="status">{copy.stopped}</p>}
          {running ? <div className={styles.section}><p role="status">{copy.thinking}</p><button type="button" disabled={stopping} onClick={() => void stop()}>{copy.stop}</button><p className={styles.muted}>{copy.stopHint}</p></div>
            : project.status !== "draft" ? <p>{copy.lockedDiscussion}</p> : <form onSubmit={event => { event.preventDefault(); void discuss(message); }}>
              <label className="chat-message-label" htmlFor={`${discussionId}-message`}>{copy.message}</label>
              <div className="chat-input-surface">
                <textarea id={`${discussionId}-message`} className="chat-input-textarea" value={message} onChange={event => setMessage(event.target.value)} maxLength={12000} rows={2} />
                <div className="chat-input-actions"><button type="submit" className="ui-action ui-action--outline pi-chrome-label chat-send-button" data-state={message.trim() ? "accent" : "dim"} disabled={busy || dirty || !message.trim()} aria-label={copy.send} title={copy.send}>
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7h9m-3.5-4L12 7l-4.5 4" /></svg>
                  <span className="chat-send-label">{copy.send}</span>
                </button></div>
              </div>
              {!project.conversation.length && <div className={styles.actions}><button type="button" disabled={busy || dirty} onClick={() => void discuss(copy.kickoff)}>{copy.startDiscussion}</button></div>}
              {dirty && <p className={styles.muted}>{copy.unsaved}</p>}
            </form>}
        </section> : <p role="status">{wrongIdea || resource.error ? copy.unavailable : copy.loading}</p>;
  return <>
    {(error || resource.error || wrongIdea) && <p ref={errorRef} tabIndex={-1} role="alert" className={styles.error}>{error ?? resource.error ?? copy.unavailable} <button type="button" onClick={() => { setError(null); void resource.refresh(); }}>{copy.refresh}</button></p>}
    {!project && <p role="status">{wrongIdea || resource.error ? copy.unavailable : copy.loading}</p>}
    {partnerHost && createPortal(<div className={`${styles.frame} ${styles.partnerFrame}`} hidden={!active}>{conversation}</div>, partnerHost)}
    {project && <>
      <header className={styles.projectHeader}><div><h2>{project.name}</h2><p className={styles.prose}>{project.brief}</p><small>{copy.stage}</small></div><Status project={project} copy={copy} /></header>
      <p className={styles.muted}>{copy.later}</p>
      <div className={`${styles.workspace} ${view !== "all" ? styles.embeddedWorkspace : ""}`}>
        {!partnerHost && conversation}
        <div className={styles.document}>
          <div hidden={view === "evidence"}><PlanEditor project={project} copy={copy} act={act} blocked={busy || !!running || !!dirtyParts.evidence} setDirty={setDirty} /></div>
          <div hidden={view === "plan"}>
            {project.currentPlanId ? <EvidenceEditor project={project} copy={copy} act={act} blocked={busy || !!running || !!dirtyParts.plan} setDirty={setDirty} /> : <p className={styles.notice}>{copy.noPlan}</p>}
            <History project={project} copy={copy} />
          </div>
        </div>
      </div>
    </>}
  </>;
}

function PlanRead({ plan, copy }: { plan: ValidationPlanRevision; copy: ValidationCopy }) {
  return <>
    <p className={styles.muted}>{copy.planVersion} {plan.number} / {plan.author === "human" ? copy.human : copy.assistant}</p>
    <div className={styles.candidates}>{plan.candidates.map(c => <details key={c.id} open={plan.selectedCandidateId === c.id}>
      <summary>{c.name}{plan.selectedCandidateId === c.id ? ` (${copy.selected})` : ""}</summary>
      <p className={styles.muted}>{copy.hypothesisOnly}</p>
      <dl>{candidateFields.map(key => <div key={key}><dt>{copy[key]}</dt><dd>{c[key] || copy.emptyFields}</dd></div>)}</dl>
    </details>)}</div>
    {!plan.selectedCandidateId && <p className={styles.notice}>{copy.noSelection}</p>}
    <h3>{copy.offer}</h3><p className={styles.prose}>{plan.offer || copy.emptyFields}</p>
    <details><summary>{copy.criteria}</summary><dl>{VALIDATION_CRITERIA_FIELDS.map(key => <div key={key}><dt>{copy[key]}</dt><dd>{plan.criteria[key] || copy.emptyFields}</dd></div>)}</dl></details>
  </>;
}

function PlanEditor({ project, copy, act, blocked, setDirty }: { project: ValidationProject; copy: ValidationCopy; act: Act; blocked: boolean; setDirty: (part: string, value: boolean) => void }) {
  const planId = useId();
  const plan = currentValidationPlan(project);
  const [draft, setDraft] = useState<ValidationPlan | null>(null);
  const [base, setBase] = useState(project.revision);
  const [reason, setReason] = useState("");
  const [approvalReason, setApprovalReason] = useState("");
  useEffect(() => { setDirty("plan", !!draft || !!approvalReason); return () => setDirty("plan", false); }, [draft, approvalReason, setDirty]);
  const edit = () => { setDraft(plan ? editablePlan(plan) : blankPlan()); setBase(project.revision); setReason(""); setApprovalReason(""); };
  const changeCandidate = (id: string, key: keyof ValidationCandidate, value: string) => setDraft(d => d && ({ ...d, candidates: d.candidates.map(c => c.id === id ? { ...c, [key]: value } : c) }));
  return <section className={styles.section} aria-labelledby={planId}>
    <div className={styles.actions}><h2 id={planId}>{copy.plan}</h2>{!draft && <button type="button" disabled={blocked} onClick={edit}>{!plan ? copy.manual : project.status === "draft" ? copy.edit : copy.revise}</button>}</div>
    {!plan && !draft && <p>{copy.noPlan}</p>}
    {draft ? <form onSubmit={async event => {
      event.preventDefault(); if (await act("savePlan", { plan: draft, reason }, base)) { setDraft(null); setReason(""); }
    }}>
      {base !== project.revision && <p role="alert" className={styles.error}>{copy.conflict}</p>}
      {project.status !== "draft" && <p className={styles.notice}>{copy.reviseHint}</p>}
      <fieldset disabled={blocked}>
        {draft.candidates.map((c, index) => <fieldset className={styles.candidateEditor} key={c.id}>
          <legend>{copy.candidate} {index + 1}</legend>
          <label className={styles.check}><input type="radio" name="selected-candidate" checked={draft.selectedCandidateId === c.id} onChange={() => setDraft({ ...draft, selectedCandidateId: c.id })} />{copy.select}</label>
          <label className={styles.field}><span>{copy.segmentName}</span><input value={c.name} onChange={e => changeCandidate(c.id, "name", e.target.value)} required maxLength={200} /></label>
          <details><summary>{copy.situation} / {copy.unknowns}</summary>{candidateFields.map(key => <TextField key={key} label={copy[key]} value={c[key]} onChange={value => changeCandidate(c.id, key, value)} maxLength={2000} rows={2} />)}</details>
          {draft.candidates.length > 1 && <button type="button" onClick={() => setDraft({ ...draft, candidates: draft.candidates.filter(candidate => candidate.id !== c.id), selectedCandidateId: draft.selectedCandidateId === c.id ? null : draft.selectedCandidateId })}>{copy.removeCandidate}</button>}
        </fieldset>)}
        {draft.candidates.length < 3 && <button type="button" onClick={() => setDraft({ ...draft, candidates: [...draft.candidates, blankCandidate()] })}>{copy.addCandidate}</button>}
        <TextField label={copy.offer} value={draft.offer} onChange={offer => setDraft({ ...draft, offer })} />
        <details open><summary>{copy.criteria}</summary>{VALIDATION_CRITERIA_FIELDS.map(key => <TextField key={key} label={copy[key]} value={draft.criteria[key]} onChange={value => setDraft({ ...draft, criteria: { ...draft.criteria, [key]: value } })} rows={2} />)}</details>
        <TextField label={copy.reason} value={reason} onChange={setReason} required maxLength={2000} rows={2} />
        <div className={styles.actions}><button type="submit" disabled={!reason.trim() || base !== project.revision}>{copy.savePlan}</button><button type="button" onClick={() => { if (window.confirm(copy.discard)) { setDraft(null); setReason(""); } }}>{copy.discard}</button></div>
      </fieldset>
    </form> : plan && <>
      <PlanRead plan={plan} copy={copy} />
      {project.status === "draft" && <form className={styles.approval} onSubmit={async event => {
        event.preventDefault(); if (window.confirm(copy.approveConfirm) && await act("approve", { planId: plan.id, reason: approvalReason }, base)) setApprovalReason("");
      }}>
        <p>{copy.approvalHint}</p><TextField label={copy.approvalReason} value={approvalReason} onChange={value => { if (!approvalReason) setBase(project.revision); setApprovalReason(value); }} required maxLength={2000} rows={2} />
        <button type="submit" disabled={blocked || !approvalReason.trim() || !plan.selectedCandidateId || base !== project.revision}>{copy.approve}</button>
        {approvalReason && base !== project.revision && <p role="alert">{copy.conflict} <button type="button" onClick={() => setApprovalReason("")}>{copy.discard}</button></p>}
      </form>}
    </>}
  </section>;
}

function EvidenceEditor({ project, copy, act, blocked, setDirty }: { project: ValidationProject; copy: ValidationCopy; act: Act; blocked: boolean; setDirty: (part: string, value: boolean) => void }) {
  const [source, setSource] = useState(""); const [quote, setQuote] = useState(""); const [interpretation, setInterpretation] = useState(""); const [observedOn, setObservedOn] = useState("");
  const [stance, setStance] = useState("unknown"); const [outcome, setOutcome] = useState("inconclusive"); const [decisionReason, setDecisionReason] = useState(""); const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [base, setBase] = useState(project.revision);
  const [draftPlanId, setDraftPlanId] = useState(project.currentPlanId);
  const evidenceDirty = !!source || !!quote || !!interpretation || !!observedOn;
  const decisionDirty = !!decisionReason || evidenceIds.length > 0;
  const dirty = evidenceDirty || decisionDirty;
  useEffect(() => { setDirty("evidence", dirty); return () => setDirty("evidence", false); }, [dirty, setDirty]);
  const touch = () => { if (!dirty) { setBase(project.revision); setDraftPlanId(project.currentPlanId); } };
  const contextPlanId = dirty ? draftPlanId : project.currentPlanId;
  const evidence = project.evidence.filter(item => item.planId === contextPlanId);
  const reset = () => { setSource(""); setQuote(""); setInterpretation(""); setObservedOn(""); setDecisionReason(""); setEvidenceIds([]); setBase(project.revision); setDraftPlanId(project.currentPlanId); };
  return <section className={styles.section}>
    <h2>{copy.evidence}</h2><p className={styles.muted}>{copy.evidenceHint}</p>
    {!evidence.length && <p>{copy.evidenceEmpty}</p>}
    {evidence.map(item => <article className={styles.observation} key={item.id}>
      <div className={styles.actions}><strong>{copy[item.stance]}</strong><time>{item.observedOn}</time></div><blockquote>{item.quote}</blockquote><p className={styles.prose}>{item.source}</p>{item.interpretation && <p className={styles.prose}>{copy.interpretation}: {item.interpretation}</p>}
      {project.status === "approved" && <label className={styles.check}><input disabled={blocked || evidenceDirty} type="checkbox" checked={evidenceIds.includes(item.id)} onChange={event => { touch(); setEvidenceIds(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id)); }} />{copy.selectedEvidence}</label>}
    </article>)}
    {dirty && base !== project.revision && <p role="alert" className={styles.error}>{copy.conflict}</p>}
    {(project.status !== "closed" || evidenceDirty) && <details><summary>{copy.addEvidence}</summary><form onSubmit={async event => {
      event.preventDefault(); if (await act("evidence", { planId: contextPlanId, stance, source, quote, interpretation, observedOn }, base)) reset();
    }}><fieldset disabled={blocked || decisionDirty || (dirty && base !== project.revision)}>
      <TextField label={copy.source} value={source} onChange={v => { touch(); setSource(v); }} required maxLength={2000} rows={2} />
      <TextField label={copy.quote} value={quote} onChange={v => { touch(); setQuote(v); }} required maxLength={12000} />
      <TextField label={copy.interpretation} value={interpretation} onChange={v => { touch(); setInterpretation(v); }} />
      <label className={styles.field}><span>{copy.observedOn}</span><input type="date" value={observedOn} onChange={e => { touch(); setObservedOn(e.target.value); }} required /></label>
      <SelectField label={copy.stance} value={stance} onChange={value => { touch(); setStance(value); }}>{(["supports", "challenges", "unknown"] as const).map(key => <option key={key} value={key}>{copy[key]}</option>)}</SelectField>
      <button type="submit">{copy.addEvidence}</button>
    </fieldset></form></details>}
    {(project.status === "approved" || decisionDirty) && <details><summary>{copy.decision}</summary><p>{copy.decisionHint}</p><form onSubmit={async event => {
      event.preventDefault(); if (window.confirm(copy.decisionConfirm) && await act("decide", { planId: contextPlanId, outcome, reason: decisionReason, evidenceIds }, base)) reset();
    }}><fieldset disabled={blocked || evidenceDirty || (dirty && base !== project.revision)}>
      <SelectField label={copy.outcome} value={outcome} onChange={value => { touch(); setOutcome(value); }}><option value="inconclusive">{copy.outcomeInconclusive}</option><option value="pass">{copy.outcomePass}</option><option value="fail">{copy.outcomeFail}</option></SelectField>
      <TextField label={copy.decisionReason} value={decisionReason} onChange={v => { touch(); setDecisionReason(v); }} required />
      <button type="submit" disabled={!decisionReason.trim() || (outcome !== "inconclusive" && !evidenceIds.length)}>{copy.recordDecision}</button>
    </fieldset></form></details>}
    {dirty && <button type="button" onClick={() => { if (window.confirm(copy.discard)) reset(); }}>{copy.discard}</button>}
  </section>;
}

function History({ project, copy }: { project: ValidationProject; copy: ValidationCopy }) {
  return <section className={styles.section}><details><summary>{copy.history}</summary><p>{copy.historyHint}</p>
    {!project.plans.length && <p>{copy.noHistory}</p>}
    {[...project.plans].reverse().map(plan => <details key={plan.id}>
      <summary>{copy.planVersion} {plan.number}: {plan.reason}</summary><p>{copy.reviewOnly}</p><PlanRead plan={plan} copy={copy} />
      <h3>{copy.versionEvidence}</h3>{project.evidence.filter(item => item.planId === plan.id).map(item => <div className={styles.observation} key={item.id}><strong>{copy[item.stance]}</strong><blockquote>{item.quote}</blockquote><p>{item.source} / {item.observedOn}</p><p>{item.interpretation}</p></div>)}
      {project.decisions.filter(decision => decision.planId === plan.id).map(decision => <p key={decision.id}><strong>{copy.decision}: {decision.outcome === "pass" ? copy.outcomePass : decision.outcome === "fail" ? copy.outcomeFail : copy.outcomeInconclusive}</strong><br />{decision.reason}</p>)}
    </details>)}
    <details><summary>{copy.activity}</summary><ol>{project.activity.map((item, index) => <li key={index}><time>{item.at}</time> / {item.actor === "human" ? copy.human : copy.assistant}<p>{item.reason}</p></li>)}</ol></details>
  </details></section>;
}
