"use client";

import { PRODUCT_ASSESSMENT_CRITERIA, ASSESSMENT_STATUSES, ASSESSMENT_VERDICTS, type ProductAssessment as Assessment } from "@/extension/robin/product-assessment";
import styles from "./ProductWorkspace.module.css";

export function ProductAssessment({ assessment, zh }: { assessment: Assessment; zh: boolean }) {
  const lang = zh ? "zh" : "en";
  return <section className={styles.assessment} data-verdict={assessment.verdict} aria-label={zh ? "是否值得做的评估" : "Worth-building assessment"}>
    <header><strong>{ASSESSMENT_VERDICTS[assessment.verdict][lang]}</strong><span>{zh ? "AI 初评" : "AI assessment"} · {assessment.assessedAt.slice(0, 10)}</span></header>
    {assessment.stale ? <p className={styles.caution}>{zh ? "目录资料已变化，这是旧评估，请重新评估后再决策。" : "Directory facts changed. This assessment is stale; reassess before deciding."}</p> : null}
    {assessment.guardrail ? <p className={styles.caution}>{assessment.guardrail}</p> : null}
    <p>{assessment.reason}</p>
    <p><strong>{zh ? "下一步：" : "Next: "}</strong>{assessment.firstTest}</p>
    <details>
      <summary className="ui-action">{zh ? "查看六项依据、切口与止损条件" : "See six criteria, the wedge and stop rule"}</summary>
      <dl className={styles.assessmentCriteria}>
        {PRODUCT_ASSESSMENT_CRITERIA.map(({ id, ...label }) => {
          const criterion = assessment.criteria[id];
          return <div key={id}><dt>{label[lang]} <span data-status={criterion.status}>{ASSESSMENT_STATUSES[criterion.status][lang]}</span></dt><dd>{criterion.reason} {criterion.sourceIds.map((sourceId) => <a key={sourceId} className="ui-action" href={assessment.sources[sourceId - 1]!.url} target="_blank" rel="noopener noreferrer" aria-label={`${zh ? "来源" : "Source"} ${sourceId}`}>[{sourceId}]</a>)}</dd></div>;
        })}
      </dl>
      <p><strong>{zh ? "你的切口（假设）：" : "Your wedge (hypothesis): "}</strong>{assessment.wedge}</p>
      <p><strong>{zh ? "停止条件：" : "Stop when: "}</strong>{assessment.stopRule}</p>
      {assessment.unknowns.length ? <div><strong>{zh ? "还不知道：" : "Still unknown: "}</strong><ul>{assessment.unknowns.map((item, i) => <li key={i}>{item}</li>)}</ul></div> : null}
      {assessment.sources.length ? <div className={styles.assessmentSources}>
        <h4>{zh ? "AI 引用的来源 · 可展开核对原文" : "AI-cited sources · expand to check quotations"}</h4>
        {assessment.sources.map((source, index) => <details key={index}><summary className="ui-action">[{index + 1}] {source.title}</summary><blockquote>{source.quote}</blockquote><a href={source.url} target="_blank" rel="noopener noreferrer" className="ui-action">{zh ? "打开原始页面 ↗" : "Open original page ↗"}</a></details>)}
      </div> : null}
    </details>
    <p className={styles.small}>{zh ? `证据把握：${assessment.confidence === "low" ? "低" : "中"}。这是 AI 辅助判断，引用未独立审计；“值得验证”不等于建议完整开发。` : `Evidence confidence: ${assessment.confidence}. AI-assisted judgment, not an independent audit. A worthwhile test is not a recommendation to build the full product.`}</p>
  </section>;
}
