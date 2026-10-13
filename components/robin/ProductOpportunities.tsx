"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { localDate } from "@/extension/robin/dates";
import type { Opportunity } from "@/extension/robin/product-opportunities";
import { usePolledResource } from "./usePolledResource";

interface Board {
  opportunities: Opportunity[];
  checkedAt?: string;
  attemptedAt?: string;
  error?: string;
  scanning: boolean;
  scheduled: boolean;
  source: string;
  savedIds: string[];
}

export function ProductOpportunities({ onSave }: { onSave: () => Promise<unknown> }) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const { data, error, refresh } = usePolledResource<Board>("/api/robin/product-opportunities", 30_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const today = localDate();
  const addedToday = data?.opportunities.filter((item) => item.discoveredOn === today).length ?? 0;

  async function act(body: object, id: string) {
    setBusy(id);
    setActionError(null);
    try {
      const response = await fetch("/api/robin/product-opportunities", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? `HTTP ${response.status}`);
      if (id !== "refresh") await onSave();
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  return <section aria-labelledby="product-opportunities" className="pi-panel flex flex-col gap-4 p-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="product-opportunities" className="pi-label">{zh ? "产品机会列表" : "Product opportunities"}</h2>
        <p className="mt-2 max-w-3xl text-sm" style={{ color: "var(--text-muted)" }}>
          {zh ? "每天从 Starter Story 公开列表筛选并追加最多 3 个新机会，旧条目保留、不重复加入。收入是来源声称的月收入，不是核实的 ARR；10% 提升是待测试假设。" : "Up to 3 new public Starter Story opportunities are appended daily; previous entries stay. Revenue is a source claim, not verified ARR; 10% improvement is a hypothesis to test."}
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>
          {data?.checkedAt ? (zh ? "上次读取：" : "Last read: ") + new Date(data.checkedAt).toLocaleDateString(locale) : zh ? "尚未完成首次读取" : "No successful read yet"}
          {data?.scanning ? (zh ? " · 正在读取" : " · Reading now") : ""}
          {data ? ` · ${zh ? `今天新增 ${addedToday} · 累计 ${data.opportunities.length}` : `${addedToday} added today · ${data.opportunities.length} total`}` : ""}
          {data?.scheduled ? (zh ? " · 已配置本机每日 09:00 定时更新" : " · Local daily 09:00 update configured") : (zh ? " · 打开页面时每日检查；未配置后台定时" : " · Checks daily on page open; no background schedule configured")}
        </p>
      </div>
      <button type="button" disabled={!!busy || data?.scanning} onClick={() => void act({ refresh: true }, "refresh")} className="ui-action pi-bracket min-h-11 px-2 text-xs disabled:opacity-50">{zh ? "现在更新" : "Refresh now"}</button>
    </header>
    {error || actionError || data?.error ? <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{actionError ?? error ?? data?.error}</p> : null}
    {!data ? <p role="status" className="text-sm">{zh ? "加载中…" : "Loading…"}</p> : data.opportunities.length === 0 ? <p role="status" className="text-sm" style={{ color: "var(--text-muted)" }}>{data.scanning ? (zh ? "正在读取公开条目…" : "Reading public listings…") : zh ? "目前没有符合筛选条件的公开条目。" : "No public listings meet the criteria yet."}</p> :
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {data.opportunities.map((item) => {
          const saved = data.savedIds.includes(item.id);
          return <li key={item.id} className="pi-card min-w-0 p-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span aria-hidden="true" className="relative grid size-11 shrink-0 place-items-center border text-lg font-semibold" style={{ borderColor: "var(--border)", color: "var(--accent)", background: "var(--bg-panel)" }}>
                {item.title.slice(0, 1).toUpperCase()}
                {item.logoUrl ? (
                  // Source-list icon, decorative beside the visible product name.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.logoUrl} alt="" width={44} height={44} loading="lazy" className="absolute inset-0 size-full object-cover" onError={(event) => { event.currentTarget.hidden = true; }} />
                ) : null}
              </span>
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="ui-action min-w-0 text-base font-semibold" style={{ color: "var(--text)", overflowWrap: "anywhere" }}>{item.title} ↗</a>
              <span className="pi-eyebrow">{item.revenue} · {item.revenueBasis === "estimated" ? (zh ? "第三方估算" : "estimated") : item.revenueBasis === "reported" ? (zh ? "来源自报" : "self-reported") : (zh ? "口径不明" : "basis unknown")}</span>
              <span className="pi-eyebrow">{item.discoveredOn === today ? (zh ? "今天新增" : "New today") : item.discoveredOn ?? (zh ? "此前收录" : "Previously added")}</span>
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{item.match}{item.relatedIdea ? ` · ${zh ? "关联你的" : "Related to"} ${item.relatedIdea}` : ""}</p>
            <details className="mt-2">
              <summary className="ui-action min-h-11 cursor-pointer content-center text-xs" style={{ color: "var(--text-muted)" }}>{zh ? "查看切口、MVP 与商业化" : "See angle, MVP and monetization"}</summary>
              <dl className="grid gap-2 pb-2 text-sm" style={{ color: "var(--text)" }}>
                {([
                  [zh ? "可能的切口" : "Potential angle", item.angle],
                  ["MVP", item.mvp],
                  [zh ? "商业化" : "Monetization", item.charge],
                  [zh ? "10% 验证" : "10% test", item.experiment],
                ] as const).map(([label, value]) => <div key={label}><dt className="pi-eyebrow mb-1">{label}</dt><dd className="m-0">{value}</dd></div>)}
              </dl>
            </details>
            <button type="button" disabled={saved || !!busy} onClick={() => void act({ id: item.id }, item.id)} className="ui-action pi-bracket min-h-11 px-2 text-xs disabled:opacity-50">{saved ? (zh ? "已保存到想法" : "Saved to ideas") : busy === item.id ? (zh ? "保存中…" : "Saving…") : (zh ? "保存为想法" : "Save as idea")}</button>
          </li>;
        })}
      </ul>}
    <a href={data?.source ?? "https://www.starterstory.com/data"} target="_blank" rel="noopener noreferrer" className="ui-action self-start text-xs" style={{ color: "var(--text-muted)" }}>{zh ? "查看原始公开列表 ↗" : "View original public list ↗"}</a>
  </section>;
}
