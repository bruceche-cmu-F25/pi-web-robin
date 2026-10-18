import { randomUUID } from "node:crypto";
import { readJsonArray, readJsonObject, updateJsonObject } from "./paths.ts";
import { paperText, PaperError, paperUrl, listPapers, paperProjects, LEGACY_PROJECT_ID, type Paper } from "./papers-domain.ts";
import { BRIEF_META, HEADLINE } from "./heat-brief.ts";
import { PIPELINE, GAPS, RESULTS, PROJECT_REPOSITORY, PROGRESS_SHEET, PROJECT_DRIVE, STATUS_REPORT } from "./research.ts";

/**
 * A research project is the unit a researcher thinks in: what they are trying to find out (brief),
 * what they are doing about it now (focus), what they have learned (notebook), where its material lives
 * (links), and the papers and discussion gathered for it. HEAT is one project, not the product.
 */
export interface ResearchLink { title: string; url: string }
export interface ResearchProject {
  id: string; name: string; brief: string; objective: string; note: string; links: ResearchLink[];
  /** Built-in authored reference attached to this project's context (only HEAT has one). */
  reference?: "heat";
  /** The research home: papers read and questions asked outside any project. Never a tab, never archived. */
  general?: boolean;
  archived?: boolean; createdAt: string; updatedAt: string; objectiveUpdatedAt: string | null;
}
interface ProjectsFile { version: 1; activeId: string; projects: ResearchProject[] }
const PROJECTS = "research-projects.json";
/** Data stored before projects existed belongs to the migrated HEAT project. */
export { LEGACY_PROJECT_ID };
export const GENERAL_PROJECT_ID = "general";
function generalProject(): ResearchProject {
  return { id: GENERAL_PROJECT_ID, name: "Research", brief: "", objective: "", note: "", links: [], general: true, createdAt: BRIEF_META.written, updatedAt: BRIEF_META.written, objectiveUpdatedAt: null };
}

const HEAT_BRIEF = [
  "Hallucination detection for RAG answers: compare a main answer's atomic facts against sampled alternative answers (UR-RAG pipeline) and visualise where they disagree.",
  "Inherited project. Re-establishing the baseline is the first deliverable; see the project references for the takeover brief.",
].join("\n\n");

function legacyProjects(): ProjectsFile {
  const objective = readJsonObject<{ objective?: unknown; note?: unknown; updatedAt?: unknown }>("research-objective.json");
  const conversation = readJsonObject<{ messages?: unknown[]; threads?: unknown }>(CONVERSATION);
  const hasLegacy = !!objective || !!conversation?.messages?.length || readJsonArray<Paper>("research-papers.json").length > 0;
  if (!hasLegacy) return { version: 1, activeId: "", projects: [] };
  if (objective && (typeof objective.objective !== "string" || (objective.note !== undefined && typeof objective.note !== "string"))) throw new Error("Stored research notes are invalid");
  const at = typeof objective?.updatedAt === "string" ? objective.updatedAt : null;
  return { version: 1, activeId: LEGACY_PROJECT_ID, projects: [{
    id: LEGACY_PROJECT_ID, name: "HEAT", brief: HEAT_BRIEF, reference: "heat",
    objective: (objective?.objective as string | undefined) ?? "", note: (objective?.note as string | undefined) ?? "",
    links: [PROJECT_REPOSITORY, PROGRESS_SHEET, PROJECT_DRIVE, STATUS_REPORT].map(({ title, url }) => ({ title, url })),
    createdAt: at ?? BRIEF_META.written, updatedAt: at ?? BRIEF_META.written, objectiveUpdatedAt: at,
  }] };
}
function readProjectsFile(): ProjectsFile { return readJsonObject<ProjectsFile>(PROJECTS) ?? legacyProjects(); }
function updateProjects<R>(change: (file: ProjectsFile) => R): R {
  return updateJsonObject<ProjectsFile, R>(PROJECTS, (stored) => {
    const file = stored ?? legacyProjects();
    const result = change(file);
    return { value: file, result, changed: true };
  });
}
function find(file: ProjectsFile, id: string): ResearchProject {
  if (id === GENERAL_PROJECT_ID && !file.projects.some((item) => item.id === id)) file.projects.push(generalProject());
  const project = file.projects.find((item) => item.id === id);
  if (!project) throw new PaperError("Research project not found", 404);
  return project;
}

