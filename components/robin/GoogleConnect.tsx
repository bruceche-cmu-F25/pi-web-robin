"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  redirectUri: string;
  hint?: string;
  email?: string | null;
  canSendGmail?: boolean;
}

/**
 * Connect/disconnect control for the read-only Google calendar feed.
 *
 * `status` is what the events endpoint reported (including a fetch error, which
 * only that response knows about); this component fetches the fuller
 * configuration state on its own.
 */
export function GoogleConnect({
  status,
  onChanged,
  account = "primary",
  showClientConfig = false,
}: {
  status?: { connected: boolean; error?: string };
  onChanged: () => void;
  account?: "primary" | "outreach";
  showClientConfig?: boolean;
}) {
  const { t, locale } = useI18n();
  const zh = locale.startsWith("zh");
  const endpoint = account === "outreach" ? "/api/robin/google?account=outreach" : "/api/robin/google";
  const [config, setConfig] = useState<GoogleStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) return;
      setConfig(await response.json() as GoogleStatus);
    } catch {
      // Leave the row hidden rather than showing a broken control.
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: "connect" | "disconnect") => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/robin/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, account }),
      });
      const body = await response.json().catch(() => null) as
        { authorizeUrl?: string; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);

      if (action === "connect" && body?.authorizeUrl) {
        // Full navigation, not a popup: Google blocks consent in many embedded
        // and popup contexts, and the callback lands back on this origin.
        window.location.href = body.authorizeUrl;
        return;
      }
      await load();
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveClient = async () => {
    setBusy(true); setError(null); setSaved(false);
    try {
      const response = await fetch("/api/robin/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "configure", account: "outreach", clientId, clientSecret }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not save OAuth client");
      setClientSecret(""); setClientId(""); setSaved(true);
      await load(); onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };

  if (!config) return null;

  const connected = status?.connected ?? config.connected;

  return (
    <div className="flex flex-col gap-1 border-t pt-2" style={{ borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs" style={{ color: "var(--text-dim)" }}>
          {account === "outreach" ? (zh ? "Cold Reach 发件邮箱：" : "Cold Reach sender: ") : ""}
          {connected ? config.email ?? t("robin.google.connected") : t("robin.google.disconnected")}
        </span>
        {config.configured ? (
          <button
            type="button"
            onClick={() => void act(connected ? "disconnect" : "connect")}
            disabled={busy}
            className="ui-action px-2 text-xs disabled:opacity-40"
            style={{ color: "var(--accent)" }}
          >
            {busy ? "…" : connected ? t("robin.google.disconnect") : account === "outreach" ? (zh ? "连接个人 Gmail" : "Connect personal Gmail") : t("robin.google.connect")}
          </button>
        ) : (
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.google.notConfigured")}</span>
        )}
      </div>

      {account === "outreach" ? <p className="text-xs" style={{ color: "var(--text-dim)" }}>{zh ? "仅用于 Cold Reach 发信、查回复和跟进；学校邮箱与日历保持独立。连接或断开此账号会关闭自动发件箱，需手动重新开启。" : "Used only for Cold Reach sending, replies and follow-ups. Your school inbox and calendar stay separate. Connecting or disconnecting turns off the automatic outbox; enable it again when ready."}</p> : null}
      {account === "outreach" && showClientConfig ? <details open={!config.configured || undefined} className="py-2">
        <summary className="cursor-pointer text-sm">{zh ? "配置 Cold Reach OAuth 客户端" : "Configure Cold Reach OAuth client"}</summary>
        <p className="text-xs py-2">{zh ? "填写新建的 Web application 客户端。只更新 Cold Reach，学校邮箱配置保持不变。更换客户端后需重新连接个人 Gmail。" : "Use your new Web application client. Only Cold Reach is updated; school credentials stay unchanged. Reconnect personal Gmail after changing clients."}</p>
        <div className="flex flex-col gap-2 max-w-xl">
          <label className="text-sm">Client ID<input className="w-full border rounded p-2" style={{ background: "var(--bg)", borderColor: "var(--border)" }} value={clientId} onChange={(event) => setClientId(event.target.value)} autoComplete="off" spellCheck={false} disabled={busy} /></label>
          <label className="text-sm">Client secret<input className="w-full border rounded p-2" style={{ background: "var(--bg)", borderColor: "var(--border)" }} type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} autoComplete="new-password" spellCheck={false} disabled={busy} /></label>
          <button className="ui-action text-sm" disabled={busy || !clientId.trim() || !clientSecret.trim()} onClick={() => void saveClient()}>{zh ? "保存 Cold Reach 客户端" : "Save Cold Reach client"}</button>
        </div>
      </details> : null}
      {account === "outreach" && !showClientConfig ? <Link href="/dashboard/settings#cold-reach-email" className="text-xs underline" style={{ color: "var(--accent)" }}>{zh ? "前往设置管理发件邮箱" : "Manage sender in Settings"}</Link> : null}
      {saved ? <p role="status" className="text-sm">{zh ? "已保存。请点击「连接个人 Gmail」完成授权。" : "Saved. Click Connect personal Gmail to authorize."}</p> : null}
      {!config.configured && account === "primary" && (
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>
          {t("robin.google.configureHint")}
        </p>
      )}
      {status?.error && (
        <p className="text-xs" style={{ color: "var(--accent)" }}>{t("robin.google.error", { message: status.error })}</p>
      )}
      {error && <p className="text-xs" style={{ color: "var(--accent)" }}>{error}</p>}
    </div>
  );
}
