/** Browser-safe vocabulary for the single Jarvis discovery campaign. */
export const CORE_JARVIS_SEGMENTS = ["info_exec", "clinic", "professional_services", "nontech_exec", "small_tech"] as const;
/** The first four cohorts share the original balanced 100-contact campaign; info_exec is researched on its own. */
export const BALANCED_JARVIS_QUOTA = { clinic: 30, professional_services: 25, nontech_exec: 30, small_tech: 15 } as const;
export const LEGACY_JARVIS_SEGMENTS = ["founder", "investor", "product", "research"] as const;
export const JARVIS_SEGMENTS = [...CORE_JARVIS_SEGMENTS, ...LEGACY_JARVIS_SEGMENTS] as const;
export const JARVIS_STATUSES = ["new", "ready", "sent", "replied", "interested", "declined", "bounced", "do_not_contact"] as const;
export type CoreJarvisSegment = typeof CORE_JARVIS_SEGMENTS[number];
export type JarvisSegment = typeof JARVIS_SEGMENTS[number];
export type JarvisStatus = typeof JARVIS_STATUSES[number];
export interface JarvisCandidate {
  name: string;
  company: string;
  role: string;
  seniority: string;
  industry: string;
  /** Workplace location, not a private/home address. Empty when unsupported. */
  personLocation?: string;
  personLocationSource?: string;
  /** Company HQ or office as labelled in the source; never substituted for personLocation. */
  companyLocation?: string;
  companyLocationSource?: string;
  /** IANA zone for the person's work location, never a fixed UTC offset. */
  timeZone?: string;
  segment: JarvisSegment;
  profileUrl: string;
  evidence: string;
  evidenceUrl: string;
  needHypothesis: string;
  email: string;
  emailSource: string;
  emailQuote: string;
  opener: string;
  /** Completes "I came across your work in ___"; drafts fall back to industry when empty. */
  area?: string;
  /** Greeting override, e.g. "Mike" for T. Michael Ward; defaults to the first word of name. */
  firstName?: string;
  /** Required for info_exec: why this person has to keep up with a lot of news. */
  newsBurden?: JarvisNewsBurden;
  /** Required for info_exec: which of the five user personas they represent. */
  persona?: JarvisPersona;
  /** The concrete list a target user must track; required for a persona under rubric v2. */
  watchList?: string;
  /** Where research first found this person: the named list, article or page. */
  foundVia?: { source: string; url: string };
}
/**
 * The five Jarvis user personas, in priority order. Each is someone who keeps
 * an explicit watch list (a portfolio, clients, competitors, a research agenda)
 * and pays for missing a development on it. Quotas split the 100 info_exec target.
 */
export const JARVIS_PERSONAS = ["vc", "client_advisor", "startup_leader", "nontech_tech_leader", "researcher"] as const;
export type JarvisPersona = typeof JARVIS_PERSONAS[number];
/**
 * Executives only since rubric v2: "researcher" stays a known value so older
 * assessments still parse and render, but it is no longer researched or counted.
 */
export const JARVIS_TARGET_PERSONAS = ["vc", "client_advisor", "startup_leader", "nontech_tech_leader"] as const satisfies readonly JarvisPersona[];
export const JARVIS_PERSONA_QUOTA: Record<JarvisPersona, number> = { vc: 35, client_advisor: 25, startup_leader: 25, nontech_tech_leader: 15, researcher: 0 };
/**
 * Bumped when the persona rules change; contacts assessed under an older
 * version are rescored and do not count until they are.
 * v2: executives only, ≤500 people, a named watch list, fast-moving fields, strict anchors, 9/12.
 */