export function listResearchProjects(): { activeId: string; projects: ResearchProject[] } {
  const file = readProjectsFile();
  const active = file.projects.find((item) => item.id === file.activeId && !item.archived)
    ?? file.projects.find((item) => !item.archived && !item.general) ?? file.projects.find((item) => item.general);
  return { activeId: active?.id ?? "", projects: file.projects };
}
/** The project a request names, else the one the researcher last worked in. */
export function getResearchProject(id?: string | null): ResearchProject {
  const { activeId, projects } = listResearchProjects();
  const project = projects.find((item) => item.id === (id || activeId)) ?? (id === GENERAL_PROJECT_ID ? generalProject() : undefined);
  if (!project) throw new PaperError(id ? "Research project not found" : "Create a research project first", 404);
  return project;
}
function links(value: unknown): ResearchLink[] {
  if (!Array.isArray(value) || value.length > 20) throw new PaperError("links must be a list of at most 20 links");
  return value.map((item) => {
    const link = item as Partial<ResearchLink> | null;
    const url = paperUrl(link?.url);
    const title = paperText(link?.title ?? "", 200).trim();
    return { title: title || new URL(url).hostname, url };
  });
}
export function createResearchProject(input: unknown): ResearchProject {
  const v = input as { name?: unknown; brief?: unknown; objective?: unknown; links?: unknown } | null;
  const name = paperText(v?.name, 120, true).trim();
  const brief = paperText(v?.brief ?? "", 20_000);
  const objective = paperText(v?.objective ?? "", 10_000);
  const projectLinks = v?.links === undefined ? [] : links(v.links);
  return updateProjects((file) => {
    if (file.projects.length >= 50) throw new PaperError("At most 50 research projects; archive one first");
    const now = new Date().toISOString();
    const project: ResearchProject = { id: randomUUID(), name, brief, objective, note: "", links: projectLinks, createdAt: now, updatedAt: now, objectiveUpdatedAt: objective ? now : null };
    file.projects.push(project);
    file.activeId = project.id;
    return project;
  });
}
export function updateResearchProject(id: string, patch: unknown): ResearchProject {
  const v = patch as Record<string, unknown> | null;
  if (!v || Array.isArray(v) || Object.keys(v).some((key) => !["name", "brief", "links", "archived"].includes(key))) throw new PaperError("Invalid project edit");
  const next = {
    name: v.name === undefined ? undefined : paperText(v.name, 120, true).trim(),
    brief: v.brief === undefined ? undefined : paperText(v.brief, 20_000),
    links: v.links === undefined ? undefined : links(v.links),
  };
  if (v.archived !== undefined && typeof v.archived !== "boolean") throw new PaperError("archived must be a boolean");
  if (id === GENERAL_PROJECT_ID && (v.archived !== undefined || v.name !== undefined)) throw new PaperError("The research home cannot be renamed or archived");
  return updateProjects((file) => {
    const project = find(file, id);
    if (next.name !== undefined) project.name = next.name;
    if (next.brief !== undefined) project.brief = next.brief;
    if (next.links !== undefined) project.links = next.links;
    if (v.archived === true) project.archived = true;
    if (v.archived === false) delete project.archived;
    project.updatedAt = new Date().toISOString();
    return project;
  });
}
export function setActiveResearchProject(id: string): void {
  updateProjects((file) => {
    const project = find(file, id);
    if (project.archived) delete project.archived;
    file.activeId = id;
  });
}

