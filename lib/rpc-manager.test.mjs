import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper, startRpcSession } = await jiti.import("./rpc-manager.ts");

test("RPC refuses a malformed subagent resource snapshot instead of reopening it as normal", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-corrupt-subagent-"));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  try {
    for (const parentSessionId of ["parent", null]) {
      const manager = SessionManager.create(root, sessionDir);
      manager.appendMessage({ role: "user", content: "delegated task", timestamp: Date.now() });
      manager.appendCustomEntry("pi-web:subagent", {
        version: 1,
        parentSessionId,
        parentSessionPath: "/tmp/parent.jsonl",
        parentToolCallId: "call",
        profile: "general-purpose",
        description: "corrupt",
        task: "task",
        runInBackground: false,
        createdAt: new Date().toISOString(),
        resourceSnapshot: {
          version: 1,
          appendSystemPrompt: [],
          tools: "read",
          loadSkills: false,
          loadExtensions: false,
        },
      });
      await assert.rejects(
        startRpcSession(manager.getSessionId(), manager.getSessionFile(), undefined),
        /Invalid subagent resource snapshot/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("normal sessions load the Read-only MCP policy with the built-ins", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  // The Read-only policy for MCP tools rides along with the MCP extension.
  assert.match(startupSource, /\.\.\.\(builtins\?\.extensions \?\? \[\]\),\s*createReadOnlyMcpPolicyExtension\(\),/);
});

test("fork_branch copies the selected assistant entry without replacing the source session", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-quoted-branch-"));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  const manager = SessionManager.create(root, sessionDir);
  manager.appendMessage({ role: "user", content: "source prompt", timestamp: Date.now() });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "selected response" }],
    api: "test",
    provider: "test",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  const selectedEntryId = manager.getLeafId();
  const sourceFile = manager.getSessionFile();
  let forkedFile;
  let disposed = false;
  const wrapper = new AgentSessionWrapper({
    sessionId: manager.getSessionId(),
    sessionFile: sourceFile,
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    extensionRunner: {},
    agent: { state: {} },
    dispose() { disposed = true; },
  });

  try {
    const result = await wrapper.send({ type: "fork_branch", entryId: selectedEntryId });
    const sessions = await SessionManager.list(root, sessionDir);
    const forkedInfo = sessions.find((session) => session.id === result.newSessionId);
    assert.ok(forkedInfo);
    forkedFile = forkedInfo.path;
    assert.equal(SessionManager.open(forkedFile, sessionDir).getLeafId(), selectedEntryId);
    assert.equal(manager.getLeafId(), selectedEntryId);
    assert.equal(disposed, false);
  } finally {
    wrapper.destroy();
    if (forkedFile) await unlink(forkedFile);
    if (sourceFile) await unlink(sourceFile);
    await rmdir(sessionDir);
    await rmdir(root);
  }
});

test("fork before the first message persists a reopenable message-free child session", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-root-fork-"));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  const manager = SessionManager.create(root, sessionDir);
  const settingsEntryId = manager.appendModelChange("test", "test-model");
  const firstEntryId = manager.appendMessage({ role: "user", content: "source prompt", timestamp: Date.now() });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "source response" }],
    api: "test",
    provider: "test",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  const sourceFile = manager.getSessionFile();
  let forkedFile;
  const wrapper = new AgentSessionWrapper({
    sessionId: manager.getSessionId(),
    sessionFile: sourceFile,
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    extensionRunner: { emit: async () => {} },
    agent: { state: {} },
    dispose() {},
  });

  try {
    const result = await wrapper.send({ type: "fork", entryId: firstEntryId });
    const sessions = await SessionManager.list(root, sessionDir);
    const forkedInfo = sessions.find((session) => session.id === result.newSessionId);
    assert.ok(forkedInfo);
    forkedFile = forkedInfo.path;

    const forked = SessionManager.open(forkedFile, sessionDir);
    assert.equal(forked.getHeader().parentSession, sourceFile);
    assert.equal(forked.getLeafId(), settingsEntryId);
    assert.deepEqual(forked.getEntries(), [manager.getEntry(settingsEntryId)]);
  } finally {
    wrapper.destroy();
    if (forkedFile) await unlink(forkedFile);
    if (sourceFile) await unlink(sourceFile);
    await rmdir(sessionDir);
    await rmdir(root);
  }
});

function assistantFixture(text) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "test",
    provider: "test",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

