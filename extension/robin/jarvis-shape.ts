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
  /** Required for info_exec: which target persona they represent. */
  persona?: JarvisPersona;
  /** The concrete list a target user must track; required for a current target persona. */
  watchList?: string;
  /** Public professional social profiles. They are contact/review routes, not evidence by themselves. */
  socials?: Partial<Record<JarvisSocialPlatform, string>>;
  /** A specific public post or update actually read during research; absent when inaccessible or not found. */
  socialEvidence?: { url: string; quote: string };
  /** Public profiles whose content required login after an attempted visit; hand off to Bruce for manual review. */
  socialLoginRequired?: JarvisSocialPlatform[];
  /** Where research first found this person: the named list, article or page. */
  foundVia?: { source: string; url: string };
  /** Current research lane. Historical contacts may contain an older lane value. */
  sourcingLane?: JarvisResearchLane | JarvisDtcLane;
  /** Public evidence that the brand uses Shopify / Shopify Plus. */
  shopifyEvidence?: { url: string; quote: string };
  /** Legacy evidence from the 2026-10-02 grant/fellowship-only experiment. */
  opportunityNeedEvidence?: { url: string; quote: string };
  /** Public evidence that this person must filter changing information across sources to make decisions. */
  informationNeedEvidence?: { url: string; quote: string };
  /** A recent, sourced reason this is a useful moment to ask for feedback. */
  whyNow?: { summary: string; url: string; quote: string };
  /** Company-level fit and contact-level reachability are deliberately separate. */
  companyFit?: { score: number; evidence: string };
  reachability?: { score: number; evidence: string };
}
/**
 * The five Jarvis user personas, in priority order. Each is someone who keeps
 * an explicit watch list (a portfolio, clients, competitors, a research agenda)
 * and pays for missing a development on it. Quotas split the 100 info_exec target.
 */
export const JARVIS_SOCIAL_PLATFORMS = ["linkedin", "instagram", "x", "tiktok"] as const;
export type JarvisSocialPlatform = typeof JARVIS_SOCIAL_PLATFORMS[number];
export type JarvisWebsiteContactKind = "personal_email" | "company_email" | "contact_form" | "phone";
export interface JarvisWebsiteContact {
  kind: JarvisWebsiteContactKind;
  value: string;
  sourceUrl: string;
}
export interface JarvisWebsiteResearch {
  status: "found" | "none" | "missing_website" | "blocked" | "error";
  websiteUrl?: string;
  contacts: JarvisWebsiteContact[];
  checkedAt: string;
  note?: string;
}
/** New ICPs come first; older values remain so historical assessments still render. */
export const JARVIS_PERSONAS = ["ecommerce_owner", "healthcare_operator", "cross_source_operator", "grant_researcher", "nonprofit_operator", "independent_creator", "legal_leader", "vc", "client_advisor", "startup_leader", "nontech_tech_leader", "researcher"] as const;
export type JarvisPersona = typeof JARVIS_PERSONAS[number];
export const JARVIS_TARGET_PERSONAS = ["ecommerce_owner", "healthcare_operator", "cross_source_operator"] as const satisfies readonly JarvisPersona[];
export const JARVIS_PERSONA_QUOTA: Record<JarvisPersona, number> = {
  ecommerce_owner: 45, healthcare_operator: 35, cross_source_operator: 20,
  grant_researcher: 0, nonprofit_operator: 0, independent_creator: 0, legal_leader: 0,
  vc: 0, client_advisor: 0, startup_leader: 0, nontech_tech_leader: 0, researcher: 0,
};
/** Three source pools inside the cross-domain personal-intelligence validation sprint. */
export const JARVIS_RESEARCH_LANES = ["dtc_shopify", "healthcare_operations", "cross_source_operations"] as const;
export type JarvisResearchLane = typeof JARVIS_RESEARCH_LANES[number];
export const JARVIS_RESEARCH_LANE_QUOTA: Record<JarvisResearchLane, number> = {
  dtc_shopify: 45, healthcare_operations: 35, cross_source_operations: 20,
};
/** Compatibility aliases retained while older UI/report names are migrated. */
export const JARVIS_DTC_LANES = JARVIS_RESEARCH_LANES;
export type JarvisDtcLane = JarvisResearchLane;
export const JARVIS_DTC_LANE_QUOTA = JARVIS_RESEARCH_LANE_QUOTA;
/**
 * Bumped when the ICP changes; older contacts must be reassessed before they count.
 * v6 data remains compatible with the original evidence-rich sprint. Since the
 * 2026-10-05 override, current role plus a verified personal route is the gate;
 * information-need and why-now evidence are optional prioritization signals.
 */
