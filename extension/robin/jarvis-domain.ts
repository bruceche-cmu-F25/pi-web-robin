import { randomUUID } from "node:crypto";
import { readJsonObject, updateJsonObject } from "./paths.ts";
import { isPublicWebHost } from "./public-web.ts";
import { CORE_JARVIS_SEGMENTS, JARVIS_SEGMENTS, JARVIS_STATUSES, JARVIS_TEMPLATE_FIELDS, type JarvisCandidate, type JarvisTemplate, type JarvisLead, type JarvisRun, type JarvisState, type JarvisStatus } from "./jarvis-shape.ts";

const FILE = "jarvis-discovery.json";
const empty = (): JarvisState => ({ leads: [], run: null });
const now = () => new Date().toISOString();
export function readJarvis(): JarvisState {
  const state = readJsonObject<JarvisState>(FILE) ?? empty();
  // The first research run targeted tech/VC/research. Keep it visible, but do
  // not let it make the redesigned non-tech campaign look closer to 100.
  state.leads = state.leads.map((lead) => ({
    ...lead,
    audienceFit: lead.audienceFit ?? (CORE_JARVIS_SEGMENTS.includes(lead.segment as typeof CORE_JARVIS_SEGMENTS[number]) ? "core" : "adjacent"),
  }));
  return state;
}
function change<T>(fn: (state: JarvisState) => T): T {
  return updateJsonObject<JarvisState, T>(FILE, (stored) => {
    const state = stored ?? empty();
    return { result: fn(state), value: state, changed: true };
  });
}
function text(value: unknown, key: string, max = 2000, required = true): string {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new Error(`Invalid ${key}`);
  return value.trim();
}
function webUrl(value: unknown, key: string, required = true): string {
  const raw = text(value, key, 2000, required);
  if (!raw) return "";
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol) || !isPublicWebHost(url.hostname) || url.username || url.password) throw new Error(`Invalid public URL: ${key}`);
  url.hash = "";
  return url.toString();
}
/** Free webmail domains: a professional outreach address must live on the org's own domain. */
const FREE_WEBMAIL = /@(gmail|hotmail|outlook|yahoo|aol|icloud|protonmail|proton\.me|gmx|zoho|yandex|mail\.ru|qq|126|163|foxmail|sina)\.(com|net|org|me|ru|cn|ch|de)$/i;
function email(value: unknown): string {
  const raw = text(value, "email", 254, false).toLowerCase();
  if (!raw) return raw;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(raw)) throw new Error("Invalid email");
  if (FREE_WEBMAIL.test(raw)) throw new Error("Work contact must use the organization's own domain, not a free webmail address");
  return raw;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
}
export function parseJarvisCandidate(value: unknown): JarvisCandidate {
  const item = object(value);
  if (!CORE_JARVIS_SEGMENTS.includes(item.segment as typeof CORE_JARVIS_SEGMENTS[number])) throw new Error("Invalid core segment");
  const candidate: JarvisCandidate = {
    name: text(item.name, "name", 160), company: text(item.company, "company", 200),
    role: text(item.role, "role", 200), seniority: text(item.seniority, "seniority", 100),
    industry: text(item.industry, "industry", 200), segment: item.segment as JarvisCandidate["segment"],
    profileUrl: webUrl(item.profileUrl, "profileUrl"), evidence: text(item.evidence, "evidence"),
    evidenceUrl: webUrl(item.evidenceUrl, "evidenceUrl"), needHypothesis: text(item.needHypothesis, "needHypothesis"),
    email: email(item.email ?? ""), emailSource: webUrl(item.emailSource ?? "", "emailSource", false),
    emailQuote: text(item.emailQuote ?? "", "emailQuote", 2000, false), opener: text(item.opener, "opener", 600),
    area: text(item.area ?? "", "area", 120, false),
  };
  if (candidate.email && (!candidate.emailSource || !candidate.emailQuote.toLowerCase().includes(candidate.email))) {
    throw new Error("An email needs a source URL and a quote containing the exact address");
  }
  return candidate;
}