test("fork and fork_branch copy finished entries while the source keeps running", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-running-fork-"));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  const manager = SessionManager.create(root, sessionDir);
  const firstUserId = manager.appendMessage({ role: "user", content: "first prompt", timestamp: Date.now() });
  const firstAssistantId = manager.appendMessage(assistantFixture("first response"));
  // The turn the agent is still running: its user message is already on disk.
  const runningUserId = manager.appendMessage({ role: "user", content: "running prompt", timestamp: Date.now() });
  const sourceFile = manager.getSessionFile();
  const sourceBefore = await readFile(sourceFile, "utf8");
  const forkedFiles = [];
  let disposed = false;
  let shutdownEvents = 0;
  const wrapper = new AgentSessionWrapper({
    sessionId: manager.getSessionId(),
    sessionFile: sourceFile,
    sessionManager: manager,
    isStreaming: true,
    isCompacting: false,
    isBashRunning: false,
    extensionRunner: { emit: async () => { shutdownEvents += 1; } },
    agent: { state: {} },
    dispose() { disposed = true; },
  });

  try {
    const forked = await wrapper.send({ type: "fork", entryId: runningUserId });
    const branched = await wrapper.send({ type: "fork_branch", entryId: firstAssistantId });
    const sessions = await SessionManager.list(root, sessionDir);
    for (const result of [forked, branched]) {
      const info = sessions.find((session) => session.id === result.newSessionId);
      assert.ok(info);
      forkedFiles.push(info.path);
      const child = SessionManager.open(info.path, sessionDir);
      assert.equal(child.getHeader().parentSession, sourceFile);
      assert.equal(child.getLeafId(), firstAssistantId);
      assert.deepEqual(child.getEntries().map((entry) => entry.id), [firstUserId, firstAssistantId]);
    }

    assert.equal(wrapper.isAlive(), true);
    assert.equal(disposed, false);
    assert.equal(shutdownEvents, 0);
    assert.equal(manager.getLeafId(), runningUserId);
    assert.equal(await readFile(sourceFile, "utf8"), sourceBefore);
  } finally {
    wrapper.destroy();
    for (const file of forkedFiles) await unlink(file);
    await unlink(sourceFile);
    await rmdir(sessionDir);
    await rmdir(root);
  }
});

test("fork refuses a running shell command and a source not yet written to disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-unsaved-fork-"));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  const manager = SessionManager.create(root, sessionDir);
  manager.appendModelChange("test", "test-model");
  // pi 0.99 writes the file at the first user message. Remove it to exercise
  // the missing-on-disk error without relying on the old flush behavior.
  const userId = manager.appendMessage({ role: "user", content: "first prompt", timestamp: Date.now() });
  const sourceFile = manager.getSessionFile();
  await unlink(sourceFile);
  const inner = {
    sessionId: manager.getSessionId(),
    sessionFile: manager.getSessionFile(),
    sessionManager: manager,
    isStreaming: true,
    isCompacting: false,
    isBashRunning: true,
    extensionRunner: {},
    agent: { state: {} },
    dispose() {},
  };
  const wrapper = new AgentSessionWrapper(inner);

  try {
    await assert.rejects(
      wrapper.send({ type: "fork", entryId: userId }),
      /Cannot fork while a shell command is running/,
    );
    await assert.rejects(
      wrapper.send({ type: "fork_branch", entryId: userId }),
      /Cannot fork while a shell command is running/,
    );

    inner.isBashRunning = false;
    await assert.rejects(
      wrapper.send({ type: "fork", entryId: userId }),
      /has not been saved yet/,
    );
    await assert.rejects(
      wrapper.send({ type: "fork_branch", entryId: userId }),
      /has not been saved yet/,
    );
    assert.equal(wrapper.isAlive(), true);
    assert.deepEqual(await readdir(sessionDir), []);
  } finally {
    wrapper.destroy();
    await rm(root, { recursive: true, force: true });
  }
});

