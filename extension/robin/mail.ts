/**
 * The email-review model: how today's mail is categorised and shown.
 *
 * Client-safe: no `node:fs` here, so the dashboard imports the category list
 * and types directly while the store and the Gmail client stay server-only.
 * This is what turns a raw message list into "here is what came in today and
 * which of it needs you" — the thing Gmail's own inbox does not give you.
 */

export const MAIL_CATEGORIES = [
  "important",
  "interview",
  "oa",
  "appointment",
  "delivery",
  "deadline",
  "document",
  "other",
] as const;

export type MailCategory = (typeof MAIL_CATEGORIES)[number];

/** What the review turn actually created for an item, so the page can badge it. */
export const MAIL_ACTIONS = ["none", "todo", "event", "both"] as const;
export type MailAction = (typeof MAIL_ACTIONS)[number];

/**
 * What an email asks of the user — the axis the page is organised on.
 *
 * Category says what kind of mail it is; triage says whether to spend
 * attention on it. `act` still needs the user and nothing tracks it yet;
 * `tracked` needs doing but a todo, event, or OA row already holds it, so it is
 * handled as far as the inbox is concerned; `fyi` needs nothing.
 */
export const MAIL_TRIAGE = ["act", "tracked", "fyi"] as const;
export type MailTriage = (typeof MAIL_TRIAGE)[number];

export interface MailReviewItem {
  /** Gmail message id, used to link back into the thread. */
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  /** Arrival time as a UTC ISO instant. */
  date: string;
  category: MailCategory;
  /** One line, in the user's language: what this is and what (if anything) to do. */
  summary: string;
  action: MailAction;
  /** Absent on reviews saved before triage existed; read it through `triageOf`. */
  triage?: MailTriage;
  /** The one concrete next step, imperative and short. Only for act/tracked. */
  next?: string;
  /** Local YYYY-MM-DD deadline or start date, when the email states one. */
  due?: string;
  /** The user marked it handled on the page. Survives a re-check; see `saveMailReview`. */
  done?: boolean;
}

export interface MailReview {
  /** Local calendar date the review covers. */
  day: string;
  /** UTC ISO instant the review was saved. */
  reviewedAt: string;
  items: MailReviewItem[];
  /** One or two sentences: what, if anything, needs the user today. */
  headline?: string;
  /** Messages read but left out as ads, alerts, or marketing. */
  skipped?: number;
  /** The assistant's plain report, in the user's language — rendered as markdown. */
  report?: string;
}

export function isMailCategory(value: string): value is MailCategory {
  return (MAIL_CATEGORIES as readonly string[]).includes(value);
}

export function normalizeCategory(value: unknown): MailCategory {
  return typeof value === "string" && isMailCategory(value) ? value : "other";
}

export function isMailAction(value: string): value is MailAction {
  return (MAIL_ACTIONS as readonly string[]).includes(value);
}

export function normalizeAction(value: unknown): MailAction {
  return typeof value === "string" && isMailAction(value) ? value : "none";
}

/** How many todos and calendar events a review says it auto-created. */
export function countReviewActions(review: MailReview): { todos: number; events: number } {
  let todos = 0;
  let events = 0;
  for (const item of review.items) {
    if (item.action === "todo" || item.action === "both") todos += 1;
    if (item.action === "event" || item.action === "both") events += 1;
  }
  return { todos, events };
}

export function normalizeTriage(value: unknown): MailTriage | undefined {
  return typeof value === "string" && (MAIL_TRIAGE as readonly string[]).includes(value)
    ? value as MailTriage
    : undefined;
}

/**
 * An item's triage, inferred for reviews saved before the field existed:
 * "other" mail is FYI, anything that auto-created something is tracked, and
 * the rest is assumed to need the user — over-flagging costs a glance,
 * under-flagging costs a missed deadline.
 */
export function triageOf(item: MailReviewItem): MailTriage {
  // Handled by the user is handled: it leaves "needs you" whatever the review said.
  if (item.done) return "tracked";
  if (item.triage) return item.triage;
  if (item.category === "other") return "fyi";
  return item.action === "none" ? "act" : "tracked";
}

/**
 * Items grouped by triage, each group soonest-due first. Undated items keep
 * their review order after the dated ones, and anything the user already
 * handled sinks below the rest — it is the one row that needs no reading.
 */
export function groupByTriage(items: readonly MailReviewItem[]): Record<MailTriage, MailReviewItem[]> {
  const groups: Record<MailTriage, MailReviewItem[]> = { act: [], tracked: [], fyi: [] };
  for (const item of items) groups[triageOf(item)].push(item);
  for (const list of Object.values(groups)) {
    list.sort((a, b) => Number(a.done ?? false) - Number(b.done ?? false)
      || (a.due ? 0 : 1) - (b.due ? 0 : 1)
      || (a.due ?? "").localeCompare(b.due ?? ""));
  }
  return groups;
}