export const DEFAULT_JARVIS_TEMPLATE: JarvisTemplate = {
  subject: "Quick question about information overload",
  body: "Hi {{firstName}},\n\nI’m Bruce, a master’s student in software engineering at Carnegie Mellon, and I’m working on a product around information overload.\n\nThe idea is simple: a personalized TL;DR built around you, with very little setup. Instead of spending time searching through newsletters, news, papers, and industry updates, it would surface the few things most worth your attention.\n\nI came across {{work}}, and I’d genuinely value your reaction.\n\nDoes this sound like it would solve a real problem for you, or more like a nice-to-have? And if it worked reliably and consistently saved you time, is it something you could imagine paying for?\n\nNo need for a long reply — even a sentence or two would be incredibly helpful.\n\nBest,\nBruce",
};
const PLACEHOLDER = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/** Validates a template's placeholders so a typo fails loudly instead of mailing "{{frstName}}". */
export function parseJarvisTemplate(value: unknown): JarvisTemplate {
  const item = object(value);
  const template = { subject: text(item.subject, "subject", 300), body: text(item.body, "body", 12000) };
  for (const [, key] of `${template.subject}\n${template.body}`.matchAll(PLACEHOLDER)) {
    if (!(JARVIS_TEMPLATE_FIELDS as readonly string[]).includes(key!)) throw new Error(`Unknown placeholder {{${key}}}; use ${JARVIS_TEMPLATE_FIELDS.map((f) => `{{${f}}}`).join(", ")}`);
  }
  return template;
}

export function jarvisDraft(candidate: JarvisCandidate, template: JarvisTemplate = DEFAULT_JARVIS_TEMPLATE): { subject: string; body: string } {
  const firstName = candidate.firstName?.trim() || candidate.name.replace(/^(dr|mr|ms|mrs)\.?\s+/i, "").split(/\s+/)[0]!;
  // An explicit area is written as-is; only the industry fallback is lowercased
  // ("Behavioral health" reads as "in behavioral health"; acronyms such as "HVAC" stay).
  const fallback = candidate.industry.trim().replace(/\.$/, "");
  const area = candidate.area?.trim() || (/^\p{Lu}\p{Ll}/u.test(fallback) ? fallback[0]!.toLowerCase() + fallback.slice(1) : fallback);
  // "your work leading X" reads better than "your work in leading X".
  const work = /^\p{Ll}+ing\b/u.test(area) ? `your work ${area}` : `your work in ${area}`;
  const values: Record<string, string> = { firstName, name: candidate.name, company: candidate.company, role: candidate.role, area, work };
  const fill = (value: string) => value.replace(PLACEHOLDER, (_, key: string) => values[key] ?? "");
  return { subject: fill(template.subject), body: fill(template.body) };
}

/**
 * Re-renders every draft that is still exactly what the previous template
 * produced. Edited, approved or already-contacted drafts are Bruce's and stay.
 */
export function setJarvisTemplate(value: unknown, dryRun = false): { updated: number; kept: number; sample?: { name: string; subject: string; body: string } } {
  const next = parseJarvisTemplate(value);
  const plan = (state: JarvisState) => {
    const previous = state.template ?? DEFAULT_JARVIS_TEMPLATE;
    const regenerable = state.leads.filter((lead) => {
      const old = jarvisDraft(lead, previous);
      return !lead.reviewed && lead.status === "new" && lead.subject === old.subject && lead.body === old.body;
    });
    const first = regenerable[0];
    return { regenerable, kept: state.leads.length - regenerable.length, sample: first && { name: first.name, ...jarvisDraft(first, next) } };
  };
  if (dryRun) {
    const { regenerable, kept, sample } = plan(readJarvis());
    return { updated: regenerable.length, kept, sample };
  }
  return change((state) => {
    const { regenerable, kept, sample } = plan(state);
    const at = now();
    for (const lead of regenerable) Object.assign(lead, jarvisDraft(lead, next), { updatedAt: at });
    state.template = next;
    return { updated: regenerable.length, kept, sample };
  });
}
const identity = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const profileKey = (value: string) => value.replace(/^https?:\/\/(www\.)?/i, "").replace(/\?.*$/, "").replace(/\/$/, "").toLowerCase();