test("session replacement rejects active work and clone writes one reopenable child", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-clone-"));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  const manager = SessionManager.create(root, sessionDir);
  manager.appendMessage({ role: "user", content: "clone fixture", timestamp: Date.now() });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "fixture response" }],
    api: "test",
    provider: "test",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  const cloneLeafId = manager.getLeafId();
  manager.appendSessionInfo("source-only metadata");

  const sourceFile = manager.getSessionFile();
  let clonedFile;
  let releaseModelRefresh;
  let signalModelRefresh;
  const modelRefreshStarted = new Promise((resolve) => { signalModelRefresh = resolve; });
  const modelRefreshHeld = new Promise((resolve) => { releaseModelRefresh = resolve; });
  let releaseShutdown;
  let signalShutdown;
  const shutdownStarted = new Promise((resolve) => { signalShutdown = resolve; });
  const shutdownHeld = new Promise((resolve) => { releaseShutdown = resolve; });
  let finishPrompt;
  const wrapper = new AgentSessionWrapper({
    sessionId: manager.getSessionId(),
    sessionFile: sourceFile,
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    prompt: (_message, options) => new Promise((resolve) => {
      finishPrompt = resolve;
      options.preflightResult?.("started");
    }),
    modelRuntime: {
      getModel: () => undefined,
      refresh: async () => {
        signalModelRefresh();
        await modelRefreshHeld;
      },
    },
    extensionRunner: {
      emit: async () => {
        signalShutdown();
        await shutdownHeld;
        throw new Error("fixture shutdown failure");
      },
    },
    agent: { state: {} },
    dispose() {},
  });

  try {
    const modelChange = wrapper.send({ type: "set_model", provider: "test", modelId: "missing" });
    await modelRefreshStarted;
    await assert.rejects(
      wrapper.send({ type: "clone" }),
      /Cannot clone while another session command is running/,
    );
    releaseModelRefresh();
    await assert.rejects(modelChange, /Model not found/);

    await wrapper.send({ type: "prompt", message: "keep this run active" });
    await assert.rejects(
      wrapper.send({ type: "clone", leafId: cloneLeafId }),
      /Cannot clone while the session is running/,
    );
    assert.ok(finishPrompt);
    finishPrompt();
    await new Promise((resolve) => setImmediate(resolve));

    const firstClone = wrapper.send({ type: "clone", leafId: cloneLeafId });
    await shutdownStarted;
    await assert.rejects(
      wrapper.send({ type: "clone" }),
      /Session is being copied to a new session/,
    );
    let shutdownErrorLog = "";
    const originalConsoleError = console.error;
    console.error = (...args) => { shutdownErrorLog = args.join(" "); };
    let result;
    try {
      releaseShutdown();
      result = await firstClone;
    } finally {
      console.error = originalConsoleError;
    }
    assert.match(shutdownErrorLog, /clone succeeded, but source session shutdown failed/);

    const sessions = await SessionManager.list(root, sessionDir);
    const clonedInfo = sessions.find((session) => session.id === result.newSessionId);
    assert.ok(clonedInfo);
    clonedFile = clonedInfo.path;

    const cloned = SessionManager.open(clonedFile, sessionDir);
    assert.equal(cloned.getHeader().parentSession, sourceFile);
    assert.equal(cloned.getLeafId(), cloneLeafId);
    assert.deepEqual(cloned.buildSessionContext().messages, manager.buildSessionContext().messages);
  } finally {
    wrapper.destroy();
    if (clonedFile) await unlink(clonedFile);
    if (sourceFile) await unlink(sourceFile);
    await rmdir(sessionDir);
    await rmdir(root);
  }
});

test("cancelled session replacement releases its lock", async () => {
  const manager = SessionManager.inMemory(tmpdir());
  let autoRetryEnabled = false;
  const wrapper = new AgentSessionWrapper({
    sessionId: manager.getSessionId(),
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    setAutoRetryEnabled: (enabled) => { autoRetryEnabled = enabled; },
    extensionRunner: {},
    agent: { state: {} },
    dispose() {},
  });

  try {
    assert.deepEqual(await wrapper.send({ type: "fork", entryId: "missing" }), { cancelled: true });
    await wrapper.send({ type: "set_auto_retry", enabled: true });
    assert.equal(autoRetryEnabled, true);
  } finally {
    wrapper.destroy();
  }
});

test("clone cancels an assistant-free branch without creating a file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-clone-empty-"));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  const manager = SessionManager.create(root, sessionDir);
  manager.appendMessage({ role: "user", content: "no assistant yet", timestamp: Date.now() });
  const sourceFile = manager.getSessionFile();
  const wrapper = new AgentSessionWrapper({
    sessionId: manager.getSessionId(),
    sessionFile: sourceFile,
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    extensionRunner: { emit: async () => {} },
    agent: { state: {} },
    dispose() {},
  });

  try {
    assert.deepEqual(await wrapper.send({ type: "clone" }), { cancelled: true });
    // Since pi 0.99 the first user message already creates the source file.
    assert.deepEqual((await SessionManager.list(root, sessionDir)).map((session) => session.path), [sourceFile]);
  } finally {
    wrapper.destroy();
    await rm(root, { recursive: true, force: true });
  }
});

