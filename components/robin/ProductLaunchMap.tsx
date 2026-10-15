"use client";

import { useEffect, useState } from "react";
import { LAUNCH_MAP, LAUNCH_STATUSES, breakEvenCustomers, type LaunchDecision, type LaunchNodeId, type LaunchStatus } from "@/extension/robin/product-launch";
import { PRODUCT_CASES } from "@/extension/robin/product-cases";
import type { Idea } from "@/extension/robin/product-domain";
import { ProductGlyph } from "./ProductGlyph";
import styles from "./ProductWorkspace.module.css";

const NODE_HINTS: Record<LaunchNodeId, { zh: string; en: string }> = {
  market: { zh: "谁在付钱，为什么选你", en: "Who pays, and why choose you" },
  validation: { zh: "先拿证据，再写代码", en: "Evidence before code" },
  build: { zh: "只做一条能用的核心路径", en: "One usable path to value" },
  billing: { zh: "价格、收款、退款与责任", en: "Price, checkout, refunds & obligations" },
  distribution: { zh: "找到第一批真正的买家", en: "Reach your first real buyers" },
  release: { zh: "让陌生人能安全地用起来", en: "Deliver safely to a stranger" },
  operations: { zh: "处理故障，让用户再回来", en: "Handle failures & earn repeat use" },
  economics: { zh: "算清成本，知道何时停下", en: "Know the costs and when to stop" },
};

type Draft = { status: LaunchStatus; note: string; expectedUpdatedAt: string | null };
const STATUS = {
  todo: { zh: "未决定", en: "Not decided" }, doing: { zh: "在做", en: "Working on it" },
  done: { zh: "已确认", en: "Confirmed" }, skip: { zh: "本次不做", en: "Not this time" },
};