export interface ResearchObjective { objective: string; note: string; updatedAt: string | null }
export function readResearchObjective(projectId?: string | null): ResearchObjective {
  if (!listResearchProjects().projects.length) return { objective: "", note: "", updatedAt: null };
  const project = getResearchProject(projectId);
  return { objective: project.objective, note: project.note, updatedAt: project.objectiveUpdatedAt };
}
export function saveResearchObjective(input: { objective: unknown; note?: unknown }, projectId?: string | null): ResearchObjective {
  if (!input || typeof input !== "object") throw new PaperError("objective must be a string");
  if (typeof input.objective !== "string") throw new PaperError("objective must be a string");
  if (input.objective.length > 10_000) throw new PaperError("objective must be at most 10000 characters", 413);
  if (input.note !== undefined && typeof input.note !== "string") throw new PaperError("note must be a string");
  if (typeof input.note === "string" && input.note.length > 100_000) throw new PaperError("note must be at most 100000 characters", 413);
  return updateProjects((file) => {
    const project = projectFor(file, projectId);
    project.objective = input.objective as string;
    if (typeof input.note === "string") project.note = input.note;
    project.objectiveUpdatedAt = project.updatedAt = new Date().toISOString();
    return { objective: project.objective, note: project.note, updatedAt: project.objectiveUpdatedAt };
  });
}
/** The named project, else the current one; with none yet, a general project rather than a dead end. */
export function ensureResearchProject(id?: string | null): ResearchProject {
  if (id === GENERAL_PROJECT_ID || (!id && !listResearchProjects().activeId)) return updateProjects((file) => find(file, GENERAL_PROJECT_ID));
  return getResearchProject(id);
}
/** Without any project yet, the first notebook write creates a general one rather than failing. */
function projectFor(file: ProjectsFile, projectId?: string | null): ResearchProject {
  if (projectId) return find(file, projectId);
  const active = file.projects.find((item) => item.id === file.activeId && !item.archived) ?? file.projects.find((item) => !item.archived);
  if (active) return active;
  return find(file, GENERAL_PROJECT_ID);
}
/** Explicit human capture appends to the latest notebook, never a stale browser snapshot. */
export function appendResearchNote(input: unknown, projectId?: string | null): ResearchObjective {
  const text = paperText(input, 100_000, true);
  return updateProjects((file) => {
    const project = projectFor(file, projectId);
    if (!project.note.includes(text)) {
      const note = project.note ? `${project.note}\n\n${text}` : text;
      if (note.length > 100_000) throw new PaperError("The research notebook exceeds 100000 characters", 413);
      project.note = note;
      project.objectiveUpdatedAt = project.updatedAt = new Date().toISOString();
    }
    return { objective: project.objective, note: project.note, updatedAt: project.objectiveUpdatedAt };
  });
}

function bounded(note: string): string {
  return note.length <= 20_000 ? note : `${note.slice(0, 4000)}\n\n[Middle of notebook omitted; latest notes follow]\n\n${note.slice(-16_000)}`;
}
/** The project's live goals and notes; an attached authored reference is explicitly historical. */
export function researchContext(projectId?: string | null) {
  const { projects } = listResearchProjects();
  const project = getResearchProject(projectId);
  const papers = listPapers();
  const summary = ({ id, title, url, analysis, access }: Paper) => ({ id, title, url, summary: analysis?.summary.slice(0, 1000), connection: analysis && connectionFor(analysis, project.id)?.text.slice(0, 600), needsPdf: access?.state === "needs-pdf" });
  return {
    project: { id: project.id, name: project.name, brief: project.brief.slice(0, 10_000), links: project.links, ...(project.general ? { general: true } : {}) },
    weeklyObjective: project.objective,
    projectNotes: bounded(project.note),
    projectNotesTruncated: project.note.length > 20_000,
    objectiveUpdatedAt: project.objectiveUpdatedAt,
    otherProjects: projects.filter((item) => item.id !== project.id && !item.archived && !item.general).map(({ id, name, objective, brief }) => ({ id, name, brief: brief.slice(0, 400), objective: objective.slice(0, 300) })),
    ...(project.reference === "heat" ? { reference: {
      referenceDate: BRIEF_META.written,
      caveat: "Authored reference snapshot, NOT a live code audit. Do not assume old defects or results are still current. Distinguish project facts, user updates and proposed experiments.",
      briefing: HEADLINE, pipeline: PIPELINE, historicalResults: RESULTS, knownGaps: GAPS,
    } } : {}),
    library: papers.filter((paper) => paperProjects(paper).includes(project.id)).slice(0, 40).map(summary),
    /** Papers already read for other projects: reuse their reading with research_relate instead of reading again. */
    elsewhereInLibrary: papers.filter((paper) => !paperProjects(paper).includes(project.id)).slice(0, 30).map(({ id, title, analysis }) => ({ id, title, hasReading: !!analysis && !analysis.outdated })),
  };
}
export function connectionFor(analysis: NonNullable<Paper["analysis"]>, projectId: string) {
  return analysis.connections?.[projectId] ?? (projectId === LEGACY_PROJECT_ID && analysis.heatConnection ? { text: analysis.heatConnection, objective: analysis.objective, createdAt: analysis.createdAt } : undefined);
}