/** Retries only add new people. Research never replaces drafts, replies or suppression. */
export function addJarvisCandidates(values: unknown[], checks: Set<string> = new Set(), runId?: string): number {
  if (values.length > 10) throw new Error("Maximum 10 candidates per batch");
  const candidates = values.map(parseJarvisCandidate);
  return change((state) => {
    if (runId && (state.run?.id !== runId || state.run.status !== "running")) return 0;
    let added = 0;
    for (const item of candidates) {
      if (state.leads.some((lead) =>
        (item.email && item.email === lead.email)
        || (identity(item.name) === identity(lead.name) && (profileKey(item.profileUrl) === profileKey(lead.profileUrl) || identity(item.company) === identity(lead.company))))) continue;
      const timestamp = now();
      state.leads.push({ ...item, ...jarvisDraft(item, state.template), id: randomUUID(), audienceFit: "core", status: "new", reviewed: false,
        emailCheck: !item.email ? "missing" : checks.has(item.email) ? "source_found" : "unconfirmed",
        notes: "", confirmedNeeds: "", createdAt: timestamp, updatedAt: timestamp, history: [{ status: "new", at: timestamp }] });
      added++;
    }
    if (runId && state.run) state.run.added += added;
    return added;
  });
}

/** User-owned fields only; a research response cannot invoke this path. */
export function updateJarvisLead(id: string, value: unknown): JarvisLead {
  const patch = object(value);
  const allowed = new Set(["status", "reviewed", "subject", "body", "notes", "confirmedNeeds", "email", "emailSource", "emailQuote", "industry", "role", "seniority", "segment", "needHypothesis", "area", "firstName"]);
  for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new Error(`Unknown field: ${key}`);
  return change((state) => {
    const lead = state.leads.find((item) => item.id === id);
    if (!lead) throw new Error("Contact not found");
    const next = { ...lead };
    for (const key of ["subject", "body", "notes", "confirmedNeeds", "industry", "role", "seniority", "needHypothesis", "area", "firstName"] as const) {
      if (patch[key] !== undefined) next[key] = text(patch[key], key, key === "body" || key === "notes" || key === "confirmedNeeds" ? 12000 : key === "area" || key === "firstName" ? 120 : 2000, key === "subject" || key === "body");
    }
    if (patch.segment !== undefined) {
      if (!JARVIS_SEGMENTS.includes(patch.segment as JarvisCandidate["segment"])) throw new Error("Invalid segment");
      next.segment = patch.segment as JarvisCandidate["segment"];
    }
    if (patch.email !== undefined) next.email = email(patch.email);
    if (patch.emailSource !== undefined) next.emailSource = webUrl(patch.emailSource, "emailSource", false);
    if (patch.emailQuote !== undefined) next.emailQuote = text(patch.emailQuote, "emailQuote", 2000, false);
    if (next.email && (!next.emailSource || !next.emailQuote.toLowerCase().includes(next.email))) throw new Error("An email needs its public source and exact address in the quote");
    const contactChanged = next.email !== lead.email || next.emailSource !== lead.emailSource || next.emailQuote !== lead.emailQuote;
    if (contactChanged) {
      next.emailCheck = next.email ? "unconfirmed" : "missing";
      next.reviewed = false;
    }
    if (next.subject !== lead.subject || next.body !== lead.body) next.reviewed = false;
    if (patch.reviewed !== undefined) {
      if (typeof patch.reviewed !== "boolean") throw new Error("Invalid reviewed flag");
      next.reviewed = patch.reviewed;
    }
    if (next.reviewed && !next.email) throw new Error("Add a sourced work email before approving");
    if (patch.status !== undefined) {
      if (!JARVIS_STATUSES.includes(patch.status as JarvisStatus)) throw new Error("Invalid status");
      next.status = patch.status as JarvisStatus;
      if (lead.status === "do_not_contact" && next.status !== lead.status) throw new Error("Do-not-contact cannot be reopened");
      if (["ready", "sent"].includes(next.status) && (!next.email || !next.reviewed || ["bounced", "declined"].includes(lead.status))) throw new Error("Review the contact and draft first; declined/bounced contacts are suppressed");
    }
    if (!next.reviewed && next.status === "ready") next.status = "new";
    if (next.status !== lead.status) {
      const at = now();
      next.history = [...lead.history, { status: next.status, at }];
      if (next.status === "sent" && !next.sentAt) next.sentAt = at;
      if (["replied", "interested", "declined"].includes(next.status) && !next.repliedAt) next.repliedAt = at;
    }
    next.updatedAt = now();
    Object.assign(lead, next);
    return lead;
  });
}

export function writeJarvisRun(run: JarvisRun): void { change((state) => { state.run = run; }); }
export function patchJarvisRun(id: string, patch: Partial<Pick<JarvisRun, "status" | "batches" | "message" | "finishedAt">>): void {
  change((state) => { if (state.run?.id === id && state.run.status === "running") Object.assign(state.run, patch); });
}
