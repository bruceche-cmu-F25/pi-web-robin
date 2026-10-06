import { hasJarvisSocialOutreach, isOutreachApprovedFor, JARVIS_SOCIAL_PLATFORMS, type JarvisLead, type JarvisSocialPlatform, type JarvisStatus } from "./jarvis-shape.ts";

export type OutreachChannel = "email" | JarvisSocialPlatform;
export const OUTREACH_CHANNELS: OutreachChannel[] = ["email", ...JARVIS_SOCIAL_PLATFORMS];
export const channelName = (channel: OutreachChannel) => ({ email: "Email", linkedin: "LinkedIn", instagram: "Instagram", x: "X", tiktok: "TikTok" })[channel];
export const hasSentOutreach = (lead: JarvisLead) => Boolean(lead.sentAt || hasJarvisSocialOutreach(lead) || lead.status === "sent");
export const canReviewOutreach = (lead: JarvisLead) => ["new", "ready"].includes(lead.status)
  && !lead.queuedAt && !lead.sentAt && !lead.sendAttempt && !hasJarvisSocialOutreach(lead);
export const canAddToReviewQueue = (lead: JarvisLead) => canReviewOutreach(lead) && !lead.outreachWorkflow;
export const canReviewChannel = (lead: JarvisLead, channel: OutreachChannel) => canReviewOutreach(lead)
  && (channel === "email" ? Boolean(lead.email && lead.emailCheck === "source_found" && lead.emailSource) : Boolean(lead.socials?.[channel]));

/** One contact stage across email and social; keep the underlying email history intact. */
export function outreachStage(lead: JarvisLead): JarvisStatus {
  if (["interested", "declined", "bounced", "do_not_contact"].includes(lead.status)) return lead.status;
  if (lead.repliedAt || JARVIS_SOCIAL_PLATFORMS.some((p) => lead.socialOutreach?.[p]?.repliedAt)) return "replied";
  if (lead.sentAt || hasJarvisSocialOutreach(lead)) return "sent";
  if (JARVIS_SOCIAL_PLATFORMS.some((p) => lead.socialOutreach?.[p]?.draft && !lead.socialOutreach[p]?.skippedAt && isOutreachApprovedFor(lead, p))) return "ready";
  return lead.status;
}

export const DEFAULT_SOCIAL_TEMPLATES = {
  instagram: "Hi {{firstName}} — I'm Bruce. We're building a personal intelligence filter that learns what you're working toward and filters updates across the sources you follow into a short daily brief: what changed, why it matters, and what to do next.\n\nHow do you decide what deserves your attention today, and what tends to get missed?\n\nhttps://your-secretary.com",
  linkedin: "Hi {{firstName}} — I'm Bruce. We're building a personal intelligence filter for people who have to keep up with changing information across their work. It learns from your goals, projects, public footprint, and feedback, then monitors public sources and sources you explicitly choose to connect.\n\nInstead of another long digest, it sends a short daily brief with only the developments and opportunities worth acting on—why each matters, the source, and the next step. Grants and fellowships can be one use case; so can policy, operations, market, customer, or competitor changes.\n\nHow do you decide what deserves your attention today, and what tends to get missed?\n\nhttps://your-secretary.com\n\nBruce",
} as const;

export const CURRENT_OUTREACH_LANDING_PAGE = "https://your-secretary.com";
const LEGACY_OUTREACH_LINK = /https?:\/\/(?:www\.)?jarvis\.day\b/i;
const GRANT_ONLY_POSITIONING = /(?:for people pursuing grants? and fellowships?|grant and fellowship discovery idea|current(?:ly)? find grants? and fellowships?|only opportunities that fit your current work, with the reason, deadline)/i;

/** Final send gate: old links and the retired grant-only pitch can never be claimed. */
export function assertCurrentOutreachCopy(...parts: string[]): void {
  const copy = parts.join("\n");
  if (LEGACY_OUTREACH_LINK.test(copy)) throw new Error("Outreach still contains the retired jarvis.day link");
  if (GRANT_ONLY_POSITIONING.test(copy)) throw new Error("Outreach still uses the retired grant-only positioning");
  if (!copy.includes(CURRENT_OUTREACH_LANDING_PAGE)) throw new Error(`Outreach must include ${CURRENT_OUTREACH_LANDING_PAGE}`);
}

