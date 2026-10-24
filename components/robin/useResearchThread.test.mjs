import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred, hookHarness, settle } from "../../scripts/react-hook-harness.mjs";

const run = { id: "r1", projectId: "heat", sessionId: null, startedAt: "2026-10-19T00:00:00Z", phase: "starting", detail: "" };
const empty = () => ({ messages: [], run: null });
function threadHarness() {
  const requests = [], timers = new Set();
  let changes = 0;
  const options = { projectId: "heat", locale: "zh-CN", beforeAsk: async () => {}, onChange: () => { changes++; }, fallbackError: "Request failed" };
  const h = hookHarness(new URL("./useResearchThread.ts", import.meta.url), {
    "./research-client": {
      researchJson: (method, body, signal) => ({ method, body, signal }),
      researchRequest: (url, init = {}) => {
        const request = { ...deferred(), url, ...init, method: init.method ?? "GET" };
        requests.push(request);
        return request.promise;
      },
    },
  }, {
    Error, URLSearchParams,
    setTimeout: (fn) => { timers.add(fn); return fn; },
    clearTimeout: (fn) => timers.delete(fn),
  });
  return { ...h, requests, options, get changes() { return changes; }, render: () => h.render(() => h.exports.useResearchThread(options)),
    poll() { const fn = timers.values().next().value; assert.ok(fn); timers.delete(fn); fn(); },
  };
}

test("a recovered poll clears Load failed and exposes the actual task error", async () => {
  const h = threadHarness();
  try {
    h.render(); h.requests[0].reject(new Error("Load failed")); await settle();
    assert.equal(h.render().error, "Load failed");
    h.poll(); h.requests.at(-1).resolve({ ...empty(), error: "Model unavailable" }); await settle();
    assert.equal(h.render().error, "Model unavailable");
    h.poll(); h.requests.at(-1).resolve(empty()); await settle();
    assert.equal(h.render().error, "");
    assert.equal(h.render().ready, true);
  } finally { h.unmount(); }
});

test("accepted work stays busy after POST completes, then polling publishes the answer", async () => {
  const h = threadHarness();
  try {
    h.render(); h.requests[0].resolve(empty()); await settle();
    const sending = h.render().send("Read this", "paper1"); await settle();
    const post = h.requests.find((request) => request.method === "POST");
    assert.equal(post.body.paperId, "paper1");
    post.resolve({ run }); await settle();
    const question = { id: "q1", role: "user", text: "Read this", paperId: "paper1", at: "" };
    h.requests.at(-1).resolve({ messages: [question], run });
    assert.equal(await sending, true);
    assert.equal(h.render().pending, null);
    assert.equal(h.render().busy, true);
    assert.equal(await h.render().send("Duplicate"), false);
    // busy changes restart the poll effect. Its result—not the POST—delivers the final answer.
    h.requests.at(-1).resolve({ messages: [question, { id: "a1", role: "assistant", text: "Saved answer", paperId: "paper1", at: "" }], run: null });
    await settle();
    assert.equal(h.render().busy, false);
    assert.equal(h.render().state.messages.at(-1).text, "Saved answer");
    assert.ok(h.changes >= 2, "completed reading refreshes the library and paper sheet");
  } finally { h.unmount(); }
});

test("failed submissions are not reported as sent or erased by a successful status poll", async () => {
  const h = threadHarness();
  try {
    h.render(); h.requests[0].resolve(empty()); await settle();
    const sending = h.render().send("Keep my draft"); await settle();
    h.requests.find((request) => request.method === "POST").reject(new Error("Request failed (403)")); await settle();
    h.requests.at(-1).resolve(empty());
    assert.equal(await sending, false);
    assert.equal(h.render().error, "Request failed (403)");
    assert.equal(h.render().busy, false);
  } finally { h.unmount(); }
});

