/** Shared display vocabulary; no storage or model imports in the browser. */
export const PRODUCT_ASSESSMENT_CRITERIA = [
  { id: "demand", zh: "需求与付费证据", en: "Demand & payment evidence" },
  { id: "wedge", zh: "改进 / 迁移空间", en: "Improvement / transfer" },
  { id: "build", zh: "单人实现难度", en: "Solo build feasibility" },
  { id: "distribution", zh: "首批用户怎么来", en: "First-user acquisition" },
  { id: "economics", zh: "收费与持续成本", en: "Pricing & ongoing costs" },
  { id: "operations", zh: "维护、依赖与风险", en: "Maintenance & risks" },
] as const;
export type AssessmentCriterionId = typeof PRODUCT_ASSESSMENT_CRITERIA[number]["id"];
export type AssessmentVerdict = "test" | "research" | "pass";
export type CriterionStatus = "supported" | "risk" | "unknown" | "blocked";
export const ASSESSMENT_VERDICTS = {
  test: { zh: "值得小额验证", en: "Worth a small test" },
  research: { zh: "先补证据", en: "Research first" },
  pass: { zh: "暂不建议", en: "Pass for now" },
};
export const ASSESSMENT_STATUSES = {
  supported: { zh: "有依据", en: "Supported" }, risk: { zh: "有风险", en: "Risk" },
  unknown: { zh: "未知", en: "Unknown" }, blocked: { zh: "关键阻碍", en: "Blocker" },
};
export interface ProductAssessment {
  verdict: AssessmentVerdict;
  reason: string;
  wedge: string;
  firstTest: string;
  stopRule: string;
  unknowns: string[];
  criteria: Record<AssessmentCriterionId, { status: CriterionStatus; reason: string; sourceIds: number[] }>;
  /** Model-supplied citations, not independently audited proof. IDs are 1-based. */
  sources: Array<{ title: string; url: string; quote: string }>;
  guardrail?: string;
  confidence: "low" | "medium";
  locale: "zh" | "en";
  assessedAt: string;
  basis: string;
  stale?: boolean;
}