export interface ResearchMessage { id: string; role: "user" | "assistant"; text: string; at: string; sessionId?: string; paperId?: string }
export interface ResearchRun { id: string; projectId: string; sessionId: string | null; startedAt: string; phase: string; detail: string; cancelled?: boolean; paperId?: string }
/** `stopped`: the researcher stopped the last turn; a choice, not a failure, so it is not an error. */
export interface ResearchConversation { messages: ResearchMessage[]; run: ResearchRun | null; error?: string; stopped?: boolean }
interface ConversationFile { threads: Record<string, ResearchMessage[]>; run: ResearchRun | null; errors?: Record<string, string>; stopped?: Record<string, boolean> }
const CONVERSATION = "research-conversation.json";
function normalizeConversation(stored: (Partial<ConversationFile> & { messages?: ResearchMessage[]; error?: string }) | null): ConversationFile {
  if (!stored) return { threads: {}, run: null };
  if (stored.threads) return { threads: stored.threads, run: stored.run ?? null, errors: stored.errors, stopped: stored.stopped };
  // Before projects there was one conversation; it belongs to the migrated project.
  return { threads: { [LEGACY_PROJECT_ID]: stored.messages ?? [] }, run: stored.run ? { ...stored.run, projectId: stored.run.projectId ?? LEGACY_PROJECT_ID } : null,
    errors: stored.error ? { [LEGACY_PROJECT_ID]: stored.error } : undefined };
}
function updateConversation<R>(change: (state: ConversationFile) => { result: R; changed: boolean }): R {
  return updateJsonObject<ConversationFile, R>(CONVERSATION, (stored) => {
    const state = normalizeConversation(stored);
    const { result, changed } = change(state);
    return { value: state, result, changed };
  });
}
/** One project's thread. The run is global: one research turn at a time, whichever project it serves. */
export function readResearchConversation(projectId?: string | null): ResearchConversation {
  const state = normalizeConversation(readJsonObject(CONVERSATION));
  const id = projectId ?? (listResearchProjects().projects.length ? getResearchProject().id : "");
  return { messages: state.threads[id] ?? [], run: state.run, error: state.errors?.[id], ...(state.stopped?.[id] ? { stopped: true } : {}) };
}
/** The project a running tool call serves: its run's project, else the researcher's current one. */
export function researchProjectForSession(sessionId: string): string {
  const run = normalizeConversation(readJsonObject(CONVERSATION)).run;
  return run?.sessionId === sessionId ? run.projectId : getResearchProject().id;
}
export function beginResearchRun(question: string, paperId?: string, projectId?: string): ResearchRun {
  paperText(question, 10_000, true);
  const project = ensureResearchProject(projectId);
  return updateConversation((state) => {
    if (state.run && Date.now() - Date.parse(state.run.startedAt) < 12 * 60_000) throw new PaperError("Research is already running. Wait or stop it before starting again.", 409);
    const run: ResearchRun = { id: randomUUID(), projectId: project.id, sessionId: null, startedAt: new Date().toISOString(), phase: "starting", detail: "", paperId };
    state.threads[project.id] = [...(state.threads[project.id] ?? []), { id: randomUUID(), role: "user" as const, text: question, at: run.startedAt, paperId }].slice(-100);
    state.run = run;
    if (state.errors) delete state.errors[project.id];
    if (state.stopped) delete state.stopped[project.id];
    return { result: run, changed: true };
  });
}
export function attachResearchSession(runId: string, sessionId: string): boolean {
  return updateConversation((state) => {
    if (!state.run || state.run.id !== runId || state.run.cancelled) return { result: false, changed: false };
    state.run.sessionId = sessionId;
    return { result: true, changed: true };
  });
}
export function researchProgress(sessionId: string, phase: string, detail: string): void {
  updateConversation((state) => {
    if (!state.run || state.run.sessionId !== sessionId) return { result: undefined, changed: false };
    state.run.phase = phase; state.run.detail = detail.slice(0, 300);
    return { result: undefined, changed: true };
  });
}
export function cancelResearchRun(): ResearchRun | null {
  return updateConversation((state) => {
    if (!state.run) return { result: null, changed: false };
    state.run.cancelled = true;
    return { result: state.run, changed: true };
  });
}
export function finishResearchRun(id: string, result: { reply?: string; sessionId?: string; error?: string; stopped?: boolean }): void {
  updateConversation((state) => {
    if (state.run?.id !== id) return { result: undefined, changed: false };
    const { projectId, paperId } = state.run;
    const thread = state.threads[projectId] ?? [];
    if (result.reply) thread.push({ id: randomUUID(), role: "assistant", text: paperText(result.reply, 100_000), at: new Date().toISOString(), sessionId: result.sessionId, paperId });
    state.threads[projectId] = thread.slice(-100);
    state.run = null;
    if (result.stopped) state.stopped = { ...state.stopped, [projectId]: true };
    else if (result.error) state.errors = { ...state.errors, [projectId]: result.error };
    return { result: undefined, changed: true };
  });
}
