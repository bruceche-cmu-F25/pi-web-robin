/** Client-safe vocabulary. Shadow previews preserve observations, not editorial judgments. */
export const BRIEF_SOURCES = ["mail", "calendar", "todos", "world"] as const;
export type BriefSource = typeof BRIEF_SOURCES[number];
export type BriefCoverage = "ready" | "partial" | "stale" | "unavailable" | "disconnected";
export interface BriefItem {
  id: string;
  source: BriefSource;
  section: "attention" | "schedule" | "tasks" | "updates" | "world";
  title: string;
  summary: string;
  href: string;
  eventDate?: string;
  publishedOn?: string;
  due?: string;
  evidence: {
    kind: "stored-review" | "record" | "legacy-passage" | "mail-message";
    reference: string;
    quote?: string;
    checkedAt?: string;
  };
}
export interface BriefInput {
  source: BriefSource;
  observedAt: string;
  coverage: BriefCoverage;
  detail: string;
  items: BriefItem[];
}
export interface BriefScope { day: string; timezone: string }
export interface BriefEdition extends BriefScope {
  id: string;
  runId: string;
  revision: number;
  mode: "shadow";
  createdAt: string;
  inputsCompletedAt: string;
  items: BriefItem[];
  previewIds: string[];
  coverage: Omit<BriefInput, "items">[];
}
export interface BriefRun extends BriefScope {
  id: string;
  requestId: string;
  stage: "prepare" | "harvest" | "verify" | "brief" | "done" | "failed";
  startedAt: string;
  finishedAt: string | null;
  leaseUntil: number;
  failure: string | null;
  interrupted: boolean;
}

export function validBriefDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function bounded(value: unknown, max: number): value is string { return typeof value === "string" && value.length <= max; }
function safeHref(href: string): boolean {
  if (/[\\\u0000-\u0020]/.test(href)) return false;
  if (href.startsWith("/") && !href.startsWith("//")) return true;
  try { const u = new URL(href); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; }
}
export function validateBriefInput(input: BriefInput, source: BriefSource): void {
  if (!input || input.source !== source || !["ready", "partial", "stale", "unavailable", "disconnected"].includes(input.coverage)
    || !bounded(input.observedAt, 40) || !Number.isFinite(Date.parse(input.observedAt)) || !bounded(input.detail, 1000)
    || !Array.isArray(input.items) || input.items.length > 200 || JSON.stringify(input).length > 1_000_000) throw new Error("Invalid brief source result");
  const ids = new Set<string>();
  for (const item of input.items) {
    if (!item || item.source !== source || !bounded(item.id, 500) || !item.id || ids.has(item.id)
      || !["attention", "schedule", "tasks", "updates", "world"].includes(item.section) || !bounded(item.title, 1000) || !item.title.trim()
      || !bounded(item.summary, 5000) || !bounded(item.href, 2500) || !safeHref(item.href)
      || !item.evidence || !["stored-review", "record", "legacy-passage", "mail-message"].includes(item.evidence.kind)
      || !bounded(item.evidence.reference, 1000) || !item.evidence.reference
      || (item.evidence.quote !== undefined && !bounded(item.evidence.quote, 5000))
      || (item.evidence.checkedAt !== undefined && (!bounded(item.evidence.checkedAt, 40) || !Number.isFinite(Date.parse(item.evidence.checkedAt))))) throw new Error("Invalid brief item or evidence");
    for (const value of [item.eventDate, item.publishedOn]) if (value !== undefined && !validBriefDay(value)) throw new Error("Invalid brief item date");
    if (item.due !== undefined && (!bounded(item.due, 40) || !Number.isFinite(Date.parse(item.due)))) throw new Error("Invalid brief deadline");
    ids.add(item.id);
  }
}

/** No editorial model yet: keep original wording and explicit coverage, no invented lede. */
export function composeShadow(inputs: BriefInput[]) {
  if (inputs.length !== BRIEF_SOURCES.length || new Set(inputs.map(i => i.source)).size !== BRIEF_SOURCES.length) throw new Error("Incomplete input manifest");
  for (const source of BRIEF_SOURCES) validateBriefInput(inputs.find(i => i.source === source)!, source);
  if (!inputs.some(i => i.coverage === "ready" || i.coverage === "partial")) throw new Error("No usable sources");
  const order = { attention: 0, schedule: 1, tasks: 2, updates: 3, world: 4 };
  const items = inputs.filter(i => i.coverage === "ready" || i.coverage === "partial").flatMap(i => i.items)
    .sort((a, b) => order[a.section] - order[b.section] || (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.id.localeCompare(b.id));
  if (new Set(items.map(i => i.id)).size !== items.length) throw new Error("Duplicate brief item identity");
  return { items, previewIds: items.slice(0, 5).map(i => i.id), coverage: inputs.map(({ source, observedAt, coverage, detail }) => ({ source, observedAt, coverage, detail })) };
}
