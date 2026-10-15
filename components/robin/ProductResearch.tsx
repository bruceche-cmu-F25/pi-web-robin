"use client";

import type { Idea } from "@/extension/robin/product-domain";
import { useProductAgent } from "./ProductIncubatorShell";
import { ProductOpportunities } from "./ProductOpportunities";
import { ProductGlyph } from "./ProductGlyph";
import styles from "./ProductWorkspace.module.css";

const SOURCE = "https://www.starterstory.com/data/ios-app-ideas";

export function ProductResearch({ zh, onCreated, onRefresh }: {
  zh: boolean;
  onCreated: (idea: Idea) => Promise<void>;
  onRefresh: () => Promise<unknown>;
}) {
  const agent = useProductAgent();
  return <div className={styles.section}>
    <header className={styles.sectionHeader}>
      <div>
        <span className={styles.eyebrow}>STARTER STORY / iOS APP IDEAS</span>
        <h2 className={styles.heading}>{zh ? "从现有 App，找到你的切口。" : "Find your opening in existing apps."}</h2>
        <p className={styles.description}>{zh ? "从这个产品目录选候选，再研究能否做得更好，或把同一机制用于新场景。" : "Choose a product from this directory, then investigate an improvement or a new context for its core mechanism."}</p>
      </div>
      <div className={styles.researchAction}>
        <button type="button" className={`ui-action pi-bracket ${styles.primaryAction}`} onClick={() => agent.ask({ brief: zh
          ? `机会来源只用 ${SOURCE} 的公开产品条目，不从创始人访谈中挑产品。先读取我的想法避免重复，再读取这个目录，挑 3 个适合单人低成本研究的 App；不要以收入高低直接推断适合我。对每个候选记录目录链接、产品详情链接、目录收入及口径、单人评分（如果有）；再查产品官网、App Store 定价与评论验证实际功能和具体痛点，确认是否确有 iOS 版本。提出一个可测的 10% 改进和一个迁移场景，说明最小原型、便宜的对照实验、收费假设和劝退理由。事实和假设分开，未披露的写未知，收入不是利润或我的验证。访谈只可补充实施经验，不改变候选来源。不绕过付费限制，不自动创建想法或改状态。`
          : `Discover candidates only from public product listings at ${SOURCE}, not founder interviews. Read my ideas first to avoid duplicates. Select 3 apps to investigate for low-cost solo building; high revenue is not proof of fit. Record the directory and detail links, revenue claim and basis, and source solo score if shown. Verify actual features, pricing, reviews and iOS availability through official product/App Store pages. Separate facts from hypotheses. Propose one measurable 10% improvement, one context transfer, a minimal prototype, cheap comparative test, billing hypothesis and strongest reason not to build. Mark unknowns; revenue is not profit or validation of my idea. Interviews may supplement implementation lessons only. Do not bypass paywalls, create ideas or change their state.` })}><ProductGlyph name="market" />{zh ? "从这个目录研究" : "Research this directory"}</button>
        <a href={SOURCE} target="_blank" rel="noopener noreferrer" className={`ui-action ${styles.timestamp}`}>{zh ? "打开 iOS App 点子库 ↗" : "Open iOS App Ideas ↗"}</a>
      </div>
    </header>
    <ol className={styles.readingPath} aria-label={zh ? "如何使用机会研究" : "How to use this desk"}>
      {(zh ? ["选现有 App", "改进 / 迁移", "小实验验证"] : ["Choose an app", "Improve / transfer", "Run a small test"]).map((step, index) => <li key={index}><span className={styles.stepLabel}>0{index + 1}</span><span>{step}</span></li>)}
    </ol>
    <ProductOpportunities onSave={onRefresh} onCreated={onCreated} />
  </div>;
}