test("new-session route applies model scope during construction instead of follow-up commands", async () => {
  const source = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");

  assert.match(source, /initialModel: \{ provider, modelId \}/);
  assert.match(source, /thinkingLevel: explicitThinkingLevel/);
  assert.doesNotMatch(source, /session\.send\(\{ type: "set_model"/);
  assert.doesNotMatch(source, /session\.send\(\{ type: "set_thinking_level"/);
  assert.match(source, /model: state\.model/);
  assert.match(source, /thinkingLevel: state\.thinkingLevel/);
});

test("prompt routes mark only preflight failures as rejected", async () => {
  const existingRoute = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const newRoute = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");

  for (const source of [existingRoute, newRoute]) {
    assert.match(source, /let promptAccepted = false/);
    assert.match(source, /await .*\.send\(/);
    assert.match(source, /promptAccepted = .*\.type === "prompt"/);
    assert.match(source, /commandType === "prompt" && !promptAccepted/);
  }
});

test("Robin sessions keep their declared tool allow-lists exact", async () => {
  const managerSource = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  // The session machinery lives here, not in the route: the scoring runner
  // drives a turn directly rather than making pi-web call its own HTTP API.
  const assistantSource = await readFile(new URL("./robin-assistant.ts", import.meta.url), "utf8");

  // Upstream routes set_tools through setActiveToolSelection(), which always
  // unions in the extension tools. The exact path has to stay clear of it.
  assert.match(managerSource, /if \(command\.exact === true\)/);
  assert.doesNotMatch(
    managerSource.slice(
      managerSource.indexOf("if (command.exact === true)"),
      managerSource.indexOf("} else {", managerSource.indexOf("if (command.exact === true)")),
    ),
    /withExtensionTools/,
  );
  assert.match(managerSource, /exactTools && selectedToolNames\s*\? selectedToolNames\s*: resolveActiveToolNames/);
  assert.match(managerSource, /toolsOption = exactTools \? selectedToolNames/);
  assert.match(managerSource, /exactTools \? \{ excludeTools: \["mcp__\*"\] \}/);
  assert.match(managerSource, /const builtins = subagentResources \|\| chatOnly \|\| exactTools/);
  // Robin allow-lists name extension tools, so they must bypass the normal
  // session selector's built-in-only validation and persistence.
  assert.match(managerSource, /exactTools[\s\S]*?new Set\(options\.toolNames\)[\s\S]*?validateSessionToolSelection/);
  assert.match(managerSource, /const persistedToolNames = subagentResources \|\| exactTools/);
  assert.match(managerSource, /!subagentResources && !exactTools && persistedToolNames === undefined/);
  assert.match(assistantSource, /exactTools: true/);
  assert.equal((assistantSource.match(/exact: true/g) ?? []).length, 2);
});

test("the scoring turn can never hold a tool that writes anything but a score", async () => {
  // The one turn that reads employer-authored text is the one turn that must
  // not be able to act on it. Pinned here because the tool list is easy to
  // extend by habit and this is the only thing that would notice.
  const source = await readFile(new URL("../extension/robin/tools.ts", import.meta.url), "utf8");
  const scoring = source.slice(source.indexOf("ROBIN_SCORING_TOOL_NAMES"));
  const names = [...scoring.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);

  assert.deepEqual(names, ["job_profile", "job_pending", "job_score"]);
  for (const forbidden of ["todo_add", "link_add", "calendar_create_event", "job_scan", "job_status"]) {
    assert.ok(!names.includes(forbidden), `${forbidden} must stay out of the scoring tool set`);
  }
});

test("exact prompts are sent through before_agent_start instead of the SDK prompt state", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const subagentSource = await readFile(new URL("./subagent-runtime.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));
  const promptSource = source.slice(
    source.indexOf('case "prompt"'),
    source.indexOf('case "abort"'),
  );

  // Pi 0.86 replays agent.state.systemPrompt from the transcript: assigning it throws,
  // and the loop's request context no longer carries a systemPrompt field.
  assert.doesNotMatch(source, /state\.systemPrompt =/);
  assert.doesNotMatch(source, /prepareNextTurnWithContext/);
  assert.doesNotMatch(subagentSource, /state\.systemPrompt =/);
  assert.match(startupSource, /const exactSystemPromptExtension = createExactSystemPromptExtension\(\(\) => exactSystemPromptRef\.current\?\.\(\)\)/);
  assert.match(startupSource, /exactSystemPromptRef\.current = exactSystemPrompt;/);
  assert.match(startupSource, /\{ \.\.\.CHAT_ONLY_RESOURCE_LOADER_OPTIONS, extensionFactories: \[exactSystemPromptExtension\] \}/);
  assert.match(startupSource, /createSubagentSkillsBinding\(\{/);
  assert.match(startupSource, /skillsBinding\?\.loaderOptions\.extensionFactories/);
  assert.match(subagentSource, /exactSystemPrompt: promptPlan\.exactSystemPrompt/);
  assert.match(subagentSource, /skillsBinding\.loaderOptions\.extensionFactories/);
  assert.match(promptSource, /preflightResult: \(\) => acceptPreflight\(\)/);
  assert.doesNotMatch(promptSource, /requestedToolNames/);
});

test("RPC session startup persists explicit preferences without replaying setters", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /const trustReloadOptions = subagentResources[\s\S]*?subagentLoadsResources[\s\S]*?projectTrustReloadOptions\(sessionCwd, agentDir\)/);
});
