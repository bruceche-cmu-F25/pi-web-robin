import { randomUUID } from "node:crypto";
import { readJsonObject, updateJsonObject } from "./paths.ts";
import { isPublicWebHost } from "./public-web.ts";
import { CORE_JARVIS_SEGMENTS, DEFAULT_JARVIS_DAILY, DEFAULT_JARVIS_OUTBOX, JARVIS_NEWS_BURDEN_KEYS, JARVIS_PERSONAS, JARVIS_RUBRIC_VERSION, JARVIS_TARGET_PERSONAS, isJarvisFollowUpDue, JARVIS_SEGMENTS, JARVIS_STATUSES, JARVIS_TEMPLATE_FIELDS, type JarvisCandidate, type JarvisNewsBurden, type JarvisDaily, type JarvisOutbox, type JarvisPersona, type JarvisRescoreRun, type JarvisTemplate, type JarvisLead, type JarvisRun, type JarvisState, type JarvisStatus } from "./jarvis-shape.ts";

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
function timeZone(value: unknown): string {
  const zone = text(value ?? "", "timeZone", 80, false);
  if (!zone) return "";
  if (!zone.includes("/") && zone !== "UTC") throw new Error("Use an IANA time zone such as America/Chicago");
  try { return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone; }
  catch { throw new Error("Invalid IANA time zone"); }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
}
function newsBurden(value: unknown): JarvisNewsBurden {
  if (!value || typeof value !== "object") throw new Error("info_exec needs a scored newsBurden");
  const item = object(value);
  return Object.fromEntries(JARVIS_NEWS_BURDEN_KEYS.map((key) => {
    if (!item[key] || typeof item[key] !== "object") throw new Error(`Missing newsBurden.${key}`);
    const entry = object(item[key]);
    if (!Number.isInteger(entry.score) || (entry.score as number) < 0 || (entry.score as number) > 3) throw new Error(`Invalid newsBurden.${key}.score`);
    return [key, { score: entry.score as number, evidence: text(entry.evidence, `newsBurden.${key}.evidence`, 400) }];
  })) as JarvisNewsBurden;
}
/** `wide`: a wide-net run also keeps executives who fit no persona ("none"), scored but without a watch list. */
export function parseJarvisCandidate(value: unknown, options: { wide?: boolean } = {}): JarvisCandidate {
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
    personLocation: text(item.personLocation ?? "", "personLocation", 200, false),
    personLocationSource: webUrl(item.personLocationSource ?? "", "personLocationSource", false),
    companyLocation: text(item.companyLocation ?? "", "companyLocation", 200, false),
    companyLocationSource: webUrl(item.companyLocationSource ?? "", "companyLocationSource", false),
  };
  if (item.foundVia && typeof item.foundVia === "object") {
    const via = item.foundVia as Record<string, unknown>;
    try { candidate.foundVia = { source: text(via.source, "foundVia.source", 200), url: webUrl(via.url, "foundVia.url") }; }
    catch { /* an unsourced discovery note is dropped, not the person */ }
  }
  // info_exec is chosen for its news burden, so the scored reasons are the evidence.
  if (item.segment === "info_exec" || item.newsBurden !== undefined) candidate.newsBurden = newsBurden(item.newsBurden);
  if (item.segment === "info_exec" && options.wide && (item.persona === "none" || item.persona === undefined || item.persona === "")) {
    // Scored, but no persona: counted only through the wide-net tier.
  } else if (item.segment === "info_exec") {
    if (!JARVIS_TARGET_PERSONAS.includes(item.persona as typeof JARVIS_TARGET_PERSONAS[number])) throw new Error(`info_exec needs a persona: ${JARVIS_TARGET_PERSONAS.join(", ")}`);
    candidate.persona = item.persona as JarvisPersona;
    candidate.watchList = text(item.watchList, "watchList", 400);
  }
  // Research sometimes omits a citation or uses an unsupported abbreviation.
  // Preserve the contact, but drop the unsupported optional geography.
  if (!candidate.personLocationSource) candidate.personLocation = "";
  if (!candidate.companyLocationSource) candidate.companyLocation = "";
  try { candidate.timeZone = candidate.personLocation ? timeZone(item.timeZone) : ""; }
  catch { candidate.timeZone = ""; }
  if (!/\b(?:you|your)\b/i.test(candidate.opener)) throw new Error("Opener must address the recipient, not describe them in the third person");
  if (candidate.email && (!candidate.emailSource || !candidate.emailQuote.toLowerCase().includes(candidate.email))) {
    throw new Error("An email needs a source URL and a quote containing the exact address");
  }
  return candidate;
}

