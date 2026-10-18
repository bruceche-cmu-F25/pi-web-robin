import { createHash, randomUUID } from "node:crypto";
import { readJsonArray, updateJsonArray } from "./paths.ts";
import { createNoteDraft } from "./notes-domain.ts";
import { archiveNoteToObsidian, resolveObsidianVault, type ObsidianArchive } from "./obsidian-domain.ts";
import { isPublicWebHost } from "./public-web.ts";

const FILE = "research-papers.json";
export const UNTITLED_PAPER = "Untitled paper / 未识别标题的论文";
export type PaperStatus = "queued" | "reading" | "read";
export interface PaperMetadata {
  title: string; url: string; authors: string[]; year: string; abstract: string;
  pdfUrl: string; provider: string;
}
export interface PaperSource { text: string; kind: "pdf" | "pasted"; label: string; pages?: number; truncated: boolean; loadedAt: string }
export interface PaperMessage { id: string; role: "user" | "assistant"; text: string; at: string; source: string; sessionId?: string }
/** How one paper bears on one research project, judged against that project's focus at the time. */
export interface ProjectConnection { text: string; objective: string; createdAt: string; basis?: "full reading" | "saved reading" }
export interface PaperAnalysis {
  abstractExplanation: string; summary: string;
  /** Before projects, the only connection was to HEAT; it reads as the HEAT project's connection. */
  heatConnection?: string;
  connections?: Record<string, ProjectConnection>;
  sourceKey: string; coverage: string; objective: string; createdAt: string; outdated?: boolean;
}
export interface PaperAccess { state: "needs-pdf"; checkedAt: string; attempts: Array<{ url: string; error: string }>; links: string[] }
export interface Paper extends PaperMetadata {
  id: string; revision: number; status: PaperStatus; tags: string; note: string;
  source: PaperSource | null; messages: PaperMessage[]; createdAt: string; updatedAt: string;
  analysis?: PaperAnalysis; access?: PaperAccess;
  /** Research projects this paper was gathered for. Absent on papers saved before projects existed. */
  projectIds?: string[];
  exports: Array<{ fingerprint: string; draftId: string; archive?: ObsidianArchive }>;
}
export class PaperError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function paperText(value: unknown, max: number, required = false): string {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new PaperError(`Expected ${required ? "non-empty " : ""}text, at most ${max} characters`);
  return value;
}
export function paperUrl(value: unknown, optional = false): string {
  if (optional && (value === undefined || value === "")) return "";
  const url = new URL(paperText(value, 3000, true));
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || !isPublicWebHost(url.hostname)) throw new PaperError("Use a public HTTP(S) paper URL");
  url.hash = "";
  return url.href;
}
export function canonicalPaperUrl(value: unknown): string {
  const url = new URL(paperUrl(value));
  if (/^(export\.)?arxiv\.org$/.test(url.hostname)) {
    const id = url.pathname.replace(/^\/(abs|pdf|html)\//, "").replace(/\.pdf$/, "").replace(/v\d+$/, "");
    if (/^(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})$/.test(id)) return `https://arxiv.org/abs/${id}`;
  }
  if (/^(dx\.)?doi\.org$/.test(url.hostname)) {
    const doi = decodeURIComponent(url.pathname.slice(1)).toLowerCase();
    if (!/^10\.\d{4,9}\/\S+$/.test(doi)) throw new PaperError("Invalid DOI link");
    return new URL(`https://doi.org/${doi}`).href;
  }
  return url.href;
}
/** Papers stored before projects existed belong to the migrated HEAT project. */
export const LEGACY_PROJECT_ID = "heat";
export function paperProjects(paper: Pick<Paper, "projectIds">): string[] { return paper.projectIds ?? [LEGACY_PROJECT_ID]; }
export function listPapers(): Paper[] { return readJsonArray<Paper>(FILE).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
export function getPaper(id: string): Paper {
  const paper = listPapers().find((item) => item.id === id);
  if (!paper) throw new PaperError("Paper not found", 404);
  return paper;
}
export function addPaper(input: unknown, projectId?: string): Paper {
  const v = input as Partial<PaperMetadata> | null;
  if (!v || !Array.isArray(v.authors) || v.authors.length > 100) throw new PaperError("Invalid paper metadata");
  const metadata: PaperMetadata = {
    title: paperText(v.title, 1000, true), url: canonicalPaperUrl(v.url),
    authors: v.authors.map((name) => paperText(name, 300)), year: paperText(v.year, 10),
    abstract: paperText(v.abstract, 30_000), pdfUrl: paperUrl(v.pdfUrl, true), provider: paperText(v.provider, 100),
  };
  return updateJsonArray<Paper, Paper>(FILE, (papers) => {
    const existing = papers.find((paper) => paper.url === metadata.url);
    if (existing) {
      if (!projectId || paperProjects(existing).includes(projectId)) return { value: existing, changed: false };
      existing.projectIds = [...paperProjects(existing), projectId];
      return { value: existing, changed: true };
    }
    const now = new Date().toISOString();
    const paper: Paper = { ...metadata, id: randomUUID(), revision: 1, status: "queued", tags: "", note: "", source: null, messages: [], exports: [], createdAt: now, updatedAt: now, projectIds: projectId ? [projectId] : [] };
    papers.push(paper);
    return { value: paper, changed: true };
  });
}
function mutatePaper(id: string, revision: unknown, change: (paper: Paper) => void): Paper {
  return updateJsonArray<Paper, Paper>(FILE, (papers) => {
    const paper = papers.find((item) => item.id === id);
    if (!paper) throw new PaperError("Paper not found", 404);
    if (!Number.isInteger(revision) || paper.revision !== revision) throw new PaperError("This paper changed elsewhere. Reload before saving; your draft has been kept.", 409);
    change(paper);
    paper.revision++;
    paper.updatedAt = new Date().toISOString();
    return { value: paper, changed: true };
  });
}
/** Gathering a paper for a project is bookkeeping, not an edit: it never invalidates an open note draft. */
export function addPaperToProject(id: string, projectId: string): Paper {
  return updateJsonArray<Paper, Paper>(FILE, (papers) => {
    const paper = papers.find((item) => item.id === id);
    if (!paper) throw new PaperError("Paper not found", 404);
    if (paperProjects(paper).includes(projectId)) return { value: paper, changed: false };
    paper.projectIds = [...paperProjects(paper), projectId];
    return { value: paper, changed: true };
  });
}
export function removePaperFromProject(id: string, projectId: string): Paper {
  return updateJsonArray<Paper, Paper>(FILE, (papers) => {
    const paper = papers.find((item) => item.id === id);
    if (!paper) throw new PaperError("Paper not found", 404);
    paper.projectIds = paperProjects(paper).filter((item) => item !== projectId);
    return { value: paper, changed: true };
  });
}
export function updatePaper(id: string, revision: unknown, patch: unknown): Paper {
  const v = patch as Record<string, unknown> | null;
  if (!v || Array.isArray(v) || Object.keys(v).some((key) => !["note", "tags", "status"].includes(key))) throw new PaperError("Invalid paper edit");
  return mutatePaper(id, revision, (paper) => {
    if (v.note !== undefined) paper.note = paperText(v.note, 50_000);
    if (v.tags !== undefined) paper.tags = paperText(v.tags, 500);
    if (v.status !== undefined) {
      if (!["queued", "reading", "read"].includes(v.status as string)) throw new PaperError("Invalid reading status");
      paper.status = v.status as PaperStatus;
    }
  });
}
export function savePaperSource(id: string, revision: unknown, source: PaperSource): Paper {
  paperText(source.text, 400_000, true);
  if (source.text.replace(/--- page \d+ ---/g, "").trim().length < 80) throw new PaperError("No usable text found. Scanned PDFs need OCR; paste the extracted text instead.");
  if (!["pdf", "pasted"].includes(source.kind)) throw new PaperError("Invalid source kind");
  paperText(source.label, 3000, true);
  return mutatePaper(id, revision, (paper) => {
    paper.source = source; delete paper.access;
    if (paper.analysis) paper.analysis.outdated = paper.analysis.sourceKey !== paperEvidenceKey(paper);
  });
}
export function paperEvidenceKey(paper: Paper): string {
  return createHash("sha256").update(JSON.stringify({ url: paper.url, abstract: paper.abstract, source: paper.source })).digest("hex");
}
export function savePaperAccess(id: string, revision: number, attempts: PaperAccess["attempts"], links: string[]): Paper {
  return mutatePaper(id, revision, (paper) => {
    paper.access = { state: "needs-pdf", checkedAt: new Date().toISOString(), attempts: attempts.slice(0, 8), links: [...new Set(links.map((url) => paperUrl(url)))].slice(0, 8) };
  });
}
/** Generated analysis is separate from the user's notes; a source change rejects an outdated model result. */
export function savePaperAnalysis(id: string, sourceKey: string, input: Pick<PaperAnalysis, "abstractExplanation" | "summary"> & { connection?: string; title?: string; originalAbstract?: string }, project: { id: string; objective: string; general?: boolean }): Paper {
  const fields = { abstractExplanation: paperText(input.abstractExplanation, 8000, true), summary: paperText(input.summary, 20_000, true) };
  // A reading from the research home has no project to connect to; a project reading must say how it bears on it.
  const connection = project.general ? "" : paperText(input.connection, 10_000, true);
  return updateJsonArray<Paper, Paper>(FILE, (papers) => {
    const paper = papers.find((item) => item.id === id);
    if (!paper) throw new PaperError("Paper not found", 404);
    if (sourceKey !== paperEvidenceKey(paper)) throw new PaperError("Paper source changed. Read it again before saving the summary.", 409);
    // Direct PDFs sometimes have no citation metadata. Accept missing fields only as quotations
    // from the opening source text, never model-invented bibliographic data or replacements for user metadata.
    const normalize = (value: string) => value.replace(/-\s*\n\s*/g, "").replace(/\s+/g, " ").trim();
    const opening = normalize(paper.source?.text.slice(0, 20_000) ?? "");
    if (input.title && paper.title === UNTITLED_PAPER) {
      const title = paperText(input.title, 1000, true);
      if (title.length < 4 || !opening.includes(normalize(title))) throw new PaperError("The title must quote the opening paper text");
      paper.title = title;
    }
    if (input.originalAbstract && !paper.abstract) {
      const abstract = paperText(input.originalAbstract, 8000, true);
      if (abstract.length < 40 || !opening.includes(normalize(abstract))) throw new PaperError("The original abstract must quote the opening paper text");
      paper.abstract = abstract;
    }
    const createdAt = new Date().toISOString();
    const objective = paperText(project.objective, 10_000);
    // A fresh reading keeps other projects' connections: the paper did not stop bearing on them.
    const connections = { ...legacyConnections(paper.analysis), ...(connection ? { [project.id]: { text: connection, objective, createdAt, basis: "full reading" as const } } : {}) };
    paper.analysis = { ...fields, connections, sourceKey: paperEvidenceKey(paper), coverage: sourceDescription(paper), objective, createdAt };
    if (!paperProjects(paper).includes(project.id)) paper.projectIds = [...paperProjects(paper), project.id];
    paper.revision++; paper.updatedAt = createdAt;
    return { value: paper, changed: true };
  });
}
function legacyConnections(analysis?: PaperAnalysis): Record<string, ProjectConnection> {
  if (!analysis) return {};
  return { ...(analysis.heatConnection ? { [LEGACY_PROJECT_ID]: { text: analysis.heatConnection, objective: analysis.objective, createdAt: analysis.createdAt } } : {}), ...analysis.connections };
}
/** Relate an already-read paper to another project from its saved reading, without reading it again. */
export function relatePaper(id: string, project: { id: string; objective: string }, connection: unknown): Paper {
  const text = paperText(connection, 10_000, true);
  return updateJsonArray<Paper, Paper>(FILE, (papers) => {
    const paper = papers.find((item) => item.id === id);
    if (!paper) throw new PaperError("Paper not found", 404);
    if (!paper.analysis || paper.analysis.outdated || paper.analysis.sourceKey !== paperEvidenceKey(paper)) throw new PaperError("This paper has no current reading. Read it with research_read and save a summary instead.", 409);
    const createdAt = new Date().toISOString();
    paper.analysis.connections = { ...legacyConnections(paper.analysis), [project.id]: { text, objective: paperText(project.objective, 10_000), createdAt, basis: "saved reading" } };
    delete paper.analysis.heatConnection;
    if (!paperProjects(paper).includes(project.id)) paper.projectIds = [...paperProjects(paper), project.id];
    paper.revision++; paper.updatedAt = createdAt;
    return { value: paper, changed: true };
  });
}
export function recordPaperTurn(id: string, revision: number, question: string, answer: string, sessionId: string, sourceOverride?: string): Paper {
  paperText(question, 10_000, true); paperText(answer, 50_000, true);
  return mutatePaper(id, revision, (paper) => {
    if (paper.messages.length >= 80) throw new PaperError("Conversation limit reached. Keep the useful explanations in your note before starting another paper.");
    const source = sourceOverride ?? sourceDescription(paper);
    const at = new Date().toISOString();
    paper.messages.push({ id: randomUUID(), role: "user", text: question, at, source }, { id: randomUUID(), role: "assistant", text: answer, at, source, sessionId });
  });
}
export function sourceDescription(paper: Paper): string {
  return paper.source ? `${paper.source.kind}: ${paper.source.label}${paper.source.truncated ? " (TRUNCATED — only an excerpt)" : ""}` : "ABSTRACT ONLY — full text has not been loaded";
}
export type ProjectNames = Record<string, string>;
/** Obsidian-friendly: projects become wikilinks and tags, so a vault groups readings by project. */
export function paperMarkdown(paper: Paper, includeDiscussion = true, projectNames: ProjectNames = {}): string {
  const projects = paperProjects(paper).map((id) => projectNames[id]).filter(Boolean);
  const tag = (name: string) => name.trim().replace(/[\s#,，]+/g, "-").replace(/^-+|-+$/g, "");
  const tags = [...new Set(["research", "paper", ...projects.map(tag).filter(Boolean), ...paper.tags.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean)])];
  const connections = Object.entries(legacyConnections(paper.analysis)).filter(([id]) => projectNames[id] || id === LEGACY_PROJECT_ID);
  const content = [
    "---", `title: ${JSON.stringify(paper.title)}`, `source: ${JSON.stringify(paper.url)}`, `authors: ${JSON.stringify(paper.authors)}`,
    `projects: ${JSON.stringify(projects.map((name) => `[[${name.replace(/[[\]|]/g, "")}]]`))}`,
    `year: ${JSON.stringify(paper.year)}`, `tags: ${JSON.stringify(tags)}`, `reading_status: ${paper.status}`,
    `coverage: ${JSON.stringify(sourceDescription(paper))}`, `updated: ${JSON.stringify(paper.updatedAt)}`, "---", "",
    `# ${paper.title.replace(/[\r\n]/g, " ")}`, "", `<${paper.url}>`, "",
    "## Reading notes / 阅读笔记", "", paper.note || "No curated note yet / 尚未整理笔记。", "",
    "## Abstract / 摘要", "", paper.abstract || "—", "",
    ...(paper.analysis ? ["## AI reading summary / AI 阅读整理", "", paper.analysis.outdated ? "> Outdated: source changed / 正文已变更，需要重新整理。" : "", "> " + paper.analysis.coverage,
      "### Abstract explained / 摘要解读", paper.analysis.abstractExplanation, "### Summary / 总结", paper.analysis.summary,
      ...connections.flatMap(([id, item]) => [`### Connection to ${projectNames[id] ?? "HEAT"} / 与 ${projectNames[id] ?? "HEAT"} 的联系`, item.text,
        ...(item.objective ? [`> Focus at the time / 当时的研究重点: ${item.objective.replace(/\s+/g, " ").slice(0, 600)}`] : []), ""])] : []),
    ...(includeDiscussion ? ["## Discussion / 阅读问答", "",
      ...paper.messages.map((message) => `### ${message.role === "user" ? "Question / 问题" : "AI explanation / AI 讲解"}\n\n${message.text}\n\n> Source coverage: ${message.source}`)] : []),
    "", "---", "AI explanations are unverified reading aids. Check claims against the original paper. / AI 讲解仅辅助阅读，请对照原文核实。", "",
  ].join("\n");
  if (content.length > 100_000) throw new PaperError("The export exceeds 100,000 characters. Turn off Include discussion to export your curated note instead.", 413);
  return content;
}
/** Reuse Notes' atomic, no-overwrite publication and retry receipts. Each changed snapshot is a new archive, never a sync. */
export function archivePaper(id: string, input: { revision: unknown; vaultId: string; confirmed: unknown; includeDiscussion?: boolean; projectNames?: ProjectNames }): ObsidianArchive {
  if (input.confirmed !== true) throw new PaperError("Confirm the destination and preview before saving");
  resolveObsidianVault(input.vaultId);
  const paper = getPaper(id);
  if (paper.revision !== input.revision) throw new PaperError("Paper changed; review the export again", 409);
  const content = paperMarkdown(paper, input.includeDiscussion !== false, input.projectNames);
  // updatedAt reflects app bookkeeping too; fingerprint the exact reviewed content for safe retry.
  const fingerprint = createHash("sha256").update(JSON.stringify({ vault: input.vaultId, content })).digest("hex");
  let entry = paper.exports.find((item) => item.fingerprint === fingerprint);
  if (entry?.archive) return entry.archive;
  if (!entry) {
    // Publication preparation does not increment the editing revision or alter updatedAt.
    entry = updateJsonArray<Paper, Paper["exports"][number]>(FILE, (papers) => {
      const current = papers.find((item) => item.id === id);
      if (!current || current.revision !== input.revision) throw new PaperError("Paper changed; review again", 409);
      const previous = current.exports.find((item) => item.fingerprint === fingerprint);
      if (previous) return { value: previous, changed: false };
      const draft = createNoteDraft({ title: current.title.slice(0, 200), text: content });
      const next = { fingerprint, draftId: draft.id };
      current.exports.push(next);
      return { value: next, changed: true };
    });
  }
  const archive = archiveNoteToObsidian({ confirmed: true, vaultId: input.vaultId, draftId: entry.draftId,
    title: paper.title.slice(0, 200), content, expectedDraft: { title: paper.title.slice(0, 200), text: content }, attachmentIds: [] });
  updateJsonArray<Paper, void>(FILE, (papers) => {
    const saved = papers.find((item) => item.id === id)?.exports.find((item) => item.fingerprint === fingerprint);
    if (!saved) throw new PaperError("Archive saved, but its library receipt could not be recorded. Retry to recover.", 500);
    saved.archive = archive;
    return { value: undefined, changed: true };
  });
  return archive;
}
