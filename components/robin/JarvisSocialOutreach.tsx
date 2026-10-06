"use client";

import { useEffect, useState } from "react";
import { JARVIS_SOCIAL_PLATFORMS, isOutreachApprovedFor, type JarvisLead, type JarvisSocialPlatform } from "@/extension/robin/jarvis-shape";
import { socialDraft } from "@/extension/robin/outreach-shape";
import styles from "./JarvisDiscovery.module.css";
import { JARVIS_OUTREACH_API } from "@/lib/jarvis-api";

const label = (platform: JarvisSocialPlatform) => platform === "x" ? "X" : platform[0]!.toUpperCase() + platform.slice(1);


/** Local drafts stay local until Save; a profile link and Copy never record a send. */
export function JarvisSocialOutreach({ lead, zh, refresh, onDirty }: { lead: JarvisLead; zh: boolean; refresh: () => Promise<void>; onDirty: (dirty: boolean) => void }) {
  const t = (cn: string, en: string) => zh ? cn : en;
  const available = JARVIS_SOCIAL_PLATFORMS.filter((p) => lead.socials?.[p]);
  const [platform, setPlatform] = useState<JarvisSocialPlatform>(available[0] ?? "linkedin");
  const reviewNeeded = !isOutreachApprovedFor(lead, platform);
  const stored = lead.socialOutreach?.[platform];
  const [draft, setDraft] = useState(stored?.draft ?? socialDraft(lead, platform));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const dirty = draft !== (stored?.draft ?? socialDraft(lead, platform));
  useEffect(() => { if (!dirty) setDraft(stored?.draft ?? socialDraft(lead, platform)); }, [platform, stored?.draft, dirty, lead]);
  useEffect(() => { onDirty(dirty || busy); }, [dirty, busy, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const update = async (op: "save" | "sent" | "replied") => {
    if (op === "sent" && !window.confirm(t(`你已经在 ${label(platform)} 人工发出了这段消息？这里仅记录，不会替你发送。`, `Did you manually send this message on ${label(platform)}? This only records it; nothing is sent here.`))) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch(JARVIS_OUTREACH_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "social", op, id: lead.id, platform, revision: lead.revision ?? 0, ...(op === "save" ? { draft } : {}) }) });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? `Request failed (${response.status})`);
      await refresh();
      setMessage(op === "save" ? t("社媒文案已保存；尚未发送。", "Social draft saved; not sent.") : op === "sent" ? t("已记录人工发送；没有自动私信。", "Manual send recorded; no automatic DM.") : t("已记录回复。", "Reply recorded."));
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  if (!available.length) return <section className={styles.socialPanel}><h3>{t("社媒联系", "Social outreach")}</h3><p>{t("没有可信的个人社媒主页；不要猜测账号。", "No trusted personal social profile; do not guess a handle.")}</p></section>;
  return <section className={styles.socialPanel}>
    <h3>{t("社媒联系 · 人工发送", "Social outreach · manual send")}</h3>
    <p>{t("先确认链接属于本人、核对 ICP，再人工联系；打开主页或复制不会记录为已发送。", "Verify that the profile belongs to this person and review ICP fit before contacting anyone. Opening a link or copying never logs a send.")}</p>
    {reviewNeeded ? <p role="status">{t("ICP 未核实：只能查看主页和编辑草稿，不能复制待发送文案或记录发送。", "ICP unverified: review profiles and edit drafts only; sending actions are unavailable.")}</p> : null}
    <div className={styles.socialChannels} role="group" aria-label={t("社媒渠道", "Social channels")}>{available.map((p) => <button key={p} type="button" aria-pressed={platform === p} disabled={busy} onClick={() => { if (dirty && !window.confirm(t("放弃未保存的社媒文案？", "Discard unsaved social draft?"))) return; setPlatform(p); setDraft(socialDraft(lead, p)); setMessage(""); setError(""); }}>{label(p)}{lead.socialOutreach?.[p]?.sentAt ? " ✓" : ""}</button>)}</div>
    <a href={lead.socials![platform]} target="_blank" rel="noreferrer">{t(`打开 ${label(platform)} 公开主页 ↗`, `Open public ${label(platform)} profile ↗`)}</a>
    {lead.socialTemplateDrafts?.[platform] && !stored?.sentAt ? <button type="button" disabled={busy || lead.status === "do_not_contact"} onClick={() => { setDraft(lead.socialTemplateDrafts![platform]!); setMessage(""); }}>{t("套用当前模板", "Apply current template")}</button> : null}
    <label>{t("这位联系人的社媒文案", "Message for this person")}<textarea value={draft} maxLength={4000} rows={10} disabled={busy || lead.status === "do_not_contact"} onChange={(e) => { setDraft(e.target.value); setMessage(""); }} /></label>
    <div className={styles.actions}>
      <button type="button" className="ui-action pi-bracket" disabled={busy || (!dirty && Boolean(stored?.draft)) || !draft.trim()} onClick={() => void update("save")}>{t("保存文案", "Save message")}</button>
      <button type="button" className="ui-action pi-bracket" disabled={busy || reviewNeeded || dirty || !stored?.draft} onClick={() => void navigator.clipboard.writeText(stored!.draft).then(() => setMessage(t("已复制；请到社媒人工发送。", "Copied; send manually on the platform."))).catch(() => setError(t("无法复制，请手动选择文本。", "Copy failed; select the text manually.")))}>{t("复制已保存文案", "Copy saved message")}</button>
    </div>
    {stored?.sentAt ? <div className={styles.socialHistory}><strong>{t("人工发送记录", "Manual send record")}</strong><time dateTime={stored.sentAt}>{new Date(stored.sentAt).toLocaleString()}</time>{stored.sentText ? <blockquote>{stored.sentText}</blockquote> : null}{stored.repliedAt ? <span>{t("已回复", "Replied")} · {new Date(stored.repliedAt).toLocaleString()}</span> : <button type="button" className="ui-action pi-bracket" disabled={busy} onClick={() => void update("replied")}>{t("记录已回复", "Record reply")}</button>}</div> : <button type="button" className="ui-action pi-bracket" disabled={busy || reviewNeeded || dirty || !stored?.draft || Boolean(lead.queuedAt || lead.sentAt || lead.sendAttempt || JARVIS_SOCIAL_PLATFORMS.some((p) => lead.socialOutreach?.[p]?.sentAt))} onClick={() => void update("sent")}>{t("我已在社媒人工发送 · 记录", "I sent it manually · record")}</button>}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}{message ? <p role="status">{message}</p> : null}
  </section>;
}
