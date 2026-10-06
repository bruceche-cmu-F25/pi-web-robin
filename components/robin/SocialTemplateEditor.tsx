"use client";

import { useState } from "react";
import { mutate } from "./usePolledResource";
import styles from "./JarvisDiscovery.module.css";
import { JARVIS_PREFERENCES_API } from "@/lib/jarvis-api";

export function SocialTemplateEditor({ platform, template, refresh, zh }: { platform: "instagram" | "linkedin"; template: string; refresh: () => Promise<void>; zh: boolean }) {
  const [body, setBody] = useState(template);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const label = platform === "instagram" ? "Instagram" : "LinkedIn";
  const t = (cn: string, en: string) => zh ? cn : en;
  const save = async () => {
    setBusy(true); setError("");
    try {
      await mutate(JARVIS_PREFERENCES_API, "POST", { action: "social-template", platform, body });
      await refresh(); setSaved(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  return <details className={styles.template} open>
    <summary>{label} · {t("私信模板", "DM template")}{body !== template ? <span>{t("未保存", "Unsaved")}</span> : null}</summary>
    <div className={styles.templateForm}>
      <p>{t("用于尚未保存草稿的联系人。已有文案保持原样，可在审核／发送队列中点击「套用当前模板」，检查后重新批准。", "Used for contacts without a saved draft. For existing copy, choose Apply current template in Review / Send queue, then review and approve it again.")}</p>
      <label>{label} {t("私信正文", "message")}<textarea rows={9} maxLength={4000} value={body} disabled={busy} onChange={e => { setBody(e.target.value); setSaved(false); }} /></label>
      <p className="text-xs">{t("可用变量：", "Placeholders: ")}<code>{"{{firstName}} {{name}} {{company}} {{role}} {{area}} {{work}} {{opener}} {{shortOpener}}"}</code></p>
      <p className="text-xs">{t("{{opener}} 保留每个人的个性化开场；想更简短可以删掉它。保存模板不会发送消息。", "{{opener}} adds the personalized introduction; remove it for a shorter message. Saving sends nothing.")}</p>
      <button type="button" className="ui-action pi-bracket" disabled={busy || !body.trim() || body === template} onClick={() => void save()}>{busy ? t("保存中…", "Saving…") : t(`保存 ${label} 模板`, `Save ${label} template`)}</button>
      {error ? <p role="alert">{error}</p> : null}
      {saved ? <p role="status">{t("模板已保存", "Template saved")}</p> : null}
    </div>
  </details>;
}
