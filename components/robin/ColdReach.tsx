"use client";
import { OutreachContacts } from "./OutreachContacts";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { JARVIS_DELIVERY_POLICY, type JarvisState } from "@/extension/robin/jarvis-shape";
import { usePolledResource } from "./usePolledResource";
import styles from "./ColdReach.module.css";
import { canReviewChannel, channelName, OUTREACH_CHANNELS, socialDraft, type OutreachChannel } from "@/extension/robin/outreach-shape";
import { JARVIS_OUTREACH_API, JARVIS_STATE_API } from "@/lib/jarvis-api";

const API = JARVIS_STATE_API;
type Channel = OutreachChannel;
type Card = { id: string; revision: number; route: string; source: string; subject: string; body: string; draft: string; skipped: boolean };
const available = canReviewChannel;

export function ColdReach({ initialIds, initialChannel = "email", onClose }: { initialIds?: string[]; initialChannel?: Channel; onClose?: () => void } = {}) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const t = useCallback((cn: string, en: string) => zh ? cn : en, [zh]);
  const { data, error: loadError, refresh } = usePolledResource<JarvisState>(API, 30_000);
  const leads = useMemo(() => data?.leads ?? [], [data]);
  const byId = useMemo(() => new Map(leads.map((lead) => [lead.id, lead])), [leads]);
  const [channel, setChannel] = useState<Channel>(initialChannel);
  const [query, setQuery] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [batchApproved, setBatchApproved] = useState(false);
  const [step, setStep] = useState<"select" | "review" | "dispatch">("select");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  const [skippedDispatch, setSkippedDispatch] = useState<string[]>([]);
  const [skipReason, setSkipReason] = useState<"private" | "wrong-account" | "cannot-dm" | "platform-limit">("cannot-dm");
  const [copied, setCopied] = useState<string | null>(null);
  const initialSelectionLoaded = useRef(false);
  const outbox = data?.outbox;
  const label = channelName(channel);
  const close = () => { if (touched && step === "review" && !window.confirm(t("离开本批审核？未提交的修改将丢失。", "Leave this batch? Unsubmitted edits will be lost."))) return; onClose?.(); };
  useEffect(() => {
    if (!touched || step !== "review") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [step, touched]);
  const eligible = leads.filter((lead) => available(lead, channel));
  const shown = eligible.filter((lead) => `${lead.name} ${lead.company} ${lead.role}`.toLowerCase().includes(query.trim().toLowerCase()));
  const savedInstagram = leads.filter((lead) => available(lead, "instagram") && lead.socialOutreach?.instagram?.draft && !lead.socialOutreach.instagram.sentAt && !lead.socialOutreach.instagram.skippedAt);
  const active = cards.filter((card) => !card.skipped);
  const complete = active.every((card) => channel === "email" ? card.subject.trim() && card.body.trim() : card.draft.trim());
  const dispatch = active.filter((card) => !sent.includes(card.id) && !skippedDispatch.includes(card.id));
  const patchCard = (id: string, change: Partial<Card>) => {
    setTouched(true); setBatchApproved(false);
    setCards((value) => value.map((card) => card.id === id ? { ...card, ...change } : card));
  };
  const begin = useCallback((selected: string[], mode: Channel) => {
    if (!selected.length) return;
    setTouched(false); setChannel(mode); setError(""); setNotice(""); setBatchApproved(false);
    setCards(selected.map((id) => {
      const lead = byId.get(id)!;
      return { id, revision: lead.revision ?? 0, route: mode === "email" ? lead.email : lead.socials![mode]!, source: lead.emailSource,
        subject: lead.subject, body: lead.body, draft: mode === "email" ? "" : socialDraft(lead, mode), skipped: false };
    }));
    setStep("review");
  }, [byId]);
  useEffect(() => {
    if (!data || initialSelectionLoaded.current) return;
    initialSelectionLoaded.current = true;
    const params = new URLSearchParams(window.location.search);
    const mode = initialIds ? initialChannel : params.get("channel") as Channel;
    if (!OUTREACH_CHANNELS.includes(mode)) return;
    setChannel(mode);
    const requested = initialIds ?? (params.get("ids") ?? "").split(",").filter(Boolean);
    const chosen = [...new Set(requested)].filter((id) => byId.has(id) && available(byId.get(id)!, mode));
    if (chosen.length) begin(chosen, mode);
    if (chosen.length !== requested.length) setError(t("部分联系人已变化或不符合此渠道条件，已移出本批。", "Some contacts changed or are unavailable for this channel and were removed from the batch."));
  }, [data, byId, begin, initialIds, initialChannel, t]);
  const submit = async () => {
    if (busy || !active.length || !batchApproved || !complete) return;
    const changed = active.find((card) => (byId.get(card.id)?.revision ?? -1) !== card.revision);
    if (changed) { setError(t("名单在审核期间发生变化。请重新打开批次并复核。", "A contact changed during review. Restart this batch and review it again.")); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(JARVIS_OUTREACH_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare-batch", channel, confirmed: true,
        items: active.map(({ id, revision, route, source, subject, body, draft }) => ({ id, revision, route, source, subject, body, draft, identityChecked: batchApproved, draftChecked: batchApproved })) }) });
      const result = await response.json() as { prepared?: number; error?: string };
      if (!response.ok || result.prepared !== active.length) throw new Error(result.error ?? t("批次未完整保存", "Batch was not fully saved"));
      await refresh();
      if (channel === "email") { setStep("select"); setIds([]); setNotice(t(`已批准并排队 ${result.prepared} 封邮件；未包含其他联系人。`, `${result.prepared} emails approved and queued; no other contacts were added.`)); }
      else { setStep("dispatch"); setSent([]); setSkippedDispatch([]); setNotice(t("文案已保存，私信仍为 0。请在 Chrome 中手动逐条发送。", "Drafts saved; zero DMs sent. Send one at a time manually in Chrome.")); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const markSent = async (card: Card) => {
    const lead = byId.get(card.id);
    if (!lead || channel === "email") return;
    if (lead.socials?.[channel] !== card.route || lead.socialOutreach?.[channel]?.draft !== card.draft) { setError(t("账号或文案已变化，请重新审核。", "The account or draft changed. Review it again.")); return; }
    if (!window.confirm(t(`你已在 ${label} 亲自向 ${lead.name} 发送这条私信？此操作只记录，不会帮你发送。`, `Did you personally send this DM to ${lead.name} on ${label}? This only records it; it does not send.`))) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(JARVIS_OUTREACH_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "social", op: "sent", id: card.id, platform: channel, revision: lead.revision ?? 0 }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? t("记录失败", "Could not record send"));
      setSent((value) => [...value, card.id]); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const markSkipped = async (card: Card) => {
    const lead = byId.get(card.id);
    if (!lead) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(JARVIS_OUTREACH_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "social", op: "skip", id: card.id, platform: channel, reason: skipReason, revision: lead.revision ?? 0 }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? t("跳过记录失败", "Could not record skip"));
      setSkippedDispatch((value) => [...value, card.id]); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const copy = async (card: Card) => {
    try { await navigator.clipboard.writeText(card.draft); setCopied(card.id); }
    catch { setError(t("浏览器不允许复制，请手动选择文案。", "Clipboard unavailable; select the draft manually.")); }
  };

  return <section aria-label={t("联系人批量审核", "Contact batch review")} className={onClose ? styles.embedded : `robin-page robin-dashboard ${styles.page}`}>
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div><span className="pi-eyebrow">COLD REACH / HUMAN REVIEW</span><h2>{t("批量审核", "Batch review")}</h2><p>{t("核对匹配理由、联系方式与话术，再批准本批联系人。", "Review fit, contact details and copy, then approve this batch.")}</p></div>
        {onClose ? <button type="button" className="ui-action pi-bracket" disabled={busy} onClick={close}>{t("← 返回联系人", "← Back to contacts")}</button> : <Link className="ui-action pi-bracket" href="/outreach/research">{t("← 返回联系人", "← Back to contacts")}</Link>}
      </header>
      <p className={styles.status} role="status">{data ? t(`Gmail 发送箱：${outbox?.enabled ? "开启" : "暂停"} · ${outbox?.dailyLimit ? `每日最多 ${outbox.dailyLimit} 封` : "无每日上限"} · 审核后可随时发送、间隔 ${JARVIS_DELIVERY_POLICY.minimumGapMinutes}–${JARVIS_DELIVERY_POLICY.maximumGapMinutes} 分钟；无回复 ${JARVIS_DELIVERY_POLICY.followUpDelayHours} 小时后最多跟进一次。`, `Gmail outbox: ${outbox?.enabled ? "on" : "paused"} · ${outbox?.dailyLimit ? `up to ${outbox.dailyLimit}/day` : "no daily cap"} · approved mail may send at any hour, spaced ${JARVIS_DELIVERY_POLICY.minimumGapMinutes}–${JARVIS_DELIVERY_POLICY.maximumGapMinutes} minutes; at most one follow-up after ${JARVIS_DELIVERY_POLICY.followUpDelayHours} hours without a reply.`) : t("正在读取发送状态…", "Loading sending status…")}</p>
      {(loadError || error) ? <p className={styles.error} role="alert">{error || loadError}</p> : null}
      {notice ? <p className={styles.success} role="status">{notice}</p> : null}

      {step === "select" ? <section className={styles.panel} aria-labelledby="reach-select">
        <span className="pi-eyebrow">01 / SELECT</span><h2 id="reach-select">{t("挑选一批联系人", "Build a batch")}</h2>
        <div className={styles.channels} role="group" aria-label={t("渠道", "Channel")}>
          {OUTREACH_CHANNELS.map((option) => <button key={option} type="button" aria-pressed={channel === option} onClick={() => { setChannel(option); setIds([]); setQuery(""); }}>{option === "email" ? "Email · Gmail" : channelName(option)}</button>)}
        </div>
        <p className={styles.help}>{channel === "email" ? t("只列出在公开来源页找到邮箱、且未联系的人。批准后排队可能立即开始，绝不自动包含 Instagram 批次。", "Only unsent contacts with a work email found on a public source. Approval may start the active outbox; Instagram contacts are never added automatically.") : t("优先使用已保存的文案；其余根据个人资料准备初稿，供你修改。社媒消息由你在对应平台发送。", "Saved copy takes precedence; other contacts get an editable starting draft. Send social messages on the platform.")}</p>
        {channel === "instagram" && savedInstagram.length ? <button type="button" className={styles.suggested} onClick={() => begin(savedInstagram.map((lead) => lead.id), "instagram")}>{t(`整批预览已保存的 ${savedInstagram.length} 条 Instagram 草稿 →`, `Review ${savedInstagram.length} saved Instagram drafts together →`)}</button> : null}
        <label className={styles.search}>{t("搜索联系人", "Search contacts")}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("姓名、公司或职位", "Name, company or role")} /></label>
        <div className={styles.roster} role="group" aria-label={t("选择本批联系人", "Choose batch contacts")}>{shown.map((lead) => <label key={lead.id} className={styles.rosterRow}><input type="checkbox" checked={ids.includes(lead.id)} onChange={() => setIds((value) => value.includes(lead.id) ? value.filter((id) => id !== lead.id) : [...value, lead.id])} /><span><strong>{lead.name}</strong><small>{lead.company} · {lead.role}</small></span><em>{channel === "email" ? lead.email : label}</em></label>)}{data && !shown.length ? <p>{t("没有符合此渠道条件的人", "No eligible contacts for this channel")}</p> : null}</div>
        <div className={styles.actions}><span>{t(`已选 ${ids.length}`, `${ids.length} selected`)}</span><button type="button" disabled={!ids.length} onClick={() => begin(ids, channel)}>{t("整批预览 →", "Preview batch →")}</button></div>
      </section> : null}

      {step === "review" ? <section className={`${styles.panel} ${styles.bulkPanel}`} aria-labelledby="reach-review">
        <div className={styles.cardTop}><div><span className="pi-eyebrow">BATCH PREVIEW / {label.toUpperCase()}</span><h2 id="reach-review">{t(`整批审核 · ${active.length} 位`, `Review batch · ${active.length} people`)}</h2><p>{t("全文已展开，直接修改；取消勾选即可移出本批。", "Full messages are shown below. Edit directly, or uncheck a person to leave them out.")}</p></div></div>
        <div className={styles.bulkRows}>{cards.map((card) => {
          const lead = byId.get(card.id);
          return <article className={styles.bulkRow} key={card.id} data-skipped={card.skipped || undefined} aria-label={lead?.name}>
            <div className={styles.bulkIdentity}>
              <label className={styles.include}><input type="checkbox" checked={!card.skipped} disabled={busy} onChange={(event) => patchCard(card.id, { skipped: !event.target.checked })} /> <strong>{lead?.name}</strong></label>
              <p>{lead?.company} · {lead?.role}</p>
              <p className={styles.route}>{label} · {card.route}</p>
              {lead ? <OutreachContacts lead={lead} zh={zh} /> : null}
              <div className={styles.links}><a href={lead?.evidenceUrl} target="_blank" rel="noreferrer">{t("依据 ↗", "Evidence ↗")}</a></div>
              <h3>{t("为什么适合 · 待验证假设", "Why they may fit · hypothesis")}</h3><p>{lead?.needHypothesis}</p><p className={styles.help}>{lead?.evidence}</p>
              {channel === "email" ? <p className={styles.help}>{lead?.emailQuote}</p> : null}
              {lead?.whyNow ? <p><a href={lead.whyNow.url} target="_blank" rel="noreferrer">{lead.whyNow.summary} ↗</a></p> : null}
            </div>
            <div className={styles.bulkCopy}>
              {card.skipped ? <p className={styles.help}>{t("已移出本批，重新勾选可恢复文案。", "Excluded from this batch. Check again to restore the message.")}</p> : channel === "email" ? <>
                <label className={styles.field}>{t("主题", "Subject")}<input aria-label={t(`${lead?.name} 的主题`, `Subject for ${lead?.name}`)} value={card.subject} maxLength={300} disabled={busy} onChange={(event) => patchCard(card.id, { subject: event.target.value })} /></label>
                <label className={styles.field}>{t("正文", "Message")}<textarea aria-label={t(`${lead?.name} 的正文`, `Message for ${lead?.name}`)} rows={Math.max(12, Math.min(32, card.body.split("\n").length + Math.ceil(card.body.length / 80)))} value={card.body} maxLength={12000} disabled={busy} onChange={(event) => patchCard(card.id, { body: event.target.value })} /></label>
              </> : <label className={styles.field}>{t("私信文案", "Social message")}<textarea aria-label={t(`${lead?.name} 的私信`, `Message for ${lead?.name}`)} rows={Math.max(10, Math.min(25, card.draft.split("\n").length + Math.ceil(card.draft.length / 80)))} value={card.draft} maxLength={4000} disabled={busy} onChange={(event) => patchCard(card.id, { draft: event.target.value })} /></label>}
            </div>
          </article>;
        })}</div>
        <div className={styles.bulkApproval}>
          <label className={styles.check}><input type="checkbox" checked={batchApproved} disabled={busy || !active.length || !complete} onChange={(event) => { setTouched(true); setBatchApproved(event.target.checked); }} />{t(`我已核对所选 ${active.length} 人的匹配理由、联系方式和完整文案，批准本批。`, `I reviewed the fit, contact routes and full messages for these ${active.length} people and approve this batch.`)}</label>
          <div className={styles.actions}><span>{channel === "email" ? t(`只排队所选 ${active.length} 封 · 发送箱${outbox?.enabled ? "开启，可能开始发送" : "暂停"}`, `Only ${active.length} selected emails · outbox ${outbox?.enabled ? "active; sending may begin" : "paused"}`) : t("保存文案后，在社媒平台发送并记录。", "Save drafts, then send on the social platform and log it.")}</span><button type="button" disabled={busy || !active.length || !complete || !batchApproved} onClick={() => void submit()}>{busy ? t("保存中…", "Saving…") : channel === "email" ? t(`批准并排队 ${active.length} 封邮件`, `Approve & queue ${active.length} emails`) : t(`批准 ${active.length} 条社媒文案`, `Approve ${active.length} social drafts`)}</button></div>
          {!complete ? <p role="status">{t("请补全所选联系人的文案。", "Complete the messages for all included contacts.")}</p> : null}
        </div>
      </section> : null}

      {step === "dispatch" ? <section className={styles.panel} aria-labelledby="reach-dispatch"><span className="pi-eyebrow">04 / MANUAL DISPATCH</span><h2 id="reach-dispatch">{t(`${label} · 已记录 ${sent.length} / ${active.length}`, `${label} · ${sent.length} / ${active.length} logged`)}</h2><p className={styles.help}>{t(`在 ${label} 发送后点击「记录」。无法联系时可以记录跳过原因。`, `Send on ${label}, then log it here. If you cannot contact them, record a skip reason.`)}</p>
        {dispatch.length ? <div className={styles.dispatchCard}><h3>{byId.get(dispatch[0]!.id)?.name} · {byId.get(dispatch[0]!.id)?.company}</h3><a href={dispatch[0]!.route} target="_blank" rel="noreferrer">{t(`打开 ${label} 主页 ↗`, `Open ${label} profile ↗`)}</a><pre>{dispatch[0]!.draft}</pre><div className={styles.actions}><button type="button" disabled={busy} onClick={() => void copy(dispatch[0]!)}>{copied === dispatch[0]!.id ? t("已复制", "Copied") : t("复制文案", "Copy DM")}</button><label className={styles.skipField}>{t("跳过原因", "Skip reason")} <select value={skipReason} disabled={busy} onChange={(event) => setSkipReason(event.target.value as typeof skipReason)}><option value="cannot-dm">{t("无法私信", "Can't DM")}</option><option value="private">{t("私密账号", "Private account")}</option><option value="wrong-account">{t("账号不符", "Wrong account")}</option><option value="platform-limit">{t("平台限制", "Platform limit")}</option></select></label><button type="button" disabled={busy} className={styles.secondary} onClick={() => void markSkipped(dispatch[0]!)}>{t("记录跳过", "Log skip")}</button><button type="button" disabled={busy} onClick={() => void markSent(dispatch[0]!)}>{t("我已亲自发送 · 记录", "I sent it · log send")}</button></div></div> : <p className={styles.success} role="status">{t(`本批已处理：${sent.length} 条人工发送，${skippedDispatch.length} 条跳过。`, `Batch handled: ${sent.length} manually sent, ${skippedDispatch.length} skipped.`)}</p>}
        <button type="button" className={styles.secondary} onClick={() => { setStep("select"); setIds([]); }}>{t("返回新批次", "New batch")}</button>
      </section> : null}
    </div>
  </section>;
}
