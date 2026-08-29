"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ConfigEmptyState, ConfigSectionTitle } from "./SettingsUi";
import AnthropicIcon from "@lobehub/icons/es/Anthropic/components/Mono";
import OpenAIIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import OpenCodeIcon from "@lobehub/icons/es/OpenCode/components/Mono";

// Same rendering convention as ModelsConfig: mono icons inherit currentColor.
const USAGE_PROVIDER_ICONS: Record<string, React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>> = {
  "openai-codex": OpenAIIcon,
  "anthropic": AnthropicIcon,
  "opencode": OpenCodeIcon,
};

interface UsageWindowView {
  label: string;
  usedPercent: number;
  resetAt?: number;
}

interface ProviderUsageView {
  provider: string;
  displayName: string;
  windows: UsageWindowView[];
  plan?: string;
  creditBalance?: number;
  extraUsageEnabled?: boolean;
  error?: string;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "success"; providers: ProviderUsageView[]; fetchedAt: number }
  | { phase: "error"; message: string };

function formatReset(resetAt: number, now: number): string {
  const remainingMs = resetAt - now;
  if (remainingMs <= 0) return "now";
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${mins}m`;
  return `in ${mins}m`;
}

function UsageBar({ window: usageWindow, now }: { window: UsageWindowView; now: number }) {
  const { t } = useI18n();
  const used = Math.round(usageWindow.usedPercent);
  const remaining = Math.max(0, 100 - used);
  const color = used >= 80 ? "var(--danger)" : used >= 60 ? "var(--warning)" : "var(--success)";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {usageWindow.label}
        </span>
        <span style={{ fontSize: 11, color: "var(--text)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {t("models.usageUsedRemaining", { used, remaining })}
        </span>
      </div>
      <div style={{ height: 6, marginTop: 5, background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 0, overflow: "hidden" }}>
        <div style={{ width: `${used}%`, height: "100%", background: color, transition: "width 0.3s ease" }} />
      </div>
      {usageWindow.resetAt !== undefined && (
        <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 3 }}>
          {t("models.usageResets", { time: formatReset(usageWindow.resetAt, now) })}
        </div>
      )}
    </div>
  );
}

function UsageCard({ usage, now }: { usage: ProviderUsageView; now: number }) {
  const { t } = useI18n();
  const Icon = USAGE_PROVIDER_ICONS[usage.provider];
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 0, background: "var(--bg-panel)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {Icon && <Icon size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />}
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {usage.displayName}
        </span>
        {usage.plan && (
          <span style={{ fontSize: 10, padding: "1px 6px", background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "color-mix(in srgb, var(--accent) 80%, transparent)", borderRadius: 0, flexShrink: 0 }}>
            {usage.plan}
          </span>
        )}
        <span style={{ marginLeft: "auto", width: 7, height: 7, borderRadius: "50%", background: usage.error ? "var(--danger)" : "var(--success)", flexShrink: 0 }} />
      </div>

      {usage.error ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>{usage.error}</div>
      ) : usage.windows.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("models.usageNoData")}</div>
      ) : (
        <>
          {usage.windows.map((window) => (
            <UsageBar key={window.label} window={window} now={now} />
          ))}
          {usage.creditBalance !== undefined && (
            <div style={{ fontSize: 10, color: "var(--text-dim)" }}>
              {t("models.usageExtraCredit", { balance: usage.creditBalance.toFixed(2) })}
            </div>
          )}
          {usage.extraUsageEnabled !== undefined && (
            <div style={{ fontSize: 10, color: "var(--text-dim)" }}>
              {usage.extraUsageEnabled
                ? t("models.usageExtraUsageEnabled")
                : t("models.usageExtraUsageDisabled")}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Quota dashboard for subscription-backed providers (Settings → Models → Usage). */
export function UsagePanel() {
  const { t } = useI18n();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const requestIdRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setState({ phase: "loading" });
    try {
      const res = await fetch("/api/usage", { cache: "no-store" });
      const data = await res.json() as {
        providers?: ProviderUsageView[];
        fetchedAt?: number;
        error?: string;
      };
      if (requestId !== requestIdRef.current) return;
      if (!res.ok || data.error || !Array.isArray(data.providers)) {
        setState({ phase: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setState({ phase: "success", providers: data.providers, fetchedAt: data.fetchedAt ?? Date.now() });
      setNow(Date.now());
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <ConfigSectionTitle>{t("models.usage")}</ConfigSectionTitle>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state.phase === "loading"}
          style={{
            height: 24, padding: "0 9px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 0,
            color: state.phase === "loading" ? "var(--text-dim)" : "var(--text-muted)",
            cursor: state.phase === "loading" ? "not-allowed" : "pointer",
            fontSize: 11, display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
          {state.phase === "loading" ? t("models.usageLoading") : t("models.usageRefresh")}
        </button>
      </div>

      {state.phase === "loading" && <ConfigEmptyState>{t("models.usageLoading")}</ConfigEmptyState>}

      {state.phase === "error" && (
        <div style={{ padding: "8px 10px", border: "1px solid color-mix(in srgb, var(--danger) 30%, transparent)", borderRadius: 0, color: "var(--danger)", fontSize: 11, lineHeight: 1.4 }}>
          {t("models.usageFailed", { message: state.message })}
        </div>
      )}

      {state.phase === "success" && (
        <>
          <div style={{ fontSize: 10, color: "var(--text-dim)" }}>
            {t("models.usageUpdated", { time: new Date(state.fetchedAt).toLocaleTimeString() })}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {state.providers.map((usage) => (
              <UsageCard key={usage.provider} usage={usage} now={now} />
            ))}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {t("models.usageFootnote")}
          </div>
        </>
      )}
    </div>
  );
}
