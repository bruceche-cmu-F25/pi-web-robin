import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { deferred, settle } from "../scripts/react-hook-harness.mjs";

// No paid turns or personal storage. Route/domain integration checks use the real store.
const root = mkdtempSync(join(tmpdir(), "job-scoring-runner-"));
const stub = join(root, "runtime.mjs");
writeFileSync(stub, `
const state = () => globalThis.__jobScoringRunnerTest;
export const jobProfile = () => ({ scoreBatch: state().batch, rubricLocale: 'en', scoreModel: state().model });
export const claimJobScoringRun = value => { state().claims++; state().saved = {...value}; return true; };
export const heartbeatJobScoringRun = () => state().owned;
export const pendingJobCount = () => state().pending.length;
export const pendingJobIds = () => { if (state().failRead) throw Error('queue read failed'); return [...state().pending]; };
export const saveScoringState = value => {
  state().publications++;
  if (state().failPublish) { state().failPublish = false; throw Error('progress write failed'); }
  if (!state().owned) return false;
  state().saved = {...value}; return true;
};
export const scoringState = () => state().saved;
export const scorerName = model => model ? model.provider + '/' + model.modelId : null;
export const RUN_LEASE_MS = 120000;
export const RUNTIME_OWNER_ID = 'test';
export const startRunHeartbeat = (renew, controller) => {
  state().controller = controller;
  state().heartbeat = () => { if (!renew()) controller.abort(); };
  const timer = setInterval(() => {}, 100000); state().timer = timer; return timer;
};
export const runAssistantTurn = (...args) => { state().calls.push(args); return state().turn(...args); };
`);
const { startJobScoring } = await createJiti(import.meta.url, { alias: {
  "@/lib/robin-assistant": stub,
  "@/extension/robin/job-domain": stub,
  "@/extension/robin/job-profile": stub,
  "@/extension/robin/run-lease": stub,
  "@": process.cwd(),
} }).import("./job-scoring-runner.ts");
let state;
beforeEach(() => {
  state = globalThis.__jobScoringRunnerTest = {
    saved: null, batch: 1, model: null, pending: ["one"], owned: true,
    claims: 0, publications: 0, calls: [], turn: async () => {},
  };
});
afterEach(async () => { state.finish?.(); await settle(); clearInterval(state.timer); });
after(() => { delete globalThis.__jobScoringRunnerTest; rmSync(root, { recursive: true, force: true }); });

function holdTurn() {
  const hold = deferred(); state.finish = hold.resolve;
  state.turn = () => hold.promise;
  return hold;
}

test("empty backlog does not claim ownership or call a model", () => {
  state.pending = [];
  assert.deepEqual(startJobScoring(), { started: false, reason: "nothing-pending", scoring: null });
  assert.equal(state.claims, 0);
  assert.equal(state.calls.length, 0);
});

test("start returns acceptance before completion; local duplicate starts do no work", async () => {
  const hold = holdTurn();
  const result = startJobScoring();
  assert.equal(result.started, true);
  assert.equal(result.scoring.running, true);
  assert.equal(startJobScoring().reason, "already-running");
  assert.equal(state.claims, 1);
  assert.equal(state.calls.length, 1);
  state.pending = []; hold.resolve(); await settle();
  assert.equal(state.saved.running, false);
  state.pending = ["later"];
  assert.equal(startJobScoring().started, true, "terminal cleanup releases the local fast path");
  await settle();
});

test("losing the durable heartbeat aborts the in-flight turn without overwriting its replacement", async () => {
  const hold = holdTurn(); startJobScoring();
  const signal = state.calls[0][4];
  assert.ok(signal instanceof AbortSignal);
  state.owned = false;
  state.saved = { id: "replacement", running: true };
  state.heartbeat();
  assert.equal(signal.aborted, true);
  hold.resolve(); await settle();
  assert.deepEqual(state.saved, { id: "replacement", running: true });
  assert.equal(state.calls.length, 1);
});

test("loss of publication ownership before a round prevents the paid call", async () => {
  state.owned = false;
  startJobScoring(); await settle();
  assert.equal(state.calls.length, 0);
  assert.equal(state.controller.signal.aborted, true);
});

for (const fault of ["failRead", "failPublish"]) test(`${fault}: unexpected runner failures publish terminal errors while still owned`, async () => {
  state[fault] = true;
  startJobScoring(); await settle();
  assert.equal(state.saved.running, false);
  assert.match(state.saved.error, fault === "failRead" ? /queue read failed/ : /progress write failed/);
  assert.ok(state.saved.finishedAt);
  assert.equal(state.calls.length, 0);
  state[fault] = false;
  assert.equal(startJobScoring().started, true);
  await settle();
});

test("partial progress survives a provider failure and remaining counts come from the backlog", async () => {
  state.pending = ["one", "two", "three"];
  state.turn = async () => { state.pending.shift(); if (state.calls.length === 2) throw new Error("Provider unavailable"); };
  startJobScoring(); await settle();
  assert.equal(state.calls.length, 2);
  assert.equal(state.saved.remaining, 1);
  assert.equal(state.saved.running, false);
  assert.equal(state.saved.error, "Provider unavailable");
});

test("new arrivals may keep the count flat: progress is determined by original ids", async () => {
  state.pending = ["one", "two"];
  state.turn = async () => {
    if (state.calls.length === 1) state.pending = ["two", "new"];
    else state.pending = [];
  };
  startJobScoring(); await settle();
  assert.equal(state.calls.length, 2);
  assert.equal(state.saved.remaining, 0);
  assert.equal(state.saved.error, null);
});

test("adding jobs without scoring any original id stops instead of buying another round", async () => {
  state.pending = ["one", "two"];
  state.turn = async () => { state.pending.push("new"); };
  startJobScoring(); await settle();
  assert.equal(state.calls.length, 1);
  assert.equal(state.saved.remaining, 3);
  assert.match(state.saved.error, /no progress/);
});

test("a large queue is capped at eight rounds even when work is progressing", async () => {
  state.pending = Array.from({ length: 20 }, (_, i) => String(i));
  state.turn = async () => { state.pending.shift(); };
  startJobScoring(); await settle();
  assert.equal(state.calls.length, 8);
  assert.equal(state.saved.totalRounds, 8);
  assert.equal(state.saved.remaining, 12);
  assert.equal(state.saved.running, false);
});

test("out-of-scope pin falls back only once; a failing default terminates without editing the pin", async () => {
  state.model = { provider: "test", modelId: "retired" };
  state.turn = async () => { throw new Error("Model is not available in the enabled scope: fixture"); };
  startJobScoring(); await settle();
  assert.deepEqual(state.calls.map(args => args[3]), [undefined, null]);
  assert.equal(state.saved.fallbackFrom, "test/retired");
  assert.equal(state.saved.model, null);
  assert.equal(state.saved.running, false);
  assert.match(state.saved.error, /Model is not available/);
  assert.equal(state.model.modelId, "retired");
});
