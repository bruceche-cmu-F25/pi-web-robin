"use client";

import { OUTREACH_STATES, outreachDisplayState, outreachDisplayRank, hasSentOutreach, canAddToReviewQueue, canReviewOutreach, canReviewChannel, channelName, socialDraft, type OutreachChannel } from "@/extension/robin/outreach-shape";
import type { JarvisLead } from "@/extension/robin/jarvis-shape";
import { OutreachContacts } from "./OutreachContacts";
import outreachStyles from "./OutreachStatus.module.css";
import styles from "./OutreachRoster.module.css";

export function OutreachRoster({ leads, channel, selected, onToggle, onDetails, zh, loading }: {
  loading: boolean;
  leads: JarvisLead[]; channel: OutreachChannel; selected: Set<string>;
  onToggle: (id: string) => void; onDetails: (id: string) => void; zh: boolean;
}) {
  const t = (cn: string, en: string) => zh ? cn : en;
  return <div className={styles.roster}>
    {[...leads].sort((a, b) => outreachDisplayRank(a) - outreachDisplayRank(b)).map((lead) => {
      const state = outreachDisplayState(lead);
      const marker = OUTREACH_STATES[state];
      const eligible = canReviewChannel(lead, channel);
      const copy = channel === "email" ? lead.body : socialDraft(lead, channel);
      return <article key={lead.id} className={`${styles.row} ${outreachStyles.row}`} data-workflow={state} data-sent={hasSentOutreach(lead) || undefined} data-selected={selected.has(lead.id) || undefined} aria-label={lead.name}>
        <div className={styles.person}>
          <input type="checkbox" aria-label={t(`选择 ${lead.name}`, `Select ${lead.name}`)} checked={selected.has(lead.id)} disabled={!canAddToReviewQueue(lead) && !selected.has(lead.id)} onChange={() => onToggle(lead.id)} />
          <span className={styles.avatar} aria-hidden>{lead.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span><div><button id={`jarvis-row-${lead.id}`} className={styles.name} onClick={() => onDetails(lead.id)}>{lead.name}</button><p>{lead.company}</p><small>{lead.role}</small><p className={outreachStyles.badge}>{marker[0]} {marker[zh ? 1 : 2]}</p><button className={styles.more} onClick={() => onDetails(lead.id)}>{t("完整资料 ↗", "Full profile ↗")}</button></div>
        </div>
        <div className={styles.fit}><span className={styles.mobileLabel}>{t("为什么适合 · 待验证", "Why they may fit")}</span><p>{lead.needHypothesis || lead.evidence}</p><a href={lead.evidenceUrl} target="_blank" rel="noreferrer">{t("依据 ↗", "Evidence ↗")}</a></div>
        <div><OutreachContacts lead={lead} zh={zh} />
          {!eligible ? <small className={styles.reason}>{!canReviewOutreach(lead)
            ? lead.queuedAt ? t("已在邮件队列中，无需重复选择", "Already in the email queue")
              : lead.sendAttempt && !lead.sentAt ? t("已有发送记录或正在发送，请查看详情", "Sending or an existing send attempt; see full profile")
              : t("已联系或已结束，不再加入首次联系批次", "Contacted or closed; excluded from first outreach")
            : channel === "email" ? lead.email ? t("可以勾选；邮箱来源尚未核实，暂不加入邮件批次", "Selectable; verify the email source before email outreach") : t("可以勾选；尚无邮箱，可选择已有的社媒渠道", "Selectable; no email yet — choose an available social channel")
              : t(`可以勾选；尚无 ${channelName(channel)}，可切换渠道`, `Selectable; no ${channelName(channel)} profile — choose another channel`)}</small> : null}
        </div>
        <div className={styles.copy}><span className={styles.mobileLabel}>{t("话术预览", "Message preview")}</span>{channel === "email" ? <strong>{lead.subject}</strong> : <strong>{channelName(channel)}</strong>}<p>{copy.length > 230 ? `${copy.slice(0, 230)}…` : copy}</p><small>{t("整批预览中可直接修改全文", "Edit the full message in batch preview")}</small></div>
      </article>;
    })}
    {!leads.length ? <p className={styles.empty}>{loading ? t("正在加载联系人…", "Loading contacts…") : t("没有符合筛选条件的联系人。", "No contacts match these filters.")}</p> : null}
  </div>;
}