test("switching conversations in the same project ignores a late poll and tracks the other session's run", async () => {
  const h = threadHarness();
  try {
    h.options.conversationId = "A"; h.render(); const old = h.requests[0];
    h.options.conversationId = "B"; h.render();
    assert.equal(old.signal.aborted, true);
    h.requests.at(-1).resolve({ messages: [{ id: "b", text: "B history" }], conversation: { id: "B" }, run: { ...run, conversationId: "A" } }); await settle();
    old.resolve({ messages: [{ id: "a", text: "A history" }], conversation: { id: "A" }, run: null }); await settle();
    assert.equal(h.render().state.messages[0].id, "b"); assert.equal(h.render().busy, false); assert.equal(h.render().elsewhere, true);
  } finally { h.unmount(); }
});

test("a late POST after a conversation switch cannot navigate back or alter the new thread", async () => {
  const h = threadHarness(); let selected = null;
  try {
    h.options.conversationId = "A"; h.options.onConversation = (id) => { selected = id; };
    h.render(); h.requests[0].resolve({ ...empty(), conversation: { id: "A", paperId: "paperA" } }); await settle();
    const sending = h.render().send("Question A"); await settle();
    const post = h.requests.find((request) => request.method === "POST");
    assert.equal(post.body.conversationId, "A"); assert.equal(post.body.paperId, "paperA");
    h.options.conversationId = "B"; h.render();
    h.requests.at(-1).resolve({ ...empty(), conversation: { id: "B" }, messages: [{ id: "b", text: "Keep B" }] }); await settle();
    post.resolve({ run: { ...run, conversationId: "A" } }); await settle();
    h.requests.at(-1).resolve({ ...empty(), conversation: { id: "A" } });
    assert.equal(await sending, false); assert.equal(selected, null);
    assert.equal(h.render().state.messages[0].id, "b"); assert.equal(h.render().error, "");
  } finally { h.unmount(); }
});

test("question drafts and late clearing are isolated by conversation", () => {
  const values = new Map();
  const h = hookHarness(new URL("./useResearchThread.ts", import.meta.url), { "./research-client": {} }, {
    localStorage: { getItem: (key) => values.get(key), setItem: (key, text) => values.set(key, text) },
  });
  try {
    const render = (key) => h.render(() => h.exports.useResearchQuestion(key));
    render("A"); const a = render("A"); a.setQuestion("A draft");
    render("B"); const b = render("B"); assert.equal(b.question, ""); b.setQuestion("B draft");
    a.setQuestion(""); assert.equal(render("B").question, "B draft");
    render("A"); assert.equal(render("A").question, "");
    render("B"); assert.equal(render("B").question, "B draft");
  } finally { h.unmount(); }
});

test("acceptance clears only the submitted draft, including browser persistence", () => {
  const values = new Map();
  const h = hookHarness(new URL("./useResearchThread.ts", import.meta.url), { "./research-client": {} }, {
    localStorage: { getItem: (key) => values.get(key), setItem: (key, text) => values.set(key, text) },
  });
  try {
    const render = (key = "A") => h.render(() => h.exports.useResearchQuestion(key));
    render(); render().setQuestion("First");
    const submitted = render();
    submitted.setQuestion("Second");
    submitted.clearSubmitted();
    assert.equal(render().question, "Second"); assert.equal(values.get("A"), "Second");
    // Even editing away and back to the same text creates a new draft.
    const second = render(); second.setQuestion("Other"); render().setQuestion("Second");
    second.clearSubmitted(); assert.equal(render().question, "Second");
    const leaving = render(); render("B"); render("B").setQuestion("B draft");
    leaving.clearSubmitted(); assert.equal(render("B").question, "B draft");
    assert.equal(values.get("A"), "Second");
    render("A"); render().clearSubmitted();
    assert.equal(render().question, ""); assert.equal(values.get("A"), "");
  } finally { h.unmount(); }
});

test("aborted polls from a previous project cannot overwrite the current conversation", async () => {
  const h = threadHarness();
  try {
    h.render(); const old = h.requests[0];
    h.options.projectId = "general"; h.render();
    assert.equal(old.signal.aborted, true);
    h.requests.at(-1).resolve({ messages: [{ id: "new", text: "Home answer" }], run: null }); await settle();
    old.resolve({ messages: [{ id: "old", text: "Stale answer" }], run }); await settle();
    assert.equal(h.render().state.messages.at(-1).id, "new");
    assert.equal(h.render().busy, false);
  } finally { h.unmount(); }
});
