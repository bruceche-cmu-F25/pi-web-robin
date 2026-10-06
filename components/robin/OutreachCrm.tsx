"use client";

import { useMemo, useState } from "react";
import type { JarvisLead } from "@/extension/robin/jarvis-shape";
import { channelName, OUTREACH_CHANNELS, OUTREACH_STATES, outreachDisplayState, type OutreachChannel } from "@/extension/robin/outreach-shape";
import { filterOutreachActivity, outreachActivity, outreachDate, summarizeOutreach } from "@/lib/outreach-crm";
import styles from "./OutreachCrm.module.css";

export function OutreachCrm({ leads, zh, loading, error, audienceLabel }: {
  leads: JarvisLead[]; zh: boolean; loading: boolean; error?: string | null; audienceLabel: (lead: JarvisLead) => string;
}) {
  const t = (cn: string, en: string) => zh ? cn : en;
  const [period, setPeriod] = useState("today");
  const [date, setDate] = useState(() => outreachDate(new Date()));
  const [channel, setChannel] = useState<OutreachChannel | "all">("all");
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState("persona");
  const activity = useMemo(() => outreachActivity(leads), [leads]);
  const today = outreachDate(new Date());
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 6);
  const start = period === "today" ? today : period === "week" ? outreachDate(weekStart) : period === "date" ? date : "";
  const end = period === "all" ? "" : period === "date" ? date : today;
  const rows = filterOutreachActivity(activity, start, end, channel);
  const summary = summarizeOutreach(rows);
  const groups = new Map<string, number>();
  for (const lead of summary.people) {
    const label = groupBy === "industry" ? lead.industry.trim() || t("未分类", "Unclassified") : audienceLabel(lead);
    groups.set(label, (groups.get(label) ?? 0) + 1);
  }
  const composition = [...groups].sort((a, b) => b[1] - a[1]);
  const shown = rows.filter(({ lead }) => `${lead.name} ${lead.company} ${lead.role}`.toLowerCase().includes(query.trim().toLowerCase()));
  const maxChannel = Math.max(1, ...summary.channels.map((c) => c.messages));
  if (loading) return <p role="status">{t("正在加载 CRM…", "Loading CRM…")}</p>;
  if (error && !leads.length) return <p role="alert">{error}</p>;
  return <section className={styles.crm} aria-label={t("CRM 概览", "CRM overview")}>
    <header className={styles.header}><div><span className="pi-eyebrow">OUTREACH / CRM</span><h2>{t("每一次联系，都有迹可循。", "Every conversation starts somewhere.")}</h2><p>{period === "all" ? t("全部已记录发送", "All recorded sends") : `${start}${start !== end ? ` — ${end}` : ""}`} · {t("按本地时区", "Local timezone")} {Intl.DateTimeFormat().resolvedOptions().timeZone}</p></div>
      <div className={styles.filters}><label>{t("时间范围", "Period")}<select value={period} onChange={e => setPeriod(e.target.value)}><option value="today">{t("今天", "Today")}</option><option value="week">{t("近 7 天", "Last 7 days")}</option><option value="all">{t("全部", "All time")}</option><option value="date">{t("指定日期", "Choose date")}</option></select></label>{period === "date" ? <label>{t("日期", "Date")}<input type="date" value={date} onChange={e => { if (e.target.value) setDate(e.target.value); }} /></label> : null}<label>{t("渠道", "Channel")}<select value={channel} onChange={e => setChannel(e.target.value as typeof channel)}><option value="all">{t("全部渠道", "All channels")}</option>{OUTREACH_CHANNELS.map(c => <option key={c} value={c}>{channelName(c)}</option>)}</select></label></div>
    </header>
    {error ? <p role="alert">{t("刷新失败，以下为上次加载的数据：", "Refresh failed; showing previously loaded data: ")}{error}</p> : null}
    <div className={styles.metrics}>{[
      [t("发送消息", "Messages sent"), summary.messages, t("含首次联系与跟进", "Initial messages and follow-ups")],
      [t("联系人数", "People contacted"), summary.people.length, t("跨渠道去重", "Unique across channels")],
      [t("跟进消息", "Follow-ups"), summary.followups, t("已包含在发送消息中", "Included in messages sent")],
      [t("使用渠道", "Active channels"), summary.channels.filter(c => c.messages).length, t("有已记录发送的渠道", "Channels with recorded sends")],
    ].map(([label, value, note]) => <div key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}</div>
    <div className={styles.charts}>
      <section className={styles.panel}><h3>{t("从哪里发出", "Channels used")}</h3><p>{t("按消息份数统计 · 点击渠道筛选", "Message counts · select a channel to filter")}</p>{summary.channels.map(c => <button key={c.channel} className={styles.barRow} aria-pressed={channel === c.channel} onClick={() => setChannel(channel === c.channel ? "all" : c.channel)}><span>{channelName(c.channel)}</span><span className={styles.track} aria-hidden><i style={{ width: `${100 * c.messages / maxChannel}%` }} /></span><strong>{c.messages}</strong><small>{c.people} {t("人", "people")}</small></button>)}</section>
      <section className={styles.panel}><div className={styles.panelTitle}><h3>{t("联系人构成", "Audience composition")}</h3><select aria-label={t("构成维度", "Group audience by")} value={groupBy} onChange={e => setGroupBy(e.target.value)}><option value="persona">{t("用户类型", "Persona")}</option><option value="industry">{t("行业", "Industry")}</option></select></div><p>{t("按所选范围内的去重人数统计；使用当前联系人分类。", "Unique people in this selection, using their current classifications.")}</p><div className={styles.composition}>{composition.map(([label, count]) => <div key={label} className={styles.barRow}><span>{label}</span><span className={styles.track} aria-hidden><i style={{ width: `${count / summary.people.length * 100}%` }} /></span><strong>{count}</strong><small>{Math.round(count / summary.people.length * 100)}%</small></div>)}{!composition.length ? <p>{t("此范围内还没有发送记录。", "No sends in this selection yet.")}</p> : null}</div></section>
    </div>
    <section className={styles.panel}><div className={styles.panelTitle}><div><h3>{t("发给了谁", "Who you contacted")}</h3><p>{t(`共 ${rows.length} 条消息 · 展示 ${shown.length} 条`, `${rows.length} messages · ${shown.length} shown`)}</p></div><input type="search" aria-label={t("搜索发送记录", "Search sent activity")} placeholder={t("搜索姓名、公司或职位", "Search name, company or role")} value={query} onChange={e => setQuery(e.target.value)} /></div>
      <div className={styles.tableWrap}><table><thead><tr>{[t("发送时间", "Sent at"), t("联系人", "Contact"), t("类型", "Audience"), t("渠道 / 收件地址", "Channel / recipient"), t("消息", "Message"), t("当前状态", "Current status")].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{shown.map(row => {
        const lead = row.lead; const state = OUTREACH_STATES[outreachDisplayState(lead)];
        const message = row.kind === "followup" ? "" : row.channel === "email" ? lead.outreachPlans?.email?.body ?? lead.body : lead.socialOutreach?.[row.channel]?.sentText ?? lead.socialOutreach?.[row.channel]?.draft;
        return <tr key={`${lead.id}-${row.channel}-${row.kind}`}><td><time dateTime={row.at}>{new Date(row.at).toLocaleString(zh ? "zh-CN" : "en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</time></td><td><strong>{lead.name}</strong><small>{lead.company}</small><small>{lead.role}</small></td><td>{audienceLabel(lead)}</td><td>{channelName(row.channel)}<small>{row.channel === "email" ? lead.email : lead.socials?.[row.channel]}</small></td><td><span>{row.kind === "followup" ? t("跟进", "Follow-up") : t("首次联系", "Initial outreach")}</span>{message ? <details><summary>{t("查看文案", "View message")}</summary>{row.channel === "email" ? <small>{t("当前保存的邮件文案", "Currently saved email copy")}</small> : null}<pre>{message}</pre></details> : null}</td><td>{state[0]} {state[zh ? 1 : 2]}</td></tr>;
      })}</tbody></table></div>{!shown.length ? <p className={styles.empty}>{query ? t("没有匹配的发送记录。", "No activity matches your search.") : t("此范围内还没有发送记录，可切换日期或查看全部。", "No sends in this selection. Try another date or all time.")}</p> : null}
    </section>
    <p className={styles.note}>{t("仅统计已记录成功的发送，不代表已送达。邮件跟进计为另一条消息；排队、草稿、结果待确认和 Connect 邀请不计入。社媒以手动记录为准，未记录的发送不会出现在这里。", "Counts confirmed send records, not delivery. Email follow-ups count as separate messages. Queued, draft, uncertain sends and connection invitations are excluded. Social activity depends on manually logged sends.")}</p>
  </section>;
}
