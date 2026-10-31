import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred, findElement, hookHarness, settle } from "../../scripts/react-hook-harness.mjs";

function notesHarness(initial = "") {
  const puts = [];
  const onSavedCalls = [];
  let askMentor = 0;
  const harness = hookHarness(new URL("./FsoNotes.tsx", import.meta.url), {
    "@/components/MarkdownBody": { MarkdownBody: () => null },
    "@/hooks/useI18n": { useI18n: () => ({ t: (key) => key }) },
    "@/extension/robin/fso": { FSO_PARTS: [] },
    "./FsoWorkspace.module.css": { default: {} },
  }, {
    fetch: (_url, init) => { const pending = deferred(); puts.push({ ...pending, body: JSON.parse(init.body), keepalive: init.keepalive }); return pending.promise; },
  });
  const ref = {};
  const tree = harness.render(() => harness.exports.FsoNoteEditor({
    chapter: { id: "0a", title: "Fixture" },
    note: { text: initial, updatedAt: "2030-01-01T00:00:00Z" },
    onSaved: (_id, note) => onSavedCalls.push(note?.text ?? null),
    onAskMentor: () => { askMentor += 1; },
  }, ref));
  const textarea = findElement(tree, (node) => node.type === "textarea");
  const ask = findElement(tree, (node) => node.type === "button" && node.props["data-state"] === "accent");
  return {
    ...harness, ref, textarea, ask, puts, onSavedCalls,
    getAskMentor: () => askMentor,
    type: (value) => textarea.props.onChange({ target: { value } }),
    ok: (index, text) => puts[index].resolve({ ok: true, json: async () => ({ note: { text } }) }),
    fail: (index, message) => puts[index].reject(new Error(message)),
  };
}

test("saves are serialized and the latest draft wins", async () => {
  const h = notesHarness();
  h.type("old edit");
  const older = h.ref.current.flush();
  h.type("new edit");
  const newer = h.ref.current.flush();
  await settle();
  // The first queued task sends the newest draft it sees; the second is a no-op.
  assert.equal(h.puts.length, 1);
  h.ok(0, "new edit");
  await Promise.all([older, newer]);
  assert.deepEqual(h.onSavedCalls, ["new edit"]);
});

test("a failed save rejects flush and the ask-mentor action holds back", async () => {
  const h = notesHarness();
  // Success first, so the button can be exercised at all.
  h.type("draft");
  const saved = h.ref.current.flush();
  await settle();
  h.ok(0, "draft");
  await saved;
  await h.ask.props.onClick();
  assert.equal(h.getAskMentor(), 1);

  // New unsaved draft whose save fails: the action must not fire.
  h.type("draft v2");
  const click = h.ask.props.onClick();
  await settle();
  h.fail(1, "network down");
  await click;
  assert.equal(h.getAskMentor(), 1);

  // And a direct flush reports the failure rather than swallowing it.
  h.type("draft v3");
  const failed = h.ref.current.flush();
  await settle();
  h.fail(2, "network down");
  await assert.rejects(failed, /network down/);
});

for (const exit of ["flush", "mentor", "unmount"]) test(`A → B → A waits for the corrective save on ${exit}`, async () => {
  const h = notesHarness("A");
  h.type("B"); const older = h.ref.current.flush(); await settle();
  assert.equal(h.puts[0].body.text, "B");
  h.type("A");
  let finished = false;
  const leaving = exit === "unmount" ? (h.unmount(), Promise.resolve())
    : (exit === "mentor" ? h.ask.props.onClick() : h.ref.current.flush()).then(() => { finished = true; });
  h.ok(0, "B"); await older; await settle();
  assert.equal(h.puts.length, 2, "a corrective A must follow the in-flight B");
  assert.equal(h.puts[1].body.text, "A");
  assert.equal(h.getAskMentor(), 0);
  if (exit !== "unmount") assert.equal(finished, false);
  else assert.equal(h.puts[1].keepalive, true);
  h.ok(1, "A"); await leaving; await settle();
  assert.equal(h.onSavedCalls.at(-1), "A");
  assert.equal(h.getAskMentor(), exit === "mentor" ? 1 : 0);
});

test("a corrective save failure blocks the mentor and remains retryable", async () => {
  const h = notesHarness("A");
  h.type("B"); const older = h.ref.current.flush(); await settle();
  h.type("A"); const ask = h.ask.props.onClick();
  h.ok(0, "B"); await older; await settle();
  assert.equal(h.puts.length, 2);
  h.fail(1, "offline"); await ask;
  assert.equal(h.getAskMentor(), 0);
  const retry = h.ask.props.onClick(); await settle();
  h.ok(2, "A"); await retry;
  assert.equal(h.getAskMentor(), 1);
});

test("an uncertain older write cannot certify the reverted text as saved", async () => {
  const h = notesHarness("A");
  h.type("B"); const older = h.ref.current.flush();
  const failed = assert.rejects(older, /response lost/); await settle();
  h.type("A"); const ask = h.ask.props.onClick();
  h.fail(0, "response lost"); await failed; await settle();
  assert.equal(h.puts.length, 2, "B may have committed even without its response");
  assert.equal(h.getAskMentor(), 0);
  h.ok(1, "A"); await ask;
  assert.equal(h.getAskMentor(), 1);
});

test("unchanged confirmed text does not create redundant writes", async () => {
  const h = notesHarness("A");
  await h.ref.current.flush(); await h.ref.current.flush();
  h.unmount(); await settle();
  assert.equal(h.puts.length, 0);
});
