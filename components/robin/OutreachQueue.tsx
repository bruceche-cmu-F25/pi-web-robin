"use client";

import { useEffect, useState } from "react";
import type { JarvisLead, OutreachUndo } from "@/extension/robin/jarvis-shape";
import { canReviewChannel, canPlanChannel, isLinkedInConnectionPending, remainingOutreachChannels, channelSentAt, hasApprovedChannelPlan, channelName, OUTREACH_CHANNELS, socialDraft, type OutreachChannel } from "@/extension/robin/outreach-shape";
import { OutreachContacts } from "./OutreachContacts";
import { mutate } from "./usePolledResource";
import { JARVIS_OUTREACH_API } from "@/lib/jarvis-api";
import styles from "./OutreachQueue.module.css";

export function OutreachQueue({ leads, mode, zh, refresh, onSendQueue, onDirty, undo }: { undo?: OutreachUndo; onDirty: (dirty: boolean) => void; leads: JarvisLead[]; mode: "review" | "send"; zh: boolean; refresh: () => Promise<void>; onSendQueue: () => void }) {
  const [dirty, setDirty] = useState(false);
  const leave = () => !dirty || window.confirm(zh ? "放弃尚未批准的文案修改？" : "Discard unapproved message edits?");
  const [index, setIndex] = useState(0);
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoError, setUndoError] = useState("");
  const [undoFocus, setUndoFocus] = useState<string | null>(null);
  const [deferred, setDeferred] = useState<string[]>([]);
  const ordered = [...leads].sort((a, b) => Number(deferred.includes(a.id)) - Number(deferred.includes(b.id)) || (a.outreachWorkflow?.at ?? "").localeCompare(b.outreachWorkflow?.at ?? ""));
  const focusedIndex = ordered.findIndex(lead => lead.id === undoFocus);
  const currentIndex = focusedIndex >= 0 ? focusedIndex : Math.min(index, Math.max(0, ordered.length - 1));
  const current = ordered[currentIndex];
  const t = (cn: string, en: string) => zh ? cn : en;
  const revert = async () => {
    if (!undo || !leave()) return;
    setUndoBusy(true); setUndoError("");
    try {
      await mutate(JARVIS_OUTREACH_API, "POST", { action: "revert-outreach-change", id: undo.leadId, revision: undo.revision });
      setDirty(false); onDirty(false); setUndoFocus(undo.leadId); setIndex(0);
      await refresh();
    } catch (caught) { setUndoError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setUndoBusy(false); }
  };
  const undoLabel = undo?.op.split(":").at(-1);
  const undoActionLabel = ({ sent: t("记录已发送", "Log sent"), skip: t("跳过渠道", "Skip channel"), approve: t("批准话术", "Approve message"), requested: t("记录 Connect 请求", "Log Connect request"), accepted: t("记录 Connect 已通过", "Log Connect acceptance"), save: t("保存文案", "Save message"), replied: t("记录回复", "Log reply") } as Record<string, string>)[undoLabel ?? ""] ?? undo?.op;
  return <section className={styles.queue} aria-label={mode === "review" ? "Review queue" : "Send queue"}>
    <header><div><h2>{mode === "review" ? t("审核队列", "Review queue") : t("发送队列", "Send queue")} · {leads.length}</h2><p>{mode === "review" ? t("逐个核对匹配理由，选择渠道并修改话术。通过后进入发送队列。", "Check fit, choose a channel and edit the message. Approved people move to Send queue.") : t("逐个渠道联系：所有可用渠道发送或明确跳过后才移出队列；新渠道需先确认话术。", "Send through every available channel. People stay here until all channels are sent or explicitly skipped; each new channel needs message approval.")}</p></div>{mode === "review" ? <button onClick={onSendQueue}>{t("前往发送队列 →", "Go to Send queue →")}</button> : null}</header>
    {mode === "send" ? <div className={styles.actions}>
      <button type="button" disabled={!undo || undoBusy} onClick={() => void revert()}>{t("↶ 撤销上一次更改", "↶ Revert last change")}</button>
      <small>{undo ? `${undo.name} · ${undoActionLabel}` : t("暂无可撤销的记录", "No change to revert")}</small>
      <small>{t("仅撤销 Robin 记录，不撤回平台上的消息。", "Reverts Robin records only; messages on other platforms are not recalled.")}</small>
      {undoError ? <p role="alert">{undoError}</p> : null}
    </div> : null}
    {current ? <>
      <div className={styles.navigation}><button disabled={currentIndex === 0} onClick={() => { if (leave()) { setUndoFocus(null); setIndex(Math.max(0, currentIndex - 1)); } }}>← {t("上一位", "Previous")}</button><span>{Math.min(currentIndex + 1, leads.length)} / {leads.length}</span><button disabled={currentIndex >= leads.length - 1} onClick={() => { if (leave()) { setUndoFocus(null); setIndex(currentIndex + 1); } }}>{t("下一位", "Next")} →</button></div>
      <QueuePerson key={`${mode}-${current.id}-${current.revision}`} onDirty={(value) => { setDirty(value); onDirty(value); }} lead={current} mode={mode} zh={zh} refresh={refresh} onLater={() => { if (!leave()) return; setUndoFocus(null); setDeferred((ids) => [...ids.filter((id) => id !== current.id), current.id]); setIndex(0); }} />
    </> : <div className={styles.empty}>{mode === "review" ? t("审核队列已清空。在联系人列表勾选后，点击「加入审核队列」。", "Review queue is empty. Select people in Contacts and click Add to review queue.") : t("暂无待发送的人。审核通过后会出现在这里，不会自动发送。", "No one is waiting to send. Approve people in Review queue; nothing sends automatically.")}</div>}
  </section>;
}

