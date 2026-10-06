"use client";

import { useState } from "react";
import { JARVIS_DELIVERY_POLICY } from "@/extension/robin/jarvis-shape";
import { mutate } from "./usePolledResource";
import styles from "./JarvisDiscovery.module.css";
import { JARVIS_PREFERENCES_API } from "@/lib/jarvis-api";

export function FollowUpTemplateEditor({ template, refresh, zh }: { template: string; refresh: () => Promise<void>; zh: boolean }) {
  const [body, setBody] = useState(template);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const t = (cn: string, en: string) => zh ? cn : en;
  const save = async () => {
    setBusy(true); setError("");
    try {
      await mutate(JARVIS_PREFERENCES_API, "POST", { action: "follow-up-template", body });
      setSaved(true); await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <details className={styles.template}>
    <summary>{t("跟进邮件模板", "Follow-up email template")}{body !== template ? <span>{t("未保存", "Unsaved")}</span> : null}</summary>
    <div className={styles.templateForm}>
      <p>{t(`用于首封发出 ${JARVIS_DELIVERY_POLICY.followUpDelayHours} 小时后仍未回复的跟进邮件。沿用原邮件主题和会话，最多跟进一次。保存只更新模板，不会开启发送箱或立即发信。`, `Used for one follow-up after ${JARVIS_DELIVERY_POLICY.followUpDelayHours} hours without a reply, in the original email thread. Saving updates the template; it does not enable the outbox or send immediately.`)}</p>
      <label>{t("主题", "Subject")}<input readOnly value={t("Re: 原邮件主题（自动沿用）", "Re: original email subject (automatic)")} /></label>
      <label>{t("跟进正文", "Follow-up body")}<textarea rows={12} maxLength={12000} value={body} disabled={busy} onChange={(event) => { setBody(event.target.value); setSaved(false); }} /></label>
      <p className="text-xs">{t("可用变量：", "Placeholders: ")}<code>{"{{firstName}} {{name}} {{company}} {{role}} {{area}} {{work}} {{opener}} {{shortOpener}}"}</code></p>
      <button type="button" className="ui-action pi-bracket" disabled={busy || !body.trim() || body === template} onClick={() => void save()}>{t("保存跟进模板", "Save follow-up template")}</button>
      {error ? <p role="alert">{error}</p> : null}
      {saved ? <p role="status">{t("跟进模板已保存。", "Follow-up template saved.")}</p> : null}
    </div>
  </details>;
}
