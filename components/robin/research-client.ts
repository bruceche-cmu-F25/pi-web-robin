import type { Paper } from "@/extension/robin/papers-domain";
import type { ResearchProject } from "@/extension/robin/research-domain";

export type PaperSummary = Pick<Paper, "id" | "url" | "title" | "authors" | "year" | "status" | "tags" | "updatedAt"> & {
  archived: boolean; needsPdf?: boolean; hasAnalysis?: boolean; coverage?: "pdf" | "excerpt" | "abstract" | "none";
  projectIds?: string[]; downloadLinks?: string[];
};
export type ProjectSummary = Omit<ResearchProject, "note"> & { hasNotes: boolean; papers: number; needsPdf: number; read: number; messages: number };
export function paperSummary(paper: Paper): PaperSummary {
  return { id: paper.id, url: paper.url, title: paper.title, authors: paper.authors, year: paper.year, status: paper.status, tags: paper.tags, updatedAt: paper.updatedAt,
    archived: paper.exports.some((item) => item.archive), needsPdf: !!paper.access, hasAnalysis: !!paper.analysis && !paper.analysis.outdated,
    coverage: paper.source ? paper.source.truncated || paper.source.kind === "pasted" ? "excerpt" : "pdf" : paper.abstract ? "abstract" : "none",
    projectIds: paper.projectIds ?? ["heat"], downloadLinks: paper.access ? [...new Set([...paper.access.links, paper.pdfUrl].filter(Boolean))].slice(0, 4) : undefined };
}
export class ResearchRequestError extends Error {
  reply?: string;
  constructor(message: string, reply?: string) { super(message); this.reply = reply; }
}
export async function researchRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new ResearchRequestError(body?.error || `Request failed (${response.status})`, body?.reply);
  return body as T;
}
export function researchJson(method: string, value: unknown, signal?: AbortSignal): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value), signal };
}
/** Upload a PDF the agent could not obtain; the server extracts and stores its text. */
export async function uploadPaperPdf(paper: { id: string }, file: File, signal?: AbortSignal): Promise<Paper> {
  if (file.size > 20 * 1024 * 1024) throw new Error("PDF must be under 20 MB");
  const { paper: current } = await researchRequest<{ paper: Paper }>(`/api/research/papers?id=${encodeURIComponent(paper.id)}`, { signal });
  const form = new FormData(); form.set("id", paper.id); form.set("revision", String(current.revision)); form.set("file", file);
  return (await researchRequest<{ paper: Paper }>("/api/research/papers/source", { method: "POST", body: form, signal })).paper;
}
/** The research home's id: papers read and questions asked outside any project. */
export const GENERAL = "general";
export function researchHref(projectId: string, paperId?: string | null): string {
  const params = new URLSearchParams(projectId === GENERAL ? {} : { project: projectId });
  if (paperId) params.set("paper", paperId);
  return params.size ? `/research?${params}` : "/research";
}
export function downloadMarkdown(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url;
  link.download = `${name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 100) || "research"}.md`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
