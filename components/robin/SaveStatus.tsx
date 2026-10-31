"use client";

import { useI18n } from "@/hooks/useI18n";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

/** Describe a confirmed receipt separately from a draft or an uncertain write. No timers or retries of our own. */
export function SaveStatus({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  const { t } = useI18n();
  return <span className="save-status" data-state={state}>
    <span role="status" aria-live="polite">{state === "idle" ? "" : t(`saveStatus.${state}`)}</span>
    {state === "error" && onRetry && <button type="button" className="ui-action" onClick={onRetry}>{t("saveStatus.retry")}</button>}
  </span>;
}