export const JARVIS_RUBRIC_VERSION = 2;
/** Where each persona leaves public evidence of what it watches: sent to research verbatim and shown on the page. */
export const JARVIS_PERSONA_PLAYBOOK: Record<JarvisPersona, string> = {
  vc: "Persona vc. Search small and midsize venture firm team pages with published portfolios and theses, emerging-manager and solo-GP lists, angel-group leadership, family-office and PE operating-partner bios, and partners quoted on sector outlooks. Prefer firms under roughly 20 investors, where no analyst team filters news for the partner.",
  client_advisor: "Persona client_advisor. Search boutique M&A and investment-bank team pages with named sector coverage (healthcare technology, software, fintech, energy), corporate-finance advisory and boutique strategy-consultancy leadership pages, and managing directors quoted on deals in trade press or league-table announcements. Only managing directors and partners; skip general law, accounting, insurance and wealth firms.",
  startup_leader: "Persona startup_leader. Search startup team pages, accelerator demo-day and portfolio lists, founders quoted in sector trade press, and conference speakers from 5–200 person companies in AI applications, fintech, healthtech, climate or defense tech. Exclude companies whose product is news, feeds, monitoring or summarization.",
  nontech_tech_leader: "Persona nontech_tech_leader. Search CIO-of-the-year award lists (ORBIE and regional business journals), CIOs, CTOs, chief digital and chief strategy officers quoted in Banking Dive, CIO Dive, Healthcare Dive, Insurance Journal or American Banker, and technology speakers at ICBA, ABA, HLTH, AHIP or Gartner CIO Symposium, at banks, credit unions, insurers and healthcare providers of roughly 500 people or fewer. Rotate industries between batches.",
  researcher: "Persona researcher. Search university faculty and lab pages, recent conference keynote and panel speakers, and researchers quoted in the press, in fast-moving fields whose work crosses into industry or policy (applied AI, biomedical informatics, energy systems, economics of technology). Prefer faculty and lab-staff pages that print a university address.",
};

export const JARVIS_NEWS_BURDEN_KEYS = ["change", "breadth", "unfiltered", "footprint"] as const;
/**
 * change: how fast their field moves in ways that affect decisions;
 * breadth: how many domains they must follow at once;
 * unfiltered: how little staff filters it for them;
 * footprint: how much public material exists to build a profile from.
 * Each score is 0–3 with a sourced one-line justification.
 */
export type JarvisNewsBurden = Record<typeof JARVIS_NEWS_BURDEN_KEYS[number], { score: number; evidence: string }>;
export const JARVIS_NEWS_BURDEN_MAX = 12;
/** A target user needs 9/12 with no dimension at zero (rubric v2). */
export const JARVIS_NEWS_BURDEN_QUALIFY = 9;
export function newsBurdenTotal(lead: Pick<JarvisCandidate, "newsBurden">): number {
  return lead.newsBurden ? JARVIS_NEWS_BURDEN_KEYS.reduce((sum, key) => sum + lead.newsBurden![key].score, 0) : 0;
}
export interface JarvisLead extends JarvisCandidate {
  id: string;
  /** Core leads count toward the campaign target; the original tech-heavy batch is retained as adjacent. */
  audienceFit: "core" | "adjacent";
  status: JarvisStatus;
  emailCheck: "missing" | "unconfirmed" | "source_found";
  reviewed: boolean;
  subject: string;
  body: string;
  notes: string;
  confirmedNeeds: string;
  createdAt: string;
  updatedAt: string;
  revision?: number;
  sentAt?: string;
  /** Persisted before the network request: a crash or timeout must not cause a second send. */
  sendAttempt?: { id: string; at: string; state: "pending" | "uncertain" | "sent"; messageId?: string; threadId?: string };
  repliedAt?: string;
  /** Manual follow-up, or the outbox's single automatic one; never set when opening a draft. */
  followedUpAt?: string;
  /** The outbox's automatic follow-up, claimed before sending like sendAttempt. */
  followUpAttempt?: { id: string; at: string; state: "pending" | "uncertain" | "sent"; messageId?: string };
  /** Approved in a batch for paced sending; cleared by any draft or email edit. */
  queuedAt?: string;
  /** Last Gmail thread check for a reply or bounce. */
  syncedAt?: string;
  /** When persona and newsBurden were (re)assessed; set on research and on rescoring. */
  assessedAt?: string;
  /** JARVIS_RUBRIC_VERSION of that assessment; absent means v1. */
  assessedVersion?: number;
  history: Array<{ status: JarvisStatus; at: string }>;
}
export interface JarvisRun {
  id: string;
  status: "running" | "done" | "error" | "cancelled";
  target: number;
  /** Optional cohort-only run (e.g. finding more non-tech executives after 100). */
  focus?: CoreJarvisSegment;
  /** Wide-net info_exec run: any executive above the quality floor with a published email counts. */
  wide?: boolean;
  added: number;
  batches: number;
  startedAt: string;
  finishedAt?: string;
  message: string;
}
/** Rescoring existing contacts against the five personas; separate from discovery so both can run. */
export interface JarvisRescoreRun {
  id: string;
  status: "running" | "done" | "error" | "cancelled";
  total: number;
  assessed: number;
  startedAt: string;
  finishedAt?: string;
  message: string;
}
/**
 * Paced sending of batch-approved contacts, plus one automatic follow-up.
 * Bruce approves each contact; the outbox only decides when to send it.
 */
