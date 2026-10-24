import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred, hookHarness, settle } from "../../scripts/react-hook-harness.mjs";

function notesHarness() {
  const requests = [], timers = new Set();
  const messages = { error: "Save failed", limit: "Notebook full" };
  const h = hookHarness(new URL("./useProjectNotes.ts", import.meta.url), {}, {
    Error,
    window: { setTimeout: (fn) => { timers.add(fn); return fn; }, clearTimeout: (fn) => timers.delete(fn) },
    fetch(url, options = {}) { const request = { ...deferred(), url, ...options }; requests.push(request); return request.promise; },
  });
  return { ...h, requests, messages, render: () => h.render(() => h.exports.useProjectNotes("heat", messages)) };
}
const captureState = (captures = []) => ({ captures, vaults: [{ id: "local", name: "Vault", path: "/vault" }], vaultId: "local" });
const respond = (request, body, status = 200) => request.resolve({ ok: status < 400, status, json: async () => ({ revision: "v1", ...body }) });

test("Keep flushes pending edits, adopts partial-save state, and retries by message id", async () => {
  const h = notesHarness();
  try {
    h.render();
    assert.match(h.requests[0].url, /captures=1/);
    respond(h.requests[0], { objective: "Focus", note: "Original", captureState: captureState() }); await settle();
    h.render().setNote("My unsaved edit");
    const capturing = h.render().capture("answer1");
    assert.equal(h.render().capturing, true);
    assert.equal(h.requests.at(-1).method, "PUT");
    assert.deepEqual(JSON.parse(h.requests.at(-1).body), { note: "My unsaved edit", revision: "v1" });
    respond(h.requests.at(-1), {}); await settle();
    assert.equal(h.requests.at(-1).method, "PATCH");
    assert.deepEqual(JSON.parse(h.requests.at(-1).body), { messageId: "answer1", vaultId: "local" });
    const partial = { messageId: "answer1", notebookSaved: true, error: "Vault unavailable" };
    respond(h.requests.at(-1), { objective: "Focus", note: "My unsaved edit\nSaved answer", capture: partial, captureState: captureState([partial]) });
    await capturing;
    assert.equal(h.render().capturing, false);
    assert.equal(h.render().note, "My unsaved edit\nSaved answer");
    assert.equal(h.render().captureState.captures[0].error, "Vault unavailable");
    const retry = h.render().capture("answer1"); await settle();
    assert.equal(h.requests.at(-1).method, "PATCH", "partial success is not overwritten by a stale PUT");
    const complete = { messageId: "answer1", notebookSaved: true, archive: { url: "obsidian://open?path=x" } };
    respond(h.requests.at(-1), { objective: "Focus", note: "My unsaved edit\nSaved answer", capture: complete, captureState: captureState([complete]) });
    await retry;
    assert.ok(h.render().captureState.captures[0].archive);
  } finally { h.unmount(); }
});

test("a stale save preserves the draft, pauses retries and blocks research and Keep", async () => {
  const h = notesHarness();
  try {
    h.render(); respond(h.requests[0], { objective: "Focus", note: "Original" }); await settle();
    h.render().setObjective("My focus draft");
    const saving = h.render().flush(); await settle();
    assert.deepEqual(JSON.parse(h.requests.at(-1).body), { objective: "My focus draft", revision: "v1" });
    respond(h.requests.at(-1), { error: "Changed elsewhere" }, 409);
    await assert.rejects(saving, /Save failed/);
    assert.equal(h.render().saveState, "conflict");
    assert.equal(h.render().objective, "My focus draft");
    const count = h.requests.length;
    h.render().setNote("Still editing my draft");
    await assert.rejects(h.render().flush(), /Save failed/);
    await assert.rejects(h.render().capture("answer"), /Save failed/);
    h.messages.error = "Localized save error"; h.render();
    assert.equal(h.requests.length, count, "neither retry nor locale change replaces the draft or its base revision");
    assert.equal(h.render().note, "Still editing my draft");
    h.render().setObjective("Focus"); h.render().setNote("Original");
    await assert.rejects(h.render().flush(), /Localized save error/, "returning to the old local base does not resolve a server conflict");
    assert.equal(h.requests.length, count);
  } finally { h.unmount(); }
});

test("edits made during a save drain with the returned revision; Keep supplies the next revision", async () => {
  const h = notesHarness();
  try {
    h.render(); respond(h.requests[0], { objective: "Focus", note: "Original" }); await settle();
    h.render().setNote("First edit");
    const saving = h.render().flush(); await settle();
    h.render().setNote("Second edit");
    respond(h.requests.at(-1), { revision: "v2" }); await settle();
    assert.deepEqual(JSON.parse(h.requests.at(-1).body), { note: "Second edit", revision: "v2" });
    respond(h.requests.at(-1), { revision: "v3" }); await saving;
    const keeping = h.render().capture("answer"); await settle();
    respond(h.requests.at(-1), { objective: "Focus", note: "Second edit + answer", revision: "v4" }); await keeping;
    h.render().setObjective("New focus");
    const next = h.render().flush(); await settle();
    assert.deepEqual(JSON.parse(h.requests.at(-1).body), { objective: "New focus", revision: "v4" });
    respond(h.requests.at(-1), { revision: "v5" }); await next;
    assert.equal(h.render().note, "Second edit + answer");
    assert.equal(h.render().saveState, "saved");
  } finally { h.unmount(); }
});

test("reload restores receipts without writing; a rejected capture preserves local notes", async () => {
  const h = notesHarness();
  try {
    h.render();
    const saved = { messageId: "saved", notebookSaved: true, archive: { url: "obsidian://open?path=x" } };
    respond(h.requests[0], { objective: "Focus", note: "Keep this", captureState: captureState([saved]) }); await settle();
    assert.equal(h.render().captureState.captures[0].messageId, "saved");
    assert.equal(h.requests.length, 1);
    h.render().setVaultId("chosen");
    const saving = h.render().capture("another"); await settle();
    assert.equal(JSON.parse(h.requests.at(-1).body).vaultId, "chosen");
    respond(h.requests.at(-1), { error: "Not authorized" }, 403);
    await assert.rejects(saving, /Not authorized/);
    assert.equal(h.render().note, "Keep this");
    assert.equal(h.render().capturing, false);
  } finally { h.unmount(); }
});
