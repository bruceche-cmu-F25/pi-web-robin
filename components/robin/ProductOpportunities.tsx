"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { Idea } from "@/extension/robin/product-domain";
import { useProductAgent } from "./ProductIncubatorShell";
import styles from "./ProductWorkspace.module.css";
import type { Opportunity } from "@/extension/robin/product-opportunities";
import { usePolledResource } from "./usePolledResource";
import { PRODUCT_ASSESSMENT_CRITERIA, type ProductAssessment as Assessment } from "@/extension/robin/product-assessment";
import { ProductAssessment } from "./ProductAssessment";

interface Board {
  opportunities: Opportunity[];
  checkedAt?: string;
  attemptedAt?: string;
  error?: string;
  scanning: boolean;
  scheduled: boolean;
  source: string;
  savedIds: string[];
  assessments?: Record<string, Assessment>;
}

export function ProductOpportunities({ onSave, onCreated }: { onSave: () => Promise<unknown>; onCreated?: (idea: Idea) => Promise<void> }) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const { data, error, refresh } = usePolledResource<Board>("/api/robin/product-opportunities", 30_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const agent = useProductAgent();
  const [written, setWritten] = useState<Record<string, Assessment>>({});
  const [assessmentErrors, setAssessmentErrors] = useState<Record<string, string>>({});
  const assessing = useRef<AbortController | null>(null);
  useEffect(() => () => assessing.current?.abort(), []);

  async function assess(item: Opportunity) {
    if (busy || assessing.current) return;
    const controller = new AbortController();
    assessing.current = controller;
    setBusy(`assess:${item.id}`);
    setAssessmentErrors((previous) => ({ ...previous, [item.id]: "" }));
    try {
      const response = await fetch("/api/robin/product-opportunities/assess", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, locale: zh ? "zh" : "en" }), signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok || !result.assessment) throw new Error(result.error ?? `HTTP ${response.status}`);
      setWritten((previous) => ({ ...previous, [item.id]: result.assessment }));
      await refresh();
    } catch (caught) {
      setAssessmentErrors((previous) => ({ ...previous, [item.id]: controller.signal.aborted
        ? (zh ? "已停止评估，之前的结果保留。" : "Assessment stopped; previous result retained.")
        : caught instanceof Error ? caught.message : String(caught) }));
    } finally {
      assessing.current = null;
      setBusy(null);
    }
  }

  async function act(body: object, id: string) {
    setBusy(id);
    setActionError(null);
    try {
      const response = await fetch("/api/robin/product-opportunities", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
      if (id !== "refresh") {
        if (onCreated && result.idea) await onCreated(result.idea);
        else await onSave();
      }
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  return <section aria-labelledby="product-opportunities" className="flex flex-col gap-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 id="product-opportunities" className="text-lg">{zh ? "iOS App 目录" : "iOS App directory"}</h3>
        <p className="mt-2 max-w-3xl text-sm" style={{ color: "var(--text-muted)" }}>
          {zh ? "展示该页公开可读的产品，不按收入门槛剔除小 App。收入和单人评分来自目录，未独立核实，也不代表适合你；具体 iOS 版本、价格和用户痛点仍需查证。" : "Public products from this page, including small apps with low or undisclosed revenue. Revenue and solo scores are directory claims, not independently verified or a fit assessment. Verify iOS availability, pricing and user pain."}
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>
          {data?.checkedAt ? (zh ? "上次读取：" : "Last read: ") + new Date(data.checkedAt).toLocaleDateString(locale) : zh ? "尚未完成首次读取" : "No successful read yet"}
          {data?.scanning ? (zh ? " · 正在读取" : " · Reading now") : ""}
          {data ? ` · ${data.opportunities.length} ${zh ? "个公开候选" : "public candidates"}` : ""}
          {data?.scheduled ? (zh ? " · 已配置本机每日 09:00 定时更新" : " · Local daily 09:00 update configured") : (zh ? " · 打开页面时每日检查；未配置后台定时" : " · Checks daily on page open; no background schedule configured")}
        </p>
      </div>
      <button type="button" disabled={!!busy || data?.scanning} onClick={() => void act({ refresh: true }, "refresh")} className="ui-action pi-bracket min-h-11 px-2 text-xs disabled:opacity-50">{zh ? "现在更新" : "Refresh now"}</button>
    </header>
    <details className={styles.assessmentGuide}>
      <summary className="ui-action">{zh ? "怎么判断值不值得做？" : "How is this assessed?"}</summary>
      <p>{zh ? "按单人、低成本、改进或场景迁移评估，不替你假设技能、预算或已有用户。高收入和来源单人评分不是开工理由。" : "For a solo, low-cost improvement or context transfer. No assumed skills, budget or audience. High revenue and the directory's solo score are not a reason to build."}</p>
      <ul>{PRODUCT_ASSESSMENT_CRITERIA.map((criterion) => <li key={criterion.id}>{criterion[zh ? "zh" : "en"]}</li>)}</ul>
      <p>{zh ? "有关键未知或缺少官网与目录外的依据，不会建议投入验证；明确的阻碍则可判为“暂不建议”。点击才运行 AI，调研回合限时 3 分钟，可停止；每日目录更新不自动评估。" : "Key unknowns or missing official/non-directory evidence prevent a positive verdict; a clear blocker can still mean Pass. AI runs only on click, with a 3-minute research-turn limit and a stop control; daily discovery never triggers assessments."}</p>
      <p>{zh ? "采集范围：仅公开页快照，不代表完整数据库。未读取登录或订阅内容；来源不可访问时会标记未知。" : "Coverage: a public-page snapshot, not the whole database. Login/subscription content is not read; inaccessible sources remain unknown."}</p>
    </details>
    {error || actionError || data?.error ? <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{actionError ?? error ?? data?.error}</p> : null}
    {!data ? <p role="status" className="text-sm">{zh ? "加载中…" : "Loading…"}</p> : data.opportunities.length === 0 ? <p role="status" className="text-sm" style={{ color: "var(--text-muted)" }}>{data.scanning ? (zh ? "正在读取公开条目…" : "Reading public listings…") : zh ? "目前还没有可读的公开条目。" : "No readable public listings yet."}</p> :
      <ul className={styles.catalogGrid}>
        {data.opportunities.map((item) => {
          const saved = data.savedIds.includes(item.id);
          const remote = data.assessments?.[item.id];
          const local = written[item.id];
          const assessment = local && (!remote || local.assessedAt > remote.assessedAt) ? local : remote;
          const working = busy === `assess:${item.id}`;
          return <li key={item.id} className={styles.catalogItem}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span aria-hidden="true" className="relative grid size-11 shrink-0 place-items-center border text-lg font-semibold" style={{ borderColor: "var(--border)", color: "var(--accent)", background: "var(--bg-panel)" }}>
                {(item.productHost ?? item.title).slice(0, 1).toUpperCase()}
                {item.logoUrl ? (
                  // Source-list icon, decorative beside the visible product name.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.logoUrl} alt="" width={44} height={44} loading="lazy" className="absolute inset-0 size-full object-cover" onError={(event) => { event.currentTarget.hidden = true; }} />
                ) : null}
              </span>
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="ui-action min-w-0 text-base font-semibold" style={{ color: "var(--text)", overflowWrap: "anywhere" }}>{item.productHost ?? item.title} ↗</a>
              <span className="pi-eyebrow">{item.monthlyUsd === null ? (zh ? "月收入未披露" : "Monthly revenue undisclosed") : `${item.revenue} · ${item.revenueBasis === "estimated" ? (zh ? "第三方估算" : "estimated") : item.revenueBasis === "reported" ? (zh ? "来源自报" : "self-reported") : (zh ? "口径不明" : "basis unknown")}`}</span>
              {item.soloScore !== undefined ? <span className="pi-eyebrow">{zh ? "来源单人评分" : "Source solo score"} {item.soloScore}/100</span> : null}
            </div>
            <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>{item.title}</p>
            {item.relatedIdea ? <p className="mt-2 text-xs" style={{ color: "var(--accent-teal)" }}>{zh ? "关联你的" : "Related to"} {item.relatedIdea}</p> : null}
            {assessment ? <ProductAssessment assessment={assessment} zh={zh} /> : <p className={styles.small}>{zh ? "尚未评估 · 目录收入不代表值得做" : "Not assessed · directory revenue is not a recommendation"}</p>}
            {working ? <p role="status" className={styles.small}>{zh ? "正在核查产品、定价与用户证据…" : "Checking product, pricing and customer evidence…"}</p> : null}
            {assessmentErrors[item.id] ? <p role="alert" className={styles.error}>{assessmentErrors[item.id]}</p> : null}
            <button type="button" disabled={!!busy} onClick={() => void assess(item)} className="ui-action pi-bracket min-h-11 text-xs" data-state="accent">{working ? (zh ? "评估中…" : "Assessing…") : assessment ? (zh ? "重新评估" : "Reassess") : (zh ? "判断值不值得做" : "Assess this opportunity")}</button>
            {working ? <button type="button" onClick={() => assessing.current?.abort()} className="ui-action min-h-11 text-xs">{zh ? "停止评估" : "Stop assessment"}</button> : null}
            <details className="mt-2">
              <summary className="ui-action min-h-11 cursor-pointer content-center text-xs" style={{ color: "var(--text-muted)" }}>{zh ? "待验证假设：改进 / 迁移" : "Unvalidated hypotheses: improve / transfer"}</summary>
              <p className="mb-3 text-xs" style={{ color: "var(--accent-amber)" }}>{zh ? "以下是按类别生成的研究起点，不是已发现的产品缺陷或来源事实。" : "Category-level prompts, not researched product defects or source facts."}</p>
              <dl className="grid gap-2 pb-2 text-sm" style={{ color: "var(--text)" }}>
                {([
                  [zh ? "可能的切口" : "Potential angle", item.angle],
                  [zh ? "迁移场景" : "Context transfer", item.transfer ?? (zh ? "待研究" : "Not researched")],
                  ["MVP", item.mvp],
                  [zh ? "商业化" : "Monetization", item.charge],
                  [zh ? "10% 验证" : "10% test", item.experiment],
                ] as const).map(([label, value]) => <div key={label}><dt className="pi-eyebrow mb-1">{label}</dt><dd className="m-0">{value}</dd></div>)}
              </dl>
            </details>
            <button type="button" className="ui-action pi-bracket min-h-11 self-start text-xs" onClick={() => agent.ask({ brief: zh
              ? `从 https://www.starterstory.com/data/ios-app-ideas 收录的这个候选研究：${item.title}；详情 ${item.url}；目录显示官网 ${item.productHost ?? "未知"}。先核查官方产品、iOS 版本、当前价格与评论；不要换成访谈中的其他产品。列出带来源的实际功能与痛点，再分别提出 10% 改进、场景迁移、最小原型、对照实验和劝退理由。区分事实与假设；目录收入不是利润或我的验证。只研究，不创建想法、不改状态。`
              : `Research this candidate from https://www.starterstory.com/data/ios-app-ideas: ${item.title}; detail ${item.url}; listed site ${item.productHost ?? "unknown"}. Verify official features, iOS availability, current pricing and reviews. Do not substitute products from interviews. Separate sourced facts from hypotheses; propose a measurable 10% improvement, context transfer, minimal prototype, comparative test and strongest reason not to build. Directory revenue is not profit or validation. Research only; do not create ideas or change state.` })}>{zh ? "研究这个产品" : "Research this product"}</button>
            <button type="button" disabled={!!busy} onClick={() => void act({ id: item.id }, item.id)} className="ui-action pi-bracket min-h-11 px-2 text-xs disabled:opacity-50">{saved ? (zh ? "打开已保存想法" : "Open saved idea") : busy === item.id ? (zh ? "保存中…" : "Saving…") : (zh ? "保存为想法" : "Save as idea")}</button>
          </li>;
        })}
      </ul>}
    <a href={data?.source ?? "https://www.starterstory.com/data/ios-app-ideas"} target="_blank" rel="noopener noreferrer" className="ui-action self-start text-xs" style={{ color: "var(--text-muted)" }}>{zh ? "查看原始公开列表 ↗" : "View original public list ↗"}</a>
  </section>;
}
