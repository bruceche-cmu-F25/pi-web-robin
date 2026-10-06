"use client";
import { useState } from "react";
import type { JarvisLead } from "@/extension/robin/jarvis-shape";
import { channelName, channelSentAt, OUTREACH_CHANNELS } from "@/extension/robin/outreach-shape";
import styles from "./OutreachQueue.module.css";

export function OutreachSent({ leads, zh, onPlan }: { leads: JarvisLead[]; zh: boolean; onPlan: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const t = (cn: string, en: string) => zh ? cn : en;
  const shown = leads.filter((lead) => `${lead.name} ${lead.company}`.toLowerCase().includes(query.toLowerCase()));
  return <section className={styles.queue} aria-label="Sent"><header><h2>{t("已发送", "Sent")} · {leads.length}</h2><input aria-label={t("搜索已发送联系人", "Search sent contacts")} placeholder={t("搜索姓名或公司", "Search name or company")} value={query} onChange={(event) => setQuery(event.target.value)} /></header>
    {!shown.length ? <p>{t("没有已发送记录", "No sent records")}</p> : shown.map((lead) => <article key={lead.id} className={styles.sentRecord}><h3>{lead.name}</h3><p>{lead.company} · {lead.role}</p>
      {lead.sentAt ? <p>{t("发件邮箱：", "Sender: ")}{lead.sendAttempt?.senderEmail ?? t("旧账号记录（不使用个人邮箱自动跟进）", "Legacy account (no automatic follow-up from personal Gmail)")}</p> : null}
      {OUTREACH_CHANNELS.filter((c) => channelSentAt(lead, c)).map((c) => <details key={c}><summary>{channelName(c)} · {new Date(channelSentAt(lead, c)!).toLocaleString()} · {c === "email" ? lead.email : lead.socials?.[c]}</summary>{c === "email" ? <strong>{lead.outreachPlans?.email?.subject ?? lead.subject}</strong> : null}<pre>{c === "email" ? lead.outreachPlans?.email?.body ?? lead.body : lead.socialOutreach?.[c]?.sentText ?? lead.socialOutreach?.[c]?.draft}</pre></details>)}
      {lead.outreachWorkflow?.stage === "send" ? <button onClick={() => onPlan(lead.id)}>{t("查看或准备其他平台", "View or prepare another platform")}</button> : null}
    </article>)}
  </section>;
}