export const JARVIS_RUBRIC_VERSION = 6;
/** Where each persona leaves public evidence and contact routes. */
export const JARVIS_PERSONA_PLAYBOOK: Record<JarvisPersona, string> = {
  grant_researcher: "Persona grant_researcher. Find current postdoctoral researchers, research scientists, principal investigators, lab or center directors, and advanced doctoral candidates with a clearly documented active research agenda. Prefer small labs, independent institutes and cross-disciplinary work where opportunities are spread across funders and programs. Exclude people with only an old publication or title and no current project evidence.",
  nonprofit_operator: "Persona nonprofit_operator. Find founders, executive directors and program directors at small or midsize nonprofits, community initiatives and social-impact organizations with an active program, expansion, evaluation or public-interest project. Prefer people personally responsible for funding and program delivery; exclude fundraising vendors, grant consultants and large institutions with dedicated development research teams.",
  independent_creator: "Persona independent_creator. Find independent filmmakers, journalists, writers, artists, designers and community creators with a current documented project or body of work that plausibly uses grants, residencies or fellowships. Prefer people without a large representation or research team. Exclude generic influencers, course sellers and creators whose main product is opportunity/news curation.",
  ecommerce_owner: "Persona ecommerce_owner. Work COMPANY-FIRST: discover an active small or midsize DTC brand, then identify its current founder, owner, CEO or COO. A 5–100 person team and Shopify / Shopify Plus are prioritization signals, not intake gates. If team size or commerce platform is not publicly documented, leave that enrichment unknown; do not return an empty list solely for missing Shopify proof. Use brand pages, technology profiles, founder interviews, trade press and public social posts. Exclude dropshippers, agencies, ecommerce consultants, course sellers, generic resellers, single-product test stores and giant brands.",
  healthcare_operator: "Persona healthcare_operator. Search owners, CEOs, COOs, executive directors and practice administrators of independent multi-site clinics, specialty groups, ambulatory providers and digital-health operators under roughly 500 people. Prefer leaders visibly responsible for payer policy, reimbursement, regulation, staffing and operations; exclude individual clinicians without operating responsibility and large health systems.",
  cross_source_operator: "Persona cross_source_operator. Find current hands-on owners, managing partners, operating executives and functional operations leaders at small or midsize professional-service or operating businesses. Verify the current role and a qualified personal contact route. Evidence that they monitor regulations, client sectors, tenders, markets, competitors, supply chains or policy is useful enrichment but is not required. Exclude news/opportunity curators and consultants selling monitoring, summarization or funding discovery.",
  legal_leader: "Persona legal_leader. Search managing partners and practice leaders at small and midsize firms whose own pages show named work in M&A, privacy, AI, healthcare, fintech, cybersecurity or regulated transactions. Prefer articles, talks or client alerts that demonstrate active monitoring; exclude general-practice managing partners, legal consultants and people selling news or research.",
  vc: "Legacy persona: VC / investor.",
  client_advisor: "Legacy persona: transaction advisor.",
  startup_leader: "Legacy persona: startup leader.",
  nontech_tech_leader: "Legacy persona: non-tech technology leader.",
  researcher: "Legacy persona: researcher.",
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
/** A target user needs 9/12 plus explicit strength in change, breadth and footprint. */
export const JARVIS_NEWS_BURDEN_QUALIFY = 9;
export function newsBurdenTotal(lead: Pick<JarvisCandidate, "newsBurden">): number {
  return lead.newsBurden ? JARVIS_NEWS_BURDEN_KEYS.reduce((sum, key) => sum + lead.newsBurden![key].score, 0) : 0;
}
export interface JarvisLead extends JarvisCandidate {
  /** Derived by the read view; never an approved or sent draft. */
  socialTemplateDrafts?: Partial<Record<JarvisSocialPlatform, string>>;
  id: string;
  /** Core leads count toward the campaign target; the original tech-heavy batch is retained as adjacent. */
  audienceFit: "core" | "adjacent";
  /** Human ICP judgement, independent of the model's persona/score and of outreach status. Missing means pending. */
  icpReview?: { verdict: "verified" | "pending" | "adjacent"; reason: string; at: string };
  /** Product-neutral approval from a complete Cold Reach card review; never changes ICP classification. */
  outreachPlans?: Partial<Record<"email" | JarvisSocialPlatform, { route: string; subject?: string; body: string; approvedAt: string }>>;
  outreachWorkflow?: { stage: "review" | "send"; at: string };
  /** Manually recorded LinkedIn invitation; never counts as a sent message. */
  linkedinConnection?: { route: string; requestedAt: string; acceptedAt?: string };
  outreachApproval?: { channel: "email" | JarvisSocialPlatform; route: string; at: string };
  status: JarvisStatus;
  emailCheck: "missing" | "unconfirmed" | "source_found";
  reviewed: boolean;
  /** User-edited social messages. Opening a profile never sends or records a message. */
  socialOutreach?: Partial<Record<JarvisSocialPlatform, { draft: string; sentAt?: string; sentText?: string; repliedAt?: string; skippedAt?: string; skipReason?: "private" | "wrong-account" | "cannot-dm" | "platform-limit" }>>;
  /** Read-only public routes found on the official site. Never queued or sent automatically. */
  websiteResearch?: JarvisWebsiteResearch;
  subject: string;
  body: string;
  notes: string;
  confirmedNeeds: string;
  createdAt: string;
  updatedAt: string;
  revision?: number;
  sentAt?: string;
  /** Persisted before the network request: a crash or timeout must not cause a second send. */
  sendAttempt?: { senderEmail?: string; id: string; at: string; state: "pending" | "uncertain" | "sent"; messageId?: string; threadId?: string };
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
  /** Retained across progress updates so retries cannot hide the failure. */
  lastError?: string;
  id: string;
  /** Runtime instance holding the renewable lease for this research run. */
  ownerId?: string;
  /** Last successful lease renewal; absent on runs written before leases existed. */
  heartbeatAt?: string;
  status: "running" | "done" | "error" | "cancelled";
  target: number;
  /** Optional cohort-only run (e.g. finding more non-tech executives after 100). */
  focus?: CoreJarvisSegment;
  /** Wide-net info_exec run: any executive above the quality floor with a published email counts. */
  wide?: boolean;
  /** Optional public social route that every result in this run must include. */
  channelFocus?: JarvisSocialPlatform;
  added: number;
  batches: number;
  /** Live counters for the event-driven DTC research worker pool. */
  pipeline?: {
    stage: "discovering" | "finishing";
    activeWorkers: number;
    completed: number;
    failed: number;
  };
  startedAt: string;
  finishedAt?: string;
  message: string;
}
/** Rescoring existing contacts against the current personas; separate from discovery so both can run. */
export interface JarvisRescoreRun {
  id: string;
  ownerId?: string;
  heartbeatAt?: string;
  status: "running" | "done" | "error" | "cancelled";
  total: number;
  assessed: number;
  startedAt: string;
  finishedAt?: string;
  message: string;
}
export interface JarvisWebsiteRun {
  id: string;
  ownerId?: string;
  heartbeatAt?: string;
  status: "running" | "done" | "error" | "cancelled";
  total: number;
  checked: number;
  found: number;
  failed: number;
  activeWorkers: number;
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
  /** Scheduled start: nothing is sent before this instant. */
  startAt?: string;
  lastSendAt?: string;
  lastSyncAt?: string;
  message?: string;
}
export const DEFAULT_JARVIS_OUTBOX: JarvisOutbox = { enabled: true };
/** Bruce requires at least one full day between the confirmed first send and follow-up. */
export const JARVIS_FOLLOW_UP_DAYS = 1;
/**
 * The delivery contract shared by the sender and every UI that describes it.
 * Reviewed outreach may run at any hour; pacing, the optional daily cap and
 * the explicit scheduled start remain enforced.
 */
export const JARVIS_DELIVERY_POLICY = {
  recipientWindowEnforced: false,
  minimumGapMinutes: 6,
  maximumGapMinutes: 12,
  replySyncMinutes: 15,
  followUpDelayHours: JARVIS_FOLLOW_UP_DAYS * 24,
  bouncePauseThreshold: 3,
} as const;
/** Outreach email with {{placeholder}} slots; see JARVIS_TEMPLATE_FIELDS. */
export interface JarvisTemplate { subject: string; body: string }
export const JARVIS_TEMPLATE_FIELDS = ["firstName", "name", "company", "role", "area", "work", "opener", "shortOpener"] as const;
export interface OutreachUndo {
  leadId: string;
  name: string;
  op: string;
  revision: number;
  before: JarvisLead;
}
export interface JarvisState {
  outreachUndo?: OutreachUndo;
  leads: JarvisLead[];
  run: JarvisRun | null;
  template?: JarvisTemplate;
  socialTemplates?: Partial<Record<JarvisSocialPlatform, string>>;
  /** Body only: a follow-up replies in the original thread, so it keeps the original subject. */
  followUpTemplate?: string;
  rescore?: JarvisRescoreRun | null;
  websiteRun?: JarvisWebsiteRun | null;
  outbox?: JarvisOutbox;
  /** Internal cross-process ownership for one email transmission; omitted from HTTP views. */
  deliveryLease?: { ownerId: string; heartbeatAt: string };
  daily?: JarvisDaily;
}
/** Unattended research: once a day, find `count` more contactable strict-ICP users. Never queues or sends. */
export interface JarvisDaily {
  enabled: boolean;
  count: number;
  /** Server-local hour (0–23) the run starts at, or on the first check after it. */
  hour: number;
  /** Server-local YYYY-MM-DD of the last day a run was started. */
  lastRunOn?: string;
}
export const DEFAULT_JARVIS_DAILY: JarvisDaily = { enabled: false, count: 15, hour: 6 };

/** After the waiting period from the first confirmed send, until a reply or one follow-up is recorded. */
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
  if (lead.status !== "sent" || !lead.sentAt || lead.repliedAt || lead.followedUpAt || lead.followUpAttempt || (lead.segment === "info_exec" && !isOutreachApprovedFor(lead, "email"))) return false;
  const sent = Date.parse(lead.sentAt);
  return Number.isFinite(sent) && at >= sent + JARVIS_FOLLOW_UP_DAYS * 24 * 60 * 60 * 1000;
}

