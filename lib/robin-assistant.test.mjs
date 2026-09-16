import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "robin-lifecycle-"));
const data = join(root, "data");
const previous = { dir: process.env.ROBIN_DATA_DIR, tz: process.env.TZ };
process.env.ROBIN_DATA_DIR = data;
process.env.TZ = "America/Los_Angeles";
const stub = join(root, "runtime.mjs");
writeFileSync(stub, `
import { readFileSync } from 'node:fs';
const state = () => globalThis.__robinLifecycleTest;
export const getRpcSession = id => state().live.get(id);
export const startRpcSession = (...args) => state().start(...args);
export const resolveSessionPath = async id => state().files.get(id) ?? null;
export const readSessionHeader = path => JSON.parse(readFileSync(path, 'utf8').split('\\n')[0]);
export const invalidateSessionPathCache = id => state().invalidated.push(id);
export const invalidateSessionListCache = () => { state().listInvalidations++; };
export const prepareJobScoringSession = async () => {};
`);
const jiti = createJiti(import.meta.url, { alias: {
  "@/lib/rpc-manager": stub,
  "@/lib/session-reader": stub,
  "./job-scoring-runtime.ts": stub,
  "@": process.cwd(),
}, moduleCache: false });
const lifecycle = await jiti.import("./robin-session-lifecycle.ts");
const assistant = await jiti.import("./robin-assistant.ts");
const store = await jiti.import("../extension/robin/store.ts");
const productState = await jiti.import("../extension/robin/product-agent-state.ts");
const history = () => JSON.parse(readFileSync(join(data, "assistant-session-history.json"), "utf8"));
let runtime;

function transcript(id, at = Date.now(), cwd = data) {
  const path = join(data, `${id}.jsonl`);
  writeFileSync(path, JSON.stringify({ type: "session", version: 3, id, cwd, timestamp: new Date(at).toISOString() }) + "\n");
  utimesSync(path, at / 1000, at / 1000);
  runtime.files.set(id, path);
  return path;
}
function tracked(id, at, cwd = data) {
  const path = transcript(id, at, cwd);
  lifecycle.recordRobinSessionActivity(id, path, at);
  return path;
}