function QueuePerson({ lead, mode, zh, refresh, onLater, onDirty }: { onDirty: (dirty: boolean) => void; lead: JarvisLead; mode: "review" | "send"; zh: boolean; refresh: () => Promise<void>; onLater: () => void }) {
  const t = (cn: string, en: string) => zh ? cn : en;
  const [channel, setChannel] = useState<OutreachChannel>((mode === "send" ? OUTREACH_CHANNELS.find((c) => hasApprovedChannelPlan(lead, c)) ?? remainingOutreachChannels(lead)[0] : lead.outreachApproval?.channel) ?? OUTREACH_CHANNELS.find((c) => canReviewChannel(lead, c)) ?? "email");
  const [subject, setSubject] = useState(lead.subject);
  const [body, setBody] = useState(lead.body);
  const [social, setSocial] = useState(() => Object.fromEntries(OUTREACH_CHANNELS.filter((c) => c !== "email").map((c) => [c, socialDraft(lead, c as Exclude<OutreachChannel, "email">)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const [confirmSend, setConfirmSend] = useState(false);
  const [copied, setCopied] = useState(false);
  const route = channel === "email" ? lead.email : lead.socials?.[channel];
  const message = channel === "email" ? body : social[channel];
  const approved = hasApprovedChannelPlan(lead, channel) || (!lead.outreachPlans?.[channel] && lead.outreachApproval?.channel === channel && canReviewChannel(lead, channel));
  const unchanged = message === (channel === "email" ? lead.body : socialDraft(lead, channel)) && (channel !== "email" || subject === lead.subject);
  const skipped = channel !== "email" && Boolean(lead.socialOutreach?.[channel]?.skippedAt);
  const sendable = approved && unchanged && !skipped;

  const act = async (payload: object) => {
    setBusy(true); setError("");
    try { await mutate(JARVIS_OUTREACH_API, "POST", payload); setDirty(false); onDirty(false); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const approve = () => act({ action: "approve-for-send", channel, confirmed: true, items: [{ id: lead.id, revision: lead.revision ?? 0, route, source: lead.emailSource, subject, body, draft: social[channel], identityChecked: true, draftChecked: true }] });
  return <article className={styles.person}>
    <div className={styles.identity}><h3>{lead.name}</h3><p>{lead.role} · {lead.company}</p><OutreachContacts lead={lead} zh={zh} />
      <h4>{t("为什么适合 · 待验证", "Why they may fit")}</h4><p>{lead.needHypothesis || lead.evidence}</p><p className={styles.evidence}>{lead.evidence}</p><a href={lead.evidenceUrl} target="_blank" rel="noreferrer">{t("核对来源 ↗", "Check source ↗")}</a>
      {lead.whyNow ? <p><a href={lead.whyNow.url} target="_blank" rel="noreferrer">{lead.whyNow.summary} ↗</a></p> : null}
    </div>
    <div className={styles.message}>
      <label>{t("联系渠道", "Contact channel")}<select value={channel} disabled={busy} onChange={(e) => { setChannel(e.target.value as OutreachChannel); setConfirmSend(false); setCopied(false); }}>{OUTREACH_CHANNELS.map((c) => <option key={c} value={c} disabled={mode === "send" ? !canPlanChannel(lead, c) : !canReviewChannel(lead, c)}>{channelName(c)}{channelSentAt(lead, c) ? t(" · 已发送", " · sent") : hasApprovedChannelPlan(lead, c) ? t(" · 待发送", " · ready") : !(mode === "send" ? canPlanChannel(lead, c) : canReviewChannel(lead, c)) ? t(" · 暂不可用", " · unavailable") : ""}</option>)}</select></label>
      {mode === "send" ? <div className={styles.channelProgress}><span>{t(`还剩 ${remainingOutreachChannels(lead).length} 个可用渠道`, `${remainingOutreachChannels(lead).length} available channels left`)}</span>{OUTREACH_CHANNELS.filter((c) => c === "email" ? lead.email : lead.socials?.[c]).map((c) => <span key={c}>{channelName(c)} · {channelSentAt(lead, c) ? t("已发送", "Sent") : c !== "email" && lead.socialOutreach?.[c]?.skippedAt ? t("已跳过", "Skipped") : c === "linkedin" && isLinkedInConnectionPending(lead) ? t("等待 Connect 通过", "Connection pending") : !canPlanChannel(lead, c) ? t("暂不可用", "Unavailable") : hasApprovedChannelPlan(lead, c) ? t("待发送", "Ready") : t("待确认话术", "Needs message approval")}</span>)}</div> : null}
      <p className={styles.route}>{route ? <a href={channel === "email" ? `mailto:${route}` : route} target={channel === "email" ? undefined : "_blank"} rel="noopener noreferrer">{route}</a> : t("尚无可用联系方式", "No available route")}</p>
      {channel === "email" ? <label>{t("主题", "Subject")}<input value={subject} maxLength={300} readOnly={busy || Boolean(channelSentAt(lead, channel))} onChange={(e) => { setDirty(true); setSubject(e.target.value); }} /></label> : null}
      {channel !== "email" && lead.socialTemplateDrafts?.[channel] && !channelSentAt(lead, channel) ? <button type="button" disabled={busy} onClick={() => { setDirty(true); setConfirmSend(false); setSocial(value => ({ ...value, [channel]: lead.socialTemplateDrafts![channel]! })); }}>{t("套用当前模板", "Apply current template")}</button> : null}
      <label>{t("话术", "Message")}<textarea rows={16} value={message} maxLength={channel === "email" ? 12000 : 4000} readOnly={busy || Boolean(channelSentAt(lead, channel))} onChange={(e) => { setDirty(true); if (channel === "email") setBody(e.target.value); else setSocial((value) => ({ ...value, [channel]: e.target.value })); }} /></label>
      {error ? <p role="alert">{error}</p> : null}
      {mode === "review" ? <><p>{t("点击通过，即表示已核对身份、联系方式和上方完整话术。", "Approve after checking identity, the contact route and the full message above.")}</p><div className={styles.actions}><button disabled={busy || !canReviewChannel(lead, channel) || !message?.trim() || (channel === "email" && !subject.trim())} onClick={() => void approve()}>{t("通过 → 加入发送队列", "Approve → Send queue")}</button><button disabled={busy} onClick={onLater}>{t("稍后再看", "Review later")}</button><button disabled={busy} onClick={() => void act({ action: "review-queue", op: "remove", ids: [lead.id] })}>{t("移出审核队列", "Remove from review")}</button></div>{!canReviewChannel(lead, channel) ? <p>{t("需先补全或核实联系方式；可暂时跳过，回联系人详情修改。", "Complete or verify a contact route first. Review later and edit the contact in Contacts.")}</p> : null}</> : <>
        {!sendable ? <div className={styles.confirm}><p>{t("核对当前平台的话术后，将它加入待发送渠道。其他已准备的平台会保留。", "Review this platform’s message and add it to the send plan. Other prepared channels stay in the plan.")}</p><button disabled={busy || !canPlanChannel(lead, channel) || !message?.trim() || (channel === "email" && !subject.trim())} onClick={() => void act({ action: "plan-channel", id: lead.id, revision: lead.revision ?? 0, channel, route, source: lead.emailSource, subject, body: message, confirmed: true })}>{t("确认话术并准备此平台", "Approve message for this platform")}</button></div> : null}
        <div className={styles.actions}>{channel === "email" ? <button disabled={busy || !sendable} onClick={() => setConfirmSend(true)}>{t("让 Robin 发送这封邮件", "Send this email with Robin")}</button> : <><button disabled={busy || !sendable} onClick={() => { void navigator.clipboard.writeText(message).then(() => setCopied(true)).catch(() => setError(t("复制失败，请手动复制", "Copy failed; copy the message manually"))); }}>{copied ? t("已复制", "Copied") : t("复制话术", "Copy message")}</button><a href={route} target="_blank" rel="noreferrer">{t("打开社媒 ↗", "Open profile ↗")}</a><button disabled={busy || !sendable} onClick={() => setConfirmSend(true)}>{t(`已通过 ${channelName(channel)} 发送，记录`, `Sent via ${channelName(channel)} · log`)}</button></>}
</div>
        {channel === "linkedin" && canPlanChannel(lead, channel) && lead.linkedinConnection?.route !== route ? <div className={styles.actions}><button disabled={busy} onClick={() => { if (dirty && !window.confirm(t("记录 Connect 会放弃未保存的话术修改，继续？", "Record connection and discard unsaved message edits?"))) return; void act({ action: "linkedin-connection", op: "requested", id: lead.id, revision: lead.revision ?? 0, route }); }}>{t("已发送 Connect 请求 · 记录", "Connect request sent · Log")}</button><small>{t("仅记录你已手动发送的好友请求；通过后再发消息。", "Only logs an invitation you already sent manually. Message after acceptance.")}</small></div> : null}
        {channel !== "email" && canPlanChannel(lead, channel) && !skipped ? <div className={styles.actions}><button disabled={busy} onClick={() => { if (dirty && !window.confirm(t("跳过此渠道会放弃未保存的话术修改，继续？", "Skip this channel and discard unsaved message edits?"))) return; void act({ action: "social", op: "skip", id: lead.id, revision: lead.revision ?? 0, platform: channel, reason: "cannot-dm" }); }}>{channel === "linkedin" ? t("无法私信 / 需要会员 · 跳过 LinkedIn", "Cannot message / Premium required · Skip LinkedIn") : t("无法私信 · 跳过此渠道", "Cannot message · Skip channel")}</button><small>{t("会记录跳过原因，并继续其他渠道；不会标记为已发送。", "Records the reason and continues with other channels; does not mark it as sent.")}</small></div> : null}
        {skipped ? <p>{t("此渠道已跳过。若现在可以联系，可重新确认话术启用。", "This channel was skipped. Approve its message again if it is now reachable.")}</p> : null}
        {confirmSend && sendable ? <div className={styles.confirm}><p>{channel === "email" ? t(`确认由 Robin 将上方邮件发送给 ${route}？`, `Send the email shown above to ${route}?`) : t(`确认你已通过 ${channelName(channel)} 向 ${lead.name} 发送上方话术？账号为 ${route}。这里只记录。`, `Confirm you sent the message above to ${lead.name} via ${channelName(channel)} at ${route}. This only records it.`)}</p><button disabled={busy} onClick={() => void act(channel === "email" ? { action: "send", id: lead.id, revision: lead.revision ?? 0, confirmed: true } : { action: "social", op: "sent", id: lead.id, revision: lead.revision ?? 0, platform: channel })}>{channel === "email" ? t("确认发送邮件", "Confirm email send") : t(`记录 ${channelName(channel)} 已发送`, `Log ${channelName(channel)} send`)}</button><button disabled={busy} onClick={() => setConfirmSend(false)}>{t("取消", "Cancel")}</button></div> : null}
      </>}
    </div>
  </article>;
}