/** Sort usable unsent emails first, unsourced contacts next, contacted and suppressed contacts last. */
export function jarvisListPriority(lead: JarvisLead): number {
  if (["declined", "bounced", "do_not_contact"].includes(lead.status)) return 4;
  if (hasJarvisSocialOutreach(lead)) return 3;
  if (lead.sentAt || ["sent", "replied", "interested"].includes(lead.status)) return 3;
  if (!lead.email) return 2;
  return lead.status === "ready" ? 0 : 1;
}

/** The campaign target counts core contacts Bruce can actually email, not just names found. */
export const isSendableCore = (lead: JarvisLead) => lead.audienceFit === "core" && Boolean(lead.email) && !["bounced", "do_not_contact"].includes(lead.status);
/**
 * The strict persona predicate is independent of contactability, so rescoring
 * can identify a fit before a public outreach route is found.
 */
// At validation stage, public evidence can prove ICP identity and reachability,
// but only a conversation can prove the hypothesized information pain. Keep
// newsBurden for prioritization instead of using it to exclude interview leads.
export const isQualifiedInfoExec = (lead: JarvisLead) => (JARVIS_TARGET_PERSONAS as readonly string[]).includes(lead.persona ?? "")
  && (lead.assessedVersion ?? 1) >= JARVIS_RUBRIC_VERSION && Boolean(lead.watchList?.trim())
  && JARVIS_RESEARCH_LANES.includes(lead.sourcingLane as JarvisResearchLane)
  && Boolean(lead.informationNeedEvidence?.url && lead.informationNeedEvidence.quote)
  && Boolean(lead.whyNow?.url && lead.whyNow.summary && lead.whyNow.quote)
  && (lead.companyFit?.score ?? 0) >= 35 && (lead.reachability?.score ?? 0) >= 30
  && !["bounced", "do_not_contact"].includes(lead.status) && Boolean(lead.newsBurden);

