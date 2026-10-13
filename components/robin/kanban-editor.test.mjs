import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";
const { changedTaskFields, editorFields, readTaskDraft, taskValues } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./kanban-editor.ts");
const todo = { id: "task", title: "Original", done: false, status: "doing", due: "2030-05-15", estimateMinutes: 30, estimateSource: "agent", revision: "original-version" };

test("editor sends only changed fields, preserving workflow, dates and tentative estimates", () => {
  const base = editorFields({ todo, status: "doing" });
  assert.deepEqual(changedTaskFields(base, { ...base, title: " Renamed " }), { title: "Renamed" });
  assert.deepEqual(changedTaskFields(base, { ...base, estimate: "030" }), {});
  assert.deepEqual(changedTaskFields(base, { ...base, estimate: "" }), { estimateMinutes: null });
  assert.deepEqual(changedTaskFields(base, { ...base, due: "" }), { due: "" });
  assert.deepEqual(changedTaskFields(base, base), {});
  assert.equal(taskValues(base).status, "doing");
});

test("draft roundtrip keeps the original revision so restoring cannot bypass conflict detection", () => {
  const base = editorFields({ todo, status: "doing" });
  const draft = { base, fields: { ...base, title: "Unsaved change" }, revision: todo.revision };
  assert.deepEqual(readTaskDraft(JSON.stringify(draft)), draft);
  for (const raw of [null, "invalid", "null", "{}", JSON.stringify({ ...draft, fields: { ...base, status: "blocked" } }), JSON.stringify({ ...draft, revision: 42 })]) assert.equal(readTaskDraft(raw), null);
});
