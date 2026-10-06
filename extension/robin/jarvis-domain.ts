import { DEFAULT_SOCIAL_TEMPLATES, assertCurrentOutreachCopy, isLinkedInConnectionPending, canReviewOutreach, canPlanChannel, hasApprovedChannelPlan, inReviewQueue, unbrandedOutreachText } from "./outreach-shape.ts";
import { randomUUID } from "node:crypto";
import { readJsonObject, updateJsonObject } from "./paths.ts";
import { isPublicWebHost } from "./public-web.ts";
import { CORE_JARVIS_SEGMENTS, DEFAULT_JARVIS_DAILY, DEFAULT_JARVIS_OUTBOX, JARVIS_NEWS_BURDEN_KEYS, JARVIS_PERSONAS, JARVIS_RESEARCH_LANES, JARVIS_RUBRIC_VERSION, JARVIS_SOCIAL_PLATFORMS, JARVIS_TARGET_PERSONAS, isCurrentValidationProspect, isJarvisFollowUpDue, isQualifiedInfoExec, isResearchedTargetUser, isOutreachApprovedFor, hasJarvisSocialOutreach, jarvisContactMethods, JARVIS_SEGMENTS, JARVIS_STATUSES, JARVIS_TEMPLATE_FIELDS, type JarvisCandidate, type JarvisNewsBurden, type JarvisDaily, type JarvisOutbox, type JarvisPersona, type JarvisRescoreRun, type JarvisTemplate, type JarvisLead, type JarvisRun, type JarvisState, type JarvisStatus, type JarvisSocialPlatform, type JarvisResearchLane, type JarvisWebsiteResearch, type JarvisWebsiteRun } from "./jarvis-shape.ts";

