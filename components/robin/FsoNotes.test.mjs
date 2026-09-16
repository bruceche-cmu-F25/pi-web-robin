import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred, findElement, hookHarness, settle } from "../../scripts/react-hook-harness.mjs";

function notesHarness() {
  const puts = [];
  const onSavedCalls = [];
  let askMentor = 0;
  const harness = hookHarness(new URL("./FsoNotes.tsx", import.meta.url), {
    "@/components/MarkdownBody": { MarkdownBody: () => null },
    "@/hooks/useI18n": { useI18n: () => ({ t: (key) => key }) },
    "@/extension/robin/fso": { FSO_PARTS: [] },
    "./FsoWorkspace.module.css": { default: {} },
  }, {
    fetch: () => { const pending = deferred(); puts.push(pending); return pending.promise; },
  });
  const ref = {};
  const tree = harness.render(() => harness.exports.FsoNoteEditor({
    chapter: { id: "0a", title: "Fixture" },
    note: { text: "", updatedAt: "2030-01-01T00:00:00Z" },
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
