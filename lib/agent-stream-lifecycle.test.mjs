import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { graceOutcome, isGraceCheckStale } = await jiti.import("./agent-stream-lifecycle.ts");

test("closes the stream once the server reports nothing running", () => {
  assert.deepEqual(graceOutcome({ running: false, state: null }), { kind: "close" });
  assert.deepEqual(graceOutcome({}), { kind: "close" });
});

test("closes the stream when a live wrapper is idle", () => {
  assert.deepEqual(
    graceOutcome({ running: true, state: { isStreaming: false, isPromptRunning: false } }),
    { kind: "close" },
  );
});

test("reattaches to a model that is still streaming", () => {
  assert.deepEqual(graceOutcome({ running: true, state: { isStreaming: true } }), {
    kind: "adopt",
    sdkAgentActive: true,
    rpcPromptPending: false,
    phase: "waiting_model",
  });
});

test("reattaches to a slash command as a running command, not a waiting model", () => {
  assert.deepEqual(graceOutcome({ running: true, state: { isPromptRunning: true } }), {
    kind: "adopt",
    sdkAgentActive: false,
    rpcPromptPending: true,
    phase: "running_command",
  });
});

test("a streaming model outranks a running prompt when both are reported", () => {
  const outcome = graceOutcome({ running: true, state: { isStreaming: true, isPromptRunning: true } });
  assert.equal(outcome.kind, "adopt");
  assert.equal(outcome.phase, "waiting_model");
  assert.equal(outcome.sdkAgentActive, true);
  assert.equal(outcome.rpcPromptPending, true);
});

test("an unreadable server keeps the stream alive instead of closing it", () => {
  assert.deepEqual(graceOutcome(null), { kind: "poll", reason: "unverified" });
});

test("keeps polling while the server is compacting, and says so", () => {
  assert.deepEqual(graceOutcome({ running: true, state: { isCompacting: true } }), {
    kind: "poll",
    reason: "compacting",
  });
});

test("a compacting flag on a dead wrapper still closes the stream", () => {
  // `running: false` means the wrapper is gone; a stale isCompacting on its last
  // reported state must not hold the stream open forever.
  assert.deepEqual(graceOutcome({ running: false, state: { isCompacting: true } }), { kind: "close" });
});

test("streaming wins over compacting so a compaction indicator cannot mask a live run", () => {
  const outcome = graceOutcome({ running: true, state: { isStreaming: true, isCompacting: true } });
  assert.equal(outcome.kind, "adopt");
});

const fresh = {
  generation: 4,
  currentGeneration: 4,
  sessionId: "s1",
  currentSessionId: "s1",
  graceActive: true,
};

test("a current grace check is allowed to act", () => {
  assert.equal(isGraceCheckStale(fresh), false);
});

test("a newer run supersedes a scheduled grace check", () => {
  assert.equal(isGraceCheckStale({ ...fresh, currentGeneration: 5 }), true);
});

test("switching sessions abandons a grace check for the previous one", () => {
  assert.equal(isGraceCheckStale({ ...fresh, currentSessionId: "s2" }), true);
  assert.equal(isGraceCheckStale({ ...fresh, currentSessionId: null }), true);
});

test("a resolved grace period abandons its own pending check", () => {
  assert.equal(isGraceCheckStale({ ...fresh, graceActive: false }), true);
});

const { agentLifecycleTransition } = await jiti.import("./agent-stream-lifecycle.ts");

const idle = {
  agentRunning: false,
  sdkAgentActive: false,
  rpcPromptPending: false,
  notifiedRunId: -1,
  promptRunId: 0,
};
const streaming = { ...idle, agentRunning: true, sdkAgentActive: true };

test("agent_start cancels a pending close and shows a waiting model", () => {
  const { next, effects } = agentLifecycleTransition("agent_start", idle);
  assert.deepEqual(effects, ["cancel-grace", "enter-waiting-model", "stream-start"]);
  assert.equal(next.agentRunning, true);
  assert.equal(next.sdkAgentActive, true);
});

test("agent_end ends the visible stream but never settles the turn", () => {
  const { next, effects } = agentLifecycleTransition("agent_end", streaming);
  assert.deepEqual(effects, ["clear-phase", "clear-retry", "stream-end", "reload-session", "reload-agent-state"]);
  // The turn stays running: one prompt can emit several agent_end events before
  // it retries or compacts, and closing here would cut the stream mid-turn.
  assert.equal(next.agentRunning, true);
  assert.equal(next.sdkAgentActive, true);
});

