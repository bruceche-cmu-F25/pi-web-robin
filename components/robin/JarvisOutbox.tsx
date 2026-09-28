"use client";

import { useState, type CSSProperties } from "react";
import { DEFAULT_JARVIS_OUTBOX, type JarvisLead, type JarvisOutbox as Outbox } from "@/extension/robin/jarvis-shape";
import styles from "./JarvisDiscovery.module.css";

const DEFAULT_ZONE = "America/New_York";

/** Mirrors the server outbox's window: weekdays 08:00–17:59 in the recipient's zone. */
function inWindow(zone: string, at: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return !["Sat", "Sun"].includes(parts.find((part) => part.type === "weekday")?.value ?? "") && hour >= 8 && hour < 18;
}
function nextWindow(zone: string, from: Date): Date | null {
  const at = new Date(from);
  at.setMinutes(0, 0, 0);
  for (let i = 0; i < 24 * 8; i++) {
    at.setHours(at.getHours() + 1);
    if (inWindow(zone, at)) return at;
  }
  return null;
}
/** The next weekday 08:00 on this browser's clock: the default a scheduled start offers. */
function nextMorning(from: Date): Date {
  const at = new Date(from);
  at.setHours(8, 0, 0, 0);
  if (at <= from) at.setDate(at.getDate() + 1);
  while (at.getDay() === 0 || at.getDay() === 6) at.setDate(at.getDate() + 1);
  return at;
}
const toInputValue = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
/** Average of the server's 6–12 minute randomized gap. */
const AVERAGE_GAP_MS = 9 * 60_000;
/**
 * When each queued email should go out, replaying the server's rules: not before
 * the scheduled start, one at a time, inside each recipient's window. The gap is
 * randomized on the server, so these are estimates.
 */
export function estimateSendTimes(queue: JarvisLead[], from: Date, dailyLimit?: number, sentToday = 0): Map<string, Date> {
  const times = new Map<string, Date>();
  let at = new Date(from);
  let day = at.toDateString(), count = sentToday;
  for (const lead of queue) {
    const zone = lead.timeZone || DEFAULT_ZONE;
    for (let guard = 0; guard < 60; guard++) {
      if (!inWindow(zone, at)) { at = nextWindow(zone, at) ?? at; }
      if (at.toDateString() !== day) { day = at.toDateString(); count = 0; }
      if (!dailyLimit || count < dailyLimit) break;
      const tomorrow = new Date(at); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(0, 0, 0, 0);
      at = tomorrow;
    }
    times.set(lead.id, new Date(at));
    count++;
    at = new Date(at.getTime() + AVERAGE_GAP_MS);
  }
  return times;
}
export const queueOrder = (leads: JarvisLead[]) => leads.filter((lead) => lead.queuedAt && !lead.sendAttempt).sort((a, b) => a.queuedAt!.localeCompare(b.queuedAt!));

type State = "paused" | "blocked" | "idle" | "scheduled" | "sending" | "waiting" | "limit";

