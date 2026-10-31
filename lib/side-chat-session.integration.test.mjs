import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxProvider, fauxAssistantMessage, fauxText, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isSideChatSession, SIDE_CHAT_SESSION_ENTRY, SIDE_CHAT_SYSTEM_PROMPT, SIDE_CHAT_RESOURCE_LOADER_OPTIONS } = await jiti.import("./side-chat-session.ts");
const { sideChatPrompt } = await jiti.import("./side-chat.ts");

function marker(data = { version: 1 }) {
  return { type: "custom", customType: SIDE_CHAT_SESSION_ENTRY, data };
}

test("side-chat policy is explicit metadata, never inferred from quoted content; corrupt versions refuse", () => {
  assert.equal(isSideChatSession([]), false);
  assert.equal(isSideChatSession([{ type: "message", message: { role: "user", content: SIDE_CHAT_SESSION_ENTRY } }]), false);
  assert.equal(isSideChatSession([marker()]), true);
  for (const data of [null, {}, { version: 2 }, { version: "1" }]) {
    assert.throws(() => isSideChatSession([marker(), marker(data)]), /Invalid side chat/);
  }
});

test("side-chat explicitly stops paid warm-up without changing global cache settings", () => {
  const handlers = new Map();
  SIDE_CHAT_RESOURCE_LOADER_OPTIONS.extensionFactories[0]({ on: (name, fn) => handlers.set(name, fn) });
  assert.deepEqual(handlers.get("cache_warming_decision")({ action: "warm" }), { action: "stop" });
});

test("real RPC side chat keeps a small provider prompt on first turn, follow-up, reload and disk reopen", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-side-chat-"));
  const agentDir = join(dir, "agent");
  const cwd = join(dir, "project");
  await mkdir(agentDir);
  await mkdir(join(cwd, ".pi"), { recursive: true });
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const wrappers = new Set();
  t.after(async () => {
    for (const wrapper of wrappers) await wrapper.shutdown();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });
  const projectInstructions = "PROJECT_INSTRUCTIONS_NOT_FOR_EXPLANATIONS ".repeat(4000);
  await writeFile(join(cwd, "AGENTS.md"), projectInstructions);
  await writeFile(join(agentDir, "AGENTS.md"), "GLOBAL_INSTRUCTIONS_NOT_FOR_EXPLANATIONS");
  await writeFile(join(cwd, ".pi", "SYSTEM.md"), "PROJECT_SYSTEM_NOT_FOR_EXPLANATIONS");
  await writeFile(join(agentDir, "APPEND_SYSTEM.md"), "APPENDED_NOT_FOR_EXPLANATIONS");
  const settings = JSON.stringify({ cacheWarming: "idle", defaultTools: ["read", "bash", "write"] });
  await writeFile(join(agentDir, "settings.json"), settings);
  const { startRpcSession, setRpcSessionTools } = await jiti.import("./rpc-manager.ts");
  const faux = fauxProvider({ models: [{ id: "side-test" }] });
  const seed = sideChatPrompt({ selection: "idempotency", answer: "Retrying has the same effect.", question: "How do retries work?" }, "zh-CN");
  const requests = [];
  async function prepare(wrapper) {
    wrappers.add(wrapper);
    await wrapper.waitUntilReady();
    wrapper.inner.modelRuntime.registerNativeProvider(faux.provider);
    await wrapper.inner.setModel(faux.getModel("side-test"));
    wrapper.silenceCompletionNotifications();
  }
  async function prompt(wrapper, text) {
    faux.setResponses([(context) => {
      requests.push(context);
      return fauxAssistantMessage([fauxText("A focused explanation.")]);
    }]);
    await wrapper.inner.prompt(text);
    assert.equal(wrapper.inner.getLastAssistantText(), "A focused explanation.");
    const context = requests.at(-1);
    assert.equal(getCurrentSystemPrompt(context.messages), SIDE_CHAT_SYSTEM_PROMPT);
    assert.deepEqual(wrapper.inner.resourceLoader.getAgentsFiles().agentsFiles, []);
    assert.deepEqual(wrapper.inner.resourceLoader.getSkills().skills, []);
    assert.deepEqual(wrapper.inner.getActiveToolNames(), []);
    assert.doesNotMatch(JSON.stringify(context), /NOT_FOR_EXPLANATIONS|You are an expert coding assistant/);
    const users = context.messages.filter((m) => m.role === "user");
    assert.equal(users.filter((m) => JSON.stringify(m.content).includes("REFERENCE JSON:")).length, 1);
    assert.ok(JSON.stringify(users).includes("How do retries work?"));
  }
  // Even a caller supplying the preferred tools cannot enable tools for a side chat.
  const { session } = await startRpcSession("__new__side-profile", "", cwd, { sideChat: true, toolNames: ["write"] });
  await prepare(session);
  await prompt(session, seed);
  await prompt(session, "Another example?");
  assert.equal(requests.length, 2, "no summary, title, or extra model call");
  assert.equal((await session.send({ type: "get_state" })).systemPrompt, SIDE_CHAT_SYSTEM_PROMPT);
  await session.send({ type: "reload" });
  await prompt(session, "What about network retries?");
  await assert.rejects(setRpcSessionTools(session.sessionId, session.sessionFile, ["read"]), /Side chat tool selection is fixed/);
  await assert.rejects(session.send({ type: "set_tools", toolNames: ["write"], exact: true }), /Side chat tool selection is fixed/);
  const file = session.sessionFile;
  const id = session.sessionId;
  assert.ok(isSideChatSession(session.inner.sessionManager.getEntries()));
  await session.shutdown();
  await assert.rejects(setRpcSessionTools(id, file, undefined), /Side chat tool selection is fixed/);
  const reopened = await startRpcSession(id, file, undefined); // no browser policy hint
  await prepare(reopened.session);
  await prompt(reopened.session, "Explain it more simply.");
  assert.equal(requests.length, 4);
  assert.equal(await readFile(join(agentDir, "settings.json"), "utf8"), settings);

  // Ordinary Chat only keeps its documented project context behavior.
  const ordinary = await startRpcSession("__new__ordinary-chat-only", "", cwd, { toolNames: [] });
  wrappers.add(ordinary.session);
  await ordinary.session.waitUntilReady();
  const normalPrompt = (await ordinary.session.send({ type: "get_state" })).systemPrompt;
  assert.ok(normalPrompt.includes(projectInstructions));
  assert.ok(normalPrompt.includes("GLOBAL_INSTRUCTIONS_NOT_FOR_EXPLANATIONS"));
  assert.doesNotMatch(normalPrompt, /PROJECT_SYSTEM_NOT_FOR_EXPLANATIONS|APPENDED_NOT_FOR_EXPLANATIONS/);
  assert.ok(SIDE_CHAT_SYSTEM_PROMPT.length < normalPrompt.length / 100);
});
