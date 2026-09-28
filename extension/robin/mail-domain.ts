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
  /**
   * When the stored review was saved, if it is not today's. A page that only
   * said "not checked today" could not tell a quiet morning from a scheduled
   * check that has been failing for days.
   */
  lastReviewedAt: string | null;
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
  const current = review && review.day === today ? review : null;
  return {
    connected: isConnected(),
    today,
    review: current,
    lastReviewedAt: !current && review ? review.reviewedAt : null,
  };
}

/**
 * Mark one of today's items handled, or undo that.
 *
 * The page is read-only towards Gmail; this only moves the item out of "needs
 * you" so the page stops asking for attention it has already had.
 */
export function markMailDone(id: string, done: boolean): MailBoard | { error: string } {
  const review = readMailReview();
  if (!review || review.day !== localDate()) return { error: "There is no review for today." };
  const item = review.items.find((entry) => entry.id === id);
  if (!item) return { error: `No email "${id}" in today's review.` };
  if (done) item.done = true;
  else delete item.done;
  writeMailReview(review);
  return mailBoard();
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
export function saveMailReview(
  items: MailReview["items"],
  brief: Pick<MailReview, "headline" | "skipped"> = {},
): MailReview {
  const headline = brief.headline?.trim();
  const skipped = typeof brief.skipped === "number" && Number.isFinite(brief.skipped) && brief.skipped > 0
    ? Math.floor(brief.skipped)
    : undefined;
  // A re-check re-reads mail the user already dealt with: newer_than:1d
  // overlaps the previous run, and a second check the same day reads it all.
  // Their "done" is a fact about the email, not about one review of it.
  const handled = new Set((readMailReview()?.items ?? []).filter((item) => item.done).map((item) => item.id));
  const review: MailReview = {
    day: localDate(),
    reviewedAt: new Date().toISOString(),
    items: items.map((item) => (handled.has(item.id) ? { ...item, done: true } : item)),
    ...(headline ? { headline } : {}),
    ...(skipped ? { skipped } : {}),
  };
  writeMailReview(review);
  return review;
}