export const DEFAULT_JARVIS_TEMPLATE: JarvisTemplate = {
  subject: "A question about what deserves your attention",
  body: "Hi {{firstName}},\n\n{{opener}}\n\nI'm Bruce Cheng, a CMU software engineering master's student exploring information overload for people who have to stay on top of fast-moving fields. The idea is a personalized TL;DR built around you — with very little setup, it filters the noise and surfaces the few news, papers, and updates actually worth your attention.\n\nNot selling anything — we're still trying to understand the problem. I'd love your honest take: how do you currently decide what's worth your attention each day, and does the filtering part feel like a real pain or more of a nice-to-have?\n\nEven a one-line reply would be really helpful.\n\nBest,\nBruce Cheng",
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
  const values: Record<string, string> = { firstName, name: candidate.name, company: candidate.company, role: candidate.role, area, work, opener: candidate.opener || `I came across ${work}.` };
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
export function addJarvisCandidates(values: unknown[], checks: Set<string> = new Set(), runId?: string, options: { wide?: boolean } = {}): number {
  if (values.length > 10) throw new Error("Maximum 10 candidates per batch");
  const candidates = values.map((value) => parseJarvisCandidate(value, options));
  return change((state) => {
    if (runId && (state.run?.id !== runId || state.run.status !== "running")) return 0;
    let added = 0;
    for (const item of candidates) {
      if (state.leads.some((lead) =>
        (item.email && item.email === lead.email)
        || (identity(item.name) === identity(lead.name) && (profileKey(item.profileUrl) === profileKey(lead.profileUrl) || identity(item.company) === identity(lead.company))))) continue;
      const timestamp = now();
      state.leads.push({ ...item, ...jarvisDraft(item, state.template), id: randomUUID(), audienceFit: "core", status: "new", reviewed: false,
        ...(item.newsBurden ? { assessedAt: timestamp, assessedVersion: JARVIS_RUBRIC_VERSION } : {}),
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
  const allowed = new Set(["status", "reviewed", "subject", "body", "notes", "confirmedNeeds", "email", "emailSource", "emailQuote", "industry", "role", "seniority", "segment", "needHypothesis", "area", "firstName", "personLocation", "personLocationSource", "companyLocation", "companyLocationSource", "timeZone", "followUp", "persona"]);
  for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new Error(`Unknown field: ${key}`);
  return change((state) => {
    const lead = state.leads.find((item) => item.id === id);
    if (!lead) throw new Error("Contact not found");
    if ((lead.sendAttempt?.state === "pending" || lead.sendAttempt?.state === "uncertain") && lead.status !== "sent" && lead.status !== "do_not_contact") {
      if (Object.keys(patch).some((key) => key !== "status") || !["sent", "do_not_contact"].includes(String(patch.status))) {
        throw new Error("Sending is pending or uncertain. Check Gmail Sent before changing this contact.");
      }
    }
    const next = { ...lead };
    for (const key of ["subject", "body", "notes", "confirmedNeeds", "industry", "role", "seniority", "needHypothesis", "area", "firstName", "personLocation", "companyLocation"] as const) {
      if (patch[key] !== undefined) next[key] = text(patch[key], key, key === "body" || key === "notes" || key === "confirmedNeeds" ? 12000 : key === "area" || key === "firstName" ? 120 : key === "personLocation" || key === "companyLocation" ? 200 : 2000, key === "subject" || key === "body");
    }
    if (patch.personLocationSource !== undefined) next.personLocationSource = webUrl(patch.personLocationSource, "personLocationSource", false);
    if (patch.companyLocationSource !== undefined) next.companyLocationSource = webUrl(patch.companyLocationSource, "companyLocationSource", false);
    if (next.personLocation && !next.personLocationSource) throw new Error("Person location needs a public source URL");
    if (next.companyLocation && !next.companyLocationSource) throw new Error("Company location needs a public source URL");
    if (patch.timeZone !== undefined) next.timeZone = timeZone(patch.timeZone);
    if ((next.personLocation !== lead.personLocation || next.personLocationSource !== lead.personLocationSource) && next.timeZone === lead.timeZone) next.timeZone = "";
    if (next.timeZone && !next.personLocation) throw new Error("Add the person's sourced work location before their time zone");
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
    // Queued means "send this approved snapshot": any change to what was approved takes it out.
    if (!next.reviewed || next.status !== "ready") delete next.queuedAt;
    if (patch.persona !== undefined) {
      if (patch.persona === "") delete next.persona;
      else if (JARVIS_PERSONAS.includes(patch.persona as JarvisPersona)) next.persona = patch.persona as JarvisPersona;
      else throw new Error("Invalid persona");
    }
    if (patch.followUp !== undefined) {
      if (patch.followUp !== true || lead.status !== "sent" || next.status !== "sent" || !lead.sentAt || lead.repliedAt || lead.followedUpAt) {
        throw new Error("A follow-up can be recorded only for a sent contact without a recorded reply or prior follow-up");
      }
      next.followedUpAt = now();
    }
    if (next.status !== lead.status) {
      const at = now();
      next.history = [...lead.history, { status: next.status, at }];
      if (next.status === "sent" && !next.sentAt) next.sentAt = at;
      if (["replied", "interested", "declined"].includes(next.status) && !next.repliedAt) next.repliedAt = at;
    }
    next.updatedAt = now();
    next.revision = (lead.revision ?? 0) + 1;
    Object.assign(lead, next);
    // Object.assign copies only present keys: removals must be applied explicitly.
    if (!next.queuedAt) delete lead.queuedAt;
    if (!next.persona) delete lead.persona;
    return lead;
  });
}

export function claimJarvisSend(id: string, expectedRevision: number): { attemptId: string; email: string; subject: string; body: string } {
  return change((state) => {
    const lead = state.leads.find((item) => item.id === id);
    if (!lead || (lead.revision ?? 0) !== expectedRevision || lead.sendAttempt || lead.status !== "ready" || !lead.reviewed || !lead.email || !lead.emailSource || !lead.emailQuote.toLowerCase().includes(lead.email)) {
      throw new Error("Contact changed, was already sent, or is not approved. Refresh and review before sending.");
    }
    const attemptId = randomUUID();
    lead.sendAttempt = { id: attemptId, at: now(), state: "pending" };
    lead.updatedAt = now();
    lead.revision = (lead.revision ?? 0) + 1;
    return { attemptId, email: lead.email, subject: lead.subject, body: lead.body };
  });
}

/** After a timeout the delivery outcome is unknown. Never offer an automatic retry. */
export function finishJarvisSend(id: string, attemptId: string, messageId?: string, threadId?: string): void {
  change((state) => {
    const lead = state.leads.find((item) => item.id === id);
    if (!lead || lead.sendAttempt?.id !== attemptId || lead.sendAttempt.state !== "pending") throw new Error("Send attempt not found");
    const at = now();
    lead.sendAttempt = { ...lead.sendAttempt, state: messageId ? "sent" : "uncertain", ...(messageId ? { messageId } : {}), ...(threadId ? { threadId } : {}) };
    delete lead.queuedAt;
    if (messageId) {
      lead.sentAt ??= at;
      if (lead.status === "ready") {
        lead.status = "sent";
        lead.history.push({ status: "sent", at });
      }
    }
    lead.updatedAt = at;
    lead.revision = (lead.revision ?? 0) + 1;
  });
}

export function writeJarvisRescore(run: JarvisRescoreRun): void { change((state) => { state.rescore = run; }); }
export function patchJarvisRescore(id: string, patch: Partial<Pick<JarvisRescoreRun, "status" | "assessed" | "message" | "finishedAt">>): void {
  change((state) => { if (state.rescore?.id === id && state.rescore.status === "running") Object.assign(state.rescore, patch); });
}
export function writeJarvisRun(run: JarvisRun): void { change((state) => { state.run = run; }); }
export function patchJarvisRun(id: string, patch: Partial<Pick<JarvisRun, "status" | "batches" | "message" | "finishedAt">>): void {
  change((state) => { if (state.run?.id === id && state.run.status === "running") Object.assign(state.run, patch); });
}

/**
 * Rescoring writes only persona and newsBurden. "none" means the person fits
 * none of the five personas: their score is kept, the persona cleared.
 */
export function applyJarvisAssessment(id: string, value: unknown): boolean {
  const item = object(value);
  const burden = newsBurden(item.newsBurden);
  if (item.persona !== "none" && !JARVIS_TARGET_PERSONAS.includes(item.persona as typeof JARVIS_TARGET_PERSONAS[number])) throw new Error("Invalid persona");
  const watchList = item.persona === "none" ? "" : text(item.watchList, "watchList", 400);
  return change((state) => {
    const lead = state.leads.find((entry) => entry.id === id);
    if (!lead) return false;
    lead.newsBurden = burden;
    if (item.persona === "none") { delete lead.persona; delete lead.watchList; }
    else { lead.persona = item.persona as JarvisPersona; lead.watchList = watchList; }
    lead.assessedAt = now();
    lead.assessedVersion = JARVIS_RUBRIC_VERSION;
    return true;
  });
}

/**
 * Batch approval: each id must carry the revision Bruce saw, so an edit made
 * elsewhere after the list was loaded is never approved blind.
 */
export function queueJarvisLeads(items: unknown): { queued: number; skipped: Array<{ id: string; reason: string }> } {
  if (!Array.isArray(items) || items.length === 0 || items.length > 200) throw new Error("Select 1–200 contacts");
  const wanted = items.map((raw) => {
    const item = object(raw);
    if (typeof item.id !== "string" || !Number.isSafeInteger(item.revision)) throw new Error("Each contact needs id and revision");
    return { id: item.id, revision: item.revision as number };
  });
  return change((state) => {
    let queued = 0;
    const skipped: Array<{ id: string; reason: string }> = [];
    for (const { id, revision } of wanted) {
      const lead = state.leads.find((entry) => entry.id === id);
      const reason = !lead ? "not found"
        : (lead.revision ?? 0) !== revision ? "changed since loaded"
        : !["new", "ready"].includes(lead.status) || lead.sendAttempt || lead.sentAt ? "already contacted or suppressed"
        : !lead.email || lead.emailCheck !== "source_found" ? "no email confirmed on its source page"
        : "";
      if (reason || !lead) { skipped.push({ id, reason }); continue; }
      const at = now();
      if (lead.status !== "ready") lead.history.push({ status: "ready", at });
      Object.assign(lead, { reviewed: true, status: "ready", queuedAt: lead.queuedAt ?? at, updatedAt: at, revision: (lead.revision ?? 0) + 1 });
      queued++;
    }
    return { queued, skipped };
  });
}

export function unqueueJarvisLeads(ids: unknown): number {
  if (!Array.isArray(ids)) throw new Error("ids must be an array");
  return change((state) => {
    let removed = 0;
    for (const lead of state.leads) {
      if (!ids.includes(lead.id) || !lead.queuedAt || lead.sendAttempt) continue;
      delete lead.queuedAt;
      lead.updatedAt = now();
      lead.revision = (lead.revision ?? 0) + 1;
      removed++;
    }
    return removed;
  });
}

export const DEFAULT_JARVIS_FOLLOW_UP = "Hi {{firstName}},\n\nJust bumping this in case it got buried. Even a one-line answer on how you decide what deserves your attention each day would help a lot.\n\nIf this isn't relevant, just say so and I won't follow up again.\n\nBest,\nBruce Cheng";

export function readJarvisOutbox(state: JarvisState = readJarvis()): JarvisOutbox {
  return { ...DEFAULT_JARVIS_OUTBOX, ...state.outbox };
}

export function setJarvisOutbox(value: unknown): JarvisOutbox {
  const item = object(value);
  return change((state) => {
    const outbox = readJarvisOutbox(state);
    if (item.enabled !== undefined) {
      if (typeof item.enabled !== "boolean") throw new Error("enabled must be boolean");
      outbox.enabled = item.enabled;
      // Resuming is the explicit acknowledgement of whatever paused it.
      if (item.enabled) delete outbox.pausedReason;
    }
    if (item.startAt === null) delete outbox.startAt;
    else if (item.startAt !== undefined) {
      const at = typeof item.startAt === "string" ? Date.parse(item.startAt) : NaN;
      if (!Number.isFinite(at)) throw new Error("startAt must be an ISO date, or null to start now");
      outbox.startAt = new Date(at).toISOString();
    }
    if (item.dailyLimit === null || item.dailyLimit === 0) delete outbox.dailyLimit;
    else if (item.dailyLimit !== undefined) {
      if (!Number.isInteger(item.dailyLimit) || (item.dailyLimit as number) < 1 || (item.dailyLimit as number) > 500) throw new Error("dailyLimit must be 1–500, or 0 for no cap");
      outbox.dailyLimit = item.dailyLimit as number;
    }
    state.outbox = outbox;
    return outbox;
  });
}

export function readJarvisDaily(state: JarvisState = readJarvis()): JarvisDaily {
  return { ...DEFAULT_JARVIS_DAILY, ...state.daily };
}

export function setJarvisDaily(value: unknown): JarvisDaily {
  const item = object(value);
  return change((state) => {
    const daily = readJarvisDaily(state);
    if (item.enabled !== undefined) {
      if (typeof item.enabled !== "boolean") throw new Error("enabled must be boolean");
      daily.enabled = item.enabled;
    }
    if (item.count !== undefined) {
      if (!Number.isInteger(item.count) || (item.count as number) < 1 || (item.count as number) > 60) throw new Error("count must be 1–60");
      daily.count = item.count as number;
    }
    if (item.hour !== undefined) {
      if (!Number.isInteger(item.hour) || (item.hour as number) < 0 || (item.hour as number) > 23) throw new Error("hour must be 0–23");
      daily.hour = item.hour as number;
    }
    if (item.lastRunOn !== undefined) {
      if (typeof item.lastRunOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.lastRunOn)) throw new Error("lastRunOn must be YYYY-MM-DD");
      daily.lastRunOn = item.lastRunOn;
    }
    state.daily = daily;
    return daily;
  });
}

export function patchJarvisOutbox(patch: Partial<JarvisOutbox>): void {
  change((state) => { state.outbox = { ...readJarvisOutbox(state), ...patch }; });
}

/** Claims the oldest queued contact for the outbox, exactly like a manual send claim. */
export function claimQueuedJarvisSend(eligible: (lead: JarvisLead) => boolean = () => true): { id: string; attemptId: string; email: string; subject: string; body: string } | null {
  return change((state) => {
    const lead = state.leads.filter((entry) => entry.queuedAt && entry.status === "ready" && entry.reviewed && !entry.sendAttempt && entry.email && entry.emailCheck === "source_found" && eligible(entry))
      .sort((a, b) => a.queuedAt!.localeCompare(b.queuedAt!))[0];
    if (!lead) return null;
    const attemptId = randomUUID();
    lead.sendAttempt = { id: attemptId, at: now(), state: "pending" };
    lead.updatedAt = now();
    lead.revision = (lead.revision ?? 0) + 1;
    return { id: lead.id, attemptId, email: lead.email, subject: lead.subject, body: lead.body };
  });
}

/** The one automatic follow-up, rendered from the follow-up template and claimed before sending. */
export function claimJarvisFollowUp(at: number = Date.now()): { id: string; attemptId: string; email: string; subject: string; body: string; threadId: string; messageId: string } | null {
  return change((state) => {
    const lead = state.leads.find((entry) => isJarvisFollowUpDue(entry, at) && entry.sendAttempt?.state === "sent" && entry.sendAttempt.threadId && entry.sendAttempt.messageId && entry.syncedAt && Date.parse(entry.syncedAt) > at - 60 * 60 * 1000);
    if (!lead) return null;
    const attemptId = randomUUID();
    lead.followUpAttempt = { id: attemptId, at: now(), state: "pending" };
    lead.updatedAt = now();
    lead.revision = (lead.revision ?? 0) + 1;
    const { body } = jarvisDraft(lead, { subject: lead.subject, body: state.followUpTemplate ?? DEFAULT_JARVIS_FOLLOW_UP });
    return { id: lead.id, attemptId, email: lead.email, subject: lead.subject.startsWith("Re:") ? lead.subject : `Re: ${lead.subject}`, body, threadId: lead.sendAttempt!.threadId!, messageId: lead.sendAttempt!.messageId! };
  });
}

export function finishJarvisFollowUp(id: string, attemptId: string, messageId?: string): void {
  change((state) => {
    const lead = state.leads.find((entry) => entry.id === id);
    if (!lead || lead.followUpAttempt?.id !== attemptId || lead.followUpAttempt.state !== "pending") throw new Error("Follow-up attempt not found");
    lead.followUpAttempt = { ...lead.followUpAttempt, state: messageId ? "sent" : "uncertain", ...(messageId ? { messageId } : {}) };
    // Either way it counts as the follow-up: an uncertain one must never be retried.
    lead.followedUpAt ??= now();
    lead.updatedAt = now();
    lead.revision = (lead.revision ?? 0) + 1;
  });
}

/** Records what the Gmail thread shows. A reply or bounce ends any automatic follow-up. */
export function recordJarvisThread(id: string, result: { threadId?: string; outcome: "none" | "replied" | "bounced"; at?: string }): void {
  change((state) => {
    const lead = state.leads.find((entry) => entry.id === id);
    if (!lead) return;
    if (result.threadId && lead.sendAttempt) lead.sendAttempt.threadId = result.threadId;
    lead.syncedAt = now();
    if (result.outcome !== "none" && lead.status === "sent") {
      const at = result.at ?? now();
      lead.status = result.outcome;
      lead.history.push({ status: result.outcome, at });
      if (result.outcome === "replied") lead.repliedAt ??= at;
      delete lead.queuedAt;
      lead.updatedAt = now();
      lead.revision = (lead.revision ?? 0) + 1;
    }
  });
}
