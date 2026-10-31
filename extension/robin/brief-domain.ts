/** Brief owns durable shadow runs, source checkpoints and immutable editions. */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { BRIEF_SOURCES, composeShadow, validBriefDay, validateBriefInput, type BriefEdition, type BriefInput, type BriefRun, type BriefScope, type BriefSource } from "./brief.ts";
import { briefStorePath, initializeBriefStore, upgradeBriefStore, withBriefStore } from "./brief-store.ts";
import { BriefAcquisitionStorageError, createBriefAcquisitionContext, verifyAcquiredBriefEvidence, type BriefAcquisitionContext } from "./brief-acquisition.ts";

const LEASE_MS = 60_000;
const DEADLINE_MS = 120_000;
interface RunRow { id: string; request_id: string; input_profile: string; day: string; timezone: string; owner: string; lease_until: number; stage: BriefRun["stage"]; started_at: string; finished_at: string | null; failure: string | null }
const rowByRequest = (db: DatabaseSync, request: string) => db.prepare("SELECT * FROM brief_runs WHERE request_id = ?").get(request) as unknown as RunRow | undefined;
function editionForRun(db: DatabaseSync, runId: string): BriefEdition | null {
  const row = db.prepare("SELECT payload FROM brief_editions WHERE run_id = ?").get(runId);
  return row ? JSON.parse(row.payload as string) as BriefEdition : null;
}
function step(db: DatabaseSync, id: string, stage: string, at: number, outcome: string) {
  db.prepare("INSERT INTO brief_steps(run_id, stage, at, outcome) VALUES(?, ?, ?, ?)").run(id, stage, new Date(at).toISOString(), outcome);
}
function owned(db: DatabaseSync, id: string, owner: string, now: number): boolean {
  return Boolean(db.prepare("SELECT 1 FROM brief_runs WHERE id = ? AND owner = ? AND lease_until > ? AND stage NOT IN ('done', 'failed')").get(id, owner, now));
}
export function initializeBriefPipeline(): void { initializeBriefStore(); }
export function upgradeBriefPipeline(writersStopped: boolean): string | null { return upgradeBriefStore(writersStopped); }
export function briefPipelineStatus(now = Date.now()) {
  if (!existsSync(briefStorePath())) return { initialized: false, mode: "shadow" as const, edition: null, runs: [] as BriefRun[] };
  return withBriefStore(db => {
    const latest = db.prepare("SELECT payload FROM brief_editions ORDER BY rowid DESC LIMIT 1").get();
    const runs = (db.prepare("SELECT * FROM brief_runs ORDER BY (stage NOT IN ('done','failed') AND lease_until > ?) DESC, rowid DESC LIMIT 20").all(now) as unknown as RunRow[]).map(r => ({
      id: r.id, requestId: r.request_id, day: r.day, timezone: r.timezone, stage: r.stage,
      startedAt: r.started_at, finishedAt: r.finished_at, failure: r.failure, leaseUntil: r.lease_until,
      interrupted: !["done", "failed"].includes(r.stage) && r.lease_until <= now,
    }));
    return { initialized: true, mode: "shadow" as const, edition: latest ? JSON.parse(latest.payload as string) as BriefEdition : null, runs };
  });
}
export function briefRunDetails(requestId: string) {
  return withBriefStore(db => {
    const run = rowByRequest(db, requestId);
    if (!run) return null;
    return { runId: run.id, inputProfile: run.input_profile, requestsReserved: Number(db.prepare("SELECT requests FROM brief_budgets WHERE run_id = ?").get(run.id)?.requests ?? 0), edition: editionForRun(db, run.id),
      inputs: db.prepare("SELECT payload FROM brief_inputs WHERE run_id = ? ORDER BY source").all(run.id).map(r => JSON.parse(r.payload as string) as BriefInput),
      steps: db.prepare("SELECT stage, at, outcome FROM brief_steps WHERE run_id = ? ORDER BY id").all(run.id) };
  });
}
export interface ShadowBriefDeps {
  scope: BriefScope;
  collect: (source: BriefSource, scope: BriefScope, signal: AbortSignal, acquisition: BriefAcquisitionContext) => BriefInput | Promise<BriefInput>;
  /** A stable policy identity. A retry may not silently switch stored/fresh inputs. */
  inputProfile?: string;
  now?: () => number;
  signal?: AbortSignal;
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/** Explicit command only. The supplied request ID survives retries and lost responses. */
export async function runShadowBrief(requestId: string, deps: ShadowBriefDeps): Promise<BriefEdition> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{2,119}$/.test(requestId)) throw new Error("Invalid brief request ID");
  if (!validBriefDay(deps.scope.day)) throw new Error("Invalid brief day");
  new Intl.DateTimeFormat("en", { timeZone: deps.scope.timezone }).format();
  deps.signal?.throwIfAborted();
  const profile = deps.inputProfile ?? "stored-v1";
  if (!/^[a-zA-Z0-9:_-]{1,150}$/.test(profile)) throw new Error("Invalid Brief input profile");
  const now = deps.now ?? Date.now;
  const owner = randomUUID();
  const claim = withBriefStore(db => {
    const existing = rowByRequest(db, requestId);
    if (existing && existing.input_profile !== profile) throw new Error("Brief request ID belongs to a different input profile");
    if (existing?.stage === "done") {
      const edition = editionForRun(db, existing.id);
      if (!edition) throw new Error("Completed Brief run has no edition; refusing to rebuild over inconsistent storage");
      return { edition, run: existing };
    }
    if (db.prepare("SELECT 1 FROM brief_runs WHERE stage NOT IN ('done','failed') AND lease_until > ?").get(now())) throw new Error("A shadow brief is already running");
    const id = existing?.id ?? randomUUID(), at = now();
    if (existing) db.prepare("UPDATE brief_runs SET owner = ?, lease_until = ?, stage = 'prepare', finished_at = NULL, failure = NULL WHERE id = ?").run(owner, at + LEASE_MS, id);
    else db.prepare("INSERT INTO brief_runs(id, request_id, day, timezone, owner, lease_until, stage, started_at, input_profile) VALUES(?, ?, ?, ?, ?, ?, 'prepare', ?, ?)").run(id, requestId, deps.scope.day, deps.scope.timezone, owner, at + LEASE_MS, new Date(at).toISOString(), profile);
    step(db, id, "guard", at, existing ? "resumed" : "claimed");
    return { edition: null, run: rowByRequest(db, requestId)! };
  }, true);
  if (claim.edition) return claim.edition;
  const run = claim.run, scope = { day: run.day, timezone: run.timezone };
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(DEADLINE_MS), ...(deps.signal ? [deps.signal] : [])]);
  const commit = <T>(action: (db: DatabaseSync) => T): T => {
    signal.throwIfAborted();
    return withBriefStore(db => {
      if (!owned(db, run.id, owner, now())) throw new Error("Brief run ownership expired");
      return action(db);
    }, true);
  };
  const heartbeat = setInterval(() => {
    try { commit(db => { db.prepare("UPDATE brief_runs SET lease_until = ? WHERE id = ?").run(now() + LEASE_MS, run.id); }); }
    catch { controller.abort(new Error("Brief heartbeat lost ownership")); }
  }, 15_000);
  heartbeat.unref();
  let stage = "prepare";
  const advance = (next: BriefRun["stage"]) => {
    stage = next;
    commit(db => { db.prepare("UPDATE brief_runs SET stage = ? WHERE id = ?").run(next, run.id); step(db, run.id, next, now(), "started"); });
  };
  try {
    advance("harvest");
    const inputs: BriefInput[] = [];
    for (const source of BRIEF_SOURCES) {
      stage = `harvest:${source}`;
      signal.throwIfAborted();
      const saved = withBriefStore(db => db.prepare("SELECT payload FROM brief_inputs WHERE run_id = ? AND source = ?").get(run.id, source));
      if (saved) {
        const input = JSON.parse(saved.payload as string) as BriefInput; validateBriefInput(input, source);
        if (input.coverage !== "unavailable") { inputs.push(input); continue; }
      }
      let input: BriefInput;
      try { input = await abortable(Promise.resolve(deps.collect(source, scope, signal, createBriefAcquisitionContext(run.id, source, commit, now))), signal); }
      catch (error) {
        signal.throwIfAborted();
        if (error instanceof BriefAcquisitionStorageError) throw error;
        input = { source, observedAt: new Date(now()).toISOString(), coverage: "unavailable", detail: `${source}: source could not be read; saved checkpoint retained`, items: [] };
      }
      validateBriefInput(input, source);
      // Provider page checkpoints precede this per-run frozen source manifest.
      commit(db => {
        verifyAcquiredBriefEvidence(db, input);
        db.prepare("INSERT INTO brief_inputs VALUES(?, ?, ?) ON CONFLICT(run_id, source) DO UPDATE SET payload = excluded.payload").run(run.id, source, JSON.stringify(input));
        step(db, run.id, `harvest:${source}`, now(), input.coverage);
      });
      inputs.push(input);
    }
    const inputsCompletedAt = new Date(now()).toISOString();
    advance("verify");
    commit(db => { for (const input of inputs) verifyAcquiredBriefEvidence(db, input); });
    const content = composeShadow(inputs);
    advance("brief");
    return commit(db => {
      const at = now();
      const revision = Number(db.prepare("SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM brief_editions WHERE day = ? AND timezone = ?").get(scope.day, scope.timezone)!.revision);
      const edition: BriefEdition = { id: randomUUID(), runId: run.id, ...scope, revision, mode: "shadow", createdAt: new Date(at).toISOString(), inputsCompletedAt, ...content };
      db.prepare("INSERT INTO brief_editions VALUES(?, ?, ?, ?, ?, 'shadow', ?)").run(edition.id, run.id, scope.day, scope.timezone, revision, JSON.stringify(edition));
      db.prepare("UPDATE brief_runs SET stage = 'done', finished_at = ?, lease_until = 0 WHERE id = ?").run(edition.createdAt, run.id);
      step(db, run.id, "publish", at, "shadow-only"); step(db, run.id, "close", at, "done");
      return edition;
    });
  } catch (error) {
    // A replaced owner must not mark its successor failed. Do not persist upstream exception bodies.
    withBriefStore(db => {
      if (!owned(db, run.id, owner, now())) return;
      const failure = signal.aborted ? "cancelled-or-deadline" : `failed:${stage}`;
      db.prepare("UPDATE brief_runs SET stage = 'failed', failure = ?, finished_at = ?, lease_until = 0 WHERE id = ?").run(failure, new Date(now()).toISOString(), run.id);
      step(db, run.id, "close", now(), failure);
    }, true);
    throw error;
  } finally { clearInterval(heartbeat); }
}