/**
 * A persona run counts research-found strict ICPs with a public contact route.
 * Rescored contacts qualify as users but do not advance a discovery run.
 */
export function jarvisContactMethods(lead: Pick<JarvisCandidate, "email" | "socials">): Array<{ platform: "email" | JarvisSocialPlatform; url: string }> {
  const methods: Array<{ platform: "email" | JarvisSocialPlatform; url: string }> = [];
  if (lead.email) methods.push({ platform: "email", url: `mailto:${lead.email}` });
  for (const platform of JARVIS_SOCIAL_PLATFORMS) {
    const url = lead.socials?.[platform];
    if (url) methods.push({ platform, url });
  }
  return methods;
}

/** Current discovery counts a source-verified individual work email or the person's saved Instagram. */
export const hasCurrentPrimaryRoute = (lead: Pick<JarvisLead, "persona" | "email" | "emailCheck" | "emailSource" | "emailQuote" | "socials">) => {
  const verifiedEmail = Boolean(lead.email && lead.emailCheck === "source_found" && lead.emailSource
    && lead.emailQuote.toLowerCase().includes(lead.email.toLowerCase()));
  return Boolean(lead.socials?.instagram) || verifiedEmail;
};
/** Historical names retained for callers while the campaign terminology changes. */
export const hasGrantPrimaryRoute = hasCurrentPrimaryRoute;
/** Compatibility name retained for older UI and reports. */
export const hasDtcPrimaryRoute = hasCurrentPrimaryRoute;

