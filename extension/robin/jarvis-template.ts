import type { JarvisCandidate, JarvisLead, JarvisState, JarvisTemplate } from "./jarvis-shape.ts";
import { DEFAULT_SOCIAL_TEMPLATES, unbrandedOutreachText } from "./outreach-shape.ts";

/** Prefer a short sourced opening; never truncate a sentence mid-thought. */
export function shortJarvisOpener(candidate: JarvisCandidate): string {
  const first = candidate.opener?.trim().match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  if (first && first.split(/\s+/).length <= 25 && !first.endsWith("?")) return first;
  const role = candidate.role.trim();
  const company = candidate.company.trim().replace(/[.!?]+$/, "");
  return role && role.split(/\s+/).length <= 6
    ? `I came across your work as ${role} at ${company}.`
    : `I came across your work at ${company}.`;
}

/** Shared by server drafts and deferred browser previews; never an approval/send. */
export function renderJarvisDraft(candidate: JarvisCandidate, template: JarvisTemplate): { subject: string; body: string } {
  const firstName = candidate.firstName?.trim() || candidate.name.replace(/^(dr|mr|ms|mrs)\.?\s+/i, "").split(/\s+/)[0]!;
  const fallback = candidate.industry.trim().replace(/\.$/, "");
  const area = candidate.area?.trim() || (/^\p{Lu}\p{Ll}/u.test(fallback) ? fallback[0]!.toLowerCase() + fallback.slice(1) : fallback);
  const work = /^\p{Ll}+ing\b/u.test(area) ? `your work ${area}` : `your work in ${area}`;
  const values: Record<string, string> = { shortOpener: shortJarvisOpener(candidate), firstName, name: candidate.name, company: candidate.company, role: candidate.role, area, work, opener: candidate.opener || `I came across ${work}.` };
  const fill = (value: string) => value.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_, key: string) => values[key] ?? "");
  return { subject: unbrandedOutreachText(fill(template.subject)), body: unbrandedOutreachText(fill(template.body)) };
}

/** Keep saved drafts/evidence/history intact; materialize template previews only on use. */
export function jarvisBrowserLeads(state: JarvisState): JarvisLead[] {
  if (!state.templateDraftsDeferred) return state.leads;
  const templates = { ...DEFAULT_SOCIAL_TEMPLATES, ...state.socialTemplates };
  return state.leads.map(lead => {
    let drafts: JarvisLead["socialTemplateDrafts"];
    return { ...lead, get socialTemplateDrafts() {
      return drafts ??= Object.fromEntries(Object.entries(templates).map(([platform, body]) =>
        [platform, renderJarvisDraft(lead, { subject: "Social message", body }).body]));
    } };
  });
}
