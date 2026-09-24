/** Browser-safe vocabulary for the single Jarvis discovery campaign. */
export const CORE_JARVIS_SEGMENTS = ["clinic", "professional_services", "nontech_exec", "small_tech"] as const;
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
  sentAt?: string;
  repliedAt?: string;
  history: Array<{ status: JarvisStatus; at: string }>;
}
export interface JarvisRun {
  id: string;
  status: "running" | "done" | "error" | "cancelled";
  target: number;
  added: number;
  batches: number;
  startedAt: string;
  finishedAt?: string;
  message: string;
}
/** Outreach email with {{placeholder}} slots; see JARVIS_TEMPLATE_FIELDS. */
export interface JarvisTemplate { subject: string; body: string }
export const JARVIS_TEMPLATE_FIELDS = ["firstName", "name", "company", "role", "area", "work"] as const;
export interface JarvisState { leads: JarvisLead[]; run: JarvisRun | null; template?: JarvisTemplate }

/** The campaign target counts core contacts Bruce can actually email, not just names found. */
export const isSendableCore = (lead: JarvisLead) => lead.audienceFit === "core" && Boolean(lead.email) && !["bounced", "do_not_contact"].includes(lead.status);

export function jarvisComposeLinks(lead: JarvisLead): { mailto: string; gmail: string } | null {
  if (!lead.email || !lead.reviewed || ["bounced", "declined", "do_not_contact"].includes(lead.status)) return null;
  return {
    mailto: `mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent(lead.subject)}&body=${encodeURIComponent(lead.body)}`,
    gmail: `https://mail.google.com/mail/?${new URLSearchParams({ view: "cm", fs: "1", to: lead.email, su: lead.subject, body: lead.body })}`,
  };
}
