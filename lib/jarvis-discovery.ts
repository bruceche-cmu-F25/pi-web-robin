import { randomUUID } from "node:crypto";
import { addJarvisCandidates, cancelJarvisRun, claimJarvisRun, DEFAULT_JARVIS_FOLLOW_UP, DEFAULT_JARVIS_TEMPLATE, heartbeatJarvisRun, patchJarvisRun, readJarvis } from "../extension/robin/jarvis-domain.ts";
import { BALANCED_JARVIS_QUOTA, CORE_JARVIS_SEGMENTS, JARVIS_PERSONA_QUOTA, JARVIS_RESEARCH_LANES, JARVIS_RESEARCH_LANE_QUOTA, JARVIS_TARGET_PERSONAS, isCurrentValidationProspect, isReachableTierExec, isSendableCore, type CoreJarvisSegment, type JarvisLead, type JarvisPersona, type JarvisResearchLane, type JarvisRun, type JarvisSocialPlatform, type JarvisState } from "../extension/robin/jarvis-shape.ts";
import { checkJarvisEmailSources, JARVIS_RESEARCH_PREAMBLE, JARVIS_RESEARCH_TOOLS, jarvisResearchPrompt, parseJarvisResearch } from "../extension/robin/jarvis-research.ts";
import { runScopedAssistantTurn } from "./robin-assistant";
import { isJarvisRescoreActive } from "./jarvis-rescore.ts";
import { hasFreshJarvisRunLease, JARVIS_RUN_LEASE_MS, JARVIS_RUNTIME_OWNER_ID, startJarvisRunHeartbeat } from "./jarvis-run-lease.ts";

// Research is pinned independently of Pi's global default and other Robin tasks.
const JARVIS_RESEARCH_MODEL = { provider: "openai-codex", modelId: "gpt-5.6-sol" } as const;

type ActiveDiscovery = { id: string; ownerId: string; controller: AbortController; heartbeatTimer: ReturnType<typeof setInterval> };
const registry = globalThis as typeof globalThis & { __jarvisDiscovery?: ActiveDiscovery };
export function readJarvisView(): JarvisState {
  const state = readJarvis();
  state.template ??= DEFAULT_JARVIS_TEMPLATE;
  state.followUpTemplate ??= DEFAULT_JARVIS_FOLLOW_UP;
  if (state.run?.status === "running" && state.run.id !== registry.__jarvisDiscovery?.id && !hasFreshJarvisRunLease(state.run)) {
    state.run = { ...state.run, status: "error", message: "Research lease expired. Saved contacts are intact; start again to continue." };
  }
  if (state.rescore?.status === "running" && !isJarvisRescoreActive(state.rescore.id) && !hasFreshJarvisRunLease(state.rescore)) {
    state.rescore = { ...state.rescore, status: "error", message: "Rescoring lease expired. Saved assessments are kept; start again to continue." };
  }
  if (state.websiteRun?.status === "running" && !hasFreshJarvisRunLease(state.websiteRun)) {
    state.websiteRun = { ...state.websiteRun, status: "error", activeWorkers: 0, message: "Website research lease expired. Saved checks are kept; start again to continue." };
  }
  delete state.deliveryLease;
  delete (state as JarvisState & { outboxLease?: unknown }).outboxLease;
  return state;
}
export function stopJarvisDiscovery(): void {
  const active = registry.__jarvisDiscovery;
  active?.controller.abort();
  cancelJarvisRun();
  // Keep the registry until the abort settles so a second job cannot overlap it.
}
/** What a run counts: evidence-qualified current ICPs with their required route. */
const counted = (focus?: CoreJarvisSegment, wide = false, channelFocus?: JarvisSocialPlatform): (lead: JarvisLead) => boolean => {
  const base = focus === "info_exec" ? (wide ? isReachableTierExec : isCurrentValidationProspect) : isSendableCore;
  return channelFocus ? (lead) => base(lead) && Boolean(lead.socials?.[channelFocus]) : base;
};
const unit = (focus?: CoreJarvisSegment, wide = false, channelFocus?: JarvisSocialPlatform) => channelFocus
  ? `current-ICP prospects with ${channelFocus}`
  : focus === "info_exec" ? (wide ? "reachable A/B professionals" : "verified cross-domain personal-intelligence prospects") : "sendable core contacts";