test("agent_end never closes the stream or notifies completion", () => {
  const { effects } = agentLifecycleTransition("agent_end", streaming);
  assert.equal(effects.includes("schedule-close"), false);
  assert.equal(effects.includes("settle-ui"), false);
  assert.equal(effects.includes("notify-agent-end"), false);
});

test("an agent_end arriving after the turn settled is ignored", () => {
  const { next, effects } = agentLifecycleTransition("agent_end", idle);
  assert.deepEqual(effects, []);
  assert.deepEqual(next, idle);
});

test("agent_settled settles the turn, closes the stream and notifies once", () => {
  const { next, effects } = agentLifecycleTransition("agent_settled", streaming);
  assert.deepEqual(effects, [
    "settle-ui",
    "clear-compacting",
    "reload-session",
    "schedule-close",
    "notify-agent-end",
  ]);
  assert.equal(next.agentRunning, false);
  assert.equal(next.sdkAgentActive, false);
});

test("agent_settled yields to a prompt command that is still running", () => {
  const state = { ...streaming, rpcPromptPending: true };
  const { next, effects } = agentLifecycleTransition("agent_settled", state);
  // prompt_done owns the completion transition in this case.
  assert.deepEqual(effects, []);
  assert.equal(next.sdkAgentActive, false, "the agent loop is still marked finished");
  assert.equal(next.agentRunning, true, "but the turn is not settled here");
});

test("agent_settled without an active agent loop does nothing", () => {
  const { effects } = agentLifecycleTransition("agent_settled", { ...idle, agentRunning: true });
  assert.deepEqual(effects, []);
});

test("agent_settled does not notify a turn the UI was not showing as running", () => {
  const { effects } = agentLifecycleTransition("agent_settled", { ...idle, sdkAgentActive: true });
  assert.equal(effects.includes("notify-agent-end"), false);
  assert.equal(effects.includes("schedule-close"), true);
});

test("prompt_done settles a slash command and announces it once", () => {
  const state = { ...idle, agentRunning: true, rpcPromptPending: true, notifiedRunId: -1, promptRunId: 7 };
  const { next, effects } = agentLifecycleTransition("prompt_done", state);
  assert.deepEqual(effects, [
    "clear-optimistic-user-message",
    "notify-agent-end",
    "reload-session",
    "settle-ui",
    "schedule-close",
  ]);
  assert.equal(next.rpcPromptPending, false);
  assert.equal(next.agentRunning, false);
  assert.equal(next.notifiedRunId, 7);
});

test("a repeated prompt_done for the same run is not announced twice", () => {
  const state = { ...idle, rpcPromptPending: false, notifiedRunId: 7, promptRunId: 7 };
  const { effects } = agentLifecycleTransition("prompt_done", state);
  assert.deepEqual(effects, ["clear-optimistic-user-message"]);
});

test("prompt_done keeps an extension-injected agent visible instead of settling it", () => {
  // The command finished but an extension already started an agent turn; its
  // own agent_settled performs the next transition.
  const state = { ...idle, agentRunning: true, sdkAgentActive: true, rpcPromptPending: true, promptRunId: 3 };
  const { next, effects } = agentLifecycleTransition("prompt_done", state);
  assert.equal(effects.includes("settle-ui"), false);
  assert.equal(effects.includes("schedule-close"), false);
  assert.equal(effects.includes("reload-session"), true);
  assert.equal(next.agentRunning, true);
});

test("a prompt_done for a new run still settles even when nothing was pending", () => {
  const state = { ...idle, agentRunning: true, notifiedRunId: 1, promptRunId: 2 };
  const { effects } = agentLifecycleTransition("prompt_done", state);
  assert.equal(effects.includes("notify-agent-end"), true);
  assert.equal(effects.includes("settle-ui"), true);
});

test("prompt_done always clears the optimistic user message", () => {
  for (const state of [idle, streaming, { ...streaming, rpcPromptPending: true }]) {
    assert.equal(
      agentLifecycleTransition("prompt_done", state).effects[0],
      "clear-optimistic-user-message",
    );
  }
});