export function ProductLaunchMap({ zh, ideas, ideaId, onChoose, onRefresh }: {
  zh: boolean;
  ideas: Idea[];
  ideaId: string | null;
  onChoose: (id: string | null) => void;
  onRefresh: () => Promise<unknown>;
}) {
  const lang = zh ? "zh" : "en";
  const [nodeId, setNodeId] = useState<LaunchNodeId>("market");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  // A successful PATCH remains visible even if the following poll fails.
  const [written, setWritten] = useState<Record<string, LaunchDecision>>({});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const idea = ideas.find((entry) => entry.id === ideaId);
  const node = LAUNCH_MAP.find((entry) => entry.id === nodeId)!;
  const example = PRODUCT_CASES.find((entry) => entry.id === node.caseId);
  const key = `${idea?.id ?? "reference"}:${nodeId}`;
  const plan = { ...idea?.launchPlan };
  for (const entry of LAUNCH_MAP) {
    const confirmedWrite = written[`${idea?.id}:${entry.id}`];
    if (confirmedWrite && (!plan[entry.id] || confirmedWrite.updatedAt > plan[entry.id]!.updatedAt)) plan[entry.id] = confirmedWrite;
  }
  const saved = plan[nodeId];
  const current = drafts[key] ?? { status: saved?.status ?? "todo", note: saved?.note ?? "", expectedUpdatedAt: saved?.updatedAt ?? null };
  const dirty = drafts[key] !== undefined;
  const hasDrafts = Object.keys(drafts).length > 0;
  const confirmed = LAUNCH_MAP.filter((entry) => plan[entry.id]?.status === "done").length;

  useEffect(() => {
    if (!hasDrafts) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [hasDrafts]);

  const edit = (patch: Partial<Draft>) => setDrafts((previous) => ({ ...previous, [key]: { ...current, ...patch } }));
  const discard = () => {
    if (!window.confirm(zh ? "放弃这个分支的未保存内容，载入最新已保存版本？" : "Discard this branch's unsaved changes and load the latest saved version?")) return;
    setDrafts((previous) => { const next = { ...previous }; delete next[key]; return next; });
    setErrors((previous) => { const next = { ...previous }; delete next[key]; return next; });
    void onRefresh();
  };

  async function save() {
    if (!idea || !dirty || saving) return;
    const sent = current;
    setSaving(true);
    setErrors((previous) => ({ ...previous, [key]: "" }));
    try {
      const response = await fetch(`/api/robin/products/${encodeURIComponent(idea.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ launchNode: { nodeId, ...sent } }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
      setWritten((previous) => ({ ...previous, [key]: result.idea.launchPlan[nodeId] }));
      setDrafts((previous) => { const next = { ...previous }; delete next[key]; return next; });
      await onRefresh();
    } catch (caught) { setErrors((previous) => ({ ...previous, [key]: caught instanceof Error ? caught.message : String(caught) })); }
    finally { setSaving(false); }
  }

  function downloadPlan() {
    const text = [
      `# ${idea?.name ?? (zh ? "产品全景图" : "Product map")}`,
      zh ? "工作清单，不是上线许可或商业成功保证。状态仅来自你自己的确认。" : "A work checklist, not launch clearance or a business guarantee. Statuses are your own decisions.",
      ...LAUNCH_MAP.map((entry) => {
        const decision = plan[entry.id];
        return [`## ${entry.title[lang]} — ${STATUS[decision?.status ?? "todo"][lang]}`, entry.question[lang],
          ...entry.tasks.map((task) => `- ${task[lang]}`), `\n${entry.output[lang]}`, decision?.note ?? "",
          `${zh ? "成本取舍" : "Lean choice"}: ${entry.lean[lang]}`, `${zh ? "风险" : "Risk"}: ${entry.risk[lang]}`].join("\n\n");
      }),
      "## Sources", ...PRODUCT_CASES.map((entry) => `${entry.name}: ${entry.source} (read ${entry.checkedOn}; founder-reported)`),
    ].join("\n\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "product-launch-plan.md"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className={styles.section}>
    <header className={styles.sectionHeader}>
      <div><span className="pi-eyebrow">02 / {zh ? "把整件事看清楚" : "SEE THE WHOLE JOB"}</span>
        <h2 className={styles.heading}>{zh ? "把一个想法，变成能运营的产品。" : "Turn an idea into a product you can run."}</h2>
        <p className={styles.description}>{zh ? "先看全貌，再点一个分支。每处都有做法、交付物和成本取舍；选择自己的想法后，还能写下你的方案。" : "See the whole picture, then open a branch for its actions, deliverable and cost trade-offs. Choose your idea to record your own plan."}</p>
      </div>
      <button type="button" className="ui-action pi-bracket min-h-11 text-xs" onClick={downloadPlan}>{zh ? "导出已保存计划 ↓" : "Export saved plan ↓"}</button>
    </header>
    <div className={styles.mapToolbar}>
      <label><span className="pi-eyebrow">{zh ? "应用到" : "APPLY TO"}</span>
        <select id="product-map-project" value={idea?.id ?? ""} disabled={saving} onChange={(event) => onChoose(event.target.value || null)}>
          <option value="">{zh ? "通用参考 · 不记录进度" : "Reference only · no progress"}</option>
          {ideas.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.parked ? (zh ? "（已搁置）" : " (parked)") : ""}</option>)}
        </select>
      </label>
      <div className={styles.mapContext}>
        <div className={styles.planSegments} aria-hidden="true">{LAUNCH_MAP.map((entry) => <span key={entry.id} data-confirmed={plan[entry.id]?.status === "done"} />)}</div>
        <p className={styles.small}>{idea ? (zh ? `${confirmed} / 8 个分支已由你确认 · 不等于产品已验证或已上线` : `${confirmed} / 8 branches confirmed by you · not market validation or launch clearance`) : (zh ? "当前是参考指南 · 选择想法后可保存自己的方案" : "Reference guide · choose an idea to save your own plan")}</p>
      </div>
    </div>

    <div id="product-map-overview" className={styles.mindmap} role="group" aria-label={zh ? "产品上线思维导图" : "Product launch mind map"}>
      <div className={styles.mapRoot}>
        <span className={styles.rootGlyph}><ProductGlyph name="idea" /></span>
        <span className="pi-eyebrow">{idea ? (zh ? "我的产品" : "MY PRODUCT") : (zh ? "从这里看全貌" : "THE WHOLE PICTURE")}</span>
        <strong>{idea?.name ?? (zh ? "从需求到可持续运营" : "From demand to a sustainable product")}</strong>
        <span>{zh ? "做出来 · 卖出去 · 维护得起" : "Build it · sell it · sustain it"}</span>
      </div>
      {[LAUNCH_MAP.slice(0, 4), LAUNCH_MAP.slice(4)].map((group, side) => <div key={side} className={styles.mapBranches} data-side={side === 0 ? "left" : "right"}>
        <p className={styles.branchGroup}>{side === 0 ? (zh ? "创造价值 / 值不值得做，怎么做" : "CREATE VALUE / WHAT & HOW TO BUILD") : (zh ? "持续经营 / 怎么卖，怎么活下去" : "SUSTAIN IT / SELL & KEEP IT RUNNING")}</p>
        {group.map((entry) => {
          const decision = plan[entry.id];
          const unsaved = drafts[`${idea?.id ?? "reference"}:${entry.id}`] !== undefined;
          return <button key={entry.id} type="button" disabled={saving} className={`ui-action ${styles.mapNode}`} aria-pressed={nodeId === entry.id} aria-controls="product-map-detail" onClick={() => {
            setNodeId(entry.id);
            requestAnimationFrame(() => {
              document.getElementById("product-map-detail")?.scrollIntoView({ block: "start" });
              document.getElementById("product-map-question")?.focus({ preventScroll: true });
            });
          }}>
            <span className={styles.nodeGlyph}><ProductGlyph name={entry.id} /></span>
            <span className={styles.nodeCopy}><strong>{entry.title[lang]}</strong><small>{NODE_HINTS[entry.id][lang]}</small></span>
            <span className={styles.nodeStatus} data-done={decision?.status === "done"}>{unsaved ? (zh ? "未保存" : "Unsaved") : idea ? STATUS[decision?.status ?? "todo"][lang] : <span aria-hidden="true">↗</span>}</span>
          </button>;
        })}
      </div>)}
    </div>

    <article id="product-map-detail" className={styles.mapDetail} aria-labelledby="product-map-question">
      <div className={styles.mapGuide}>
        <a href="#product-map-overview" className={`ui-action ${styles.backToMap}`}>{zh ? "↑ 返回全景图" : "↑ Back to the map"}</a>
        <div className={styles.guideHeading}><span className={styles.pathIcon}><ProductGlyph name={node.id} /></span><div><span className={styles.eyebrow}>{zh ? "参考做法" : "FIELD GUIDE"} / {node.title[lang]}</span><h3 id="product-map-question" tabIndex={-1}>{node.question[lang]}</h3></div></div>
        <div className={styles.deliverable}><ProductGlyph name="document" /><div><h4>{zh ? "做到什么程度就够了" : "WHAT YOU SHOULD LEAVE WITH"}</h4><p>{node.output[lang]}</p></div></div>
        <div className={styles.subheading}><h4>{zh ? "具体怎么做" : "THE WORK, MADE CONCRETE"}</h4><span>{zh ? "参考建议 · 不是自动完成的任务" : "Guidance · not automatic completion"}</span></div>
        <ol className={styles.taskList}>{node.tasks.map((task, index) => <li key={task.en}><span aria-hidden="true">0{index + 1}</span><p>{task[lang]}</p></li>)}</ol>
        <div className={styles.leanChoice}><ProductGlyph name="economics" /><div><h4>{zh ? "一个人做，先省这笔投入" : "THE LEAN SOLO-BUILDER CHOICE"}</h4><p>{node.lean[lang]}</p></div></div>
        <p className={styles.caution}><strong>{zh ? "别忽略：" : "WATCH OUT: "}</strong>{node.risk[lang]}</p>
        {example ? <details className={styles.caseExample}><summary className="ui-action"><ProductGlyph name="document" /><span>{zh ? `别人怎么做 · ${example.name}` : `How others do it · ${example.name}`}</span><span className={styles.disclosureMark} aria-hidden="true" /></summary><div><p>{nodeId === "build" ? example.sections[0]!.text[lang] : nodeId === "distribution" ? example.sections[1]!.text[lang] : nodeId === "billing" ? example.sections[2]!.text[lang] : nodeId === "operations" || nodeId === "economics" ? example.sections[3]!.text[lang] : example.evidence[lang]}</p><a className={`ui-action ${styles.timestamp}`} href={example.source} target="_blank" rel="noopener noreferrer">{zh ? "读原始逐字稿 ↗" : "Read the source transcript ↗"}</a><p className={styles.small}>{zh ? "访谈是参考，不是保证；上面的做法清单是编辑建议。" : "An interview is a reference, not a guarantee; the checklist above is editorial guidance."}</p></div></details> : null}
        {nodeId === "distribution" || nodeId === "validation" ? <a href="/product/jarvis" className="ui-action pi-bracket min-h-11 self-start content-center text-xs">{zh ? "去 CRM 找人、访谈与跟进 ↗" : "CRM · people, interviews & follow-up ↗"}</a> : null}
        {nodeId === "economics" ? <BreakEven zh={zh} /> : null}
      </div>
      <aside className={styles.decision}>
        <span className={styles.eyebrow}>{zh ? "YOUR PLAN / 留下你的答案" : "YOUR PLAN / MAKE IT YOURS"}</span>
        <h4>{zh ? "我的决定与证据" : "My decision & evidence"}</h4>
        <p className={styles.small}>{zh ? "指南提供参考，决定由你来做。把选定的做法、验证结果和链接记在这里，而不是为读完指南打勾。" : "The guide suggests; you decide. Record the approach you chose, test results and links—not just that you read the guide."}</p>
        {!idea ? <div className={styles.referencePrompt}><ProductGlyph name="idea" /><strong>{zh ? "先选一个想法，让地图变成你的计划。" : "Choose an idea to make this map your plan."}</strong><button type="button" className="ui-action pi-bracket" onClick={() => document.getElementById("product-map-project")?.focus()}>{zh ? "选择想法 ↑" : "Choose an idea ↑"}</button></div> : <>
          <p className={styles.small}>{idea.name}</p>
          <label><span>{zh ? "分支状态" : "Branch status"}</span><select disabled={saving} value={current.status} onChange={(event) => edit({ status: event.target.value as LaunchStatus })}>
            {LAUNCH_STATUSES.map((status) => <option key={status} value={status}>{STATUS[status][lang]}</option>)}
          </select></label>
          <label><span>{zh ? "方案、证据、链接与预算" : "Approach, evidence, links & budget"}</span><textarea rows={9} maxLength={20_000} value={current.note} disabled={saving} onChange={(event) => edit({ note: event.target.value })} placeholder={node.output[lang]} /></label>
          <p role="status" className={styles.small}>{saving ? (zh ? "保存中…" : "Saving…") : dirty ? (zh ? "未保存 · 切换分支会保留草稿" : "Unsaved · switching branches keeps your draft") : (zh ? "仅记录你明确保存的决定，不改变项目阶段" : "Only explicit saves are recorded; project stage is unchanged")}</p>
          {errors[key] ? <p role="alert" className={styles.error}>{errors[key]}</p> : null}
          <div className={styles.sectionHeader}>
            <button type="button" disabled={!dirty || saving} onClick={() => void save()} className="ui-action pi-bracket min-h-11 text-xs" data-state="accent">{zh ? "保存这个分支" : "Save this branch"}</button>
            {dirty ? <button type="button" disabled={saving} onClick={discard} className="ui-action min-h-11 text-xs">{zh ? "放弃草稿 / 载入最新" : "Discard / load latest"}</button> : null}
          </div>
        </>}
      </aside>
    </article>
  </div>;
}

function BreakEven({ zh }: { zh: boolean }) {
  const [values, setValues] = useState(["", "", ""]);
  const filled = values.every((value) => value.trim() !== "");
  const result = filled ? breakEvenCustomers(...values.map(Number) as [number, number, number]) : null;
  return <section className={styles.calculator}>
    <h4 className="pi-eyebrow">{zh ? "盈亏平衡草算 · 不保存" : "BREAK-EVEN SCRATCHPAD · NOT SAVED"}</h4>
    <p className={styles.small}>{zh ? "三个数用同一币种、同一个月。变动成本应包括按用户分摊的 AI、手续费与退款等。" : "Use one currency and one monthly period. Include per-user AI, processing fees and refunds in variable costs."}</p>
    <div>{(zh ? ["固定月成本", "每位客户月收入", "每位客户月变动成本"] : ["Fixed monthly cost", "Monthly revenue / customer", "Monthly variable cost / customer"]).map((label, index) => <label key={index}><span>{label}</span><input type="number" min="0" step="any" value={values[index]} onChange={(event) => setValues((previous) => previous.map((value, i) => i === index ? event.target.value : value))} /></label>)}</div>
    <p role="status">{!filled ? (zh ? "填入你核查后的数字，不预设「零成本」。" : "Enter checked figures; do not assume zero cost.") : result === null ? (zh ? "没有有效的盈亏平衡点：收入需高于变动成本，且所有数字必须非负。" : "No valid break-even point: revenue must exceed variable cost and all inputs must be non-negative.") : zh ? `约需 ${result} 位付费客户覆盖固定月成本。` : `About ${result} paying customers to cover fixed monthly cost.`}</p>
    <p className={styles.small}>{zh ? "公式：固定月成本 ÷（单客月收入 − 单客月变动成本），向上取整。未单独计入税、创始人工时或一次性投入，除非你已把它们算入。" : "Fixed cost ÷ (revenue − variable cost), rounded up. Tax, founder time and setup costs are excluded unless you included them above."}</p>
  </section>;
}
