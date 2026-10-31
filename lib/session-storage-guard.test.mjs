import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

const jiti = createJiti(import.meta.url);
const { assertSessionWritable, onSessionStorageFailure, sessionBranchWarning, sessionStorageFailure } = await jiti.import("./session-storage-guard.ts");
const { buildSessionContext } = await jiti.import("./session-reader.ts");
const user = (content) => ({ role: "user", content, timestamp: Date.now() });
const diskFull = () => Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
function fixture(t) {
  const dir = fs.mkdtempSync(join(tmpdir(), "pi-storage-guard-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return SessionManager.create(dir, dir);
}
function entries(path) { return fs.readFileSync(path, "utf8").trim().split("\n").map(JSON.parse); }
function mockFs(t, name, implementation) {
  const mock = t.mock.method(fs, name, implementation);
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  return mock;
}

test("normal provider errors and context edits retain their ancestors", (t) => {
  const sm = fixture(t);
  sm.appendModelChange("test", "model");
  assert.equal(fs.existsSync(sm.getSessionFile()), false, "metadata alone is not flushed");
  const first = sm.appendMessage(user("remember this"));
  const error = sm.appendMessage({ role: "assistant", content: [], stopReason: "error", errorMessage: "fetch failed", timestamp: Date.now() });
  sm.appendContextEdit(error, null);
  sm.appendMessage(user("continue"));
  const reopened = SessionManager.open(sm.getSessionFile());
  assert.equal(sessionBranchWarning(reopened.getEntries(), reopened.getLeafId()), undefined);
  assert.ok(reopened.getBranch().some((e) => e.id === first));
  assert.equal(reopened.buildSessionContext().messages.filter((m) => m.role === "user").length, 2);
});

test("failed append rolls back memory, stops subsequent writes and refuses a torn tail after reopen", (t) => {
  const sm = fixture(t);
  const first = sm.appendMessage(user("saved"));
  const before = sm.getEntries();
  let failures = 0;
  onSessionStorageFailure(sm, () => { failures++; });
  t.mock.method(sm, "_persist", function () {
    fs.appendFileSync(this.getSessionFile(), '{"type":"message","id":"torn');
    throw diskFull();
  });
  assert.throws(() => sm.appendMessage(user("not saved")), /Session save failed \(ENOSPC\)/);
  const bytes = fs.readFileSync(sm.getSessionFile());
  assert.equal(sm.getLeafId(), first);
  assert.deepEqual(sm.getEntries(), before);
  assert.equal(sm.getEntryCount(), before.length);
  assert.equal(sessionStorageFailure(sm)?.cause.code, "ENOSPC");
  for (const write of [
    () => sm.appendMessage(user("retry")),
    () => sm.appendCustomEntry("extension", {}),
    () => sm.appendThinkingLevelChange("high"),
    () => sm.appendLabelChange(first, "label"),
    () => sm._rewriteFile(),
  ]) assert.throws(write, /Further writes are blocked/);
  assert.equal(failures, 1);
  assert.deepEqual(fs.readFileSync(sm.getSessionFile()), bytes);
  const reopened = SessionManager.open(sm.getSessionFile());
  assert.equal(reopened.getLeafId(), first, "SDK history remains accessible");
  // SDK open adds a final newline even to a torn record; it does not repair its JSON.
  const afterOpen = fs.readFileSync(sm.getSessionFile());
  assert.deepEqual(afterOpen, Buffer.concat([bytes, Buffer.from("\n")]));
  assert.throws(() => reopened.appendMessage(user("must not join the torn line")), /invalid JSON record/);
  assert.deepEqual(fs.readFileSync(sm.getSessionFile()), afterOpen);
});

test("failed first flush publishes no partial session and keeps initial metadata", (t) => {
  const sm = fixture(t);
  const meta = sm.appendThinkingLevelChange("high");
  const original = fs.writeFileSync;
  mockFs(t, "writeFileSync", (path, data, options) => {
    if (String(path).endsWith(".tmp")) {
      original(path, String(data).slice(0, 30), options);
      throw diskFull();
    }
    return original(path, data, options);
  });
  assert.throws(() => sm.appendMessage(user("first")), /ENOSPC/);
  assert.equal(fs.existsSync(sm.getSessionFile()), false);
  assert.equal(sm.getLeafId(), meta);
  assert.equal(sm.getEntries().length, 1);
  assert.deepEqual(fs.readdirSync(sm.getSessionDir()), []);
});

test("first flush preserves exclusive-create semantics", (t) => {
  const sm = fixture(t);
  assertSessionWritable(sm); // The path was absent when the manager was admitted.
  const sentinel = "existing file owned by someone else\n";
  fs.writeFileSync(sm.getSessionFile(), sentinel);
  assert.throws(() => sm.appendMessage(user("collision")), /EEXIST/);
  assert.equal(fs.readFileSync(sm.getSessionFile(), "utf8"), sentinel);
  assert.equal(sm.getLeafId(), null);
});

test("failed rewrite leaves the previous file intact and latches the failure", (t) => {
  const sm = fixture(t);
  sm.appendMessage(user("saved"));
  const bytes = fs.readFileSync(sm.getSessionFile());
  mockFs(t, "renameSync", () => { throw diskFull(); });
  assert.throws(() => sm._rewriteFile(), /ENOSPC/);
  assert.deepEqual(fs.readFileSync(sm.getSessionFile()), bytes);
  assert.throws(() => sm.appendMessage(user("blocked")), /Further writes are blocked/);
  assert.equal(fs.readdirSync(sm.getSessionDir()).length, 1);
});

test("missing parents produce a read-only warning, no phantom pagination or automatic reparenting", async (t) => {
  const sm = fixture(t);
  const good = sm.appendMessage(user("old history"));
  const orphan = { type: "message", id: "orphan", parentId: "missing", timestamp: new Date().toISOString(), message: user("isolated") };
  fs.appendFileSync(sm.getSessionFile(), JSON.stringify(orphan) + "\n");
  const reopened = SessionManager.open(sm.getSessionFile());
  const bytes = fs.readFileSync(sm.getSessionFile());
  const context = buildSessionContext(reopened.getEntries(), reopened.getLeafId(), { tail: 50 });
  assert.match(context.integrityWarning, /entry missing is missing/);
  assert.equal(context.hasMore, false);
  assert.equal(context.messages.length, 1);
  assert.throws(() => assertSessionWritable(reopened), /disconnected/);
  assert.throws(() => reopened.appendMessage(user("unsafe")), /disconnected/);
  const { startRpcSession } = await jiti.import("./rpc-manager.ts");
  await assert.rejects(startRpcSession(reopened.getSessionId(), reopened.getSessionFile()), /disconnected/);
  assert.deepEqual(fs.readFileSync(sm.getSessionFile()), bytes);
  reopened.branch(good); // explicit recovery choice, not inferred from file order
  reopened.appendCustomEntry("recovered", { from: "orphan", checkpoint: good });
  assert.equal(sessionBranchWarning(reopened.getEntries(), reopened.getLeafId()), undefined);
  assert.equal(reopened.getEntry("orphan").parentId, "missing", "old history is never rewritten");
  assert.equal(reopened.buildSessionContext().messages[0].content, "old history");
});

test("multiple legitimate roots, branches and compaction remain valid; cycles terminate", (t) => {
  const sm = fixture(t);
  const first = sm.appendMessage(user("first"));
  sm.appendMessage(user("other branch"));
  sm.branch(first);
  const second = sm.appendMessage(user("chosen branch"));
  sm.appendCompaction("summary", second, 100);
  assertSessionWritable(sm);
  assert.ok(sm.buildSessionContext().messages.some((m) => m.role === "compactionSummary"));
  sm.resetLeaf();
  sm.appendMessage(user("independent root"));
  assertSessionWritable(sm);
  const cyclic = [
    { type: "message", id: "a", parentId: "b", message: user("a") },
    { type: "message", id: "b", parentId: "a", message: user("b") },
  ];
  assert.match(sessionBranchWarning(cyclic, "b"), /cycle/);
  const context = buildSessionContext(cyclic, "b", { tail: 50 });
  assert.match(context.integrityWarning, /cycle/);
  assert.equal(context.messages.length, 2);
  assert.equal(context.hasMore, false);
});

test("SDK terminates a valid final record before the guard permits new messages", (t) => {
  const sm = fixture(t);
  sm.appendMessage(user("saved"));
  const bytes = fs.readFileSync(sm.getSessionFile(), "utf8").trimEnd();
  fs.writeFileSync(sm.getSessionFile(), bytes);
  const reopened = SessionManager.open(sm.getSessionFile());
  reopened.appendMessage(user("new"));
  assert.equal(entries(sm.getSessionFile()).filter((e) => e.type === "message").length, 2);
  assert.ok(fs.readFileSync(sm.getSessionFile(), "utf8").startsWith(bytes + "\n"));
});

test("real SDK run stops on failed assistant persistence before executing its tools", async (t) => {
  const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
  const sm = fixture(t);
  const dir = sm.getCwd();
  const faux = fauxProvider({ models: [{ id: "storage-test" }] });
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir, agentDir: dir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: dir, agentDir: dir, sessionManager: sm, settingsManager, resourceLoader, modelRuntime,
    model: faux.getModel("storage-test"), tools: [],
  });
  const wrapper = new AgentSessionWrapper(session);
  t.after(() => wrapper.destroy());
  wrapper.start();
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  let requests = 0;
  faux.setResponses([
    () => { requests++; return fauxAssistantMessage([fauxToolCall("must_not_run", {})], { stopReason: "toolUse" }); },
    () => { requests++; return fauxAssistantMessage([fauxText("must not retry")]); },
  ]);
  const persist = sm._persist;
  t.mock.method(sm, "_persist", function (entry) {
    if (entry.type === "message" && entry.message.role === "assistant") throw diskFull();
    return persist.call(this, entry);
  });
  // SDK may propagate a storage exception or settle an aborted run; either way
  // it must settle promptly, without executing tools or requesting another reply.
  await session.prompt("test storage failure").catch((error) => assert.match(String(error), /Session save failed/));
  assert.equal(requests, 1);
  assert.equal(session.isStreaming, false);
  assert.ok(events.some((event) => event.type === "prompt_error" && /ENOSPC/.test(event.errorMessage)));
  assert.equal(events.some((event) => event.type === "tool_execution_start"), false);
  const reopened = SessionManager.open(sm.getSessionFile());
  assert.equal(sessionBranchWarning(reopened.getEntries(), reopened.getLeafId()), undefined);
  assert.ok(reopened.getBranch().some((entry) => entry.type === "message" && entry.message.role === "user"));
  assert.equal(reopened.getEntries().some((entry) => entry.type === "message" && entry.message.role === "assistant"), false);
});

test("write failure requests RPC abort, reports a notice and rejects another prompt", async (t) => {
  const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
  const sm = fixture(t);
  sm.appendMessage(user("saved"));
  let aborts = 0;
  const inner = {
    sessionManager: sm, sessionId: sm.getSessionId(), sessionFile: sm.getSessionFile(),
    isStreaming: false, isCompacting: false, isBashRunning: false,
    abort: async () => { aborts++; }, dispose() {},
  };
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  t.mock.method(sm, "_persist", () => { throw diskFull(); });
  assert.throws(() => sm.appendMessage(user("lost")), /ENOSPC/);
  assert.equal(aborts, 1);
  assert.ok(events.some((event) => event.type === "prompt_error" && /ENOSPC/.test(event.errorMessage)));
  await assert.rejects(wrapper.send({ type: "prompt", message: "no more tools" }), /Further writes are blocked/);
  assert.equal(entries(sm.getSessionFile()).filter((e) => e.type === "message").length, 1);
});