const FILE = "jarvis-discovery.json";
const empty = (): JarvisState => ({ leads: [], run: null });
const now = () => new Date().toISOString();
// Apply the same draft view to reads and writes. Changed copy needs fresh approval;
// sent and in-flight messages remain immutable history.
function prepareUnnamedCopy(state: JarvisState): JarvisState {
  if (state.template) state.template = { subject: unbrandedOutreachText(state.template.subject), body: unbrandedOutreachText(state.template.body) };
  if (state.followUpTemplate) state.followUpTemplate = unbrandedOutreachText(state.followUpTemplate);
  for (const lead of state.leads) {
    let changed = false;
    if (!lead.sentAt && !lead.sendAttempt) {
      const subject = unbrandedOutreachText(lead.subject);
      const body = unbrandedOutreachText(lead.body);
      if (subject !== lead.subject || body !== lead.body) {
        lead.subject = subject; lead.body = body; lead.reviewed = false;
        delete lead.queuedAt;
        changed = true;
      }
    }
    for (const platform of JARVIS_SOCIAL_PLATFORMS) {
      const social = lead.socialOutreach?.[platform];
      if (social?.draft && !social.sentAt) {
        const draft = unbrandedOutreachText(social.draft);
        if (draft !== social.draft) { social.draft = draft; changed = true; }
      }
    }
    if (changed) { delete lead.outreachApproval; lead.revision = (lead.revision ?? 0) + 1; }
  }
  return state;
}
export function readJarvis(): JarvisState {
  const state = prepareUnnamedCopy(readJsonObject<JarvisState>(FILE) ?? empty());
  // The first research run targeted tech/VC/research. Keep it visible, but do
  // not let it make the redesigned non-tech campaign look closer to 100.
  state.leads = state.leads.map((lead) => ({
    ...lead,
    socialTemplateDrafts: Object.fromEntries(Object.entries({ ...DEFAULT_SOCIAL_TEMPLATES, ...state.socialTemplates }).map(([platform, body]) => [platform, jarvisDraft(lead, { subject: "Social message", body }).body])),
    audienceFit: lead.audienceFit ?? (CORE_JARVIS_SEGMENTS.includes(lead.segment as typeof CORE_JARVIS_SEGMENTS[number]) ? "core" : "adjacent"),
  }));
  return state;
}
function change<T>(fn: (state: JarvisState) => T, undoAction?: { id: string; op: string }): T {
  return updateJsonObject<JarvisState, T>(FILE, (stored) => {
    const state = prepareUnnamedCopy(stored ?? empty());
    const before = undoAction && state.leads.find(lead => lead.id === undoAction.id);
    const snapshot = before && structuredClone(before);
    const result = fn(state);
    if (snapshot && undoAction) {
      const after = state.leads.find(lead => lead.id === undoAction.id);
      if (after) state.outreachUndo = { leadId: after.id, name: after.name, op: undoAction.op, revision: after.revision ?? 0, before: snapshot };
    } else if (state.outreachUndo) {
      const current = state.leads.find(lead => lead.id === state.outreachUndo!.leadId);
      if (!current || (current.revision ?? 0) !== state.outreachUndo.revision) delete state.outreachUndo;
    }
    return { result, value: state, changed: true };
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
/** Role and department inboxes are not attributable to the named person. */
const GENERIC_WORK_LOCAL = /^(info|hello|contact|support|help|office|admin|team|staff|careers|jobs|media|press|communications?|development|fundraising|grants?|director|executive|outreach|programs?|community|services?|general|inquir(?:y|ies)|mail)@/i;
function email(value: unknown): string {
  const raw = text(value, "email", 254, false).toLowerCase();
  if (!raw) return raw;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(raw)) throw new Error("Invalid email");
  if (FREE_WEBMAIL.test(raw)) throw new Error("Work contact must use the organization's own domain, not a free webmail address");
  if (GENERIC_WORK_LOCAL.test(raw)) throw new Error("Work contact must identify an individual person, not a role or department inbox");
  return raw;
}
function socialUrls(value: unknown): JarvisCandidate["socials"] {
  if (value === undefined || value === null) return undefined;
  const item = object(value);
  const hosts: Record<JarvisSocialPlatform, RegExp> = {
    linkedin: /(^|\.)linkedin\.com$/i, instagram: /(^|\.)instagram\.com$/i,
    x: /(^|\.)(x|twitter)\.com$/i, tiktok: /(^|\.)tiktok\.com$/i,
  };
  const socials: JarvisCandidate["socials"] = {};
  for (const platform of JARVIS_SOCIAL_PLATFORMS) {
    const raw = item[platform];
    if (raw === undefined || raw === "") continue;
    const url = webUrl(raw, `socials.${platform}`);
    if (!hosts[platform].test(new URL(url).hostname)) throw new Error(`Invalid ${platform} URL`);
    socials[platform] = url;
  }
  return Object.keys(socials).length ? socials : undefined;
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
function scoredSignal(value: unknown, key: "companyFit" | "reachability"): { score: number; evidence: string } {
  const item = object(value);
  if (!Number.isInteger(item.score) || (item.score as number) < 0 || (item.score as number) > 50) throw new Error(`Invalid ${key}.score`);
  return { score: item.score as number, evidence: text(item.evidence, `${key}.evidence`, 800) };
}
function sourcedSignal(value: unknown, key: "shopifyEvidence" | "opportunityNeedEvidence" | "informationNeedEvidence" | "whyNow"): { url: string; quote: string; summary?: string } {
  const item = object(value);
  return {
    ...(key === "whyNow" ? { summary: text(item.summary, "whyNow.summary", 400) } : {}),
    url: webUrl(item.url, `${key}.url`), quote: text(item.quote, `${key}.quote`, 800),
  };
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
    socials: socialUrls(item.socials),
    personLocation: text(item.personLocation ?? "", "personLocation", 200, false),
    personLocationSource: webUrl(item.personLocationSource ?? "", "personLocationSource", false),
    companyLocation: text(item.companyLocation ?? "", "companyLocation", 200, false),
    companyLocationSource: webUrl(item.companyLocationSource ?? "", "companyLocationSource", false),
  };
  if (item.socialLoginRequired !== undefined) {
    if (!Array.isArray(item.socialLoginRequired) || item.socialLoginRequired.some((platform) =>
      !JARVIS_SOCIAL_PLATFORMS.includes(platform as JarvisSocialPlatform) || !candidate.socials?.[platform as JarvisSocialPlatform])) {
      throw new Error("Login review needs a saved social profile URL");
    }
    candidate.socialLoginRequired = [...new Set(item.socialLoginRequired)] as JarvisSocialPlatform[];
  }
  if (item.socialEvidence && typeof item.socialEvidence === "object") {
    const post = object(item.socialEvidence);
    const url = webUrl(post.url, "socialEvidence.url");
    // A profile is a contact route; only a specific public social post is research evidence.
    if (!/(^|\.)(linkedin\.com|instagram\.com|twitter\.com|x\.com|tiktok\.com)$/i.test(new URL(url).hostname)
      || !/\/(posts\/|feed\/update\/|pulse\/|p\/|reel\/|status\/|video\/)/i.test(new URL(url).pathname)) throw new Error("Social evidence needs a public post URL");
    candidate.socialEvidence = { url, quote: text(post.quote, "socialEvidence.quote", 600) };
  }
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
    if (!JARVIS_RESEARCH_LANES.includes(item.sourcingLane as JarvisResearchLane)) throw new Error(`info_exec needs a current sourcingLane: ${JARVIS_RESEARCH_LANES.join(", ")}`);
    candidate.sourcingLane = item.sourcingLane as JarvisResearchLane;
    if (item.shopifyEvidence !== undefined) candidate.shopifyEvidence = sourcedSignal(item.shopifyEvidence, "shopifyEvidence") as { url: string; quote: string };
    if (item.opportunityNeedEvidence !== undefined) candidate.opportunityNeedEvidence = sourcedSignal(item.opportunityNeedEvidence, "opportunityNeedEvidence") as { url: string; quote: string };
    if (item.informationNeedEvidence !== undefined) candidate.informationNeedEvidence = sourcedSignal(item.informationNeedEvidence, "informationNeedEvidence") as { url: string; quote: string };
    if (item.whyNow !== undefined) candidate.whyNow = sourcedSignal(item.whyNow, "whyNow") as { summary: string; url: string; quote: string };
    if (item.companyFit !== undefined) candidate.companyFit = scoredSignal(item.companyFit, "companyFit");
    if (item.reachability !== undefined) candidate.reachability = scoredSignal(item.reachability, "reachability");
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
  body: "Hi {{firstName}},\n\n{{shortOpener}}\n\nI'm Bruce. We're building a personal intelligence filter for people who have to keep up with changing information across their work. It learns from your goals, projects, public footprint, and feedback, then monitors public sources and sources you explicitly choose to connect.\n\nInstead of another long digest, it sends a short daily brief with only the developments and opportunities worth acting on—why each matters, the source, and the next step. Grants and fellowships can be one use case; so can policy, operations, market, customer, or competitor changes.\n\nHow do you decide what deserves your attention today, and what tends to get missed?\n\nhttps://your-secretary.com\n\nBest,\nBruce\nhttps://www.linkedin.com/in/chi-cheng921/",
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

/** Prefer a short sourced opening; never truncate a sentence mid-thought. */
export function shortJarvisOpener(candidate: JarvisCandidate): string {
  const first = candidate.opener?.trim().match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  if (first && first.split(/\s+/).length <= 25 && !first.endsWith("?")) return first;
  const role = candidate.role.trim();
  const company = candidate.company.trim().replace(/[.!?]+$/, "");
  return role && role.split(/\s+/).length <= 6
    ? `I came across your work as ${role} at ${company}.`
    : `I came across your work at ${company}.`;
}

export function jarvisDraft(candidate: JarvisCandidate, template: JarvisTemplate = DEFAULT_JARVIS_TEMPLATE): { subject: string; body: string } {
  const firstName = candidate.firstName?.trim() || candidate.name.replace(/^(dr|mr|ms|mrs)\.?\s+/i, "").split(/\s+/)[0]!;
  // An explicit area is written as-is; only the industry fallback is lowercased
  // ("Behavioral health" reads as "in behavioral health"; acronyms such as "HVAC" stay).
  const fallback = candidate.industry.trim().replace(/\.$/, "");
  const area = candidate.area?.trim() || (/^\p{Lu}\p{Ll}/u.test(fallback) ? fallback[0]!.toLowerCase() + fallback.slice(1) : fallback);
  // "your work leading X" reads better than "your work in leading X".
  const work = /^\p{Ll}+ing\b/u.test(area) ? `your work ${area}` : `your work in ${area}`;
  const values: Record<string, string> = { shortOpener: shortJarvisOpener(candidate), firstName, name: candidate.name, company: candidate.company, role: candidate.role, area, work, opener: candidate.opener || `I came across ${work}.` };
  const fill = (value: string) => value.replace(PLACEHOLDER, (_, key: string) => values[key] ?? "");
  return { subject: unbrandedOutreachText(fill(template.subject)), body: unbrandedOutreachText(fill(template.body)) };
}

/**
 * Re-renders every draft that is still exactly what the previous template
 * produced. Edited, approved or already-contacted drafts are Bruce's and stay.
 */
export function setJarvisTemplate(value: unknown, dryRun = false, regenerateUnsent = false): { updated: number; kept: number; sample?: { name: string; subject: string; body: string } } {
  const next = parseJarvisTemplate(value);
  assertCurrentOutreachCopy(next.subject, next.body);
  const plan = (state: JarvisState) => {
    const previous = state.template ?? DEFAULT_JARVIS_TEMPLATE;
    const regenerable = state.leads.filter((lead) => {
      if (regenerateUnsent) return ["new", "ready"].includes(lead.status) && !lead.sentAt && !lead.repliedAt && !hasJarvisSocialOutreach(lead) && !lead.sendAttempt;
      const old = jarvisDraft(lead, previous);
      return isResearchedTargetUser(lead) && !lead.reviewed && lead.status === "new" && !lead.queuedAt && !lead.sendAttempt && !lead.sentAt && lead.subject === old.subject && lead.body === old.body;
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
    for (const lead of regenerable) {
      Object.assign(lead, jarvisDraft(lead, next), { updatedAt: at, revision: (lead.revision ?? 0) + 1 });
      if (regenerateUnsent) {
        lead.reviewed = false;
        delete lead.queuedAt;
        delete lead.outreachApproval;
        delete lead.outreachPlans;
        delete lead.outreachWorkflow;
        for (const platform of JARVIS_SOCIAL_PLATFORMS) {
          const social = lead.socialOutreach?.[platform];
          if (social && !social.sentAt && !social.repliedAt) social.draft = "";
        }
        if (lead.status === "ready") lead.status = "new";
      }
    }
    state.template = next;
    return { updated: regenerable.length, kept, sample };
  });
}
/** Saving a channel template never edits approved, customized or sent messages. */
export function setJarvisSocialTemplate(platform: unknown, body: unknown): string {
  if (platform !== "instagram" && platform !== "linkedin") throw new Error("Choose Instagram or LinkedIn");
  const template = parseJarvisTemplate({ subject: "Social message", body: text(body, "body", 4000) });
  assertCurrentOutreachCopy(template.body);
  return change(state => {
    state.socialTemplates = { ...state.socialTemplates, [platform]: template.body };
    return template.body;
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
  const allowed = new Set(["status", "reviewed", "subject", "body", "notes", "confirmedNeeds", "email", "emailSource", "emailQuote", "socials", "industry", "role", "seniority", "segment", "needHypothesis", "area", "firstName", "personLocation", "personLocationSource", "companyLocation", "companyLocationSource", "timeZone", "followUp", "persona", "icpReview"]);
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
    if (patch.socials !== undefined) next.socials = socialUrls(patch.socials);
    if (patch.emailSource !== undefined) next.emailSource = webUrl(patch.emailSource, "emailSource", false);
    if (patch.emailQuote !== undefined) next.emailQuote = text(patch.emailQuote, "emailQuote", 2000, false);
    if (next.email && (!next.emailSource || !next.emailQuote.toLowerCase().includes(next.email))) throw new Error("An email needs its public source and exact address in the quote");
    const contactChanged = next.email !== lead.email || next.emailSource !== lead.emailSource || next.emailQuote !== lead.emailQuote;
    if (contactChanged) {
      next.emailCheck = next.email ? "unconfirmed" : "missing";
      next.reviewed = false;
    }
    if (patch.icpReview !== undefined) {
      if (lead.segment !== "info_exec") throw new Error("ICP review belongs to the current research cohort");
      const review = object(patch.icpReview);
      if (!["verified", "pending", "adjacent"].includes(String(review.verdict))) throw new Error("Invalid ICP review verdict");
      const reason = text(review.reason, "ICP review reason", 1000, review.verdict !== "pending");
      if (review.verdict === "verified" && (!next.profileUrl || !next.evidenceUrl || !jarvisContactMethods(next).length)) throw new Error("Verify the role, evidence and contact route before approving outreach");
      next.icpReview = { verdict: review.verdict as "verified" | "pending" | "adjacent", reason, at: now() };
      next.reviewed = false;
    }
    if (next.subject !== lead.subject || next.body !== lead.body) next.reviewed = false;
    if (patch.reviewed !== undefined) {
      if (typeof patch.reviewed !== "boolean") throw new Error("Invalid reviewed flag");
      next.reviewed = patch.reviewed;
    }
    if (next.reviewed && !next.email) throw new Error("Add a sourced work email before approving");
    if (patch.reviewed === true && next.segment === "info_exec" && !isOutreachApprovedFor(next, "email")) throw new Error("Verify this ICP before approving its email");
    if (patch.status !== undefined) {
      if (!JARVIS_STATUSES.includes(patch.status as JarvisStatus)) throw new Error("Invalid status");
      next.status = patch.status as JarvisStatus;
      if (lead.status === "do_not_contact" && next.status !== lead.status) throw new Error("Do-not-contact cannot be reopened");
      if (["ready", "sent"].includes(next.status) && (!next.email || !next.reviewed || ["bounced", "declined"].includes(lead.status))) throw new Error("Review the contact and draft first; declined/bounced contacts are suppressed");
      if (next.status === "ready" && next.segment === "info_exec" && !isOutreachApprovedFor(next, "email")) throw new Error("Verify this ICP before approving its email");
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
      if (patch.followUp !== true || next.status !== "sent" || !isJarvisFollowUpDue(lead)) {
        throw new Error("A follow-up can be recorded only after the one-day wait for a sent contact without a recorded reply or prior follow-up");
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

/** Social messages are edited and logged here, never transmitted by this app. */
export function updateJarvisSocialOutreach(id: string, value: unknown): JarvisLead {
  const item = object(value);
  const platform = item.platform as JarvisSocialPlatform;
  if (!JARVIS_SOCIAL_PLATFORMS.includes(platform)) throw new Error("Unsupported social platform");
  if (!["save", "sent", "replied", "skip"].includes(String(item.op))) throw new Error("Invalid social action");
  if (item.op === "skip" && !["private", "wrong-account", "cannot-dm", "platform-limit"].includes(String(item.reason))) throw new Error("Choose a reason for skipping this profile");
  if (!Number.isSafeInteger(item.revision) || (item.revision as number) < 0) throw new Error("Contact revision required");
  const draft = item.op === "save" ? text(item.draft, "social draft", 4000) : undefined;
  if (draft) assertCurrentOutreachCopy(draft);
  return change((state) => {
    const lead = state.leads.find((entry) => entry.id === id);
    if (!lead || (lead.revision ?? 0) !== item.revision) throw new Error("Contact changed; refresh before editing social outreach");
    if (item.op === "sent" && platform === "linkedin" && isLinkedInConnectionPending(lead)) throw new Error("Wait for the LinkedIn connection to be accepted before messaging");
    const planned = hasApprovedChannelPlan(lead, platform);
    const canSkip = item.op === "skip" && lead.outreachWorkflow?.stage === "send" && canPlanChannel(lead, platform);
    const canDraft = canSkip || planned || (item.op === "save" ? isCurrentValidationProspect(lead) || isQualifiedInfoExec(lead) || isOutreachApprovedFor(lead, platform)
      : isOutreachApprovedFor(lead, platform) || isQualifiedInfoExec(lead));
    if (!lead.socials?.[platform] || !canDraft || ["declined", "bounced", "do_not_contact"].includes(lead.status)) throw new Error("A current target with a public social profile is required");
    if (item.op === "sent" && lead.segment === "info_exec" && !isOutreachApprovedFor(lead, platform) && !planned) throw new Error("Review this ICP before recording outreach");
    const previous = lead.socialOutreach?.[platform];
    if (item.op === "sent") assertCurrentOutreachCopy(previous?.draft ?? "");
    if (item.op === "sent" && (!previous?.draft || previous.sentAt || previous.skippedAt || lead.queuedAt || (!planned && (lead.sentAt || lead.sendAttempt || hasJarvisSocialOutreach(lead))))) throw new Error("Save the draft first; this person may already be contacted or queued");
    if (item.op === "replied" && (!previous?.sentAt || previous.repliedAt)) throw new Error("Record a sent message before a reply");
    if (item.op === "skip" && ((!canSkip && !previous?.draft) || previous?.sentAt)) throw new Error("Only an unsent prepared message can be skipped");
    const next = item.op === "save" ? { ...previous, draft: draft! }
      : item.op === "sent" ? { ...previous!, sentAt: now(), sentText: previous!.draft }
      : item.op === "skip" ? { ...previous, draft: previous?.draft ?? "", skippedAt: now(), skipReason: item.reason as "private" | "wrong-account" | "cannot-dm" | "platform-limit" }
      : { ...previous!, repliedAt: now() };
    lead.socialOutreach = { ...lead.socialOutreach, [platform]: next };
    if (item.op === "save" && draft !== previous?.draft && lead.outreachApproval?.channel === platform) delete lead.outreachApproval;
    lead.updatedAt = now();
    lead.revision = (lead.revision ?? 0) + 1;
    return lead;
  }, { id, op: `${platform}:${item.op}` });
}

export function claimJarvisSend(id: string, expectedRevision: number, senderEmail?: string): { attemptId: string; email: string; subject: string; body: string } {
  return change((state) => {
    const lead = state.leads.find((item) => item.id === id);
    if (!lead || (lead.revision ?? 0) !== expectedRevision || (lead.segment === "info_exec" && !isOutreachApprovedFor(lead, "email") && !hasApprovedChannelPlan(lead, "email")) || (hasJarvisSocialOutreach(lead) && !hasApprovedChannelPlan(lead, "email")) || lead.sendAttempt || lead.status !== "ready" || !lead.reviewed || !lead.email || !lead.emailSource || !lead.emailQuote.toLowerCase().includes(lead.email)) {
      throw new Error("Contact changed, was already sent, or is not approved. Refresh and review before sending.");
    }
    assertCurrentOutreachCopy(lead.subject, lead.body);
    const attemptId = randomUUID();
    const at = now();
    lead.sendAttempt = { id: attemptId, at, state: "pending", ...(senderEmail ? { senderEmail } : {}) };
    state.outbox = { ...readJarvisOutbox(state), lastSendAt: at };
    lead.updatedAt = at;
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

type LeasedRun = { status: "running" | "done" | "error" | "cancelled"; ownerId?: string; heartbeatAt?: string };
function assertLeaseAvailable(current: LeasedRun | null | undefined, staleBeforeMs: number, label: string): void {
  const heartbeatMs = current?.heartbeatAt ? Date.parse(current.heartbeatAt) : Number.NaN;
  if (current?.status === "running" && current.ownerId && Number.isFinite(heartbeatMs) && heartbeatMs > staleBeforeMs) {
    throw new Error(`${label} is already running or stopping`);
  }
}
function renewLease(current: (LeasedRun & { id: string }) | null | undefined, id: string, ownerId: string, at: string): boolean {
  if (current?.id !== id || current.status !== "running" || current.ownerId !== ownerId) return false;
  current.heartbeatAt = at;
  return true;
}

export function writeJarvisRescore(run: JarvisRescoreRun): void { change((state) => { state.rescore = run; }); }
export function claimJarvisRescore(run: JarvisRescoreRun, staleBeforeMs: number): void {
  change((state) => { assertLeaseAvailable(state.rescore, staleBeforeMs, "Rescoring"); state.rescore = run; });
}
export function heartbeatJarvisRescore(id: string, ownerId: string, at = now()): boolean {
  return change((state) => renewLease(state.rescore, id, ownerId, at));
}
export function cancelJarvisRescore(at = now()): string | null {
  return change((state) => {
    if (state.rescore?.status !== "running") return null;
    const id = state.rescore.id;
    Object.assign(state.rescore, { status: "cancelled", message: "Stopped. Saved assessments are kept.", finishedAt: at });
    return id;
  });
}
export function patchJarvisRescore(id: string, patch: Partial<Pick<JarvisRescoreRun, "status" | "assessed" | "message" | "finishedAt">>): void {
  change((state) => { if (state.rescore?.id === id && state.rescore.status === "running") Object.assign(state.rescore, patch); });
}
export function writeJarvisWebsiteRun(run: JarvisWebsiteRun): void { change((state) => { state.websiteRun = run; }); }
export function claimJarvisWebsiteRun(run: JarvisWebsiteRun, staleBeforeMs: number): void {
  change((state) => {
    assertLeaseAvailable(state.websiteRun, staleBeforeMs, "Website contact enrichment");
    for (const lead of state.leads) delete lead.websiteResearch;
    state.websiteRun = run;
  });
}
export function heartbeatJarvisWebsiteRun(id: string, ownerId: string, at = now()): boolean {
  return change((state) => renewLease(state.websiteRun, id, ownerId, at));
}
export function cancelJarvisWebsiteRun(at = now()): string | null {
  return change((state) => {
    if (state.websiteRun?.status !== "running") return null;
    const id = state.websiteRun.id;
    Object.assign(state.websiteRun, { status: "cancelled", activeWorkers: 0, message: "Stopped. Completed website checks are saved.", finishedAt: at });
    return id;
  });
}
export function patchJarvisWebsiteRun(id: string, patch: Partial<Pick<JarvisWebsiteRun, "status" | "checked" | "found" | "failed" | "activeWorkers" | "message" | "finishedAt">>): void {
  change((state) => { if (state.websiteRun?.id === id && state.websiteRun.status === "running") Object.assign(state.websiteRun, patch); });
}
export function saveJarvisWebsiteResearch(runId: string, leadId: string, research: JarvisWebsiteResearch): boolean {
  return change((state) => {
    if (state.websiteRun?.id !== runId || state.websiteRun.status !== "running") return false;
    const lead = state.leads.find((item) => item.id === leadId);
    if (!lead) return false;
    lead.websiteResearch = research;
    lead.updatedAt = now();
    lead.revision = (lead.revision ?? 0) + 1;
    return true;
  });
}
export function writeJarvisRun(run: JarvisRun): void { change((state) => { state.run = run; }); }
/** Atomically replaces only an expired research lease. */
export function claimJarvisRun(run: JarvisRun, staleBeforeMs: number): void {
  change((state) => {
    assertLeaseAvailable(state.run, staleBeforeMs, "Discovery");
    state.run = run;
  });
}
/** Renews the lease only while the same runtime still owns the active run. */
export function heartbeatJarvisRun(id: string, ownerId: string, at = now()): boolean {
  return change((state) => renewLease(state.run, id, ownerId, at));
}
/** Persist cancellation even when the HTTP request lands in a non-owner process. */
export function cancelJarvisRun(at = now()): string | null {
  return change((state) => {
    if (state.run?.status !== "running") return null;
    const id = state.run.id;
    Object.assign(state.run, { status: "cancelled", message: "Stopped. Completed batches are saved.", finishedAt: at });
    return id;
  });
}
export function patchJarvisRun(id: string, patch: Partial<Pick<JarvisRun, "status" | "batches" | "pipeline" | "message" | "finishedAt" | "lastError">>): void {
  change((state) => { if (state.run?.id === id && state.run.status === "running") Object.assign(state.run, patch); });
}

/**
 * Rescoring writes only persona and newsBurden. "none" means the person fits
 * none of the current personas: their score is kept, the persona cleared.
 */
export function applyJarvisAssessment(id: string, value: unknown, runId?: string): boolean {
  const item = object(value);
  const burden = newsBurden(item.newsBurden);
  if (item.persona !== "none" && !JARVIS_TARGET_PERSONAS.includes(item.persona as typeof JARVIS_TARGET_PERSONAS[number])) throw new Error("Invalid persona");
  const watchList = item.persona === "none" ? "" : text(item.watchList, "watchList", 400);
  return change((state) => {
    if (runId && (state.rescore?.id !== runId || state.rescore.status !== "running")) return false;
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
        : lead.segment === "info_exec" && !isOutreachApprovedFor(lead, "email") ? "Outreach needs human verification before sending"
        : lead.segment === "info_exec" && (!lead.reviewed || lead.status !== "ready") ? "Review the full batch in Cold Reach before queueing"
        : hasJarvisSocialOutreach(lead) ? "already contacted on social media"
        : !lead.email || lead.emailCheck !== "source_found" ? "no email confirmed on its source page"
        : "";
      if (reason || !lead) { skipped.push({ id, reason }); continue; }
      assertCurrentOutreachCopy(lead.subject, lead.body);
      const at = now();
      if (lead.status !== "ready") lead.history.push({ status: "ready", at });
      Object.assign(lead, { reviewed: true, status: "ready", queuedAt: lead.queuedAt ?? at, updatedAt: at, revision: (lead.revision ?? 0) + 1 });
      queued++;
    }
    return { queued, skipped };
  });
}

/** One confirmation writes an entire reviewed batch. Never partially queue a stale or invalid snapshot. */
export function prepareJarvisOutreachBatch(value: unknown, queueEmail = true): { prepared: number; channel: "email" | JarvisSocialPlatform } {
  const request = object(value);
  const channel = request.channel as "email" | JarvisSocialPlatform;
  if (channel !== "email" && !JARVIS_SOCIAL_PLATFORMS.includes(channel)) throw new Error("Choose email or a supported social platform");
  if (request.confirmed !== true || !Array.isArray(request.items) || request.items.length < 1) throw new Error("Confirm a non-empty batch of reviewed contacts");
  const items = request.items.map((raw) => object(raw));
  for (const item of items) {
    for (const key of channel === "email" ? ["subject", "body"] : ["draft"]) {
      if (typeof item[key] === "string" && unbrandedOutreachText(item[key]) !== item[key]) throw new Error("Remove the product name from outreach before approving");
    }
    assertCurrentOutreachCopy(...(channel === "email" ? [String(item.subject ?? ""), String(item.body ?? "")] : [String(item.draft ?? "")]));
  }
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("Duplicate contact in batch");
  return change((state) => {
    const prepared = items.map((item) => {
      const lead = state.leads.find((entry) => entry.id === item.id);
      if (!lead || !Number.isSafeInteger(item.revision) || (lead.revision ?? 0) !== item.revision) throw new Error("Contact changed; refresh the whole batch before approval");
      if (!queueEmail && !inReviewQueue(lead)) throw new Error("Add this person to Review queue first");
      if (item.identityChecked !== true || item.draftChecked !== true || !lead.profileUrl || !lead.evidenceUrl
        || !["new", "ready"].includes(lead.status) || lead.sentAt || lead.queuedAt || lead.sendAttempt || hasJarvisSocialOutreach(lead)) throw new Error(`${lead.name}: identity, draft or contact status needs review`);
      if (channel === "email") {
        if (!lead.email || lead.emailCheck !== "source_found" || !lead.emailSource || !lead.emailQuote.toLowerCase().includes(lead.email)
          || item.route !== lead.email || item.source !== lead.emailSource) throw new Error(`${lead.name}: work email or source changed`);
        const subject = text(item.subject, "subject", 300);
        if (/[\r\n]/.test(subject)) throw new Error("Email subject cannot contain a newline");
        return { lead, subject, body: text(item.body, "body", 12000) };
      }
      if (!lead.socials?.[channel] || item.route !== lead.socials[channel]) throw new Error(`${lead.name}: Social profile changed`);
      return { lead, draft: text(item.draft, "Social draft", 4000) };
    });
    const at = now();
    for (const item of prepared) {
      const lead = item.lead;
      lead.outreachWorkflow = { stage: "send", at };
      lead.outreachPlans = { ...lead.outreachPlans, [channel]: { route: channel === "email" ? lead.email : lead.socials![channel]!, subject: item.subject, body: item.body ?? item.draft!, approvedAt: at } };
      lead.outreachApproval = { channel, route: channel === "email" ? lead.email : lead.socials![channel]!, at };
      if ("subject" in item && item.subject !== undefined && item.body !== undefined) {
        lead.subject = item.subject;
        lead.body = item.body;
        lead.reviewed = true;
        if (lead.status !== "ready") lead.history.push({ status: "ready", at });
        lead.status = "ready";
        if (queueEmail) lead.queuedAt = at;
      } else {
        const previous = { ...lead.socialOutreach?.[channel as JarvisSocialPlatform] };
        delete previous.skippedAt;
        delete previous.skipReason;
        lead.socialOutreach = { ...lead.socialOutreach, [channel]: { ...previous, draft: item.draft } };
      }
      lead.updatedAt = at;
      lead.revision = (lead.revision ?? 0) + 1;
    }
    return { prepared: prepared.length, channel };
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

export const DEFAULT_JARVIS_FOLLOW_UP = "Hi {{firstName}},\n\nQuick follow-up on the personal intelligence filter I shared. The idea is a short daily brief shaped by your goals and projects—not a generic news digest—with only relevant developments and opportunities, why they matter, the source, and the next step. Depending on the person, that can include policy, operations, market, customer, competitor, or funding changes.\n\nIt learns from your feedback and only uses private sources you explicitly choose to connect.\n\nhttps://your-secretary.com\n\nHow do you handle this today? If it isn't relevant, just let me know and I won't follow up again.\n\nBest,\nBruce";

export function setJarvisFollowUpTemplate(value: unknown): string {
  const parsed = parseJarvisTemplate({ subject: "Follow-up", body: value });
  if (unbrandedOutreachText(parsed.body) !== parsed.body) throw new Error("Remove the product name from outreach");
  assertCurrentOutreachCopy(parsed.body);
  return change((state) => { state.followUpTemplate = parsed.body; return parsed.body; });
}

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
      if (!Number.isInteger(item.count) || (item.count as number) < 1 || (item.count as number) > 100) throw new Error("count must be 1–100");
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

export function claimJarvisDeliveryLease(ownerId: string, staleBeforeMs: number, at = now()): boolean {
  return change((state) => {
    const stored = state as JarvisState & { outboxLease?: { ownerId: string; heartbeatAt: string } };
    const current = state.deliveryLease ?? stored.outboxLease;
    const heartbeatMs = current?.heartbeatAt ? Date.parse(current.heartbeatAt) : Number.NaN;
    if (current && Number.isFinite(heartbeatMs) && heartbeatMs > staleBeforeMs) return false;
    state.deliveryLease = { ownerId, heartbeatAt: at };
    delete stored.outboxLease;
    return true;
  });
}
export function heartbeatJarvisDeliveryLease(ownerId: string, at = now()): boolean {
  return change((state) => {
    if (state.deliveryLease?.ownerId !== ownerId) return false;
    state.deliveryLease.heartbeatAt = at;
    return true;
  });
}
export function releaseJarvisDeliveryLease(ownerId: string): boolean {
  return change((state) => {
    if (state.deliveryLease?.ownerId !== ownerId) return false;
    delete state.deliveryLease;
    return true;
  });
}

/** Claims the oldest queued contact for the outbox, exactly like a manual send claim. */
export function claimQueuedJarvisSend(eligible: (lead: JarvisLead) => boolean = () => true, senderEmail?: string, at = now()): { id: string; attemptId: string; email: string; subject: string; body: string } | null {
  return change((state) => {
    const lead = state.leads.filter((entry) => entry.queuedAt && entry.status === "ready" && entry.reviewed && (entry.segment !== "info_exec" || isOutreachApprovedFor(entry, "email")) && !hasJarvisSocialOutreach(entry) && !entry.sendAttempt && entry.email && entry.emailCheck === "source_found" && eligible(entry))
      .sort((a, b) => a.queuedAt!.localeCompare(b.queuedAt!))[0];
    if (!lead) return null;
    assertCurrentOutreachCopy(lead.subject, lead.body);
    const attemptId = randomUUID();
    lead.sendAttempt = { id: attemptId, at, state: "pending", ...(senderEmail ? { senderEmail } : {}) };
    state.outbox = { ...readJarvisOutbox(state), lastSendAt: at };
    lead.updatedAt = at;
    lead.revision = (lead.revision ?? 0) + 1;
    return { id: lead.id, attemptId, email: lead.email, subject: lead.subject, body: lead.body };
  });
}

/** The one automatic follow-up, rendered from the follow-up template and claimed before sending. */
export function claimJarvisFollowUp(at: number = Date.now(), eligible: (lead: JarvisLead) => boolean = () => true): { id: string; attemptId: string; email: string; subject: string; body: string; threadId: string; messageId: string } | null {
  return change((state) => {
    const lead = state.leads.find((entry) => eligible(entry) && isJarvisFollowUpDue(entry, at) && entry.sendAttempt?.state === "sent" && entry.sendAttempt.threadId && entry.sendAttempt.messageId && entry.syncedAt && Date.parse(entry.syncedAt) > at - 60 * 60 * 1000);
    if (!lead) return null;
    const { body } = jarvisDraft(lead, { subject: lead.subject, body: state.followUpTemplate ?? DEFAULT_JARVIS_FOLLOW_UP });
    assertCurrentOutreachCopy(body);
    const attemptId = randomUUID();
    const claimedAt = new Date(at).toISOString();
    lead.followUpAttempt = { id: attemptId, at: claimedAt, state: "pending" };
    state.outbox = { ...readJarvisOutbox(state), lastSendAt: claimedAt };
    lead.updatedAt = claimedAt;
    lead.revision = (lead.revision ?? 0) + 1;
    return { id: lead.id, attemptId, email: lead.email, subject: unbrandedOutreachText(lead.subject.startsWith("Re:") ? lead.subject : `Re: ${lead.subject}`), body, threadId: lead.sendAttempt!.threadId!, messageId: lead.sendAttempt!.messageId! };
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

/** Selection is persistent and independent of delivery channel. Never sends. */
export function updateOutreachReviewQueue(value: unknown): { added: number; skipped: number } {
  const request = object(value);
  if (!Array.isArray(request.ids) || !request.ids.length || request.ids.some((id) => typeof id !== "string")) throw new Error("Select contacts first");
  if (request.op !== "add" && request.op !== "remove" && request.op !== "reopen") throw new Error("Unknown review queue action");
  const ids = request.ids as string[];
  return change((state) => {
    let added = 0, skipped = 0;
    for (const id of new Set(ids)) {
      const lead = state.leads.find((lead) => lead.id === id);
      if (!lead || !canReviewOutreach(lead)) { skipped++; continue; }
      if (request.op === "remove") {
        delete lead.outreachWorkflow;
      } else {
        if (request.op === "add" && lead.outreachWorkflow) { skipped++; continue; }
        lead.outreachWorkflow = { stage: "review", at: now() };
        delete lead.outreachApproval;
        lead.reviewed = false;
        added++;
      }
      lead.revision = (lead.revision ?? 0) + 1;
    }
    return { added, skipped };
  });
}

/** Additional channels require their own reviewed route and exact copy. */
export function planOutreachChannel(value: unknown): void {
  const request = object(value);
  const channel = request.channel as "email" | JarvisSocialPlatform;
  if (channel !== "email" && !JARVIS_SOCIAL_PLATFORMS.includes(channel)) throw new Error("Unsupported channel");
  if (request.confirmed !== true) throw new Error("Review this channel and message first");
  const body = text(request.body, "body", channel === "email" ? 12000 : 4000);
  const subject = channel === "email" ? text(request.subject, "subject", 300) : undefined;
  if (subject && /[\r\n]/.test(subject)) throw new Error("Invalid subject");
  if (unbrandedOutreachText(body) !== body || (subject && unbrandedOutreachText(subject) !== subject)) throw new Error("Remove the product name from outreach");
  assertCurrentOutreachCopy(...(subject ? [subject, body] : [body]));
  change((state) => {
    const lead = state.leads.find((lead) => lead.id === request.id);
    if (!lead || !Number.isSafeInteger(request.revision) || (lead.revision ?? 0) !== request.revision) throw new Error("Contact changed; refresh and review again");
    if (lead.outreachWorkflow?.stage !== "send" || !canPlanChannel(lead, channel)) throw new Error("Review this contact first or choose an unsent available channel");
    const route = channel === "email" ? lead.email : lead.socials![channel]!;
    if (request.route !== route) throw new Error("Contact route changed");
    if (channel === "email" && (!lead.emailQuote.toLowerCase().includes(lead.email) || request.source !== lead.emailSource)) throw new Error("Verify the email source first");
    const at = now();
    const previous = lead.outreachApproval;
    if (previous && !lead.outreachPlans?.[previous.channel] && canPlanChannel(lead, previous.channel)
      && previous.route === (previous.channel === "email" ? lead.email : lead.socials?.[previous.channel])
      && (previous.channel !== "email" || lead.reviewed)) {
      const previousBody = previous.channel === "email" ? lead.body : lead.socialOutreach?.[previous.channel]?.draft;
      if (previousBody) lead.outreachPlans = { ...lead.outreachPlans, [previous.channel]: { route: previous.route, subject: previous.channel === "email" ? lead.subject : undefined, body: previousBody, approvedAt: previous.at } };
    }
    lead.outreachPlans = { ...lead.outreachPlans, [channel]: { route, subject, body, approvedAt: at } };
    lead.outreachApproval = { channel, route, at };
    if (channel === "email") { lead.subject = subject!; lead.body = body; lead.reviewed = true; if (lead.status !== "ready") lead.history.push({ status: "ready", at }); lead.status = "ready"; }
    else lead.socialOutreach = { ...lead.socialOutreach, [channel]: { draft: body } };
    lead.updatedAt = at;
    lead.revision = (lead.revision ?? 0) + 1;
  }, { id: String(request.id), op: `${channel}:approve` });
}

/** The user sends invitations and checks acceptance on LinkedIn; this only logs those actions. */
export function updateLinkedInConnection(id: string, value: unknown): JarvisLead {
  const request = object(value);
  if (!["requested", "accepted"].includes(String(request.op))) throw new Error("Invalid connection action");
  return change((state) => {
    const lead = state.leads.find((entry) => entry.id === id);
    if (!lead || !Number.isSafeInteger(request.revision) || (lead.revision ?? 0) !== request.revision) throw new Error("Contact changed; refresh and try again");
    const route = lead.socials?.linkedin;
    if (!route || request.route !== route || lead.outreachWorkflow?.stage !== "send") throw new Error("Review this contact and its LinkedIn profile first");
    if (request.op === "requested") {
      if (!canPlanChannel(lead, "linkedin") || lead.linkedinConnection?.route === route) throw new Error("Connection already recorded or contact unavailable");
      lead.linkedinConnection = { route, requestedAt: now() };
    } else {
      if (!lead.linkedinConnection || lead.linkedinConnection.route !== route || lead.linkedinConnection.acceptedAt) throw new Error("No pending connection for this profile");
      lead.linkedinConnection.acceptedAt = now();
      const social = lead.socialOutreach?.linkedin;
      if (social) { delete social.skippedAt; delete social.skipReason; }
    }
    lead.updatedAt = now();
    lead.revision = (lead.revision ?? 0) + 1;
    return lead;
  }, { id, op: `connect:${request.op}` });
}

/** Undo the latest reversible outreach record, never a later edit or real email send. */
export function revertOutreachChange(value: unknown): JarvisLead {
  const request = object(value);
  return change(state => {
    const undo = state.outreachUndo;
    if (!undo || undo.leadId !== request.id || undo.revision !== request.revision) throw new Error("The latest outreach change has changed; refresh and try again");
    const lead = state.leads.find(entry => entry.id === undo.leadId);
    if (!lead || (lead.revision ?? 0) !== undo.revision) throw new Error("This contact has changed since that action; reverting would overwrite newer work");
    if (lead.sendAttempt?.state === "pending" || lead.sendAttempt?.state === "uncertain" || lead.sentAt !== undo.before.sentAt) throw new Error("An email send cannot be reverted");
    const restored = structuredClone(undo.before);
    restored.revision = (lead.revision ?? 0) + 1;
    restored.updatedAt = now();
    state.leads[state.leads.indexOf(lead)] = restored;
    delete state.outreachUndo;
    return restored;
  });
}

/** Result of the public-page email verifier; route edits invalidate this check. */
export function recordJarvisEmailSourceCheck(id: string, revision: number, address: string, found: boolean): void {
  change(state => {
    const lead = state.leads.find(l => l.id === id);
    if (!lead || (lead.revision ?? 0) !== revision || lead.email !== address) throw new Error("Email changed during source verification");
    lead.emailCheck = found ? "source_found" : lead.email ? "unconfirmed" : "missing";
    lead.revision = (lead.revision ?? 0) + 1;
    lead.updatedAt = now();
  });
}
