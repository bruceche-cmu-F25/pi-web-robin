"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { MailBoard } from "@/extension/robin/mail-domain";
import type { Round } from "@/extension/robin/rounds";
import type { Todo } from "@/extension/robin/todo-domain";
import { parseLocalDate } from "@/extension/robin/dates";
import { dashboardAttention, type AttentionItem } from "./dashboard-attention";
import { mutateResponse, usePolledResource } from "./usePolledResource";
import { requestRefresh } from "./refreshBus";
import styles from "./AttentionPanel.module.css";

export function AttentionPanel() {
  const { t, locale } = useI18n();
  const rounds = usePolledResource<{ rounds: Round[] }>("/api/robin/rounds");
  const mail = usePolledResource<MailBoard>("/api/robin/gmail");
  const todos = usePolledResource<{ todos: Todo[]; today: string }>("/api/robin/todos");
  const panel = useRef<HTMLElement>(null);
  const saving = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [settled, setSettled] = useState<{ item: AttentionItem; status: "done" | "missed" | "cancelled" } | null>(null);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const today = todos.data?.today ?? mail.data?.today ?? "";
  const items = useMemo(() => now !== null && today && todos.data
    ? dashboardAttention(rounds.data?.rounds ?? [], mail.data?.review ?? null, todos.data.todos ?? [], today, now)
    : [], [now, today, rounds.data, mail.data, todos.data]);
  const failed = Boolean(rounds.error || mail.error || todos.error);
  const visible = items.length > 0 || failed || Boolean(settled || actionError);
  async function settle(item: AttentionItem, status: "done" | "missed" | "cancelled" | "open") {
    // Serialize this panel's writes: mail responses contain a whole review snapshot.
    if (saving.current) return;
    saving.current = true; setPending(item.id); setActionError(null);
    try {
      if (item.kind === "mail") {
        const response = await mutateResponse("/api/robin/gmail", "PATCH", { id: item.sourceId, done: status !== "open" });
        const board = await response.json() as MailBoard;
        mail.updateData(() => board);
      } else {
        const response = await mutateResponse("/api/robin/rounds", "PATCH", { id: item.sourceId, status });
        const { round } = await response.json() as { round: Round };
        rounds.updateData((current) => current && { ...current, rounds: current.rounds.map((entry) => entry.id === round.id ? round : entry) });
        // The round domain mirrors its linked todo in the same transaction.
        if (round.todoId) todos.updateData((current) => current && { ...current, todos: current.todos.map((todo) => todo.id === round.todoId ? { ...todo, done: status !== "open" } : todo) });
      }
      setSettled(status === "open" ? null : { item, status });
      panel.current?.focus({ preventScroll: true });
      requestRefresh();
    } catch (caught) {
      setActionError(`${item.title}: ${caught instanceof Error ? caught.message : String(caught)}`);
    } finally { saving.current = false; setPending(null); }
  }
  const when = (due: string) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(due) ? parseLocalDate(due) : new Date(due);
    return Number.isNaN(date.getTime()) ? due : date.toLocaleString(locale, {
      month: "short", day: "numeric", ...(!/^\d{4}-\d{2}-\d{2}$/.test(due) ? { hour: "2-digit", minute: "2-digit" } as const : {}),
    });
  };
  return <section ref={panel} id="dashboard-attention" hidden={!visible} tabIndex={-1} className={`pi-card scroll-mt-24 p-4 ${styles.panel}`}>
    {visible && <>
      <header className={styles.header}>
        <h2 className="pi-section-title">{t("robin.attention.title")}</h2>
        {items.length > 0 && <span className="pi-meta">{items.length}</span>}
      </header>
      <p className={styles.hint}>{t("robin.attention.hint")}</p>
      {failed && <p role="alert" className={styles.error}>{t("robin.attention.loadFailed")}</p>}
      {actionError && <p role="alert" className={styles.error}>{actionError}</p>}
      {settled && <div className={styles.feedback}>
        <span role="status">{t("robin.attention.settled", { title: settled.item.title, status: t(settled.item.kind === "mail" ? "robin.gmail.doneBadge" : `robin.rounds.status.${settled.status}`) })}</span>
        <button type="button" className="ui-action pi-bracket" aria-label={t("robin.gmail.undoDone")} disabled={pending !== null} onClick={() => void settle(settled.item, "open")}>{t("robin.gmail.undoDone")}</button>
        <button type="button" className="ui-action" disabled={pending !== null} aria-label={t("i18n.close")} onClick={() => setSettled(null)}>×</button>
      </div>}
      <ul className={styles.list}>
        {items.slice(0, 5).map((item) => <li key={item.id} data-attention-id={item.id} aria-busy={pending === item.id}>
          <div className={styles.row}>
          <a href={item.href} className={styles.item} {...(item.kind === "mail" ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            <span className={styles.kind}>{t(item.kind === "mail" ? "robin.gmail.title" : `robin.rounds.kind.${item.kind}`)}</span>
            <span className={styles.copy}><strong>{item.title}</strong>{item.detail && <span>{item.detail}</span>}</span>
            <span className={styles.deadline} data-overdue={item.overdue || undefined}>
              {item.overdue && <span>{t("robin.rounds.overdue")} · </span>}
              {item.due ? <time dateTime={item.due}>{when(item.due)}</time> : t("robin.attention.noDeadline")}
            </span>
          </a>
          <div className={styles.actions} data-kind={item.kind}>
            {pending === item.id && <span role="status">{t("robin.calendar.saving")}</span>}
            {(item.kind === "mail" ? ["done"] as const : ["done", "missed", "cancelled"] as const).map((status) =>
              <button key={status} type="button" className="ui-action pi-bracket" disabled={pending !== null}
                aria-label={t("robin.attention.setStatus", { title: item.title, status: t(item.kind === "mail" ? "robin.gmail.doneBadge" : `robin.rounds.status.${status}`) })}
                onClick={() => void settle(item, status)}>
                {t(item.kind === "mail" ? "robin.gmail.markDone" : `robin.rounds.action.${status}`)}
              </button>)}
          </div>
          </div>
        </li>)}
      </ul>
      {items.length > 5 && <p className={styles.hint}>{t("robin.attention.more", { count: String(items.length - 5) })}</p>}
      <footer className={styles.footer}>
        <Link href="/dashboard/jobs#jobs-rounds" className="ui-action pi-bracket text-xs">{t("robin.rounds.title")} →</Link>
        <Link href="/dashboard/gmail#mail-act" className="ui-action pi-bracket text-xs">{t("robin.gmail.title")} →</Link>
      </footer>
    </>}
  </section>;
}
