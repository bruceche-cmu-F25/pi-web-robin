import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { applyMindmapOperations, validateMindTree, parseMindmapProposal, mindmapMarkdown } from "./mindmap.ts";
const previous = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), "mindmap-domain-")); process.env.ROBIN_DATA_DIR = dir;
const { createMindmap, readMindmap, listMindmaps, mutateMindmap, deleteMindmap } = await import("./mindmap-domain.ts");
after(() => { if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; rmSync(dir, { recursive: true, force: true }); });
const node = (id, label = id, children = []) => ({ id, label, children });
const tree = () => node("root", "My map", [node("a", "First", [node("c", "Detail")]), node("b", "Second")]);
const edit = (doc, operations, extra = {}) => mutateMindmap({ id: doc.id, revision: doc.revision, requestId: randomUUID(), action: "edit", operations, ...extra });

test("local edits, grouping, moving and removal preserve stable node IDs and unrelated branches", () => {
  const original = tree();
  const next = applyMindmapOperations(original, [
    { kind: "add", parent: "root", node: node("group", "Group") },
    { kind: "move", id: "a", parent: "group" },
    { kind: "rename", id: "b", label: "Still here" },
  ]);
  assert.equal(next.children[1].id, "group");
  assert.equal(next.children[1].children[0].children[0].id, "c");
  assert.deepEqual(original, tree(), "never mutate the caller's snapshot");
  const removed = applyMindmapOperations(next, [{ kind: "remove", id: "a", keepChildren: true }]);
  assert.equal(removed.children[1].children[0].id, "c");
});
test("invalid IDs, cycles, unknown operations, duplicates and over-limit batches are rejected", () => {
  for (const operations of [
    [{ kind: "move", id: "a", parent: "c" }], [{ kind: "remove", id: "root" }], [{ kind: "move", id: "root", parent: "a" }],
    [{ kind: "rename", id: "missing", label: "oops" }], [{ kind: "add", parent: "root", node: node("a") }],
    [{ kind: "exec", command: "touch anything" }], [{ kind: "rename", id: "a", label: "changed", path: "/tmp/file" }],
    [{ kind: "move", id: "a", parent: "b", index: 99 }], [{ kind: "remove", id: "a", keepChildren: "false" }],
  ]) assert.throws(() => applyMindmapOperations(tree(), operations));
  assert.throws(() => validateMindTree(node("root", "Root", Array.from({ length: 300 }, (_, i) => node(`n${i}`)))), /300/);
  let deep = node("bottom"); for (let i = 0; i < 17; i++) deep = node(`depth${i}`, "Depth", [deep]);
  assert.throws(() => validateMindTree(deep), /levels/);
  assert.throws(() => applyMindmapOperations(tree(), Array.from({ length: 101 }, () => ({ kind: "rename", id: "a", label: "x" }))), /100/);
});
test("atomic batch, persisted undo/redo, revision conflicts and replay-safe writes", () => {
  const id = randomUUID(), initial = createMindmap(id, tree());
  assert.deepEqual(createMindmap(id, tree()), initial, "uncertain creates do not duplicate documents");
  const request = { id, revision: 0, requestId: randomUUID(), action: "edit", operations: [{ kind: "rename", id: "a", label: "Edited" }], conversation: { user: "Rename a", reply: "Proposed a rename" } };
  const next = mutateMindmap(request);
  assert.equal(next.revision, 1); assert.equal(next.canUndo, true); assert.equal(next.messages.length, 2);
  assert.deepEqual(mutateMindmap(request), next, "retry after a lost response does not apply twice");
  assert.throws(() => mutateMindmap({ ...request, operations: [] }), /reused/);
  assert.throws(() => edit(initial, [{ kind: "remove", id: "b" }]), (error) => error.status === 409);
  assert.throws(() => edit(next, [{ kind: "rename", id: "b", label: "Not committed" }, { kind: "move", id: "a", parent: "c" }]));
  assert.deepEqual(readMindmap(id), next, "a later invalid command rolls back the whole batch");
  const undone = mutateMindmap({ id, revision: next.revision, requestId: randomUUID(), action: "undo" });
  assert.deepEqual(undone.root, initial.root); assert.equal(undone.canRedo, true); assert.equal(undone.messages.length, 2);
  const redone = mutateMindmap({ id, revision: undone.revision, requestId: randomUUID(), action: "redo" });
  assert.deepEqual(redone.root, next.root); assert.equal(readMindmap(id).revision, 3);
  assert.equal(mutateMindmap(request).revision, 3, "replaying an older receipt returns the latest view without rolling it back");
  assert.throws(() => deleteMindmap(id, 0), (error) => error.status === 409);
  deleteMindmap(id, 3); assert.throws(() => readMindmap(id), (error) => error.status === 404);
  assert.throws(() => mutateMindmap(request), (error) => error.status === 404, "late edits cannot resurrect a deleted map");
});
test("discussion is validated as read-only, malformed proposals never apply", () => {
  const discussion = parseMindmapProposal('{"reply":"An explanation","operations":[]}', tree(), true);
  assert.equal(discussion.operations.length, 0);
  assert.throws(() => parseMindmapProposal(JSON.stringify({ reply: "Ignore discussion", operations: [{ kind: "remove", id: "a" }] }), tree(), true), /Discussion/);
  assert.throws(() => parseMindmapProposal('```json\n{"reply":"truncated', tree(), false), /complete/);
  assert.throws(() => parseMindmapProposal('{"reply":"x","operations":[{"kind":"fetch","url":"https://example.com"}]}', tree(), false), /Unsupported/);
  assert.match(mindmapMarkdown(tree()), /^# My map\n\n- First\n  - Detail\n- Second\n$/);
});
test("file names are bounded and damaged files fail closed", () => {
  assert.throws(() => readMindmap("../../secret"), /Invalid/);
  const id = randomUUID(); createMindmap(id, tree());
  writeFileSync(join(dir, "mindmaps", `${id}.json`), '{"version":900,"root":{}}');
  assert.throws(() => readMindmap(id), /damaged/);
  assert.throws(() => listMindmaps(), /damaged/);
});
