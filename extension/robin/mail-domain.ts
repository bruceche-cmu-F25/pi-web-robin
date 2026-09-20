/**
 * Today's email review.
 *
 * Two adapters read this: the dashboard's HTTP route and the `gmail_review`
 * Pi tool that writes it. The "is it still today's?" rule below is the reason
 * it is worth a module — a review from yesterday is not today's mail, and a
 * page that showed one anyway would be quietly lying every morning.
 */
import { localDate } from "./dates.ts";
import { isConnected } from "./google-calendar.ts";
import type { MailReview } from "./mail.ts";
import { readMailReview, writeMailReview } from "./store.ts";

export interface MailBoard {
  /** Whether a Google account is connected at all. */
  connected: boolean;
  today: string;
  /** Today's review, or null — including when the stored one is from a past day. */
  review: MailReview | null;
}

/**
 * Everything the mail page renders, without calling Gmail.
 *
 * The review is produced by the mail-review turn and stored on disk; this only
 * reports it. The items carry their own metadata, so the page renders
 * instantly and still works when Gmail is unreachable.
 */
export function mailBoard(): MailBoard {
  const today = localDate();
  const review = readMailReview();
  return {
    connected: isConnected(),
    today,
    review: review && review.day === today ? review : null,
  };
}

/**
 * Attach the assistant's report to today's review.
 *
 * The report is the turn's final text, produced after gmail_review already
 * wrote the items — so it has to be merged in a second step. An empty inbox is
 * still a review ("no mail" is information), so a turn with no items still
 * creates a shell review rather than dropping the report.
 */
export function attachMailReport(reply: string): void {
  const report = reply.trim();
  if (!report) return;
  const review = readMailReview();
  writeMailReview(review
    ? { ...review, report }
    : { day: localDate(), reviewedAt: new Date().toISOString(), items: [], report });
}

/** The stored review as written, whatever day it is from. */
export function storedMailReview(): MailReview | null {
  return readMailReview();
}

/** Replace today's review wholesale; a second check the same day overwrites the first. */
export function saveMailReview(items: MailReview["items"]): MailReview {
  const review: MailReview = { day: localDate(), reviewedAt: new Date().toISOString(), items };
  writeMailReview(review);
  return review;
}
