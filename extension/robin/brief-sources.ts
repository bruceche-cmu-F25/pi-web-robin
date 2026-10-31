/** Read-only, stored-data adapters. No Gmail refresh, research, model turn or domain mutation. */
import { storedMailReview } from "./mail-domain.ts";
import { calendarBoard, type CalendarBoard } from "./calendar-domain.ts";
import { listTodos, type Todo } from "./todo-domain.ts";
import { weeklyView } from "./ai-weekly-domain.ts";
import type { WeeklyView } from "./ai-weekly.ts";
import { triageOf, type MailReview } from "./mail.ts";
import { addDays, localDate } from "./dates.ts";
import { deduplicateCalendarEvents, eventsInRange } from "./events.ts";
import type { BriefInput, BriefItem, BriefScope, BriefSource } from "./brief.ts";

export interface StoredBriefReaders {
  mail: () => MailReview | null;
  calendar: () => Promise<CalendarBoard>;
  todos: () => { today: string; todos: Todo[] };
  world: () => Pick<WeeklyView, "edition" | "today">;
  now: () => Date;
}
const readers: StoredBriefReaders = {
  mail: storedMailReview,
  calendar: () => calendarBoard({ localOnly: true }),
  todos: listTodos,
  world: weeklyView,
  now: () => new Date(),
};
export async function collectStoredBriefSource(source: BriefSource, scope: BriefScope, signal: AbortSignal, deps = readers): Promise<BriefInput> {
  signal.throwIfAborted();
  const observed = deps.now();
  const base = { source, observedAt: observed.toISOString(), items: [] as BriefItem[] };
  if (scope.day !== localDate(observed)) return { ...base, coverage: "unavailable", detail: "Stored adapters cannot reconstruct a past day; start a new request for today" };
  if (source === "mail") {
    const review = deps.mail();
    if (!review) return { ...base, coverage: "unavailable", detail: "No stored mail review; the inbox has not been checked by this pipeline" };
    if (review.day !== scope.day) return { ...base, coverage: "stale", detail: `Stored mail review covers ${review.day}, not ${scope.day}` };
    const actionable = review.items.filter(i => !i.done && triageOf(i) === "act");
    return { ...base, coverage: actionable.length > 200 ? "partial" : "ready", detail: `Reused mail review from ${review.reviewedAt}; no new Gmail read${actionable.length > 200 ? "; truncated to 200 items" : ""}`,
      items: actionable.slice(0, 200).map(i => ({ id: `mail:${i.id}`, source, section: "attention", title: i.subject || i.summary, summary: i.summary,
        href: "/dashboard/gmail", ...(i.due ? { due: i.due } : {}),
        evidence: { kind: "stored-review", reference: i.id, ...(i.snippet ? { quote: i.snippet } : {}) } })) };
  }
  if (source === "calendar") {
    const board = await deps.calendar(); signal.throwIfAborted();
    const events = eventsInRange(deduplicateCalendarEvents(board.events), scope.day, scope.day);
    return { ...base, coverage: board.google.connected || events.length > 200 ? "partial" : "ready",
      detail: (board.google.connected ? "Local calendar only; connected Google events are not refreshed or included" : "Local calendar only; Google is not connected") + (events.length > 200 ? "; truncated to 200 items" : ""),
      items: events.slice(0, 200).map(e => ({ id: `calendar:${e.id}`, source, section: "schedule", title: e.title,
        summary: e.start ? `${e.start}${e.end ? ` – ${e.end}` : ""}` : "All-day", eventDate: e.date,
        href: `/dashboard?view=calendar&calendar=day&date=${encodeURIComponent(scope.day)}&event=${encodeURIComponent(e.id)}`,
        evidence: { kind: "record", reference: e.id } })) };
  }
  if (source === "todos") {
    const { todos } = deps.todos();
    const relevant = todos.filter(t => !t.done && !t.archivedAt && t.due && t.due <= addDays(scope.day, 2)).sort((a, b) => a.due!.localeCompare(b.due!));
    return { ...base, coverage: relevant.length > 200 ? "partial" : "ready", detail: `Stored unfinished deadlines through ${addDays(scope.day, 2)}${relevant.length > 200 ? "; truncated to 200 items" : ""}`,
      items: relevant.slice(0, 200).map(t => ({ id: `todo:${t.id}`, source, section: "tasks", title: t.title, summary: t.due!, due: t.due,
        href: `/dashboard?view=todos&todo=${encodeURIComponent(t.id)}`, evidence: { kind: "record", reference: t.id } })) };
  }
  const { edition } = deps.world();
  if (!edition) return { ...base, coverage: "unavailable", detail: "No stored weekly edition; no public research was performed" };
  const slot = edition.slots.find(s => s.date === scope.day);
  if (!slot) return { ...base, coverage: "stale", detail: `Weekly edition has no reading slot for ${scope.day}` };
  const story = slot.story;
  return { ...base, coverage: story ? "ready" : "partial", detail: `Reused weekly reading slot; reports ${edition.from} through ${edition.through}, not today's news${!story ? "; no reliable story in this slot" : ""}`,
    items: story ? [{ id: `world:${edition.week}:${story.key}`, source, section: "world", title: story.title,
      summary: story.what, href: story.source.url, eventDate: story.eventDate, publishedOn: story.source.publishedOn,
      evidence: { kind: "legacy-passage", reference: `${edition.week}:${slot.date}`, quote: story.source.quote, checkedAt: story.source.checkedAt } }] : [] };
}