export function startJarvisDiscovery(target: number, focus?: CoreJarvisSegment, wide = false, channelFocus?: JarvisSocialPlatform): JarvisRun {
  if (wide && focus !== "info_exec") throw new Error("A wide-net run is an info_exec run");
  if (focus !== undefined && !CORE_JARVIS_SEGMENTS.includes(focus)) throw new Error("Invalid research cohort");
  if (channelFocus && (channelFocus !== "instagram" || focus !== "info_exec" || wide)) throw new Error("Current channel-focused research supports Instagram only");
  // The persona campaign has no fixed size; 1000 only bounds a mistyped target.
  const max = focus === "info_exec" ? 1000 : focus ? 150 : 100;
  if (!Number.isInteger(target) || target < 1 || target > max) throw new Error(`target must be 1–${max} for this run`);
  if (registry.__jarvisDiscovery) throw new Error("Discovery is already running or stopping");
  if (readJarvis().leads.filter(counted(focus, wide, channelFocus)).length >= target) throw new Error(`${unit(focus, wide, channelFocus)} target already reached`);
  const startedAt = new Date().toISOString();
  const run: JarvisRun = { id: randomUUID(), ownerId: JARVIS_RUNTIME_OWNER_ID, heartbeatAt: startedAt, status: "running", target, ...(focus ? { focus } : {}), ...(wide ? { wide } : {}), ...(channelFocus ? { channelFocus } : {}), added: 0, batches: 0, startedAt, message: "Starting public-source research…" };
  const controller = new AbortController();
  claimJarvisRun(run, Date.now() - JARVIS_RUN_LEASE_MS);
  const heartbeatTimer = startJarvisRunHeartbeat(() => heartbeatJarvisRun(run.id, JARVIS_RUNTIME_OWNER_ID), controller);
  registry.__jarvisDiscovery = { id: run.id, ownerId: JARVIS_RUNTIME_OWNER_ID, controller, heartbeatTimer };
  void discover(run, controller.signal).catch((error: unknown) => {
    patchJarvisRun(run.id, { status: "error", message: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() });
  }).finally(() => {
    if (registry.__jarvisDiscovery?.id === run.id) {
      clearInterval(registry.__jarvisDiscovery.heartbeatTimer);
      delete registry.__jarvisDiscovery;
    }
  });
  return run;
}
async function discover(run: JarvisRun, signal: AbortSignal): Promise<void> {
  if (run.focus === "info_exec" && !run.wide) return discoverCurrentIcpSprint(run, signal);
  return discoverLegacy(run, signal);
}

/**
 * The validation sprint researches its three company-first lanes concurrently.
 * One wave can add up to three contacts while each assistant turn stays small
 * enough to open and verify the actual sources.
 */
