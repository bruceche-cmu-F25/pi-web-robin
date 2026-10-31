"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { clearTextRecovery, readTextRecoveries, type RecoveryScope, type TextRecovery } from "@/lib/text-recovery";

export function TextRecoveryWarning() {
  const { locale } = useI18n();
  return <p role="status" className="px-3 py-2 text-sm" style={{ color: "var(--danger)" }}>
    {locale.startsWith("zh") ? "本机草稿备份不可用（存储受限或文本过大）。请复制未保存的文字后再离开。" : "Local draft backup unavailable (storage restricted or text too large). Copy unsaved text before leaving."}
  </p>;
}

/** Offer an old copy, never replace the server-loaded editor without a user choice. */
export function TextRecoveryNotice({ scope, id, writer, disabled, onRestore }: {
  scope: RecoveryScope; id: string; writer: string; disabled?: boolean;
  // True only after the adopted text has its own local backup. Otherwise keep this copy.
  onRestore: (fields: Record<string, string>) => boolean;
}) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const [recovery, setRecovery] = useState<{ drafts: TextRecovery[]; unavailable: boolean }>({ drafts: [], unavailable: false });
  useEffect(() => {
    const refresh = () => setRecovery(readTextRecoveries(scope, id, writer));
    refresh();
    const storageChanged = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(`pi-web:text-recovery:v1:${scope}:${encodeURIComponent(id)}:`)) refresh();
    };
    window.addEventListener("storage", storageChanged);
    return () => window.removeEventListener("storage", storageChanged);
  }, [scope, id, writer]);

  const discard = (draft: TextRecovery) => {
    clearTextRecovery(draft);
    setRecovery(readTextRecoveries(scope, id, writer));
  };
  const labels: Record<string, string> = zh
    ? { title: "标题", text: "正文", notionParentId: "Notion 目标", name: "名称", note: "备注", source: "LaTeX 源码" }
    : { title: "Title", text: "Text", notionParentId: "Notion destination", name: "Name", note: "Note", source: "LaTeX source" };

  return <>
    {recovery.unavailable ? <TextRecoveryWarning /> : null}
    {recovery.drafts.map((draft) => <section key={draft.key} aria-label={zh ? "本机草稿恢复" : "Local draft recovery"}
      className="min-w-0 border p-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--bg-panel)", overflowWrap: "anywhere" }}>
      <p>{zh ? "发现本机文字备份，尚未自动恢复。请先预览；恢复会替换相应字段，沿用页面的保存方式。" : "Local text backup found; nothing is restored automatically. Preview first. Restoring replaces those fields and uses normal saving rules."}</p>
      <details className="my-2">
        <summary className="ui-action min-h-11 py-3">{zh ? "预览备份" : "Preview backup"} · <time dateTime={draft.savedAt}>{new Date(draft.savedAt).toLocaleString(locale)}</time></summary>
        {Object.entries(draft.fields).map(([field, value]) => <div key={field}>
          <strong>{labels[field]}</strong><pre className="max-h-48 overflow-auto whitespace-pre-wrap py-2" style={{ font: "inherit", overflowWrap: "anywhere" }}>{value || (zh ? "（空）" : "(empty)")}</pre>
        </div>)}
      </details>
      <div className="flex flex-wrap gap-3">
        <button type="button" aria-label={zh ? "恢复草稿" : "Restore draft"} className="ui-action pi-bracket min-h-11" disabled={disabled} onClick={() => {
          if (onRestore(draft.fields)) discard(draft);
        }}>{zh ? "恢复草稿" : "Restore draft"}</button>
        <button type="button" aria-label={zh ? "丢弃这份备份" : "Discard backup"} className="ui-action pi-bracket min-h-11" disabled={disabled} onClick={() => discard(draft)}>{zh ? "丢弃这份备份" : "Discard backup"}</button>
      </div>
    </section>)}
  </>;
}