/** A starting draft from the stored, sourced opener; saved edits always take precedence. */
export function socialDraft(lead: JarvisLead, platform: JarvisSocialPlatform): string {
  if (lead.socialOutreach?.[platform]?.draft) return unbrandedOutreachText(lead.socialOutreach[platform]!.draft);
  if (lead.socialTemplateDrafts?.[platform]) return lead.socialTemplateDrafts[platform]!;
  const first = lead.firstName?.trim() || lead.name.replace(/^(dr|mr|ms|mrs)\.?\s+/i, "").split(/\s+/)[0];
  const template = platform === "instagram" ? DEFAULT_SOCIAL_TEMPLATES.instagram : DEFAULT_SOCIAL_TEMPLATES.linkedin;
  return template.replace(/\{\{firstName\}\}/g, () => first ?? "").replace(/\{\{company\}\}/g, () => lead.company);
}

/** Recipient-facing copy uses the product description while it is unnamed. */
export function unbrandedOutreachText(value: string): string {
  return value.replace(/https:\/\/a product we[’']re building\b/gi, CURRENT_OUTREACH_LANDING_PAGE)
    .replace(/https?:\/\/(?:www\.)?jarvis\.day\b/gi, CURRENT_OUTREACH_LANDING_PAGE)
    .replace(/\bbuilding a product we[’']re building\b/gi, "building a product")
    .replace(/\btry a product we[’']re building\b/gi, "try it")
    .replace(/\bbuilding Jarvis(?:\.day)?\b/gi, "building a product")
    .replace(/\btry Jarvis(?:\.day)?\b/gi, "try it")
    .replace(/(?<!:\/\/)\bJarvis(?:\.day)?\b/gi, "a product we’re building");
}

export const channelSentAt = (lead: JarvisLead, channel: OutreachChannel) => channel === "email" ? lead.sentAt : lead.socialOutreach?.[channel]?.sentAt;
export const isLinkedInConnectionPending = (lead: JarvisLead) => Boolean(lead.linkedinConnection && lead.linkedinConnection.route === lead.socials?.linkedin && !lead.linkedinConnection.acceptedAt);
export const canPlanChannel = (lead: JarvisLead, channel: OutreachChannel) => !["declined", "bounced", "do_not_contact", "replied", "interested"].includes(lead.status)
  && !lead.repliedAt && !JARVIS_SOCIAL_PLATFORMS.some((p) => lead.socialOutreach?.[p]?.repliedAt)
  && !(channel === "linkedin" && isLinkedInConnectionPending(lead))
  && !lead.queuedAt && !channelSentAt(lead, channel) && !(channel === "email" && lead.sendAttempt)
  && (channel === "email" ? Boolean(lead.email && lead.emailCheck === "source_found" && lead.emailSource) : Boolean(lead.socials?.[channel]));
/** Include available routes even when their message has not been prepared yet. */
export const remainingOutreachChannels = (lead: JarvisLead) => OUTREACH_CHANNELS.filter((channel) => canPlanChannel(lead, channel)
  && (channel === "email" || !lead.socialOutreach?.[channel]?.skippedAt));
export function hasApprovedChannelPlan(lead: JarvisLead, channel: OutreachChannel): boolean {
  if (channel !== "email" && lead.socialOutreach?.[channel]?.skippedAt) return false;
  const plan = lead.outreachPlans?.[channel];
  if (!plan) return Boolean(canPlanChannel(lead, channel) && lead.outreachApproval?.channel === channel
    && lead.outreachApproval.route === (channel === "email" ? lead.email : lead.socials?.[channel])
    && (channel === "email" ? lead.reviewed : lead.socialOutreach?.[channel]?.draft));
  return Boolean(plan && canPlanChannel(lead, channel) && plan.route === (channel === "email" ? lead.email : lead.socials?.[channel])
    && plan.body === (channel === "email" ? lead.body : lead.socialOutreach?.[channel]?.draft)
    && (channel !== "email" || (lead.reviewed && plan.subject === lead.subject)));
}
export const inSendQueue = (lead: JarvisLead) => lead.outreachWorkflow?.stage === "send" && remainingOutreachChannels(lead).length > 0 && (Boolean(lead.linkedinConnection) || Boolean(lead.sentAt) || hasJarvisSocialOutreach(lead) || JARVIS_SOCIAL_PLATFORMS.some((p) => lead.socialOutreach?.[p]?.skippedAt) || OUTREACH_CHANNELS.some((c) => hasApprovedChannelPlan(lead, c)) || (canReviewOutreach(lead) && Boolean(lead.outreachApproval && lead.outreachApproval.route === (lead.outreachApproval.channel === "email" ? lead.email : lead.socials?.[lead.outreachApproval.channel]) && (lead.outreachApproval.channel !== "email" || lead.reviewed))));
export const inReviewQueue = (lead: JarvisLead) => canReviewOutreach(lead) && Boolean(lead.outreachWorkflow) && !(lead.outreachWorkflow?.stage === "send" && isLinkedInConnectionPending(lead)) && !inSendQueue(lead);

/** Display state only: never changes queue eligibility or stored outreach history. */
export const OUTREACH_STATES = {
  untouched: ["○", "未处理", "Untouched"],
  review: ["◇", "审核中", "In review"],
  ready: ["▷", "待发送", "Ready to send"],
  connect_pending: ["⌛", "Connect 待通过", "Connect pending"],
  connected: ["↔", "Connect 已通过", "Connected"],
  queued: ["≡", "发送排队中", "Queued"],
  sending: ["↗", "发送中", "Sending"],
  uncertain: ["!", "发送结果待确认", "Check send result"],
  partial: ["◐", "已发 · 尚有渠道待处理", "Sent · channels remaining"],
  sent: ["✓", "已发消息", "Message sent"],
  followed_up: ["↻", "已跟进", "Followed up"],
  replied: ["↩", "已回复", "Replied"],
  interested: ["★", "有兴趣", "Interested"],
  declined: ["×", "不感兴趣", "Declined"],
  bounced: ["⚠", "退信", "Bounced"],
  do_not_contact: ["⊘", "不再联系", "Do not contact"],
  handled: ["▣", "已处理", "Handled"],
} as const;
export type OutreachDisplayState = keyof typeof OUTREACH_STATES;
export function outreachDisplayState(lead: JarvisLead): OutreachDisplayState {
  const stage = lead.status === "replied" ? "replied" : outreachStage(lead);
  if (stage === "interested" || stage === "declined" || stage === "bounced" || stage === "do_not_contact" || stage === "replied") return stage;
  if (lead.sendAttempt?.state === "uncertain" || lead.followUpAttempt?.state === "uncertain") return "uncertain";
  if (lead.sendAttempt?.state === "pending" || lead.followUpAttempt?.state === "pending") return "sending";
  if (lead.queuedAt && !lead.sendAttempt) return "queued";
  if (hasSentOutreach(lead)) {
    if (inSendQueue(lead)) return "partial";
    if (lead.followedUpAt || lead.followUpAttempt?.state === "sent") return "followed_up";
    return "sent";
  }
  if (isLinkedInConnectionPending(lead)) return "connect_pending";
  if (lead.linkedinConnection?.acceptedAt && lead.linkedinConnection.route === lead.socials?.linkedin) return "connected";
  if (inSendQueue(lead)) return "ready";
  if (inReviewQueue(lead)) return "review";
  if (lead.outreachWorkflow || JARVIS_SOCIAL_PLATFORMS.some(p => lead.socialOutreach?.[p]?.skippedAt)) return "handled";
  if (lead.reviewed || lead.outreachApproval || Object.keys(lead.outreachPlans ?? {}).length || stage === "ready") return "ready";
  return "untouched";
}
const outreachStateOrder = Object.keys(OUTREACH_STATES) as OutreachDisplayState[];
export const outreachDisplayRank = (lead: JarvisLead) => outreachStateOrder.indexOf(outreachDisplayState(lead));
