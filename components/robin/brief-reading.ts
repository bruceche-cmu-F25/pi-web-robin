/** Reader projections only; never translate stored diagnostics or change an immutable edition. */
import type { BriefEdition } from "../../extension/robin/brief.ts";

/** Home shows reviewed mail decisions, not failed reviews or records already visible in Calendar/Tasks. */
export function homeBriefHighlights(edition: BriefEdition) {
  if (edition.mailReport) return edition.mailReport.messages
    .filter(message => message.reviewed && message.priority === 2)
    .slice(0, 3).map(message => ({ text: message.summary, href: message.href }));
  return (edition.editorial?.items ?? []).filter(row => row.section === "personal")
    .flatMap(row => {
      const source = edition.items.find(item => row.sourceIds.includes(item.id) && item.source === "mail");
      return source ? [{ text: row.what, href: source.href }] : [];
    }).slice(0, 3);
}


export function briefCoverageSummary(edition: BriefEdition, source: BriefEdition["coverage"][number]) {
  const records = edition.items.filter(item => item.source === source.source);
  const supplied = new Set(edition.editorial?.consideredIds ?? []);
  const historical = records.length > 0 && records.every(item => item.evidence.kind === "legacy-passage");
  const storedMail = records.length > 0 && records.every(item => item.evidence.kind === "stored-review");
  return {
    collected: records.length,
    supplied: records.filter(item => supplied.has(item.id)).length,
    statusKey: `brief.coverageNote.${source.coverage}`,
    scopeKey: source.source === "world" && historical ? "brief.scope.historical"
      : source.source === "mail" && storedMail ? "brief.scope.storedMail" : `brief.scope.${source.source}`,
  };
}

/** Browser-local time, including its zone; date-only event/deadline values must not use this. */
export function briefLocalTimestamp(value: string, locale: string, timeZone?: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short", ...(timeZone ? { timeZone } : {}) }).format(date);
}
