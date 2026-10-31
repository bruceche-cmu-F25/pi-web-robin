/** Browser-safe vocabulary for the framing slice. No sending capabilities. */
export const VALIDATION_CRITERIA_FIELDS = ["hypothesis", "recruitment", "primaryOutcome", "sampleRationale", "observationPeriod", "budget", "pass", "fail", "inconclusive"] as const;
export type ValidationCriteria = Record<typeof VALIDATION_CRITERIA_FIELDS[number], string>;
export interface ValidationCandidate {
  id: string;
  name: string;
  situation: string;
  problem: string;
  alternatives: string;
  signals: string;
  exclusions: string;
  unknowns: string;
}
export interface ValidationPlan {
  candidates: ValidationCandidate[];
  selectedCandidateId: string | null;
  offer: string;
  criteria: ValidationCriteria;
}
export interface ValidationPlanRevision extends ValidationPlan {
  id: string;
  number: number;
  createdAt: string;
  author: "human" | "assistant";
  reason: string;
}
export interface ValidationEvidence {
  id: string;
  planId: string;
  stance: "supports" | "challenges" | "unknown";
  source: string;
  quote: string;
  interpretation: string;
  observedOn: string;
  createdAt: string;
}
export interface ValidationDecision {
  id: string;
  planId: string;
  outcome: "pass" | "fail" | "inconclusive";
  reason: string;
  evidenceIds: string[];
  at: string;
}
export interface ValidationProject {
  id: string;
  name: string;
  brief: string;
  ideaId: string | null;
  revision: number;
  stage: "A";
  status: "draft" | "approved" | "closed";
  currentPlanId: string | null;
  approvedPlanId: string | null;
  plans: ValidationPlanRevision[];
  evidence: ValidationEvidence[];
  decisions: ValidationDecision[];
  conversation: Array<{ role: "user" | "assistant"; text: string; at: string }>;
  discussion: { operationId: string; state: "running" | "done" | "failed" | "cancelled"; startedAt: string; error?: string } | null;
  activity: Array<{ action: string; actor: "human" | "assistant"; operationId: string; planId: string | null; reason: string; at: string }>;
  createdAt: string;
  updatedAt: string;
}
export type ValidationSummary = Pick<ValidationProject, "id" | "name" | "brief" | "ideaId" | "revision" | "stage" | "status" | "updatedAt">;
export interface ValidationBoard { initialized: boolean; projects: ValidationSummary[] }
export function emptyValidationCriteria(): ValidationCriteria {
  return Object.fromEntries(VALIDATION_CRITERIA_FIELDS.map(key => [key, ""])) as ValidationCriteria;
}
export function currentValidationPlan(project: ValidationProject): ValidationPlanRevision | null {
  return project.plans.find(plan => plan.id === project.currentPlanId) ?? null;
}