test("no transition mutates the state it was given", () => {
  const state = { ...streaming, rpcPromptPending: true, promptRunId: 5 };
  const before = { ...state };
  for (const event of ["agent_start", "agent_end", "agent_settled", "prompt_done"]) {
    agentLifecycleTransition(event, state);
  }
  assert.deepEqual(state, before);
});

/* ───────── the state-only events ───────── */

const move = (event, state = idle) => agentLifecycleTransition(event, state);

test("a state event carries no effects — the hook's UI code stays where it is", () => {
  for (const event of [
    { type: "prompt_sending" },
    { type: "prompt_started", runId: 3 },
    { type: "prompt_rejected" },
    { type: "prompt_abandoned" },
    { type: "prompt_settled" },
    { type: "stream_connected" },
    { type: "adopted", sdkAgentActive: true, rpcPromptPending: false },
    { type: "settled" },
    { type: "notified", runId: 1 },
    { type: "ui_running_changed", running: true },
  ]) {
    assert.deepEqual(move(event).effects, [], event.type);
  }
});

test("a prompt is pending on the server before it is the run in flight", () => {
  const sending = move({ type: "prompt_sending" }).next;
  assert.equal(sending.rpcPromptPending, true);
  // Not running yet: the server has not accepted it.
  assert.equal(sending.agentRunning, false);
  assert.equal(sending.promptRunId, idle.promptRunId);

  const started = move({ type: "prompt_started", runId: 7 }, sending).next;
  assert.equal(started.promptRunId, 7);
  assert.equal(started.agentRunning, true);
  assert.equal(started.rpcPromptPending, true);
});

test("a refused send clears only the server-side pending flag", () => {
  const sending = move({ type: "prompt_sending" }, streaming).next;
  const rejected = move({ type: "prompt_rejected" }, sending).next;
  assert.equal(rejected.rpcPromptPending, false);
  // The stream is a separate fact; a refused send does not end it.
  assert.equal(rejected.sdkAgentActive, true);
  assert.equal(rejected.agentRunning, true);
});

test("abandoning a send stops showing the turn without touching the server flags", () => {
  const abandoned = move({ type: "prompt_abandoned" }, { ...streaming, rpcPromptPending: true }).next;
  assert.equal(abandoned.agentRunning, false);
  assert.equal(abandoned.rpcPromptPending, true);
  assert.equal(abandoned.sdkAgentActive, true);
});

test("a settled run clears both server-side flags at once", () => {
  const settled = move({ type: "prompt_settled" }, { ...streaming, rpcPromptPending: true }).next;
  assert.equal(settled.rpcPromptPending, false);
  assert.equal(settled.sdkAgentActive, false);
});

test("adopting server state takes both flags from the server, not from a guess", () => {
  const adopted = move({ type: "adopted", sdkAgentActive: false, rpcPromptPending: true }).next;
  assert.equal(adopted.sdkAgentActive, false);
  assert.equal(adopted.rpcPromptPending, true);
  // Whatever the server reports, something is live, so the turn is shown.
  assert.equal(adopted.agentRunning, true);
});

test("a run's completion is announced once", () => {
  const first = move({ type: "notified", runId: 4 }).next;
  assert.equal(first.notifiedRunId, 4);
  // The same id again is not a change, so a caller comparing identity can skip.
  assert.equal(move({ type: "notified", runId: 4 }, first).next, first);
  assert.equal(move({ type: "notified", runId: 5 }, first).next.notifiedRunId, 5);
});

test("mirroring the rendered flag is a no-op when it already agrees", () => {
  assert.equal(move({ type: "ui_running_changed", running: false }, idle).next, idle);
  assert.equal(move({ type: "ui_running_changed", running: true }, idle).next.agentRunning, true);
});

test("a state event never disturbs the run ids it does not name", () => {
  const busy = { ...streaming, promptRunId: 9, notifiedRunId: 8 };
  for (const event of [
    { type: "prompt_sending" }, { type: "prompt_rejected" }, { type: "prompt_abandoned" },
    { type: "prompt_settled" }, { type: "stream_connected" }, { type: "settled" },
    { type: "adopted", sdkAgentActive: true, rpcPromptPending: true },
  ]) {
    const { next } = move(event, busy);
    assert.equal(next.promptRunId, 9, event.type);
    assert.equal(next.notifiedRunId, 8, event.type);
  }
});