export interface JarvisOutbox {
  enabled: boolean;
  /** Optional cap on emails per local day; absent means no cap, only the 6–12 minute pacing. */
  dailyLimit?: number;
  /** Set when the outbox stops itself (an uncertain send, repeated bounces); cleared by resuming. */
  pausedReason?: string;
  /** Scheduled start: nothing is sent before this instant, even inside a recipient's window. */
  startAt?: string;
  lastSendAt?: string;
  lastSyncAt?: string;
  message?: string;
}
export const DEFAULT_JARVIS_OUTBOX: JarvisOutbox = { enabled: true };
export const JARVIS_FOLLOW_UP_DAYS = 7;
/** Outreach email with {{placeholder}} slots; see JARVIS_TEMPLATE_FIELDS. */
export interface JarvisTemplate { subject: string; body: string }
export const JARVIS_TEMPLATE_FIELDS = ["firstName", "name", "company", "role", "area", "work", "opener"] as const;
export interface JarvisState {
  leads: JarvisLead[];
  run: JarvisRun | null;
  template?: JarvisTemplate;
  /** Body only: a follow-up replies in the original thread, so it keeps the original subject. */
  followUpTemplate?: string;
  rescore?: JarvisRescoreRun | null;
  outbox?: JarvisOutbox;
  daily?: JarvisDaily;
}
/** Unattended research: once a day, a wide-net run for `count` more reachable executives. Never queues or sends. */
export interface JarvisDaily {
  enabled: boolean;
  count: number;
  /** Server-local hour (0–23) the run starts at, or on the first check after it. */
  hour: number;
  /** Server-local YYYY-MM-DD of the last day a run was started. */
  lastRunOn?: string;
}
export const DEFAULT_JARVIS_DAILY: JarvisDaily = { enabled: false, count: 15, hour: 6 };

/** Seven full days after the first send, until a reply or one manual follow-up is recorded. */
/**
 * Emails that left Bruce's Gmail since local midnight: every first send,
 * manual or outbox, plus automatic follow-ups. One rule for the page and the
 * outbox's daily cap, since both kinds of send cost the same reputation.
 */
export function jarvisSentToday(leads: JarvisLead[], at: Date = new Date()): number {
  const day = at.toLocaleDateString("en-CA");
  const today = (iso?: string) => Boolean(iso) && new Date(iso!).toLocaleDateString("en-CA") === day;
  return leads.reduce((sum, lead) => sum + (today(lead.sentAt ?? lead.sendAttempt?.at) ? 1 : 0) + (today(lead.followUpAttempt?.at) ? 1 : 0), 0);
}

export function isJarvisFollowUpDue(lead: JarvisLead, at: number = Date.now()): boolean {
  if (lead.status !== "sent" || !lead.sentAt || lead.repliedAt || lead.followedUpAt || lead.followUpAttempt) return false;
  const sent = Date.parse(lead.sentAt);
  return Number.isFinite(sent) && at >= sent + JARVIS_FOLLOW_UP_DAYS * 24 * 60 * 60 * 1000;
}

/** Sort usable unsent emails first, unsourced contacts next, contacted and suppressed contacts last. */
export function jarvisListPriority(lead: JarvisLead): number {
  if (["declined", "bounced", "do_not_contact"].includes(lead.status)) return 4;
  if (lead.sentAt || ["sent", "replied", "interested"].includes(lead.status)) return 3;
  if (!lead.email) return 2;
  return lead.status === "ready" ? 0 : 1;
}

