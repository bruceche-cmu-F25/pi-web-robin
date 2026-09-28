import { randomUUID } from "node:crypto";
import { applyJarvisAssessment, patchJarvisRescore, readJarvis, writeJarvisRescore } from "../extension/robin/jarvis-domain.ts";
import { JARVIS_RUBRIC_VERSION, type JarvisLead, type JarvisRescoreRun } from "../extension/robin/jarvis-shape.ts";
import { JARVIS_RESCORE_PREAMBLE, JARVIS_RESEARCH_TOOLS, jarvisRescorePrompt, parseJarvisRescore } from "../extension/robin/jarvis-research.ts";
import { runScopedAssistantTurn } from "./robin-assistant";

/**
 * Re-assesses contacts not yet judged under the current rubric. Contacts with
 * stored evidence and earlier score reasons are re-judged from those alone, eight
 * per turn without web tools; the rest are researched, four per turn. Runs
 * beside discovery; each has its own registry entry and state slot.
 */
const BATCH = 4;
const OFFLINE_BATCH = 8;
const registry = globalThis as typeof globalThis & { __jarvisRescore?: { id: string; controller: AbortController } };

/** Contacts not yet judged under the current rubric that could still be contacted, unsent first. */
export function pendingRescore(leads: JarvisLead[]): JarvisLead[] {
  return leads.filter((lead) => (lead.assessedVersion ?? (lead.assessedAt ? 1 : 0)) < JARVIS_RUBRIC_VERSION && !["bounced", "do_not_contact", "declined"].includes(lead.status))
    .sort((a, b) => Number(Boolean(a.sentAt)) - Number(Boolean(b.sentAt)));
}

export function startJarvisRescore(): JarvisRescoreRun {
  if (registry.__jarvisRescore) throw new Error("Rescoring is already running or stopping");
  const total = pendingRescore(readJarvis().leads).length;
  if (!total) throw new Error("Every contact is already assessed under the current rubric");
  const run: JarvisRescoreRun = { id: randomUUID(), status: "running", total, assessed: 0, startedAt: new Date().toISOString(), message: "Starting rescoring…" };
  const controller = new AbortController();
  writeJarvisRescore(run);
  registry.__jarvisRescore = { id: run.id, controller };
  void rescore(run, controller.signal).catch((error: unknown) => {
    patchJarvisRescore(run.id, { status: "error", message: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() });
  }).finally(() => {
    if (registry.__jarvisRescore?.id === run.id) delete registry.__jarvisRescore;
  });
  return run;
}

export function stopJarvisRescore(): void {
  const active = registry.__jarvisRescore;
  if (!active) return;
  active.controller.abort();
  patchJarvisRescore(active.id, { status: "cancelled", message: "Stopped. Saved assessments are kept.", finishedAt: new Date().toISOString() });
}

export function isJarvisRescoreActive(id: string): boolean {
  return registry.__jarvisRescore?.id === id;
}

async function rescore(run: JarvisRescoreRun, signal: AbortSignal): Promise<void> {
  let assessed = 0;
  let failed = 0;
  // A contact the model skips is not retried in this run, so a stubborn one cannot loop.
  const tried = new Set<string>();
  for (let turn = 1; turn <= 80; turn++) {
    if (signal.aborted) return;
    const pending = pendingRescore(readJarvis().leads).filter((lead) => !tried.has(lead.id));
    // Re-judging stored evidence first: it is fast and needs no search quota.
    const offline = pending.some((lead) => lead.newsBurden);
    const batch = pending.filter((lead) => Boolean(lead.newsBurden) === offline).slice(0, offline ? OFFLINE_BATCH : BATCH);
    if (!batch.length) break;
    batch.forEach((lead) => tried.add(lead.id));
    patchJarvisRescore(run.id, { message: `Batch ${turn} · ${offline ? "re-judging stored evidence" : "researching"} · ${assessed}/${run.total} assessed · ${batch.map((lead) => lead.name).join(", ")}` });
    try {
      const result = await runScopedAssistantTurn({
        remembered: null, remember: () => {}, oneShot: true,
        toolNames: offline ? [] : [...JARVIS_RESEARCH_TOOLS], preamble: JARVIS_RESCORE_PREAMBLE,
        message: jarvisRescorePrompt(batch, offline), timeoutMs: offline ? 180000 : 360000, signal,
      });
      if (signal.aborted) return;
      const ids = new Set(batch.map((lead) => lead.id));
      for (const item of parseJarvisRescore(result.reply)) {
        if (!ids.has(item.id)) continue;
        try { if (applyJarvisAssessment(item.id, item)) assessed++; } catch { /* An invalid entry leaves that contact unassessed. */ }
      }
      patchJarvisRescore(run.id, { assessed });
      failed = 0;
    } catch (error) {
      if (signal.aborted) return;
      failed += 1;
      if (failed >= 3) throw new Error(`Three consecutive rescoring batches failed. Last error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  patchJarvisRescore(run.id, { status: "done", assessed, message: `Rescored ${assessed}/${run.total} contacts. Anyone skipped can be rescored again.`, finishedAt: new Date().toISOString() });
}
