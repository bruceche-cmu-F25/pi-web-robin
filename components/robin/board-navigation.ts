import type { JobStatus } from "@/extension/robin/jobs";
import type { TechEventTopic } from "@/extension/robin/tech-events";
import type { JobOrder } from "./jobs-view";

type Params = Pick<URLSearchParams, "get">;
export const JOB_PAGE_SIZE = 50;

export function jobsView(params: Params) {
  const status = params.get("status");
  const count = Number(params.get("shown"));
  return {
    filter: (["new", "shortlist", "applied", "dropped", "all"].includes(status ?? "") ? status : "new") as JobStatus | "all",
    query: params.get("q") ?? "",
    order: (params.get("sort") === "recent" ? "recent" : "priority") as JobOrder,
    shown: Number.isSafeInteger(count) && count >= JOB_PAGE_SIZE ? count : JOB_PAGE_SIZE,
    showBelow: params.get("below") === "1",
  };
}

export function eventsView(params: Params) {
  const topic = params.get("topic");
  const day = params.get("day");
  const validDay = !!day && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
  return {
    query: params.get("q") ?? "",
    topic: (["all", "ai", "swe", "data", "hardware", "startup"].includes(topic ?? "") ? topic : "all") as TechEventTopic | "all",
    day: validDay ? day : null,
    savedOnly: params.get("saved") === "1",
    showHidden: params.get("hidden") === "1",
  };
}

/** An event may return only to its own list, never a caller-supplied external destination. */
export function eventReturnHref(value: string | null): string {
  const base = "/dashboard/events";
  if (value !== base && !value?.startsWith(`${base}?`)) return base;
  try {
    const url = new URL(value, "https://board.invalid");
    return url.origin === "https://board.invalid" && url.pathname === base ? base + url.search + url.hash : base;
  } catch { return base; }
}