async function discoverCurrentIcpSprint(run: JarvisRun, signal: AbortSignal): Promise<void> {
  const workerCount = 3;
  const turnBudget = 120;
  let turns = 0;
  let inFlight = 0;
  let completed = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  let lastError = "";
  const attempts = new Map<JarvisResearchLane, number>();
  const laneFailures = new Map<JarvisResearchLane, number>();
  const counts = counted(run.focus, run.wide, run.channelFocus);
  const personaForLane: Record<JarvisResearchLane, JarvisPersona> = {
    dtc_shopify: "ecommerce_owner",
    healthcare_operations: "healthcare_operator",
    cross_source_operations: "cross_source_operator",
  };
  const nextLane = (core: JarvisLead[]): JarvisResearchLane => [...JARVIS_RESEARCH_LANES].sort((a, b) => {
    // Quotas are a soft diversity target. Repeatedly failing lanes are penalized,
    // but never block productive workers or stop the whole run.
    const progress = (lane: JarvisResearchLane) => (core.filter((lead) => lead.sourcingLane === lane).length + (attempts.get(lane) ?? 0)) / JARVIS_RESEARCH_LANE_QUOTA[lane]
      + (laneFailures.get(lane) ?? 0) * 0.15;
    return progress(a) - progress(b);
  })[0]!;
  const report = (activeWorkers: number, message: string) => patchJarvisRun(run.id, {
    batches: turns,
    pipeline: { stage: activeWorkers ? "discovering" : "finishing", activeWorkers, completed, failed },
    message,
    lastError: lastError || undefined,
  });
  const worker = async (): Promise<void> => {
    while (!signal.aborted) {
      const state = readJarvis();
      const core = state.leads.filter(isCurrentValidationProspect);
      const targetContacts = state.leads.filter(counts);
      // Reserve one target slot before awaiting. Without the reservation, three
      // workers can all observe the same remaining slot and overshoot the user's
      // requested total.
      if (targetContacts.length + inFlight >= run.target || turns >= turnBudget || consecutiveFailures >= 6) return;
      const lane = nextLane(core);
      attempts.set(lane, (attempts.get(lane) ?? 0) + 1);
      turns += 1;
      inFlight += 1;
      report(inFlight, `Pipeline · ${targetContacts.length}/${run.target} ${unit(run.focus, run.wide, run.channelFocus)} · ${inFlight} active workers save results independently.`);
      try {
      const result = await runScopedAssistantTurn({
        remembered: null, remember: () => {}, oneShot: true,
        toolNames: [...JARVIS_RESEARCH_TOOLS], preamble: JARVIS_RESEARCH_PREAMBLE,
        model: JARVIS_RESEARCH_MODEL, thinkingLevel: "low",
        // Each concurrent attempt gets a different source family even before a
        // prior worker saves a lead. Otherwise all workers see the same lane
        // count and can return the same founder from the same seed source.
        message: jarvisResearchPrompt(state.leads, "info_exec", 1, personaForLane[lane], false, lane, run.channelFocus, (attempts.get(lane) ?? 1) - 1), timeoutMs: 360000, signal,
      });
      if (!result.usedTools.includes("web_search") || !result.usedTools.some((tool) => tool === "fetch_content" || tool === "get_search_content")) {
        throw new Error(`${lane}: research must search and read public sources`);
      }
      const { candidates, rejected } = parseJarvisResearch(result.reply, "info_exec");
        const bounded = candidates.filter((candidate) => candidate.persona === personaForLane[lane] && candidate.sourcingLane === lane
          && Boolean(candidate.role?.trim() && candidate.profileUrl?.trim() && candidate.evidence?.trim() && candidate.evidenceUrl?.trim())
          && (!run.channelFocus || candidate.socials?.[run.channelFocus])).slice(0, 1);
        if (!bounded.length) throw new Error(`${lane}: no valid candidate (${rejected} rejected)`);
        const verified = await checkJarvisEmailSources(bounded, signal);
        if (signal.aborted) return;
        const reachable = bounded.filter((candidate) => Boolean(candidate.socials?.instagram)
          || Boolean(candidate.email && verified.has(candidate.email)));
        if (!reachable.length) throw new Error(`${lane}: candidate did not have the persona-specific verified contact route`);
        const added = addJarvisCandidates(reachable, verified, run.id);
        completed += 1;
        consecutiveFailures = added ? 0 : consecutiveFailures + 1;
        laneFailures.set(lane, added ? 0 : (laneFailures.get(lane) ?? 0) + 1);
        const total = readJarvis().leads.filter(counts).length;
        report(Math.max(0, inFlight - 1), `Pipeline · ${total}/${run.target} ${unit(run.focus, run.wide, run.channelFocus)} · ${completed} tasks completed, ${failed} failed.`);
      } catch (error) {
        if (signal.aborted) return;
        failed += 1;
        consecutiveFailures += 1;
        lastError = error instanceof Error ? error.message : String(error);
        laneFailures.set(lane, (laneFailures.get(lane) ?? 0) + 1);
        const total = readJarvis().leads.filter(counts).length;
        report(Math.max(0, inFlight - 1), `Pipeline · ${total}/${run.target} · ${lane} task isolated: ${error instanceof Error ? error.message : String(error)} Continuing other workers…`);
      } finally {
        inFlight -= 1;
      }
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (signal.aborted) return;
  const total = readJarvis().leads.filter(counts).length;
  patchJarvisRun(run.id, {
    status: total >= run.target ? "done" : "error", batches: turns,
    lastError: lastError || undefined,
    pipeline: { stage: "finishing", activeWorkers: 0, completed, failed },
    message: total >= run.target
      ? `Target reached: ${total} ${unit(run.focus, run.wide, run.channelFocus)}. Approved outreach may continue while future research runs.`
      : `Research stopped short of target: ${total}/${run.target} ${unit(run.focus, run.wide, run.channelFocus)}. ${completed} tasks completed, ${failed} failed. ${lastError || "No new candidates returned."} Saved results are intact.`,
    finishedAt: new Date().toISOString(),
  });
}

async function discoverLegacy(run: JarvisRun, signal: AbortSignal): Promise<void> {
  let emptyBatches = 0;
  let failedBatches = 0;
  const attempts = new Map<CoreJarvisSegment, number>();
  const personaAttempts = new Map<JarvisPersona, number>();
  const quota: Record<string, number> = BALANCED_JARVIS_QUOTA;
  const counts = counted(run.focus, run.wide);
  // Strict evidence often yields one usable contact from a three-person batch.
  // Bound a one-click 100-contact run at 120 turns; three empty or failed turns
  // still stop spending early.
  for (let batch = 1; batch <= 120; batch++) {
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
    // info_exec fills its three personas the same way: furthest behind its share first,
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
        model: JARVIS_RESEARCH_MODEL,
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
  patchJarvisRun(run.id, { status: "done", message: total >= run.target ? `Target reached: ${total} ${unit(run.focus, run.wide)}. Review sources and contact routes before outreach.` : `Batch budget reached: ${total}/${run.target} ${unit(run.focus, run.wide)}. You can continue later.`, finishedAt: new Date().toISOString() });
}
