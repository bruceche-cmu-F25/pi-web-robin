import { randomUUID } from "node:crypto";
import { addJarvisCandidates, patchJarvisRun, readJarvis, writeJarvisRun } from "../extension/robin/jarvis-domain.ts";
import { BALANCED_JARVIS_QUOTA, CORE_JARVIS_SEGMENTS, JARVIS_PERSONA_QUOTA, JARVIS_TARGET_PERSONAS, isReachableTierExec, isResearchedTargetUser, isSendableCore, type CoreJarvisSegment, type JarvisLead, type JarvisPersona, type JarvisRun, type JarvisState } from "../extension/robin/jarvis-shape.ts";
import { checkJarvisEmailSources, JARVIS_RESEARCH_PREAMBLE, JARVIS_RESEARCH_TOOLS, jarvisResearchPrompt, parseJarvisResearch } from "../extension/robin/jarvis-research.ts";
import { runScopedAssistantTurn } from "./robin-assistant";
import { isJarvisRescoreActive } from "./jarvis-rescore.ts";

// ponytail: one campaign on one local Next server; use a durable queue for multi-host deployment.
const registry = globalThis as typeof globalThis & { __jarvisDiscovery?: { id: string; controller: AbortController } };
export function readJarvisView(): JarvisState {
  const state = readJarvis();
  if (state.run?.status === "running" && state.run.id !== registry.__jarvisDiscovery?.id) {
    state.run = { ...state.run, status: "error", message: "Server restarted. Saved contacts are intact; start again to continue." };
  }
  if (state.rescore?.status === "running" && !isJarvisRescoreActive(state.rescore.id)) {
    state.rescore = { ...state.rescore, status: "error", message: "Server restarted. Saved assessments are kept; start again to continue." };
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
/** What a run counts: qualified executives for info_exec, sendable emails otherwise. */
const counted = (focus?: CoreJarvisSegment, wide = false): (lead: JarvisLead) => boolean => focus === "info_exec" ? (wide ? isReachableTierExec : isResearchedTargetUser) : isSendableCore;
const unit = (focus?: CoreJarvisSegment, wide = false) => focus === "info_exec" ? (wide ? "reachable A/B executives" : "qualified target users") : "sendable core contacts";
export function startJarvisDiscovery(target: number, focus?: CoreJarvisSegment, wide = false): JarvisRun {
  if (wide && focus !== "info_exec") throw new Error("A wide-net run is an info_exec run");
  if (focus !== undefined && !CORE_JARVIS_SEGMENTS.includes(focus)) throw new Error("Invalid research cohort");
  // The persona campaign has no fixed size; 1000 only bounds a mistyped target.
  const max = focus === "info_exec" ? 1000 : focus ? 150 : 100;
  if (!Number.isInteger(target) || target < 1 || target > max) throw new Error(`target must be 1–${max} for this run`);
  if (registry.__jarvisDiscovery) throw new Error("Discovery is already running or stopping");
  if (readJarvis().leads.filter(counted(focus, wide)).length >= target) throw new Error(focus === "info_exec" ? "Executive target already reached" : "Sendable core target already reached");
  const run: JarvisRun = { id: randomUUID(), status: "running", target, ...(focus ? { focus } : {}), ...(wide ? { wide } : {}), added: 0, batches: 0, startedAt: new Date().toISOString(), message: "Starting public-source research…" };
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
  const personaAttempts = new Map<JarvisPersona, number>();
  const quota: Record<string, number> = BALANCED_JARVIS_QUOTA;
  const counts = counted(run.focus, run.wide);
  // A hard spend bound: at most 30 turns per click. One slow search provider
  // no longer kills the whole run; three failed turns still stop spending.
  for (let batch = 1; batch <= 30; batch++) {
    if (signal.aborted) return;
    const state = readJarvis();
    // Balanced runs count people Bruce can email; info_exec counts qualified
    // people, since executives rarely publish an address.
    const core = state.leads.filter(counts);
    const remaining = run.target - core.length;
    if (remaining <= 0) break;
    // Fill the cohort furthest behind its intended share. Attempts break ties
    // so one hard source pool cannot monopolize every turn.
    const segment = run.focus ?? (Object.keys(quota) as CoreJarvisSegment[]).sort((a, b) => {
      const progress = (s: CoreJarvisSegment) => (core.filter((lead) => lead.segment === s).length + (attempts.get(s) ?? 0)) / quota[s]!;
      return progress(a) - progress(b);
    })[0]!;
    attempts.set(segment, (attempts.get(segment) ?? 0) + 1);
    // info_exec fills its five personas the same way: furthest behind its share first,
    // so the priority order sets the mix without starving the lower personas.
    const persona = segment !== "info_exec" ? undefined : [...JARVIS_TARGET_PERSONAS].sort((a, b) => {
      const progress = (p: JarvisPersona) => (core.filter((lead) => lead.persona === p).length + (personaAttempts.get(p) ?? 0)) / JARVIS_PERSONA_QUOTA[p];
      return progress(a) - progress(b);
    })[0]!;
    if (persona) personaAttempts.set(persona, (personaAttempts.get(persona) ?? 0) + 1);
    // Three per turn: five-person batches regularly hit the per-turn timeout.
    const count = Math.min(3, remaining);
    patchJarvisRun(run.id, { batches: batch, message: `Batch ${batch} · ${persona ? `${segment}/${persona}` : segment} · ${core.length}/${run.target} ${unit(run.focus, run.wide)}. Searching public sources…` });
    let progressed = false;
    try {
      const result = await runScopedAssistantTurn({
        remembered: null, remember: () => {}, oneShot: true,
        toolNames: [...JARVIS_RESEARCH_TOOLS], preamble: JARVIS_RESEARCH_PREAMBLE,
        message: jarvisResearchPrompt(state.leads, segment, count, persona, run.wide), timeoutMs: 360000, signal,
      });
      if (signal.aborted) return;
      if (!result.usedTools.includes("web_search") || !result.usedTools.some((tool) => tool === "fetch_content" || tool === "get_search_content")) {
        throw new Error("Research must search and read public sources; no contacts were imported from this batch.");
      }
      const { candidates, rejected } = parseJarvisResearch(result.reply, run.focus, { wide: run.wide });
      const bounded = candidates.filter((candidate) => (!run.focus || candidate.segment === run.focus) && (!persona || candidate.persona === persona || (run.wide && !candidate.persona))).slice(0, count);
      const verified = await checkJarvisEmailSources(bounded, signal);
      if (signal.aborted) return;
      const added = addJarvisCandidates(bounded, verified, run.id, { wide: run.wide });
      patchJarvisRun(run.id, { message: `Batch ${batch}: ${added} added; ${rejected} invalid records skipped. Source presence is not deliverability verification.` });
      progressed = readJarvis().leads.filter(counts).length > core.length;
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
    if (emptyBatches >= 3) throw new Error(`Three batches added no new ${unit(run.focus, run.wide)}. Saved contacts are intact; review the sources before trying again.`);
  }
  const final = readJarvis();
  const total = final.leads.filter(counts).length;
  patchJarvisRun(run.id, { status: "done", message: total >= run.target ? `Target reached: ${total} ${unit(run.focus, run.wide)}. Review sources and drafts before contacting.` : `Batch budget reached: ${total}/${run.target} ${unit(run.focus, run.wide)}. You can continue later.`, finishedAt: new Date().toISOString() });
}