beforeEach(() => {
  rmSync(data, { recursive: true, force: true });
  mkdirSync(data);
  globalThis.__robinTurnQueues = new Map();
  runtime = globalThis.__robinLifecycleTest = {
    files: new Map(), live: new Map(), prompts: [], starts: [], invalidated: [], listInvalidations: 0,
    pause: false, pending: [],
    async start(key, path, cwd, options) {
      this.starts.push({ key, path, cwd, options });
      const id = path ? key : `session-${this.starts.length}`;
      path ||= transcript(id);
      const listeners = new Set();
      const session = {
        sessionId: id, sessionFile: path, alive: true, running: false, commands: [],
        isAlive() { return this.alive; }, isRunning() { return this.running; },
        destroy() { this.alive = false; }, async shutdown() { this.destroy(); },
        onEvent(callback) { listeners.add(callback); return () => listeners.delete(callback); },
        async send(command) {
          this.commands.push(command);
          if (command.type === "abort") { this.running = false; return; }
          if (command.type !== "prompt") return;
          this.running = true;
          runtime.prompts.push({ id, ...command });
          const finish = () => {
            this.running = false;
            utimesSync(path, Date.now() / 1000, Date.now() / 1000);
            for (const listener of listeners) listener({ type: "message_end", message: { role: "assistant", content: "ok" } });
            for (const listener of listeners) listener({ type: "prompt_done" });
          };
          if (runtime.pause) runtime.pending.push(finish);
          else queueMicrotask(finish);
        },
      };
      this.live.set(id, session);
      return { session, realSessionId: id };
    },
  };
});
afterEach(() => {
  clearTimeout(globalThis.__robinCleanupTimer);
  delete globalThis.__robinCleanupTimer;
});
after(() => {
  rmSync(root, { recursive: true, force: true });
  if (previous.dir === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous.dir;
  if (previous.tz === undefined) delete process.env.TZ; else process.env.TZ = previous.tz;
  delete globalThis.__robinLifecycleTest;
  delete globalThis.__robinTurnQueues;
});

const at = value => new Date(value).getTime();
test("idle cutoff, local midnight, UTC midnight, invalid/future clocks", () => {
  const last = at("2026-08-31T12:00:00-07:00");
  assert.equal(lifecycle.robinSessionExpired(last, new Date(last + lifecycle.ROBIN_IDLE_MS - 1)), false);
  assert.equal(lifecycle.robinSessionExpired(last, new Date(last + lifecycle.ROBIN_IDLE_MS)), true);
  assert.equal(lifecycle.robinSessionExpired(at("2026-08-31T23:59:00-07:00"), new Date("2026-09-01T00:01:00-07:00")), true);
  assert.equal(lifecycle.robinSessionExpired(at("2026-08-31T16:59:00-07:00"), new Date("2026-08-31T17:01:00-07:00")), false);
  assert.equal(lifecycle.robinSessionExpired(NaN), true);
  assert.equal(lifecycle.robinSessionExpired(last + 1, new Date(last)), true);
});

test("clock is local, refreshed, and pins this weekend even on Sunday/year rollover", () => {
  const sunday = lifecycle.withRobinTimeContext("本周末去玩", new Date("2026-08-30T20:00:00-07:00"));
  assert.match(sunday, /2026-08-30 20:00:00 \(Sunday\); timezone: America\/Los_Angeles/);
  assert.match(sunday, /This weekend: 2026-08-29 through 2026-08-30/);
  const next = lifecycle.withRobinTimeContext("明天", new Date("2026-08-31T08:00:00-07:00"));
  assert.match(next, /This weekend: 2026-09-05 through 2026-09-06/);
  assert.match(lifecycle.withRobinTimeContext("hi", new Date("2026-12-31T12:00:00-08:00")), /2027-01-02 through 2027-01-03/);
});

test("continuous chat resumes across wrapper eviction, then rotates after 30 minutes", async t => {
  const now = at("2026-08-31T12:00:00-07:00");
  t.mock.timers.enable({ apis: ["Date"], now });
  const first = await assistant.runAssistantTurn("default", "这个周末去露营");
  t.mock.timers.setTime(now + 10 * 60_000);
  assert.equal((await assistant.runAssistantTurn("default", "改成周日")).sessionId, first.sessionId);
  assert.equal(runtime.starts.length, 1);
  runtime.live.get(first.sessionId).destroy();
  t.mock.timers.setTime(now + 20 * 60_000);
  assert.equal((await assistant.runAssistantTurn("default", "几点？")).sessionId, first.sessionId);
  assert.equal(runtime.starts.at(-1).path, runtime.files.get(first.sessionId));
  t.mock.timers.setTime(now + 50 * 60_000);
  const next = await assistant.runAssistantTurn("default", "新事情");
  assert.notEqual(next.sessionId, first.sessionId);
  assert.equal(runtime.live.get(first.sessionId).isAlive(), false);
  assert.ok(existsSync(runtime.files.get(first.sessionId)), "rotation never deletes the transcript");
  assert.match(runtime.prompts[1].message, /2026-08-31 12:10:00/);
  assert.ok(runtime.starts.every(start => start.options.exactTools === true));
});

test("midnight rotates; fresh coach preamble returns; other modes cannot refresh its age", async t => {
  const now = at("2026-08-31T23:55:00-07:00");
  t.mock.timers.enable({ apis: ["Date"], now });
  const first = await assistant.runAssistantTurn("coach", "help");
  await assistant.runAssistantTurn("coach", "why");
  assert.doesNotMatch(runtime.prompts.at(-1).message, /You are this user's coding coach/);
  assert.doesNotMatch(runtime.prompts.at(-1).message, /Robin clock/);
  t.mock.timers.setTime(now + 4 * 60_000);
  await assistant.runAssistantTurn("default", "hi");
  t.mock.timers.setTime(now + 6 * 60_000);
  const next = await assistant.runAssistantTurn("coach", "help again");
  assert.notEqual(next.sessionId, first.sessionId);
  assert.match(runtime.prompts.at(-1).message, /You are this user's coding coach/);
});

test("a response finishing after midnight still rotates before the next user message", async t => {
  const now = at("2026-08-31T23:59:00-07:00");
  t.mock.timers.enable({ apis: ["Date"], now });
  runtime.pause = true;
  const first = assistant.runAssistantTurn("default", "hi");
  while (!runtime.pending.length) await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.setTime(now + 2 * 60_000);
  runtime.pending.shift()();
  const original = await first;
  runtime.pause = false;
  const next = await assistant.runAssistantTurn("default", "今天呢");
  assert.notEqual(next.sessionId, original.sessionId);
  assert.match(runtime.prompts.at(-1).message, /2026-09-01 00:01:00/);
});

test("legacy timestamps are adopted without making an expired conversation fresh; missing cached files recover", async () => {
  const path = transcript("legacy", Date.now() - lifecycle.ROBIN_IDLE_MS - 1000);
  store.writeAssistantSessionId("legacy");
  const next = await assistant.runAssistantTurn("default", "hi");
  assert.notEqual(next.sessionId, "legacy");
  assert.equal(history().sessions.legacy.path, path);
  runtime.live.get(next.sessionId).destroy();
  rmSync(runtime.files.get(next.sessionId));
  assert.notEqual((await assistant.runAssistantTurn("default", "again")).sessionId, next.sessionId);
});

test("manual reset still starts over; fixed-mode independent jobs are always fresh and disposed", async () => {
  const first = await assistant.runAssistantTurn("default", "hi");
  assert.equal(store.clearAssistantSession("default"), true);
  assert.notEqual((await assistant.runAssistantTurn("default", "hi")).sessionId, first.sessionId);
  for (const mode of ["readOnly", "mail", "scoring"]) {
    const a = await assistant.runAssistantTurn(mode, "run");
    const b = await assistant.runAssistantTurn(mode, "run");
    assert.notEqual(a.sessionId, b.sessionId);
    assert.equal(runtime.live.get(a.sessionId).isAlive(), false);
    assert.equal(runtime.live.get(b.sessionId).commands.at(-1).type, "abort");
  }
});

test("scoped note conversations keep an exact empty tool set and selected model", async () => {
  const selected = { provider: "openai", modelId: "gpt-5.6-sol" };
  let remembered = null;
  const turn = message => assistant.runScopedAssistantTurn({
    remembered,
    remember: sessionId => { remembered = sessionId; },
    toolNames: [],
    message,
    preamble: "note-taking partner",
    model: selected,
  });
  const first = await turn("organize this");
  assert.deepEqual(runtime.starts.at(-1).options.initialModel, selected);
  assert.deepEqual(runtime.starts.at(-1).options.toolNames, []);
  assert.match(runtime.prompts.at(-1).message, /note-taking partner/);

  await turn("explain this");
  const live = runtime.live.get(first.sessionId);
  assert.ok(live.commands.some(command => command.type === "set_model"
    && command.provider === selected.provider && command.modelId === selected.modelId));
});

test("simultaneous dashboard/Telegram turns cannot create two sessions or mix replies", async () => {
  runtime.pause = true;
  const first = assistant.runAssistantTurn("default", "hi");
  await assert.rejects(assistant.runAssistantTurn("default", "another"), /still working/);
  while (!runtime.pending.length) await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.starts.length, 1);
  runtime.pending.shift()();
  assert.equal((await first).reply, "ok");
  runtime.pause = false;
  assert.equal((await assistant.runAssistantTurn("default", "follow-up")).reply, "ok");
});

test("one-shot jobs queue behind a running one instead of failing: the digest and the mail button", async () => {
  runtime.pause = true;
  const digest = assistant.runAssistantTurn("mail", "scheduled digest");
  const button = assistant.runAssistantTurn("mail", "check mail now");
  while (!runtime.pending.length) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(runtime.prompts.map(prompt => prompt.message.split("\n").at(-1)), ["scheduled digest"]);
  runtime.pending.shift()();
  assert.equal((await digest).reply, "ok");
  while (!runtime.pending.length) await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.prompts.at(-1).message.split("\n").at(-1), "check mail now");
  runtime.pending.shift()();
  const second = await button;
  assert.equal(second.reply, "ok");
  assert.notEqual(second.sessionId, (await digest).sessionId);
  runtime.pause = false;
});

test("product conversations share rotation without unrelated time context, but a timed-out live run is not replaced", async () => {
  let id = null;
  const options = () => ({ remembered: id, remember: value => { id = value; },
    toolNames: ["product_get"], preamble: "PRODUCT PREAMBLE", message: "research", timeoutMs: 10 });
  await assistant.runScopedAssistantTurn(options());
  const first = id;
  await assistant.runScopedAssistantTurn(options());
  assert.equal(id, first);
  assert.doesNotMatch(runtime.prompts.at(-1).message, /PRODUCT PREAMBLE/);
  const old = Date.now() - lifecycle.ROBIN_IDLE_MS - 1000;
  lifecycle.recordRobinSessionActivity(id, runtime.files.get(id), old);
  utimesSync(runtime.files.get(id), old / 1000, old / 1000);
  runtime.pause = true;
  await assert.rejects(assistant.runScopedAssistantTurn(options()), /took too long/);
  assert.notEqual(id, first);
  assert.match(runtime.prompts.at(-1).message, /PRODUCT PREAMBLE/);
  assert.doesNotMatch(runtime.prompts.at(-1).message, /Robin clock/);
  await assert.rejects(assistant.runScopedAssistantTurn(options()), /still working/);
  runtime.pending.shift()();
});

test("monthly cleanup is persisted, bounded to registered old Robin files, and protects current/live sessions", async () => {
  const now = new Date("2026-09-01T00:05:00-07:00");
  const old = now.getTime() - lifecycle.ROBIN_RETENTION_MS - 1000;
  const expired = tracked("expired", old);
  const current = tracked("current", old); store.writeAssistantSessionId("current");
  const product = tracked("product", old); productState.writeProductAgentSessionId("product", "idea");
  const live = tracked("live", old); runtime.live.set("live", { isAlive: () => true });
  const recent = tracked("recent", now.getTime() - 1000);
  const boundary = tracked("boundary", now.getTime() - lifecycle.ROBIN_RETENTION_MS);
  const diskActive = tracked("disk-active", old); utimesSync(diskActive, now.getTime() / 1000, now.getTime() / 1000);
  const foreign = tracked("foreign", old, "/other/project");
  const untracked = transcript("untracked", old);
  const wrongId = tracked("wrong-id", old);
  writeFileSync(wrongId, JSON.stringify({ type: "session", id: "someone-else", cwd: data }));
  utimesSync(wrongId, old / 1000, old / 1000);
  const link = join(data, "symlink.jsonl"); symlinkSync(untracked, link);
  lifecycle.recordRobinSessionActivity("symlink", link, old);
  const missing = tracked("missing", old); rmSync(missing);
  const business = join(data, "todos.json"); writeFileSync(business, "[]\n");
  assert.equal(await lifecycle.cleanupRobinSessions(now), 1);
  assert.equal(existsSync(expired), false);
  for (const path of [current, product, live, recent, boundary, diskActive, foreign, untracked, wrongId, link, business]) {
    assert.equal(existsSync(path), true, path);
  }
  assert.equal(history().lastCleanupMonth, "2026-09");
  assert.equal(history().sessions.missing, undefined);
  assert.equal(runtime.listInvalidations, 1);
  const later = tracked("later", old);
  assert.equal(await lifecycle.cleanupRobinSessions(new Date("2026-09-30T23:00:00-07:00")), 0);
  assert.ok(existsSync(later), "same month never re-sweeps, even after another invocation/restart");
  assert.ok(await lifecycle.cleanupRobinSessions(new Date("2026-10-01T00:05:00-07:00")) >= 1);
  assert.equal(existsSync(later), false);
  assert.ok(existsSync(current));
  assert.ok(existsSync(product));
});

test("startup/month timer survives restart and a 31-day month without repeated sweeps", async t => {
  const now = at("2026-10-01T00:00:00-07:00");
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  t.after(() => {
    clearTimeout(globalThis.__robinCleanupTimer);
    delete globalThis.__robinCleanupTimer;
  });
  lifecycle.startRobinSessionCleanup();
  const timer = globalThis.__robinCleanupTimer;
  lifecycle.startRobinSessionCleanup();
  assert.equal(globalThis.__robinCleanupTimer, timer, "HMR cannot install a second timer");
  t.mock.timers.tick(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(history().lastCleanupMonth, "2026-10");
  const path = tracked("old-after-sweep", now - 60 * 86400_000);
  clearTimeout(globalThis.__robinCleanupTimer);
  delete globalThis.__robinCleanupTimer;
  lifecycle.startRobinSessionCleanup();
  t.mock.timers.tick(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(existsSync(path), "startup within the same month does not re-sweep");
  t.mock.timers.tick(2_147_483_647);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(existsSync(path), "Node's maximum timer delay is only an early wake");
  t.mock.timers.tick(at("2026-11-01T00:00:00-07:00") - Date.now());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(history().lastCleanupMonth, "2026-11");
  assert.equal(existsSync(path), false);
});

test("cleanup adopts known legacy pointers, never discovers/deletes unknown old sessions", async () => {
  const now = new Date();
  const path = transcript("legacy-current", now.getTime() - 60 * 86400_000);
  store.writeMentorSessionId("legacy-current");
  assert.equal(await lifecycle.cleanupRobinSessions(now), 0);
  assert.equal(history().sessions["legacy-current"].path, path);
  assert.ok(existsSync(path));
});
