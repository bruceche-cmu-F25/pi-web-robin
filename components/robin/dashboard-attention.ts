import { addDays } from "../../extension/robin/dates.ts";
import { triageOf, type MailReview } from "../../extension/robin/mail.ts";
import { docket, dueAt, roundDay, type Round } from "../../extension/robin/rounds.ts";
import type { Todo } from "../../extension/robin/todo-domain.ts";

export interface AttentionItem {
  id: string;
  /** Exact source identity for settlement; display ids are namespaced separately. */
  sourceId: string;
  kind: "oa" | "interview" | "mail";
  title: string;
  detail?: string;
  due?: string;
  href: string;
  overdue: boolean;
}

function mailReference(url: string | undefined): string | undefined {
  if (!url) return;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "mail.google.com") return;
    const id = parsed.hash.match(/^#(?:all|inbox|sent)\/([^/?]+)$/)?.[1];
    return id ? decodeURIComponent(id) : undefined;
  } catch { return; }
}

/** A read-only projection of existing work, not another task store or an AI scan. */
export function dashboardAttention(rounds: Round[], review: MailReview | null, todos: Todo[], today: string, now: number): AttentionItem[] {
  const todoIds = new Set(todos.map((todo) => todo.id));
  const trackedMail = new Set(todos.map((todo) => mailReference(todo.url)).filter(Boolean));
  const roundMail = new Set(rounds.map((round) => round.threadId).filter(Boolean));
  const horizon = addDays(today, 7);
  const { assessments, interviews } = docket(rounds, now);
  // A date-only interview today has no known start time; do not expire it at 02:00.
  const todayInterviews = rounds.filter((round) => round.status === "open" && round.kind === "interview" && round.due === today);
  const open = new Map([...assessments, ...interviews, ...todayInterviews].map((round) => [round.id, round]));
  const candidates: (AttentionItem & { at: number })[] = [];
  for (const round of open.values()) {
    if (round.todoId && todoIds.has(round.todoId)) continue;
    const day = roundDay(round.due);
    if (day && day > horizon) continue;
    const at = dueAt(round);
    candidates.push({
      id: `round:${round.id}`, sourceId: round.id, kind: round.kind, title: round.company,
      detail: [round.role, round.detail].filter(Boolean).join(" · ") || undefined,
      due: round.due, href: "/dashboard/jobs#jobs-rounds", overdue: round.kind === "oa" && at !== null && at < now,
      at: at ?? Infinity,
    });
  }
  // Do not resurface yesterday's mail, completed items or items already tracked elsewhere.
  if (review?.day === today) for (const mail of review.items) {
    if (triageOf(mail) !== "act" || mail.action !== "none") continue;
    if (trackedMail.has(mail.id) || trackedMail.has(mail.threadId)) continue;
    if ((mail.category === "oa" || mail.category === "interview") && (roundMail.has(mail.id) || roundMail.has(mail.threadId))) continue;
    const at = mail.due ? dueAt({ kind: "oa", due: mail.due }) : null;
    candidates.push({
      id: `mail:${mail.id}`, sourceId: mail.id, kind: "mail", title: mail.next || mail.subject,
      detail: mail.summary, due: mail.due,
      href: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(mail.threadId || mail.id)}`,
      overdue: at !== null && at < now, at: at ?? Infinity,
    });
  }
  return candidates.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
