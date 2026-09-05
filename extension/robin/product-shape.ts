/**
 * The product vocabulary the browser also needs.
 *
 * Pure logic only — no node builtins. ./product-domain.ts reads and writes the
 * JSON store through ./paths.ts, so a client component that value-imports
 * anything from it drags `node:fs` into the browser bundle; Turbopack does not
 * merely warn about that, it panics and takes the dev server down. Same rule
 * as ./links.ts, and the same split: names and pure functions live here, the
 * file access lives there, and product-domain re-exports these so the
 * extension side keeps one import.
 */

/**
 * Where an idea sits, and whether it is set aside.
 *
 * These replace a three-state field (thinking / making / parked), which itself
 * replaced a six-column pipeline. The pipeline is back — but as a playbook
 * rather than a set of buckets, so the step now carries instructions instead
 * of only a label; see ./product-playbook.ts. Parked is separate because it is
 * orthogonal: you can set something aside from any step, and when you pick it
 * up again you want to be back where you left off, not at the start.
 */
export type { StepId } from "./product-playbook.ts";

/**
 * The one thing that has to be true, and the day you said you would check.
 *
 * Not a scorecard. The eight-dimension weighted version of this shipped and
 * was never filled in once, because scoring an idea across eight axes is a
 * chore you do instead of the research, not before it. One claim and one date
 * is the smallest thing that can still be wrong — and being able to be wrong
 * is the entire point: a list of ideas that can only grow is a graveyard.
 */
export interface IdeaBet {
  claim: string;
  /** YYYY-MM-DD. */
  by?: string;
  settled?: "held" | "broke";
  settledAt?: string;
}

/** How long an idea can sit untouched before saying so. */
export const STALE_AFTER_DAYS = 60;

/**
 * What, if anything, this idea needs said about it.
 *
 * Derived rather than stored, so it can never disagree with the record. Both
 * answers are about time passing rather than about the idea's merits, which is
 * the only judgement a list is entitled to make on its own:
 *
 * - `overdue` — you named a claim and a date to check it by, and the date went
 *   past. This is the one that should sting.
 * - `stale` — an idea still in the first three steps has not been touched in
 *   two months. That is information about you, not about the idea.
 *
 * Something you are actively building is never either: the work is the signal.
 * Nor is anything you have deliberately parked — that decision was already
 * made, and nagging about it would teach you to ignore the marker.
 */
export function ideaAttention(
  idea: { step: string; parked?: boolean; updatedAt: string; bet?: IdeaBet },
  today: string,
): "overdue" | "stale" | null {
  // Past the validate step you are building, and the work is the signal.
  const building = idea.step === "build" || idea.step === "improve" || idea.step === "launch";
  if (building && !idea.parked) return null;
  if (idea.bet?.by && !idea.bet.settled && idea.bet.by < today) return "overdue";
  if (idea.parked || building) return null;
  const days = (Date.parse(`${today}T00:00:00`) - Date.parse(idea.updatedAt)) / 86_400_000;
  return Number.isFinite(days) && days > STALE_AFTER_DAYS ? "stale" : null;
}

export type LibraryCategory = "source" | "test" | "tool" | "stack" | "distribution";
export type LibraryStatus = "recommended" | "saved" | "using" | "archived";

/**
 * What a resource costs, coarse enough to filter on.
 *
 * `price` is free text doing three different jobs — money ("$0+", "Free /
 * Paid"), effort ("Time"), and a deferral ("Check official pricing") — because
 * it has to describe a playbook and a SaaS subscription in the same column.
 * Rather than force those into one enum and lose what the string actually
 * says, the string stays as written and this derives the one question anyone
 * asks a tool library: can I start without paying?
 *
 * "unknown" is a real answer here, not a gap to be tidied away: it is every
 * price nobody has verified yet, and it is the band you select when you sit
 * down to check them.
 */
export type PriceBand = "free" | "paid" | "time" | "unknown";

export function priceBand(price: string): PriceBand {
  const value = price.trim().toLowerCase();
  if (!value) return "unknown";
  // A free tier is a free tier, so "Free / Paid" lands with the free ones —
  // the question is whether you can begin, not whether you can finish.
  if (value.includes("free") || value.startsWith("$0")) return "free";
  if (value.includes("time")) return "time";
  if (value.includes("check") || value === "reference") return "unknown";
  if (value.includes("paid") || value.includes("low") || value.includes("variable") || value.includes("$")) return "paid";
  return "unknown";
}
