"use client";

import { useI18n } from "@/hooks/useI18n";
import { useUiStyle } from "@/hooks/useUiStyle";
import { PiMark } from "./PiMark";

export function UiStyleToggle({ showLabel = false }: { showLabel?: boolean }) {
  const { t } = useI18n();
  const { style, toggleStyle } = useUiStyle();
  const isBalanced = style === "balanced";
  const label = t(isBalanced ? "uiStyle.balanced" : "uiStyle.classic");

  return (
    <button
      type="button"
      className="pi-ui-style-toggle ui-action ui-action--surface"
      data-style={style}
      onClick={toggleStyle}
      title={label}
      aria-label={label}
    >
      {isBalanced ? (
        <PiMark className="pi-ui-style-toggle-mark" />
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      )}
      {showLabel && <span>{isBalanced ? "Balanced" : "Classic"}</span>}
    </button>
  );
}