/** The campaign target counts core contacts Bruce can actually email, not just names found. */
export const isSendableCore = (lead: JarvisLead) => lead.audienceFit === "core" && Boolean(lead.email) && !["bounced", "do_not_contact"].includes(lead.status);
/**
 * The persona target counts qualified people from any cohort (research or
 * rescoring sets persona), email or not: executives rarely
 * publish an address, and counting only findable emails filled the list with
 * association staff. A missing email means LinkedIn or an introduction instead.
 */
export const isQualifiedInfoExec = (lead: JarvisLead) => (JARVIS_TARGET_PERSONAS as readonly string[]).includes(lead.persona ?? "")
  && (lead.assessedVersion ?? 1) >= JARVIS_RUBRIC_VERSION && Boolean(lead.watchList?.trim())
  && !["bounced", "do_not_contact"].includes(lead.status)
  && newsBurdenTotal(lead) >= JARVIS_NEWS_BURDEN_QUALIFY && JARVIS_NEWS_BURDEN_KEYS.every((key) => lead.newsBurden![key].score > 0);

/**
 * A persona run counts the qualified people research found. Rescored contacts
 * qualify too, but must not make a "+30" run stop after finding nobody.
 */
export const isResearchedTargetUser = (lead: JarvisLead) => lead.segment === "info_exec" && isQualifiedInfoExec(lead);

/** Current executive titles; "Principal" only as a firm title, never "Principal Engineer". */
const EXECUTIVE_TITLE = /\b(CEO|COO|CTO|CIO|CFO|CSO|CMO|CDO|Chief|President|Founder|Co-?founder|Managing (Partner|Director|Principal|Member)|General Partner|GP|Partner|Owner|EVP|Executive Vice|SVP|Senior Vice|General Manager|Executive Director)\b|^\s*Principal\b(?!\s+(Engineer|Scientist|Machine|Software|Product|Designer|Data|Research|Consultant))/i;
const NOT_CURRENT_EXECUTIVE = /\b(former|retired|emeritus|assistant|professor|lecturer)\b/i;
/** Associations and chambers curate news for members: a channel, never an outreach target. */
const CURATOR_ORG = /association|chamber of commerce|federation\b|society\b|trade group|\bbureau\b/i;
export const isJarvisExecutive = (lead: Pick<JarvisLead, "role">) => EXECUTIVE_TITLE.test(lead.role) && !NOT_CURRENT_EXECUTIVE.test(lead.role);
/** The wide-net quality floor: a v2 news burden of at least 6/12 in a field that is not static. */
export const JARVIS_WIDE_MIN = 6;
/**
 * A = a target user under the strict rubric (persona, watch list, 9/12).
 * B = the wide net: any other current executive, outside associations, whose
 * v2 score reaches the floor with some pace of change. Reply rates per tier
 * answer whether executives in general want Jarvis, and whether A beats B.
 */
export type JarvisTier = "A" | "B";
export function jarvisTier(lead: JarvisLead): JarvisTier | null {
  if (isQualifiedInfoExec(lead)) return "A";
  if ((lead.assessedVersion ?? 1) < JARVIS_RUBRIC_VERSION || !lead.newsBurden || ["bounced", "do_not_contact"].includes(lead.status)) return null;
  if (!isJarvisExecutive(lead) || CURATOR_ORG.test(`${lead.industry} ${lead.company}`)) return null;
  return newsBurdenTotal(lead) >= JARVIS_WIDE_MIN && lead.newsBurden.change.score >= 1 ? "B" : null;
}
/** What a wide-net run counts: an A or B executive whose email was seen on its source page. */
export const isReachableTierExec = (lead: JarvisLead) => lead.segment === "info_exec" && jarvisTier(lead) !== null && lead.emailCheck === "source_found";

export function jarvisComposeLinks(lead: JarvisLead): { mailto: string; gmail: string } | null {
  if (!lead.email || !lead.reviewed || ["bounced", "declined", "do_not_contact"].includes(lead.status) || ["pending", "uncertain"].includes(lead.sendAttempt?.state ?? "")) return null;
  return {
    mailto: `mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent(lead.subject)}&body=${encodeURIComponent(lead.body)}`,
    gmail: `https://mail.google.com/mail/?${new URLSearchParams({ view: "cm", fs: "1", to: lead.email, su: lead.subject, body: lead.body })}`,
  };
}
