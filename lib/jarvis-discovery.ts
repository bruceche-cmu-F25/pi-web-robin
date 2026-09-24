import { randomUUID } from "node:crypto";
import { addJarvisCandidates, patchJarvisRun, readJarvis, writeJarvisRun } from "../extension/robin/jarvis-domain.ts";
import { CORE_JARVIS_SEGMENTS, isSendableCore, type CoreJarvisSegment, type JarvisRun, type JarvisState } from "../extension/robin/jarvis-shape.ts";
import { checkJarvisEmailSources, JARVIS_RESEARCH_PREAMBLE, JARVIS_RESEARCH_TOOLS, jarvisResearchPrompt, parseJarvisResearch } from "../extension/robin/jarvis-research.ts";
import { runScopedAssistantTurn } from "./robin-assistant";

// ponytail: one campaign on one local Next server; use a durable queue for multi-host deployment.
const registry = globalThis as typeof globalThis & { __jarvisDiscovery?: { id: string; controller: AbortController } };
export function readJarvisView(): JarvisState {
  const state = readJarvis();
  if (state.run?.status === "running" && state.run.id !== registry.__jarvisDiscovery?.id) {
    state.run = { ...state.run, status: "error", message: "Server restarted. Saved contacts are intact; start again to continue." };
  }
  return state;
}
export function stopJarvisDiscovery(): void {
  const active = registry.__jarvisDiscovery;
  if (!active) return;
  active.controller.abort();
  patchJarvisRun(active.id, { status: "cancelled", message: "Stopped. Completed batches are saved.", finishedAt: new Date().toISOString() });
  // Keep the registry until the abort settles so a second job cannot overlap it.
}
export function startJarvisDiscovery(target: number): JarvisRun {
  if (!Number.isInteger(target) || target < 1 || target > 100) throw new Error("target must be 1–100 sendable core contacts");
  if (registry.__jarvisDiscovery) throw new Error("Discovery is already running or stopping");
  if (readJarvis().leads.filter(isSendableCore).length >= target) throw new Error("Sendable core target already reached");
  const run: JarvisRun = { id: randomUUID(), status: "running", target, added: 0, batches: 0, startedAt: new Date().toISOString(), message: "Starting public-source research…" };
  const controller = new AbortController();
  writeJarvisRun(run);
  registry.__jarvisDiscovery = { id: run.id, controller };
  void discover(run, controller.signal).catch((error: unknown) => {
    patchJarvisRun(run.id, { status: "error", message: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() });
  }).finally(() => {
    if (registry.__jarvisDiscovery?.id === run.id) delete registry.__jarvisDiscovery;
  });
  return run;
}
async function discover(run: JarvisRun, signal: AbortSignal): Promise<void> {
  let emptyBatches = 0;
  let failedBatches = 0;
  const attempts = new Map<CoreJarvisSegment, number>();
  const quota: Record<CoreJarvisSegment, number> = { clinic: 30, professional_services: 25, nontech_exec: 30, small_tech: 15 };
  // A hard spend bound: at most 30 turns per click. One slow search provider
  // no longer kills the whole run; three failed turns still stop spending.
  for (let batch = 1; batch <= 30; batch++) {
    if (signal.aborted) return;
    const state = readJarvis();
    // Progress is people Bruce can email; a name without a sourced address does not advance it.
    const core = state.leads.filter(isSendableCore);
    const remaining = run.target - core.length;
    if (remaining <= 0) break;
    // Fill the cohort furthest behind its intended share. Attempts break ties
    // so one hard source pool cannot monopolize every turn.
    const segment = [...CORE_JARVIS_SEGMENTS].sort((a, b) => {
      const progress = (s: CoreJarvisSegment) => (core.filter((lead) => lead.segment === s).length + (attempts.get(s) ?? 0)) / quota[s];
      return progress(a) - progress(b);
    })[0]!;
    attempts.set(segment, (attempts.get(segment) ?? 0) + 1);
    // Three per turn: five-person batches regularly hit the per-turn timeout.
    const count = Math.min(3, remaining);
    patchJarvisRun(run.id, { batches: batch, message: `Batch ${batch} · ${segment} · ${core.length}/${run.target} sendable core contacts. Searching public sources…` });
    let progressed = false;
    try {
      const result = await runScopedAssistantTurn({
        remembered: null, remember: () => {}, oneShot: true,
        toolNames: [...JARVIS_RESEARCH_TOOLS], preamble: JARVIS_RESEARCH_PREAMBLE,
        message: jarvisResearchPrompt(state.leads, segment, count), timeoutMs: 360000, signal,
      });
      if (signal.aborted) return;
      if (!result.usedTools.includes("web_search") || !result.usedTools.some((tool) => tool === "fetch_content" || tool === "get_search_content")) {
        throw new Error("Research must search and read public sources; no contacts were imported from this batch.");
      }
      const { candidates, rejected } = parseJarvisResearch(result.reply);
      const bounded = candidates.slice(0, count);
      const verified = await checkJarvisEmailSources(bounded, signal);
      if (signal.aborted) return;
      const added = addJarvisCandidates(bounded, verified, run.id);
      patchJarvisRun(run.id, { message: `Batch ${batch}: ${added} added; ${rejected} invalid records skipped. Source presence is not deliverability verification.` });
      progressed = readJarvis().leads.filter(isSendableCore).length > core.length;
      failedBatches = 0;
    } catch (error) {
      if (signal.aborted) return;
      failedBatches += 1;
      const message = error instanceof Error ? error.message : String(error);
      if (failedBatches >= 3) throw new Error(`Three consecutive research batches failed. Last error: ${message}`);
      patchJarvisRun(run.id, { message: `Batch ${batch} failed (${failedBatches}/3): ${message} Continuing with another cohort…` });
      continue;
    }
    emptyBatches = progressed ? 0 : emptyBatches + 1;
    if (emptyBatches >= 3) throw new Error("Three batches found no new contacts with a public work email. Saved contacts are intact; review the sources before trying again.");
  }
  const final = readJarvis();
  const total = final.leads.filter(isSendableCore).length;
  patchJarvisRun(run.id, { status: "done", message: total >= run.target ? `Target reached: ${total} sendable core contacts. Review work emails and drafts before contacting.` : `Batch budget reached: ${total}/${run.target} sendable core contacts. You can continue later.`, finishedAt: new Date().toISOString() });
}