/**
 * Contactability-first campaign gate. Bruce explicitly relaxed the earlier
 * dossier requirement on 2026-10-05: a current target-lane operator with a
 * sourced identity and a usable personal route may be contacted while deeper
 * information-need and why-now evidence remains prioritization enrichment.
 */
export const isCurrentValidationProspect = (lead: JarvisLead) => lead.segment === "info_exec"
  && (JARVIS_TARGET_PERSONAS as readonly string[]).includes(lead.persona ?? "")
  && JARVIS_RESEARCH_LANES.includes(lead.sourcingLane as JarvisResearchLane)
  && Boolean(lead.role?.trim() && lead.profileUrl?.trim() && lead.evidence?.trim() && lead.evidenceUrl?.trim())
  && !["bounced", "declined", "do_not_contact"].includes(lead.status)
  && hasCurrentPrimaryRoute(lead);
export const isGrantValidationProspect = isCurrentValidationProspect;
/** Compatibility name retained for older UI and reports. */
export const isDtcValidationProspect = isCurrentValidationProspect;

/** Research candidates remain visible even while their ICP evidence awaits human review. */
export const isResearchedTargetUser = (lead: JarvisLead) => isCurrentValidationProspect(lead);
/** Human verification cannot bypass the current identity, lane or contact-route gates. */
export const isVerifiedJarvisTarget = (lead: JarvisLead) => isCurrentValidationProspect(lead)
  && lead.icpReview?.verdict === "verified" && !["bounced", "declined", "do_not_contact"].includes(lead.status);
/** Approval is for the exact route and channel; a corrected account/address needs another review. */
export const isOutreachApprovedFor = (lead: JarvisLead, channel: "email" | JarvisSocialPlatform) => isCurrentValidationProspect(lead)
  && (isVerifiedJarvisTarget(lead)
    || (lead.outreachApproval?.channel === channel && lead.outreachApproval.route === (channel === "email" ? lead.email : lead.socials?.[channel])))
  && !["bounced", "declined", "do_not_contact"].includes(lead.status);
export const hasJarvisSocialOutreach = (lead: JarvisLead) => Boolean(JARVIS_SOCIAL_PLATFORMS.some((platform) => lead.socialOutreach?.[platform]?.sentAt));

/** Current executive titles; "Principal" only as a firm title, never "Principal Engineer". */
const EXECUTIVE_TITLE = /\b(CEO|COO|CTO|CIO|CFO|CSO|CMO|CDO|Chief|President|Founder|Co-?founder|Managing (Partner|Director|Principal|Member)|General Partner|GP|Partner|Owner|EVP|Executive Vice|SVP|Senior Vice|General Manager|Executive Director|Practice Administrator|Practice (Group )?Leader|Practice Chair)\b|^\s*Principal\b(?!\s+(Engineer|Scientist|Machine|Software|Product|Designer|Data|Research|Consultant))/i;
const NOT_CURRENT_EXECUTIVE = /\b(former|retired|emeritus|assistant|professor|lecturer)\b/i;
/** Associations and chambers curate news for members: a channel, never an outreach target. */
const CURATOR_ORG = /association|chamber of commerce|federation\b|society\b|trade group|\bbureau\b/i;
export const isJarvisExecutive = (lead: Pick<JarvisLead, "role">) => EXECUTIVE_TITLE.test(lead.role) && !NOT_CURRENT_EXECUTIVE.test(lead.role);
/** The legacy wide-net quality floor: a current-rubric burden of at least 6/12 in a changing field. */
export const JARVIS_WIDE_MIN = 6;
/**
 * A = a target user under the strict rubric (persona, watch list, 9/12).
 * B = the wide net: any other current executive, outside associations, whose
 * current-rubric score reaches the floor with some pace of change. Reply rates per tier
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
  if (!lead.email || !lead.reviewed || (lead.segment === "info_exec" && !isOutreachApprovedFor(lead, "email")) || hasJarvisSocialOutreach(lead) || ["bounced", "declined", "do_not_contact"].includes(lead.status) || ["pending", "uncertain"].includes(lead.sendAttempt?.state ?? "")) return null;
  return {
    mailto: `mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent(lead.subject)}&body=${encodeURIComponent(lead.body)}`,
    gmail: `https://mail.google.com/mail/?${new URLSearchParams({ view: "cm", fs: "1", to: lead.email, su: lead.subject, body: lead.body })}`,
  };
}
