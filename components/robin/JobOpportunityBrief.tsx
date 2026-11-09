"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { MailReview } from "@/extension/robin/mail";
import type { Round } from "@/extension/robin/rounds";
import type { Todo } from "@/extension/robin/todo-domain";
import { jobBriefActions } from "./job-brief";
import { usePolledResource } from "./usePolledResource";
import styles from "./JobOpportunityBrief.module.css";

function dateLabel(due: string, locale: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    const [y, m, d] = due.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(locale, { month: "short", day: "numeric" });
  }
  return new Date(due).toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** A live view of recorded work, not a paid inbox check triggered by opening the page. */
export function JobOpportunityBrief() {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const [openedAt] = useState(() => Date.now());
  const mail = usePolledResource<{ review: MailReview | null; today: string; connected: boolean }>("/api/robin/gmail", 60_000);
  const rounds = usePolledResource<{ rounds: Round[] }>("/api/robin/rounds", 60_000);
  const todos = usePolledResource<{ todos: Todo[] }>("/api/robin/todos", 60_000);
  const actions = useMemo(() => jobBriefActions(rounds.data?.rounds ?? [], todos.data?.todos ?? [], mail.data?.review ?? null, openedAt, zh), [rounds.data, todos.data, mail.data, openedAt, zh]);
  const failed = Boolean(mail.error || rounds.error || todos.error);
  const pending = mail.loading || rounds.loading || todos.loading;

  return <section className={styles.brief} aria-labelledby="job-brief-title">
    <header className={styles.header}>
      <div>
        <p className="pi-eyebrow">{zh ? "求职 · 今日行动" : "Job hunt · next actions"}</p>
        <h2 id="job-brief-title">{zh ? "先做这些" : "Start here"}</h2>
      </div>
      <a href="/dashboard/gmail" className="ui-action pi-bracket">{zh ? "核查邮件 ↗" : "Check mail ↗"}</a>
    </header>
    {actions.length ? <ol className={styles.actions}>{actions.slice(0, 5).map((action) => <li key={action.key}>
      <a href={action.href} className={styles.action}>
        <span>{action.title}</span>
        <span className={styles.meta}>{action.due ? dateLabel(action.due, locale) : (zh ? "待处理" : "To do")} <span aria-hidden="true">↗</span></span>
      </a>
    </li>)}</ol> : <p className={styles.note} role={pending ? "status" : undefined}>
      {pending ? (zh ? "正在读取求职记录…" : "Loading job records…") : failed ? (zh ? "部分来源不可用，无法确认是否有待办。" : "Some sources unavailable; actions may be missing.") : (zh ? "已记录的求职事项中暂无待办；邮件是否有新消息仍需核查。" : "No recorded actions; check mail for new messages.")}
    </p>}
    {actions.length > 5 && <p className={styles.note}>{zh ? `还有 ${actions.length - 5} 项：` : `${actions.length - 5} more: `} <a href="#job-rounds">{zh ? "测评与面试" : "Rounds"}</a> · <a href="/dashboard?view=todos">{zh ? "全部待办" : "Tasks"}</a></p>}
    <p className={styles.note}>
      {failed && (zh ? "部分来源读取失败；" : "Some sources failed; ")}
      {mail.data?.review ? (zh ? `邮件审阅：${new Date(mail.data.review.reviewedAt).toLocaleString(locale, { hour: "numeric", minute: "2-digit" })} 更新。` : `Mail reviewed at ${new Date(mail.data.review.reviewedAt).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}.`) : (zh ? "今日邮件尚未核查；以上不代表收件箱已清空。" : "Mail not reviewed today; this is not an inbox all-clear.")}
      {mail.data && !mail.data.connected && (zh ? " Gmail 未连接。" : " Gmail disconnected.")}
    </p>
  </section>;
}
