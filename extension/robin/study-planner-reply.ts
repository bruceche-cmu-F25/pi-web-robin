export interface PlannerProposal { objective: string; milestones: Array<{ title: string; done: false }> }

/** The assistant may talk freely; only a complete, bounded proposal gets a draft action. */
export function parsePlannerReply(text: string): { reply: string; proposal?: PlannerProposal } {
  const match = /<study_plan>\s*([\s\S]*?)\s*<\/study_plan>/i.exec(text);
  if (!match) return { reply: text.trim() };
  const reply = text.replace(match[0], "").trim() || "Here is a draft plan to review.";
  try {
    const value: unknown = JSON.parse(match[1]);
    if (!value || typeof value !== "object") return { reply };
    const plan = value as { objective?: unknown; milestones?: unknown };
    if (typeof plan.objective !== "string" || !plan.objective.trim() || plan.objective.trim().length > 160 ||
      !Array.isArray(plan.milestones) || plan.milestones.length < 1 || plan.milestones.length > 5 ||
      plan.milestones.some((item) => !item || typeof item.title !== "string" || !item.title.trim() || item.title.trim().length > 120)) return { reply };
    return { reply, proposal: { objective: plan.objective.trim(), milestones: plan.milestones.map((item) => ({ title: item.title.trim(), done: false as const })) } };
  } catch { return { reply }; }
}
