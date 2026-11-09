import { groupByTriage, type MailReview } from "../../extension/robin/mail.ts";
import { docket, dueAt, type Round } from "../../extension/robin/rounds.ts";
import type { Todo } from "../../extension/robin/todo-domain.ts";

export interface BriefAction { key: string; title: string; due?: string; href: string; source: "round" | "mail" | "todo" }

const hiring = /招聘|求职|岗位|职位|面试|猎头|recruit|hiring|interview|job|role|opportunity|founding/i;
const jobTodo = /招聘|求职|岗位|职位|面试|测评|猎头|\bOA\b|recruit|interview|\bjob\b/i;

/** Read-only projection. Recommendations, acknowledgements and expired interviews are not actions. */
export function jobBriefActions(rounds: Round[], todos: Todo[], review: MailReview | null, now = Date.now(), zh = true): BriefAction[] {
  const open = docket(rounds, now);
  const active = [...open.assessments, ...open.interviews].sort((a, b) => (dueAt(a) ?? Infinity) - (dueAt(b) ?? Infinity));
  const roundActions: BriefAction[] = active.slice(0, 4).map((round) => ({
    key: `round:${round.id}`,
    title: `${round.kind === "oa" ? (dueAt(round) !== null && dueAt(round)! < now ? (zh ? "核实过期测评" : "Verify overdue assessment") : (zh ? "完成测评" : "Complete assessment")) : (zh ? "准备并参加面试" : "Prepare for interview")} · ${round.company}${round.role ? ` — ${round.role}` : ""}`,
    due: round.due,
    href: round.threadId ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(round.threadId)}` : "#job-rounds",
    source: "round",
  }));
  const groups = groupByTriage(review?.items ?? []);
  const actionable = [...groups.act, ...groups.tracked].filter((item) =>
    item.category !== "oa" && item.category !== "interview" && !item.done
    && hiring.test(`${item.subject} ${item.summary} ${item.next ?? ""}`));
  const mailActions: BriefAction[] = actionable.slice(0, 3).map((item) => ({
    key: `mail:${item.id}`, title: item.next || item.subject,
    due: item.due,
    href: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(item.threadId || item.id)}`,
    source: "mail",
  }));
  const linked = new Set(active.map((round) => round.todoId).filter(Boolean));
  const todoActions: BriefAction[] = todos.filter((todo) => !todo.done && !todo.archivedAt && !linked.has(todo.id)
    && (jobTodo.test(todo.title) || (todo.title.startsWith("回复 ") && todo.url?.startsWith("mailto:"))))
    .filter((todo) => !actionable.some((item) => { const address = item.from.match(/<([^>]+)>/)?.[1] ?? item.from; return todo.url?.toLowerCase() === `mailto:${address.toLowerCase()}`; }))
    .sort((a, b) => (a.due ? 0 : 1) - (b.due ? 0 : 1) || (a.due ?? "").localeCompare(b.due ?? ""))
    .slice(0, 4).map((todo) => ({ key: `todo:${todo.id}`, title: todo.title, due: todo.due,
      href: `/dashboard?view=todos&todo=${encodeURIComponent(todo.id)}`, source: "todo" }));
  return [...roundActions, ...mailActions, ...todoActions];
}
