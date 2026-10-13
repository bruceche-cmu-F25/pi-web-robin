import assert from "node:assert/strict";
import test from "node:test";
import { createCanvasAutosave } from "./canvas-autosave.ts";

const edit = (title) => ({ title, scene: { elements: [], files: {}, appState: {} } });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test("coalesces edits and saves changes made during an in-flight request using the acknowledged revision", async () => {
  const started = deferred();
  const finish = deferred();
  const requests = [];
  const states = [];
  const saver = createCanvasAutosave({ revision: 0, delay: 60_000, onState: (state) => states.push(state), onSaved() {}, persist: async (content, revision) => {
    requests.push([content.title, revision]);
    if (revision === 0) { started.resolve(); await finish.promise; }
    return { revision: revision + 1 };
  } });
  saver.change(edit("old"));
  saver.change(edit("new"));
  const saving = saver.flush();
  await started.promise;
  saver.change(edit("newest"));
  assert.equal(saver.flush(), saving);
  finish.resolve();
  await saving;
  assert.deepEqual(requests, [["new", 0], ["newest", 1]]);
  assert.equal(saver.isDirty(), false);
  assert.equal(states.at(-1), "saved");
  saver.dispose();
});

test("a failed write keeps the latest edit for explicit retry, never increments revision", async () => {
  let fail = true;
  const requests = [];
  const saver = createCanvasAutosave({ revision: 8, delay: 60_000, onState() {}, onSaved() {}, persist: async (content, revision) => {
    requests.push([content.title, revision]);
    if (fail) throw new Error("conflict");
    return { revision: 9 };
  } });
  saver.change(edit("a"));
  await assert.rejects(saver.flush(), /conflict/);
  assert.equal(saver.isDirty(), true);
  saver.change(edit("b"));
  fail = false;
  await saver.flush();
  assert.deepEqual(requests, [["a", 8], ["b", 8]]);
  assert.equal(saver.isDirty(), false);
  saver.dispose();
});
