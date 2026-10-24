import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dataPath, readJsonArray, readJsonObject, updateJsonObject, withFileLock } from "./paths.ts";
import { paperText, PaperError, paperUrl, canonicalPaperUrl, getPaper, listPapers, paperProjects, LEGACY_PROJECT_ID, type Paper } from "./papers-domain.ts";
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
/** One overview snapshot: adapters never load/sort transcripts just to count them. */
export function researchProjectBoard() {
  const { activeId, projects } = listResearchProjects();
  const counts = new Map(projects.map((project) => [project.id, { papers: 0, needsPdf: 0, read: 0, messages: 0 }]));
  for (const paper of listPapers()) for (const id of new Set(paperProjects(paper))) {
    const count = counts.get(id);
    if (count) { count.papers++; if (paper.access) count.needsPdf++; if (paper.analysis && !paper.analysis.outdated) count.read++; }
  }
  const state = normalizeConversation(readJsonObject(CONVERSATION));
  for (const session of state.sessions) {
    const count = counts.get(session.projectId);
    if (count) count.messages += session.messages.length;
  }
  return { activeId, projects: projects.map(({ note, ...project }) => ({ ...project, hasNotes: !!note.trim(), ...counts.get(project.id)! })) };
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

export interface ResearchObjective { objective: string; note: string; updatedAt: string | null; revision: string }
function objectiveSnapshot(project: Pick<ResearchProject, "objective" | "note" | "objectiveUpdatedAt">): ResearchObjective {
  const { objective, note, objectiveUpdatedAt: updatedAt } = project;
  // Content revision needs no migration and is unaffected by project renames or clock resolution.
  return { objective, note, updatedAt, revision: createHash("sha256").update(JSON.stringify([objective, note])).digest("hex") };
}
export function readResearchObjective(projectId?: string | null): ResearchObjective {
  if (!listResearchProjects().projects.length) return objectiveSnapshot({ objective: "", note: "", objectiveUpdatedAt: null });
  return objectiveSnapshot(getResearchProject(projectId));
}
/** All replacement edits compare the reader's revision under the same lock as Keep's append. */
export function saveResearchObjective(input: { objective?: unknown; note?: unknown; revision?: unknown }, projectId?: string | null): ResearchObjective {
  if (!input || typeof input !== "object" || (input.objective === undefined && input.note === undefined)) throw new PaperError("Provide an objective or note");
  if (input.objective !== undefined && typeof input.objective !== "string") throw new PaperError("objective must be a string");
  if (typeof input.objective === "string" && input.objective.length > 10_000) throw new PaperError("objective must be at most 10000 characters", 413);
  if (input.note !== undefined && typeof input.note !== "string") throw new PaperError("note must be a string");
  if (typeof input.note === "string" && input.note.length > 100_000) throw new PaperError("note must be at most 100000 characters", 413);
  return updateProjects((file) => {
    const project = projectFor(file, projectId);
    if (input.revision !== objectiveSnapshot(project).revision) throw new PaperError("Research notes changed elsewhere. Keep your draft, then reload the latest notes before saving.", 409);
    if (typeof input.objective === "string") project.objective = input.objective;
    if (typeof input.note === "string") project.note = input.note;
    project.objectiveUpdatedAt = project.updatedAt = new Date().toISOString();
    return objectiveSnapshot(project);
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
    return objectiveSnapshot(project);
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
/** conversationId is the human conversation; sessionId is one underlying model execution. */
export interface ResearchRun { id: string; projectId: string; conversationId?: string; userMessageId?: string; sessionId: string | null; startedAt: string; phase: string; detail: string; cancelled?: boolean; paperId?: string }
export interface ResearchSession {
  id: string; projectId: string; title: string; kind: "discussion" | "paper" | "history"; paperId?: string;
  default?: boolean; sourceUrl?: string; renamed?: boolean; archived?: boolean; revision: number; createdAt: string; updatedAt: string;
  messages: ResearchMessage[]; error?: string; stopped?: boolean;
}
export type ResearchSessionSummary = Omit<ResearchSession, "messages"> & { messageCount: number };
export interface ResearchConversation { messages: ResearchMessage[]; run: ResearchRun | null; error?: string; stopped?: boolean; conversation?: ResearchSessionSummary; sessions?: ResearchSessionSummary[] }
interface ConversationFile { version: 2; sessions: ResearchSession[]; run: ResearchRun | null }
interface LegacyConversation { version?: number; threads?: Record<string, ResearchMessage[]>; messages?: ResearchMessage[]; run?: ResearchRun | null; errors?: Record<string, string>; stopped?: Record<string, boolean>; error?: string }
const CONVERSATION = "research-conversation.json";
const defaultId = (projectId: string, paperId?: string) => paperId ? `paper:${projectId}:${paperId}` : `discussion:${projectId}`;
function newSession(projectId: string, paperId?: string, title = "", id = defaultId(projectId, paperId)): ResearchSession {
  return { id, projectId, title, kind: paperId ? "paper" : "discussion", paperId, revision: 0, createdAt: "", updatedAt: "", messages: [] };
}
function normalizeConversation(stored: ConversationFile | LegacyConversation | null): ConversationFile {
  if (!stored) return { version: 2, sessions: [], run: null };
  if (stored.version === 2) {
    if (!Array.isArray((stored as ConversationFile).sessions)) throw new Error("Invalid research sessions");
    return stored as ConversationFile;
  }
  if (stored.version !== undefined) throw new Error("Unsupported research conversation version");
  const legacy = stored as LegacyConversation;
  const state: ConversationFile = { version: 2, sessions: [], run: legacy.run ? { ...legacy.run, projectId: legacy.run.projectId ?? LEGACY_PROJECT_ID } : null };
  const papers = new Map(listPapers().map((paper) => [paper.id, paper]));
  for (const [projectId, messages] of Object.entries(legacy.threads ?? { [LEGACY_PROJECT_ID]: legacy.messages ?? [] })) {
    for (const message of messages) {
      // Only explicit paper IDs establish ownership. Never infer from text, titles or AI-generated links.
      const id = message.paperId ? defaultId(projectId, message.paperId) : `history:${projectId}`;
      let session = state.sessions.find((item) => item.id === id);
      if (!session) {
        session = newSession(projectId, message.paperId, message.paperId ? papers.get(message.paperId)?.title ?? message.paperId : "", id);
        session.kind = message.paperId ? "paper" : "history"; session.default = !!message.paperId;
        state.sessions.push(session);
      }
      session.messages.push(message); session.createdAt ||= message.at; session.updatedAt = message.at;
    }
    const statusId = state.run?.projectId === projectId && state.run.paperId ? defaultId(projectId, state.run.paperId) : `history:${projectId}`;
    let status = state.sessions.find((item) => item.id === statusId);
    const error = legacy.errors?.[projectId] ?? (projectId === LEGACY_PROJECT_ID ? legacy.error : undefined);
    if (!status && (error || legacy.stopped?.[projectId])) { status = newSession(projectId, undefined, "", statusId); status.kind = "history"; state.sessions.push(status); }
    if (status) { status.error = error; status.stopped = legacy.stopped?.[projectId]; }
  }
  if (state.run) {
    state.run.conversationId = state.run.paperId ? defaultId(state.run.projectId, state.run.paperId) : `history:${state.run.projectId}`;
    if (!state.sessions.some((item) => item.id === state.run!.conversationId)) {
      const session = newSession(state.run.projectId, state.run.paperId, "", state.run.conversationId);
      session.kind = state.run.paperId ? "paper" : "history"; session.default = !!state.run.paperId; state.sessions.push(session);
    }
  }
  return state;
}
function updateConversation<R>(change: (state: ConversationFile) => { result: R; changed: boolean }): R {
  return updateJsonObject<ConversationFile | LegacyConversation, R>(CONVERSATION, (stored) => {
    const state = normalizeConversation(stored);
    const { result, changed } = change(state);
    if (changed && stored && stored.version !== 2) {
      // First mutation publishes migration under the same file lock; preserve the pre-migration document.
      try { writeFileSync(dataPath("research-conversation-pre-sessions.json"), JSON.stringify(stored, null, 2), { flag: "wx", mode: 0o600 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    return { value: state, result, changed };
  });
}
function defaultSession(state: ConversationFile, projectId: string, paperId?: string): ResearchSession {
  let session = state.sessions.find((item) => item.projectId === projectId && item.default && item.paperId === paperId);
  if (!session) {
    session = newSession(projectId, paperId, paperId ? getPaper(paperId).title : ""); session.default = true; state.sessions.push(session);
  }
  return session;
}
function selectSession(state: ConversationFile, projectId: string, id?: string, paperId?: string): ResearchSession {
  let session = id ? state.sessions.find((item) => item.projectId === projectId && item.id === id) : defaultSession(state, projectId, paperId);
  if (!session && id?.startsWith(`paper:${projectId}:`)) session = defaultSession(state, projectId, id.slice(`paper:${projectId}:`.length));
  if (!session) throw new PaperError("Research conversation not found", 404);
  if (paperId && session.paperId !== paperId) throw new PaperError("This conversation belongs to a different paper", 409);
  return session;
}
function sessionSummary({ messages, ...session }: ResearchSession): ResearchSessionSummary { return { ...session, messageCount: messages.length }; }
function summaries(state: ConversationFile, projectId: string): ResearchSessionSummary[] {
  return state.sessions.filter((item) => item.projectId === projectId).map(sessionSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}
/** Aggregate used only by notebook capture and project counts, never as model history or the chat UI. */
export function readResearchConversation(projectId?: string | null): ResearchConversation {
  const state = normalizeConversation(readJsonObject(CONVERSATION));
  const id = projectId ?? (listResearchProjects().projects.length ? getResearchProject().id : "");
  const sessions = state.sessions.filter((item) => item.projectId === id);
  return { messages: sessions.flatMap((item) => item.messages).sort((a, b) => a.at.localeCompare(b.at)), run: state.run,
    error: sessions.find((item) => item.error)?.error, ...(sessions.some((item) => item.stopped) ? { stopped: true } : {}) };
}
/** A run check never materializes/sorts a project's conversation history. */
export function readResearchRun(): ResearchRun | null {
  return normalizeConversation(readJsonObject(CONVERSATION)).run;
}
/** Metadata-only listing, including the virtual project default; never returns a transcript. */
export function listResearchSessions(projectId: string): { sessions: ResearchSessionSummary[]; run: ResearchRun | null } {
  getResearchProject(projectId);
  const state = normalizeConversation(readJsonObject(CONVERSATION));
  defaultSession(state, projectId);
  return { sessions: summaries(state, projectId), run: state.run };
}
/** GET is read-only, including virtual defaults and legacy migration. */
export function readResearchSession(projectId: string, id?: string, paperId?: string): ResearchConversation {
  getResearchProject(projectId);
  const state = normalizeConversation(readJsonObject(CONVERSATION));
  defaultSession(state, projectId);
  const session = selectSession(state, projectId, id, paperId);
  return { messages: session.messages, run: state.run, error: session.error, stopped: session.stopped, conversation: sessionSummary(session), sessions: summaries(state, projectId) };
}
export function createResearchSession(projectId: string, input: { title?: unknown; paperId?: unknown; ensure?: unknown }): ResearchSessionSummary {
  getResearchProject(projectId);
  const paperId = input.paperId === undefined ? undefined : paperText(input.paperId, 100, true);
  if (paperId) getPaper(paperId);
  if (input.ensure !== undefined && typeof input.ensure !== "boolean") throw new PaperError("ensure must be a boolean");
  const title = input.ensure ? "" : paperText(input.title, 200, true).trim();
  return updateConversation((state) => {
    if (input.ensure) return { result: sessionSummary(defaultSession(state, projectId, paperId)), changed: true };
    const session = newSession(projectId, paperId, title, randomUUID());
    session.createdAt = session.updatedAt = new Date().toISOString(); state.sessions.push(session);
    return { result: sessionSummary(session), changed: true };
  });
}
export function updateResearchSession(projectId: string, id: string, revision: unknown, patch: { title?: unknown; archived?: unknown }): ResearchSessionSummary {
  getResearchProject(projectId);
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some((key) => !["title", "archived"].includes(key))) throw new PaperError("Invalid conversation edit");
  const title = patch.title === undefined ? undefined : paperText(patch.title, 200, true).trim();
  if (patch.archived !== undefined && typeof patch.archived !== "boolean") throw new PaperError("archived must be a boolean");
  return updateConversation((state) => {
    defaultSession(state, projectId);
    const session = selectSession(state, projectId, id);
    if (revision !== session.revision) throw new PaperError("Conversation changed elsewhere. Reload and retry.", 409);
    if (patch.archived === true && state.run?.conversationId === id && Date.now() - Date.parse(state.run.startedAt) < 12 * 60_000) throw new PaperError("Stop or finish the running conversation before archiving it", 409);
    if (title !== undefined) { session.title = title; session.renamed = true; }
    if (patch.archived !== undefined) session.archived = patch.archived === true;
    session.revision++; session.updatedAt = new Date().toISOString();
    return { result: sessionSummary(session), changed: true };
  });
}
function liveResearchRun(run: ResearchRun): boolean {
  return !run.cancelled && Date.now() - Date.parse(run.startedAt) < 12 * 60_000;
}
/** Synchronous writes only. Pin an execution once observed; losing it must never fall back to the active project. */
export function researchSessionWriteFence(sessionId: string): <T>(write: () => T) => T {
  let runId: string | undefined;
  return (write) => withFileLock(dataPath(CONVERSATION), () => {
    const state = normalizeConversation(readJsonObject(CONVERSATION));
    const run = state.run;
    if (run?.sessionId === sessionId) runId ??= run.id;
    const retired = !runId && state.sessions.some((session) => session.messages.some((message) => message.sessionId === sessionId));
    if (retired || (runId && (!run || run.id !== runId || run.sessionId !== sessionId || !liveResearchRun(run)))) {
      throw new PaperError("Research stopped or execution ownership was lost", 409);
    }
    // Standalone extension sessions still work without a dashboard execution.
    return write();
  });
}
/** The project a running tool call serves: its run's project, else the researcher's current one. */
export function researchProjectForSession(sessionId: string): string {
  const run = normalizeConversation(readJsonObject(CONVERSATION)).run;
  return run?.sessionId === sessionId ? run.projectId : getResearchProject().id;
}
export function beginResearchRun(question: string, paperId?: string, projectId?: string, conversationId?: string): ResearchRun {
  paperText(question, 10_000, true);
  const project = ensureResearchProject(projectId);
  return updateConversation((state) => {
    if (state.run && Date.now() - Date.parse(state.run.startedAt) < 12 * 60_000) throw new PaperError("Research is already running. Wait or stop it before starting again.", 409);
    defaultSession(state, project.id);
    let session = selectSession(state, project.id, conversationId, paperId);
    if (session.archived) throw new PaperError("Restore this conversation before continuing", 409);
    // A single pasted URL in the default discussion starts its own reading, not another long mixed thread.
    const urls = question.match(/https?:\/\/[^\s<>"\u3000]+/g) ?? [];
    if (session.default && !session.paperId && urls.length === 1) {
      let sourceUrl: string | undefined;
      try { sourceUrl = canonicalPaperUrl(urls[0].replace(/[)\]。，,;；]+$/, "")); } catch { /* Not a supported public paper URL. */ }
      if (sourceUrl) {
        const known = listPapers().find((item) => (item.url && canonicalPaperUrl(item.url) === sourceUrl) || item.pdfUrl === sourceUrl);
        if (known) session = defaultSession(state, project.id, known.id);
        else {
          session = state.sessions.find((item) => item.projectId === project.id && item.sourceUrl === sourceUrl && !item.archived) ?? newSession(project.id, undefined, question.slice(0, 160), randomUUID());
          session.sourceUrl = sourceUrl;
          if (!state.sessions.includes(session)) state.sessions.push(session);
        }
      }
    }
    if (session.archived) throw new PaperError("Restore this conversation before continuing", 409);
    if (session.paperId) getPaper(session.paperId);
    const run: ResearchRun = { id: randomUUID(), projectId: project.id, conversationId: session.id, userMessageId: randomUUID(), sessionId: null, startedAt: new Date().toISOString(), phase: "starting", detail: "", paperId: session.paperId };
    session.messages.push({ id: run.userMessageId!, role: "user", text: question, at: run.startedAt, paperId: session.paperId });
    session.createdAt ||= run.startedAt; session.updatedAt = run.startedAt; delete session.error; delete session.stopped;
    state.run = run;
    return { result: run, changed: true };
  });
}
/** Verified tool result, not an AI link/title guess, attaches a pasted-link reading to its paper. */
export function recordResearchPaper(sessionId: string, paperId: string): void {
  const paper = getPaper(paperId);
  updateConversation((state) => {
    const run = state.run;
    if (!run || run.sessionId !== sessionId || !liveResearchRun(run)) return { result: undefined, changed: false };
    const session = selectSession(state, run.projectId, run.conversationId);
    if (session.sourceUrl && [paper.url ? canonicalPaperUrl(paper.url) : "", paper.pdfUrl].includes(session.sourceUrl)) {
      session.paperId = paper.id; session.kind = "paper";
      session.default = !state.sessions.some((item) => item !== session && item.projectId === run.projectId && item.paperId === paperId && item.default);
      if (!session.renamed) session.title = paper.title;
      session.revision++; delete session.sourceUrl; run.paperId = paperId;
      const question = session.messages.find((item) => item.id === run.userMessageId); if (question) question.paperId = paperId;
    } else {
      const reading = defaultSession(state, run.projectId, paperId);
      if (!reading.renamed && reading.title !== paper.title) { reading.title = paper.title; reading.revision++; }
    }
    return { result: undefined, changed: true };
  });
}
export function attachResearchSession(runId: string, sessionId: string): boolean {
  return updateConversation((state) => {
    if (!state.run || state.run.id !== runId || !liveResearchRun(state.run)) return { result: false, changed: false };
    state.run.sessionId = sessionId;
    // Keep execution identity after replacement/finish, even if no tool ran and no reply was saved.
    const question = state.sessions.find((item) => item.id === state.run!.conversationId)?.messages.find((item) => item.id === state.run!.userMessageId);
    if (question) question.sessionId = sessionId;
    return { result: true, changed: true };
  });
}
export function researchProgress(sessionId: string, phase: string, detail: string): void {
  updateConversation((state) => {
    if (!state.run || state.run.sessionId !== sessionId || !liveResearchRun(state.run)) return { result: undefined, changed: false };
    state.run.phase = phase; state.run.detail = detail.slice(0, 300);
    return { result: undefined, changed: true };
  });
}
export function cancelResearchRun(expectedRunId?: string): ResearchRun | null {
  return updateConversation((state) => {
    if (!state.run) return { result: null, changed: false };
    if (expectedRunId && state.run.id !== expectedRunId) throw new PaperError("The running conversation changed. Reload before stopping it.", 409);
    state.run.cancelled = true;
    return { result: state.run, changed: true };
  });
}
export function finishResearchRun(id: string, result: { reply?: string; sessionId?: string; error?: string; stopped?: boolean }): boolean {
  return updateConversation((state) => {
    if (state.run?.id !== id) return { result: false, changed: false };
    const { projectId, paperId, conversationId } = state.run;
    const stopped = result.stopped || !liveResearchRun(state.run);
    const session = selectSession(state, projectId, conversationId);
    const at = new Date().toISOString();
    if (result.reply && !stopped) session.messages.push({ id: randomUUID(), role: "assistant", text: paperText(result.reply, 100_000), at, sessionId: result.sessionId, paperId });
    session.updatedAt = at; state.run = null;
    if (stopped) session.stopped = true;
    else if (result.error) session.error = result.error;
    return { result: !stopped, changed: true };
  });
}
