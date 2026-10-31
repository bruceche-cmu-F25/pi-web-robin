/** Client-safe resume contracts. Only the isolated preview service executes LaTeX. */
export const MAX_RESUME_BYTES = 200_000;
export const MAX_RESUME_INSTRUCTION_BYTES = 8_000;
export const MAX_RESUME_JOB_BYTES = 30_000;
export const MAX_RESUME_PDF_BYTES = 5 * 1024 * 1024;
export const MAX_RESUME_PDF_PAGES = 5;
export const MAX_RESUME_PDF_TEXT = 60_000;

export interface ResumeDocument { source: string; revision: string; updatedAt: string | null }
export interface ResumeRequest {
  source: string;
  instruction: string;
  jobDescription: string;
  useProfile: boolean;
  locale: "en" | "zh-CN" | "zh-TW";
}
export interface ResumeProposal { source: string | null; summary: string; questions: string[] }
export interface ResumePdfImport { name: string; pages: number; text: string }

export const RESUME_TEMPLATE = String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[margin=1.6cm]{geometry}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlist[itemize]{nosep,leftmargin=*}
\begin{document}
% Replace placeholders with your own verified information.
% For Chinese text, use the ctexart class with fontset=fandol for local preview.
{\LARGE \textbf{[Your name]}}\\
{[Email]} \quad [Website]

\section*{Education}
[University] \hfill [Dates]\\
{[Degree]}

\section*{Experience}
\textbf{[Role]} --- [Organization] \hfill [Dates]
\begin{itemize}
  \item {[Describe what you built and its verified impact.]}
\end{itemize}

\section*{Projects}
\textbf{[Project]}
\begin{itemize}
  \item {[Your contribution, technologies, and verified results.]}
\end{itemize}

\section*{Skills}
[Only skills you can support with your experience.]
\end{document}
`;

export class ResumeError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export function resumeText(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== "string" || value.includes("\0")) throw new ResumeError(`${field} must be plain text`);
  if (new TextEncoder().encode(value).length > maxBytes) throw new ResumeError(`${field} exceeds ${maxBytes / 1000} KB`, 413);
  return value;
}

export function resumeRequest(value: unknown): ResumeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResumeError("Invalid resume request");
  const body = value as Record<string, unknown>;
  const instruction = resumeText(body.instruction, "instruction", MAX_RESUME_INSTRUCTION_BYTES).trim();
  if (!instruction) throw new ResumeError("Describe the change you want");
  if (typeof body.useProfile !== "boolean") throw new ResumeError("useProfile must be a boolean");
  return {
    source: resumeText(body.source, "source", MAX_RESUME_BYTES), instruction,
    jobDescription: resumeText(body.jobDescription, "jobDescription", MAX_RESUME_JOB_BYTES),
    useProfile: body.useProfile,
    locale: body.locale === "zh-TW" ? "zh-TW" : body.locale === "zh-CN" ? "zh-CN" : "en",
  };
}

/** Reject incomplete/model prose replies rather than replacing a resume with them. */
export function parseResumeProposal(reply: string): ResumeProposal {
  const raw = reply.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1");
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new ResumeError("The agent did not return a complete proposal. Your source is unchanged.", 502); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ResumeError("Invalid agent proposal", 502);
  const body = data as Record<string, unknown>;
  const summary = resumeText(body.summary, "summary", 12_000);
  if (!summary.trim() || !Array.isArray(body.questions) || body.questions.length > 20) throw new ResumeError("Invalid agent explanation", 502);
  const questions = body.questions.map((question) => resumeText(question, "question", 2_000));
  const source = body.source === null ? null : resumeText(body.source, "proposal", MAX_RESUME_BYTES);
  if (source !== null && (!/\\documentclass(?:\[[^\]]*\])?\s*\{/.test(source)
    || !source.includes("\\begin{document}") || !source.includes("\\end{document}"))) {
    throw new ResumeError("The agent returned incomplete LaTeX. Your source is unchanged.", 502);
  }
  return { source, summary, questions };
}
