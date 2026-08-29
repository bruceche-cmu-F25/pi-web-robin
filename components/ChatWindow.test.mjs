import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ChatWindow, chatTailView, phaseLabel } = await jiti.import("./ChatWindow.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const idle = { isStreaming: false, streamingContentLength: 0, agentRunning: false, hasPhase: false };

test("shows nothing after the last message while the agent is idle", () => {
  assert.equal(chatTailView(idle), "idle");
});

test("shows the phase indicator once a turn starts with no content yet", () => {
  assert.equal(chatTailView({ ...idle, agentRunning: true, hasPhase: true }), "phase");
});

test("the streamed partial replaces the phase indicator, never joins it", () => {
  const view = chatTailView({
    isStreaming: true,
    streamingContentLength: 12,
    agentRunning: true,
    hasPhase: true,
  });
  assert.equal(view, "streaming-message");
});

test("an empty partial still shows the phase rather than a blank bubble", () => {
  assert.equal(
    chatTailView({ isStreaming: true, streamingContentLength: 0, agentRunning: true, hasPhase: true }),
    "phase",
  );
});

test("a running turn with no phase shows nothing rather than an empty line", () => {
  assert.equal(chatTailView({ ...idle, agentRunning: true, hasPhase: false }), "idle");
});

test("a leftover partial suppresses the phase indicator even once streaming stops", () => {
  // isStreaming has already flipped false but the reducer still holds content.
  // Showing the phase here would put a "waiting" line under visible text.
  assert.equal(
    chatTailView({ isStreaming: false, streamingContentLength: 8, agentRunning: true, hasPhase: true }),
    "idle",
  );
});

test("content that arrives after the turn stopped is still rendered", () => {
  // isStreaming is the reducer's own flag; a finished agentRunning must not
  // blank out a partial the reducer still owns.
  assert.equal(
    chatTailView({ isStreaming: true, streamingContentLength: 5, agentRunning: false, hasPhase: false }),
    "streaming-message",
  );
});

const t = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);

test("names the single tool that is running", () => {
  const label = phaseLabel({ kind: "running_tools", tools: [{ id: "1", name: "Read" }] }, t);
  assert.match(label, /chat\.runningNamedTool/);
  assert.match(label, /Read/);
});

test("a tool reporting progress shows it alongside the tool name", () => {
  const label = phaseLabel(
    { kind: "running_tools", tools: [{ id: "1", name: "Bash", progress: "42%" }] },
    t,
  );
  assert.match(label, /Bash/);
  assert.match(label, /42%/);
});

test("progress from the latest tool wins over earlier ones", () => {
  const label = phaseLabel({
    kind: "running_tools",
    tools: [{ id: "1", name: "Read", progress: "old" }, { id: "2", name: "Bash", progress: "new" }],
  }, t);
  assert.match(label, /new/);
  assert.doesNotMatch(label, /old/);
});

test("up to three tools are listed and more are summarised as a count", () => {
  const tools = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i), name: `T${i}` }));
  assert.match(phaseLabel({ kind: "running_tools", tools: tools(3) }, t), /chat\.runningTools:/);
  const many = phaseLabel({ kind: "running_tools", tools: tools(5) }, t);
  assert.match(many, /chat\.runningToolsMore/);
  assert.match(many, /"count":3/);
});

test("a tool phase with no tools falls back to the generic label", () => {
  assert.equal(phaseLabel({ kind: "running_tools", tools: [] }, t), "chat.runningTool");
});

test("the model and command phases have their own labels, and idle has none", () => {
  assert.equal(phaseLabel({ kind: "waiting_model" }, t), "chat.waitingModel");
  assert.equal(phaseLabel({ kind: "running_command" }, t), "chat.runningCommand");
  assert.equal(phaseLabel(null, t), null);
});

function render(props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatWindow, { session: null, sessionRunning: false, ...props }),
    ),
  );
}

test("a new session renders a composer and no message tail", () => {
  const html = render();
  assert.match(html, /<textarea/);
  assert.doesNotMatch(html, /animate-\[pulse_1\.5s_infinite\]/);
});
