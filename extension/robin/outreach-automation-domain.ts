import { randomUUID } from "node:crypto";
import { readJsonObject, updateJsonObject } from "./paths.ts";
import { readJarvis, updateJarvisSocialOutreach } from "./jarvis-domain.ts";
import { assertCurrentOutreachCopy, hasApprovedChannelPlan, hasSentOutreach } from "./outreach-shape.ts";
import { isCurrentValidationProspect, type JarvisLead } from "./jarvis-shape.ts";

const FILE = "outreach-automation.json";
export const DAILY_CONTACT_TARGET = 100;
export const isHealthcareLead = (lead: JarvisLead) => lead.segment === "clinic" || lead.persona === "healthcare_operator";
export type ContactCheck = {
  instagram: "personal" | "brand" | "missing" | "blocked";
  instagramUrl?: string;
  sourceUrl: string;
  note: string;
  emailSearched: boolean;
  checkedAt: string;
};
type Attempt = { id: string; leadId: string; channel: "instagram" | "email"; route: string; body: string; at: string; state: "pending" | "sent" | "uncertain" | "blocked"; evidence?: string };
export type AutomationRunnerActivity = {
  id: string;
  command: string;
  startedAt: string;
  finishedAt?: string;
  outcome: "running" | "succeeded" | "failed";
  detail?: string;
};
type AutomationState = { checks: Record<string, ContactCheck>; attempts: Attempt[]; runner?: AutomationRunnerActivity };
export const readOutreachAutomation = (): AutomationState => readJsonObject<AutomationState>(FILE) ?? { checks: {}, attempts: [] };
const day = (at: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
export function contactedToday(leads: JarvisLead[], at = new Date().toISOString()): number {
  return leads.filter(l => [l.sentAt, ...Object.values(l.socialOutreach ?? {}).map(s => s?.sentAt)].some(t => t && day(t) === day(at))).length;
}
const normalizedRoute = (route: string) => route.toLowerCase().replace(/\/$/, "");
function confirmedAttemptState(attempt: Attempt, lead: JarvisLead): "sent" | "blocked" | null {
  if (attempt.channel === "email" && normalizedRoute(lead.email) === normalizedRoute(attempt.route)
    && lead.sentAt && lead.sendAttempt?.state === "sent" && lead.sendAttempt.messageId) return "sent";
  if (attempt.channel === "instagram" && normalizedRoute(lead.socials?.instagram ?? "") === normalizedRoute(attempt.route)) {
    if (lead.socialOutreach?.instagram?.sentAt && lead.socialOutreach.instagram.sentText === attempt.body) return "sent";
    if (lead.socialOutreach?.instagram?.skippedAt && lead.socialOutreach.instagram.skipReason === "cannot-dm") return "blocked";
  }
  return null;
}
/** Persist what the external CLI runner actually did; this is activity evidence, not a promise of a future wake. */
export function beginAutomationRunner(command: string, at = new Date().toISOString()): AutomationRunnerActivity {
  if (!command.trim() || !Number.isFinite(Date.parse(at))) throw new Error("Runner command and timestamp are required");
  return updateJsonObject<AutomationState, AutomationRunnerActivity>(FILE, current => {
    const state = current ?? { checks: {}, attempts: [] };
    const runner: AutomationRunnerActivity = { id: randomUUID(), command, startedAt: at, outcome: "running" };
    state.runner = runner;
    return { value: state, result: runner, changed: true };
  });
}
export function finishAutomationRunner(id: string, outcome: "succeeded" | "failed", detail = "", at = new Date().toISOString()): void {
  updateJsonObject<AutomationState, void>(FILE, current => {
    const state = current ?? { checks: {}, attempts: [] };
    if (state.runner?.id !== id) return { value: state, result: undefined, changed: false };
    state.runner = { ...state.runner, outcome, finishedAt: at, ...(detail.trim() ? { detail: detail.trim().slice(0, 500) } : {}) };
    return { value: state, result: undefined, changed: true };
  });
}
/**
 * Repair the safe half of a cross-file interruption: CRM delivery evidence is
 * monotonic, so it may advance a pending ledger entry. The reverse direction
 * is never inferred because a ledger claim is not proof of external delivery.
 */
export function reconcileAutomationAttempts(): { sent: number; blocked: number } {
  const crm = readJarvis();
  return updateJsonObject<AutomationState, { sent: number; blocked: number }>(FILE, current => {
    const state = current ?? { checks: {}, attempts: [] };
    let sent = 0;
    let blocked = 0;
    for (const attempt of state.attempts) {
      if (!['pending', 'uncertain'].includes(attempt.state)) continue;
      const lead = crm.leads.find(item => item.id === attempt.leadId);
      if (!lead) continue;
      const confirmed = confirmedAttemptState(attempt, lead);
      if (confirmed === "sent") {
        attempt.state = 'sent';
        attempt.evidence = attempt.evidence || (attempt.channel === "email"
          ? `Recovered from CRM-confirmed Gmail message ${lead.sendAttempt!.messageId}`
          : "Recovered from CRM-confirmed Instagram history");
        sent++;
      } else if (confirmed === "blocked") {
        attempt.state = 'blocked';
        attempt.evidence = attempt.evidence || 'Recovered from CRM cannot-DM history';
        blocked++;
      }
    }
    return { value: state, result: { sent, blocked }, changed: sent + blocked > 0 };
  });
}
export function automationRoute(lead: JarvisLead, check?: ContactCheck): "instagram" | "email" | "linkedin" | "research" | "skip" {
  if (hasSentOutreach(lead) || !["new", "ready"].includes(lead.status) || lead.repliedAt || lead.sendAttempt || lead.queuedAt || Object.values(lead.socialOutreach ?? {}).some(s => s?.repliedAt)) return "skip";
  if (!isCurrentValidationProspect(lead)) return "skip";
  if (/association|chamber of commerce|federation\b|society\b|trade group/i.test(lead.company)) return "skip";
  const email = lead.email && lead.emailCheck === "source_found" && lead.emailSource && lead.emailQuote.toLowerCase().includes(lead.email.toLowerCase());
  if (lead.persona !== "healthcare_operator" && check?.instagram === "personal" && check.instagramUrl === lead.socials?.instagram && !lead.socialOutreach?.instagram?.skippedAt) return "instagram";
  if (email) return "email";
  return "research";
}
export function recordContactCheck(id: string, check: ContactCheck): void {
  const lead = readJarvis().leads.find(l => l.id === id);
  if (!lead || !["personal", "brand", "missing", "blocked"].includes(check.instagram) || typeof check.emailSearched !== "boolean" || !check.note?.trim()) throw new Error("Invalid contact check");
  if (!/^https?:\/\//.test(check.sourceUrl) || !Number.isFinite(Date.parse(check.checkedAt))) throw new Error("Check needs a public source and timestamp");
  if (check.instagram === "personal" && (!check.instagramUrl || check.instagramUrl !== lead.socials?.instagram)) throw new Error("Personal profile must match the saved route");
  updateJsonObject<AutomationState, void>(FILE, current => { const state = current ?? { checks: {}, attempts: [] }; state.checks[id] = check; return { value: state, result: undefined, changed: true }; });
}
export function claimAutomatedOutreach(id: string, channel: "instagram" | "email"): Attempt {
  return updateJsonObject<AutomationState, Attempt>(FILE, current => {
    const state = current ?? { checks: {}, attempts: [] };
    const crm = readJarvis();
    const lead = crm.leads.find(l => l.id === id);
    if (!lead || automationRoute(lead, state.checks[id]) !== channel || !hasApprovedChannelPlan(lead, channel)) throw new Error("Review current identity, route and full copy first");
    assertCurrentOutreachCopy(channel === "email" ? lead.subject : "", channel === "email" ? lead.body : lead.socialOutreach?.instagram?.draft ?? "");
    if (state.attempts.some(a => a.leadId === id && a.state !== "blocked")) throw new Error("Previous attempt exists; reconcile it instead of sending again");
    const route = channel === "email" ? lead.email : lead.socials!.instagram!;
    if (state.attempts.some(a => a.route.toLowerCase().replace(/\/$/, "") === route.toLowerCase().replace(/\/$/, ""))) throw new Error("This route already has an outreach attempt");
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (crm.leads.some(other => other.id !== id && (hasSentOutreach(other) || other.sendAttempt)
      && ((normalize(other.name) === normalize(lead.name) && normalize(other.company) === normalize(lead.company))
        || (channel === "email" ? other.email === route : other.socials?.instagram === route)))) throw new Error("Another record for this person or route was already contacted");
    const now = new Date().toISOString();
    const attempt: Attempt = { id: randomUUID(), leadId: id, channel, route, body: channel === "email" ? lead.body : lead.socialOutreach!.instagram!.draft, at: now, state: "pending" };
    state.attempts.push(attempt);
    return { value: state, result: attempt, changed: true };
  });
}

/** A delivery-busy response is issued before Gmail is called, so this reservation may be retried safely. */
export function releaseUnstartedAutomatedEmailAttempt(attemptId: string): void {
  updateJsonObject<AutomationState, void>(FILE, current => {
    const state = current ?? { checks: {}, attempts: [] };
    const index = state.attempts.findIndex(attempt => attempt.id === attemptId);
    const attempt = state.attempts[index];
    if (!attempt || attempt.channel !== "email" || attempt.state !== "pending") throw new Error("Only an unstarted pending email attempt can be released");
    state.attempts.splice(index, 1);
    return { value: state, result: undefined, changed: true };
  });
}
export function finishAutomatedOutreach(attemptId: string, evidence: string, sent: boolean, blocked = false): void {
  const attempt = readOutreachAutomation().attempts.find(a => a.id === attemptId);
  if (!attempt || !evidence.trim()) throw new Error("Attempt and observed result are required");
  // Instagram can surface a delayed rejection after briefly rendering the
  // message with normal actions. Allow an observed cannot-DM result to
  // correct that provisional success after the CRM social change is reverted.
  if (attempt.state === "sent" && !(blocked && !sent && attempt.channel === "instagram")) return;
  if (blocked && !sent && attempt.channel === "instagram") {
    const lead = readJarvis().leads.find(l => l.id === attempt.leadId);
    if (lead && !lead.socialOutreach?.instagram?.sentAt) updateJarvisSocialOutreach(lead.id, { op: "skip", platform: "instagram", reason: "cannot-dm", revision: lead.revision ?? 0 });
  }
  if (sent) {
    const lead = readJarvis().leads.find(l => l.id === attempt.leadId);
    if (!lead) throw new Error("Contact disappeared");
    if (attempt.channel === "instagram" && !lead.socialOutreach?.instagram?.sentAt) {
      if (lead.socials?.instagram !== attempt.route || lead.socialOutreach?.instagram?.draft !== attempt.body) throw new Error("Route or draft changed; reconcile manually");
      updateJarvisSocialOutreach(lead.id, { op: "sent", platform: "instagram", revision: lead.revision ?? 0 });
    } else if (attempt.channel === "email" && !lead.sentAt) throw new Error("Robin has not confirmed email delivery");
  }
  updateJsonObject<AutomationState, void>(FILE, current => {
    const state = current ?? { checks: {}, attempts: [] };
    const item = state.attempts.find(a => a.id === attemptId);
    if (!item) throw new Error("Attempt disappeared while recording its result");
    const correction = blocked && !sent && item.channel === "instagram";
    if (item.state === "sent" && !correction) return { value: state, result: undefined, changed: false };
    if (item.state === "blocked") return { value: state, result: undefined, changed: false };
    if (sent || blocked) {
      const lead = readJarvis().leads.find(candidate => candidate.id === item.leadId);
      const confirmed = lead ? confirmedAttemptState(item, lead) : null;
      if (confirmed !== (sent ? "sent" : "blocked")) throw new Error("CRM evidence changed while recording the delivery result");
    }
    item.state = sent ? "sent" : blocked ? "blocked" : "uncertain"; item.evidence = evidence;
    if (blocked && item.channel === "instagram" && state.checks[item.leadId]) state.checks[item.leadId] = { ...state.checks[item.leadId]!, instagram: "blocked", note: evidence };
    return { value: state, result: undefined, changed: true };
  });
}
