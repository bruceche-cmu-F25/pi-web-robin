"use client";
import { useState } from "react";
import type { JarvisLead, OutreachUndo } from "@/extension/robin/jarvis-shape";
import { canPlanChannel, channelSentAt } from "@/extension/robin/outreach-shape";
import { mutate } from "./usePolledResource";
import styles from "./OutreachQueue.module.css";
import { JARVIS_OUTREACH_API } from "@/lib/jarvis-api";

export function OutreachConnections({ leads, zh, refresh, onMessage, undo }: { undo?: OutreachUndo; leads: JarvisLead[]; zh: boolean; refresh: () => Promise<void>; onMessage: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = (cn: string, en: string) => zh ? cn : en;
  const rows = leads.filter((lead) => lead.linkedinConnection).sort((a, b) => Number(Boolean(a.linkedinConnection!.acceptedAt)) - Number(Boolean(b.linkedinConnection!.acceptedAt)) || b.linkedinConnection!.requestedAt.localeCompare(a.linkedinConnection!.requestedAt));
  const accept = async (lead: JarvisLead) => {
    setBusy(true); setError("");
    try {
      await mutate(JARVIS_OUTREACH_API, "POST", { action: "linkedin-connection", op: "accepted", id: lead.id, revision: lead.revision ?? 0, route: lead.linkedinConnection!.route });
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const revert = async () => {
    if (!undo) return;
    setBusy(true); setError("");
    try {
      await mutate(JARVIS_OUTREACH_API, "POST", { action: "revert-outreach-change", id: undo.leadId, revision: undo.revision });
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const canRevert = undo && undo.op.startsWith("connect:") && leads.some(lead => lead.id === undo.leadId && (lead.revision ?? 0) === undo.revision);
  return <section className={styles.queue} aria-label="LinkedIn connections">
    <header><h2>Connect · {rows.length}</h2><button type="button" disabled={busy || !canRevert} onClick={() => void revert()}>{t("↶ 撤销上一次更改", "↶ Revert last change")}</button></header>
    {undo?.op.startsWith("connect:") ? <p role="status">{t("最近操作：", "Last change: ")}{undo.name} · {undo.op === "connect:accepted" ? t("记录已通过", "Logged acceptance") : t("记录 Connect 请求", "Logged connection request")}{!canRevert ? t("。联系人已有后续更改，无法撤销旧操作。", ". This contact has newer changes; the old action cannot be reverted.") : ""}</p> : null}
    <p>{t("在 LinkedIn 确认对方通过后，点击「已通过」；再回发送队列发消息。这里不会自动检测或发送。", "Check acceptance on LinkedIn, mark Accepted here, then return to Send queue to message. Nothing is checked or sent automatically.")}</p>
    {error ? <p role="alert">{error}</p> : null}
    {!rows.length ? <p>{t("暂无 Connect 请求记录", "No connection requests recorded")}</p> : <div className={styles.tableScroll}><table className={styles.connectionsTable}>
      <thead><tr>{[t("联系人", "Contact"), "LinkedIn", t("请求记录时间", "Request logged"), t("状态", "Status"), t("操作", "Action")].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{rows.map((lead) => {
        const connection = lead.linkedinConnection!;
        const changed = connection.route !== lead.socials?.linkedin;
        return <tr key={lead.id}><td>{lead.name}<br /><small>{lead.company}</small></td><td><a href={connection.route} target="_blank" rel="noopener noreferrer">{t("打开个人资料 ↗", "Open profile ↗")}</a></td><td>{new Date(connection.requestedAt).toLocaleString()}</td><td>{connection.acceptedAt ? <>{t("已通过", "Accepted")}<br /><small>{new Date(connection.acceptedAt).toLocaleString()}</small></> : t("等待通过", "Pending")}{changed ? <p>{t("联系人网址已更改", "Profile URL changed")}</p> : null}</td><td>{!connection.acceptedAt ? <button disabled={busy || changed} onClick={() => void accept(lead)}>{t("已通过 · 记录", "Accepted · Log")}</button> : channelSentAt(lead, "linkedin") ? t("消息已发送", "Message sent") : !changed && canPlanChannel(lead, "linkedin") ? <button disabled={busy} onClick={() => onMessage(lead.id)}>{t("去发送消息 →", "Write message →")}</button> : t("当前不可发送", "Currently unavailable")}</td></tr>;
      })}</tbody>
    </table></div>}
  </section>;
}