export function JarvisOutbox({ leads, outbox: stored, sentToday, checked, busy, zh, locale, onQueue, onTickAll, onClear, onToggle, onStart, onUnqueue, onSelect, onSync, onLimit, queueable, tiers }: {
  leads: JarvisLead[]; outbox?: Outbox; sentToday: number; checked: number; queueable: number; busy: boolean; zh: boolean; locale: string;
  tiers: Array<{ tier: "A" | "B"; total: number; reachable: number; sent: number; replied: number }>;
  onQueue: () => void; onTickAll: () => void; onClear: () => void; onToggle: () => void;
  /** Turn sending on from `startAt`, or right away with null. */
  onStart: (startAt: string | null) => void; onUnqueue: (id: string) => void; onSelect: (id: string) => void; onSync: () => void; onLimit: (limit: number) => void;
}) {
  const t = (cn: string, en: string) => zh ? cn : en;
  const outbox = { ...DEFAULT_JARVIS_OUTBOX, ...stored };
  const queue = queueOrder(leads);
  const now = new Date();
  const sent = leads.filter((lead) => lead.sendAttempt?.state === "sent" || lead.sentAt).length;
  const replied = leads.filter((lead) => lead.repliedAt).length;
  const followUps = leads.filter((lead) => lead.followUpAttempt).length;
  const openable = queue.find((lead) => inWindow(lead.timeZone || DEFAULT_ZONE, now));
  const startAt = outbox.startAt && Date.parse(outbox.startAt) > now.getTime() ? new Date(outbox.startAt) : null;
  const state: State = outbox.pausedReason ? "blocked" : !outbox.enabled ? "paused" : !queue.length ? "idle"
    : startAt ? "scheduled"
    : outbox.dailyLimit && sentToday >= outbox.dailyLimit ? "limit" : openable ? "sending" : "waiting";
  const first = queue[0];
  const reopen = first && state === "waiting" ? nextWindow(first.timeZone || DEFAULT_ZONE, now) : null;
  const when = (date: Date) => date.toLocaleString(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const clock = (date: Date) => date.toLocaleString(locale, date.toDateString() === now.toDateString() ? { hour: "2-digit", minute: "2-digit" } : { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const [scheduleInput, setScheduleInput] = useState(() => toInputValue(nextMorning(new Date())));
  const running = state === "sending" || state === "waiting" || state === "limit" || state === "scheduled";
  const estimates = outbox.enabled && !outbox.pausedReason
    ? estimateSendTimes(queue, startAt ?? now, outbox.dailyLimit, sentToday)
    : null;
  const schedule = () => {
    const at = new Date(scheduleInput);
    if (Number.isFinite(at.getTime())) onStart(at.toISOString());
  };
  const headline: Record<State, string> = {
    blocked: t("已自动暂停", "Paused automatically"),
    paused: t("已暂停", "Paused"),
    idle: t("队列为空", "Queue empty"),
    scheduled: t(`已定时 · ${startAt ? when(startAt) : ""} 开始`, `Scheduled · starts ${startAt ? when(startAt) : ""}`),
    sending: t("正在发送", "Sending"),
    waiting: t("等待对方工作时间", "Waiting for working hours"),
    limit: t("今日已达上限", "Daily limit reached"),
  };
  const detail: Record<State, string> = {
    blocked: outbox.pausedReason ?? "",
    paused: t("排队的邮件会保留，恢复后继续发送。", "Queued emails stay queued and continue when resumed."),
    idle: t("在下方名单里勾选有邮箱的联系人，然后批准并排队。", "Tick contacts with an email in the list below, then approve and queue them."),
    scheduled: t(`${queue.length} 封会从这个时间起逐封发出（你的时间），之前一封都不会发。`, `${queue.length} emails go out one at a time from then (your time); nothing is sent before.`),
    sending: t(`每 6–12 分钟发出一封，下一封给 ${openable?.name ?? ""}。`, `One every 6–12 minutes; next to ${openable?.name ?? ""}.`),
    waiting: reopen ? t(`下一个发送窗口：${when(reopen)}（你的时间）`, `Next window: ${when(reopen)} (your time)`) : "",
    limit: t("明天继续。", "Continues tomorrow."),
  };
  const tiles: Array<[number | string, string, string, number?]> = [
    [queue.length, t("排队中", "Queued"), "ready"],
    outbox.dailyLimit ? [`${sentToday}/${outbox.dailyLimit}`, t("今日已发", "Sent today"), "sent", sentToday / outbox.dailyLimit] : [sentToday, t("今日已发 · 不限", "Sent today · no cap"), "sent"],
    [sent, t("累计已发", "Total sent"), "sent"],
    [replied, sent ? t(`已回复 · ${Math.round(replied / sent * 100)}%`, `Replied · ${Math.round(replied / sent * 100)}%`) : t("已回复", "Replied"), "replied"],
    [followUps, t("自动跟进", "Follow-ups"), "sent"],
  ];

  return <section className={styles.outbox} data-state={state} aria-label={t("发送台", "Outbox")}>
    <header className={styles.outboxHead}>
      <div className={styles.outboxStatus}>
        <span className={styles.outboxEyebrow}>OUTBOX</span>
        <h2>{state === "sending" ? <span className={styles.pulse} aria-hidden /> : null}{headline[state]}</h2>
        <p role={state === "blocked" ? "alert" : "status"}>{detail[state]}</p>
        {outbox.message && state !== "blocked" ? <p className={styles.outboxLast}>{t("最近", "Last")}: {outbox.message}</p> : null}
      </div>
      <div className={styles.outboxTiles}>
        {tiles.map(([value, label, tone, share]) => <div key={label} data-tone={tone}>
          <strong>{value}</strong><span>{label}</span>
          {share !== undefined ? <i className={styles.meter} style={{ "--p": `${Math.min(100, share * 100)}%` } as CSSProperties} aria-hidden /> : null}
        </div>)}
      </div>
    </header>

    <p className={styles.outboxExperiment}>
      <span>{t("实验：executive 有没有这个需求？", "Experiment: do executives want this?")}</span>
      {tiers.map((row) => <span key={row.tier} data-tier={row.tier}><b className={styles.tierBadge} data-tier={row.tier}>{row.tier}</b> {t(`已发 ${row.sent} · 回复 ${row.replied}`, `${row.sent} sent · ${row.replied} replied`)}{row.sent ? ` · ${Math.round(row.replied / row.sent * 100)}%` : ""} · {t(`可发 ${row.reachable}`, `${row.reachable} reachable`)}</span>)}
    </p>
    {queue.length ? <div className={styles.outboxControl}>
      {running
        ? <button type="button" className={styles.outboxGo} data-tone="pause" disabled={busy} onClick={onToggle}>{t("暂停发送", "Pause sending")}</button>
        : <button type="button" className={styles.outboxGo} disabled={busy} onClick={() => onStart(null)}>{t(`▶ 立即开始发送 ${queue.length} 封`, `▶ Start sending ${queue.length} now`)}</button>}
      {state === "scheduled" ? <button type="button" className="ui-action pi-bracket" disabled={busy} onClick={() => onStart(null)}>{t("改为立即开始", "Start now instead")}</button> : null}
      <label className={styles.outboxWhen}>
        <span>{state === "scheduled" ? t("改定时", "Reschedule") : t("定时开始", "Schedule start")}</span>
        <input type="datetime-local" value={scheduleInput} disabled={busy} onChange={(e) => setScheduleInput(e.target.value)} />
      </label>
      <button type="button" className="ui-action pi-bracket" disabled={busy || !scheduleInput} onClick={schedule}>{t("定时发送", "Schedule")}</button>
    </div> : null}
    {queue.length ? <section className={styles.outboxSchedule} aria-label={t("已排期的邮件", "Scheduled emails")}>
      <h3 className="pi-label">{t(`已排期 · ${queue.length} 封`, `Scheduled · ${queue.length}`)}<small>{estimates ? t("时间为估算（你的时间），实际间隔随机 6–12 分钟", "Estimated, your time; the real gap is a random 6–12 minutes") : t("发送已暂停，恢复后按顺序发出", "Sending is paused; these go out in order once resumed")}</small></h3>
      <ol>
        {queue.map((lead, index) => {
          const at = estimates?.get(lead.id);
          return <li key={lead.id}>
            <span className={styles.outboxSlot}>{index + 1}</span>
            <time dateTime={at?.toISOString()}>{at ? `≈ ${clock(at)}` : "—"}</time>
            <button type="button" className={styles.outboxWho} onClick={() => onSelect(lead.id)}><strong>{lead.name}</strong><small>{lead.company}</small></button>
            <span className={styles.outboxAddr}>{lead.email}</span>
            <span className={styles.outboxSubject} title={lead.body}>{lead.subject}</span>
            <button type="button" className="ui-action pi-bracket text-xs" disabled={busy} onClick={() => onUnqueue(lead.id)}>{t("移出", "Remove")}</button>
          </li>;
        })}
      </ol>
    </section> : null}

    <div className={styles.outboxActions}>
      <button type="button" className={`ui-action pi-bracket ${styles.outboxPrimary}`} disabled={busy || !checked} onClick={onQueue}>
        {checked ? t(`批准并排队 ${checked} 封`, `Approve and queue ${checked}`) : t("先在名单里勾选联系人", "Tick contacts in the list first")}
      </button>
      <button type="button" className="ui-action pi-bracket" disabled={busy || !queueable} onClick={onTickAll}>{t(`勾选当前可排队的 ${queueable} 位`, `Tick all ${queueable} queueable shown`)}</button>
      {checked ? <button type="button" className="ui-action pi-bracket" disabled={busy} onClick={onClear}>{t("清除勾选", "Clear ticks")}</button> : null}
      <span className={styles.outboxSpacer} />
      {queue.length ? null : <button type="button" className={`ui-action pi-bracket ${state === "blocked" || state === "paused" ? styles.outboxResume : ""}`} disabled={busy} onClick={onToggle}>
        {state === "blocked" || state === "paused" ? t("恢复发送", "Resume sending") : t("暂停发送", "Pause sending")}
      </button>}
      <button type="button" className="ui-action pi-bracket" disabled={busy} onClick={onSync}>{t("立即检查回复", "Check replies now")}</button>
      <label className="text-xs">{t("每日上限", "Daily limit")} <select value={outbox.dailyLimit ?? 0} disabled={busy} onChange={(e) => onLimit(Number(e.target.value))}><option value={0}>{t("不限", "No cap")}</option>{[20, 50, 100].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
    </div>
    <details className={styles.outboxRules}>
      <summary>{t("发送规则", "How sending works")}</summary>
      <p>{t("只发你批准并排队的人：邮箱须在来源页确认过、且从未联系过。对方工作日 8–18 点（按对方时区，未知时按美东）逐封发送，间隔 6–12 分钟（每天大约 50–100 封）；默认不设每日上限，可在右侧设置，上限含跟进和手动发送。每 15 分钟读取 Gmail：回复标为已回复、退信标为退信，自动回复忽略。7 天无回复在原线程自动跟进一次。发送结果不确定或 24 小时内 3 封退信会自动暂停；先查 Gmail 已发送再恢复。", "Only contacts you approve and queue are sent: the email must be confirmed on its source page and never contacted before. One at a time during the recipient's weekday 8:00–18:00 (their zone, else US Eastern), 6–12 minutes apart (roughly 50–100 a day); no daily cap by default, and an optional cap counts follow-ups and manual sends. Gmail is read every 15 minutes: replies mark Replied, bounces mark Bounced, auto-replies are ignored. One follow-up goes out in the same thread after 7 days without a reply. An uncertain send or 3 bounces in 24 hours pauses the outbox; check Gmail Sent before resuming.")}</p>
    </details>
  </section>;
}
