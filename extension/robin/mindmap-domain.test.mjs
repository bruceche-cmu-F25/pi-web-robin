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
  assert.throws(() => validateMindTree(node("root", "Root", Array.from({ length: 1000 }, (_, i) => node(`n${i}`)))), /1000 nodes/);
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
test("model proposals normalize omitted leaf children, then save atomically with undo", () => {
  const doc = createMindmap(randomUUID(), tree());
  const operations = [{ kind: "add", parent: "root", node: { id: "branch", label: "Branch", children: [{ id: "leaf", label: "Leaf" }] } },
    { kind: "add", parent: "branch", node: { id: "another", label: "Another" } }];
  const reply = JSON.stringify({ reply: "Suggested topics", operations });
  const proposal = parseMindmapProposal(reply, doc.root, false);
  assert.deepEqual(proposal.operations[0].node.children[0].children, []);
  assert.deepEqual(proposal.operations[1].node.children, []);
  assert.equal(operations[0].node.children[0].children, undefined);
  assert.throws(() => applyMindmapOperations(doc.root, operations), /children must be an array/, "manual edits remain strict");
  assert.throws(() => validateMindTree(operations[1].node), /children must be an array/, "stored trees remain strict");
  assert.throws(() => parseMindmapProposal(reply, doc.root, true), /Discussion/);
  const saved = edit(doc, proposal.operations);
  assert.equal(saved.root.children.at(-1).children.length, 2);
  assert.deepEqual(readMindmap(doc.id), saved);
  assert.deepEqual(mutateMindmap({ id: doc.id, revision: saved.revision, requestId: randomUUID(), action: "undo" }).root, doc.root);
});
test("model normalization never hides malformed children or bypasses tree bounds", () => {
  const proposal = added => JSON.stringify({ reply: "Suggestion", operations: [{ kind: "add", parent: "root", node: added }] });
  for (const children of [null, {}, "", false, 0]) {
    assert.throws(() => parseMindmapProposal(proposal(node("branch", "Branch", [{ id: "leaf", label: "Leaf", children }])), tree(), false), /children must be an array/);
  }
  assert.throws(() => parseMindmapProposal(proposal({ id: "a", label: "Duplicate" }), tree(), false), /Duplicate/);
  assert.throws(() => parseMindmapProposal(proposal({ id: "new", label: "Unsafe", url: "javascript:alert(1)" }), tree(), false), /http or https/);
  let deep = { id: "leaf", label: "Leaf" };
  for (let i = 0; i < 17; i++) deep = node(`depth${i}`, "Depth", [deep]);
  assert.throws(() => parseMindmapProposal(proposal(deep), tree(), false), /levels/);
  const wide = node("wide", "Wide", Array.from({ length: 1000 }, (_, i) => ({ id: `n${i}`, label: "Leaf" })));
  assert.throws(() => parseMindmapProposal(proposal(wide), tree(), false), /1000 nodes/);
});
test("arrange balances dense branches, preserves every ID/label/relationship, and persists with undo", () => {
  const original = node("root", "Dense map", [node("discovery", "Discovery", Array.from({ length: 140 }, (_, i) => node(`d${i}`))), node("planning"), node("build", "Build", Array.from({ length: 89 }, (_, i) => node(`b${i}`))), node("release"), node("iterate")]);
  const initial = createMindmap(randomUUID(), original);
  const next = edit(initial, [{ kind: "arrange", id: "build", side: "left" }]);
  assert.equal(next.root.children[2].branchSide, "left");
  assert.equal(next.root.children[0].branchSide, "right", "the other heavy branch goes opposite, not alternating by index");
  const withoutSides = structuredClone(next.root); withoutSides.children.forEach((child) => delete child.branchSide);
  assert.deepEqual(withoutSides, original, "no grouping, deletions, renaming, IDs or sibling order changes");
  assert.deepEqual(readMindmap(initial.id).root, next.root);
  const undone = mutateMindmap({ id: next.id, revision: next.revision, requestId: randomUUID(), action: "undo" });
  assert.deepEqual(undone.root, original);
  const redone = mutateMindmap({ id: next.id, revision: undone.revision, requestId: randomUUID(), action: "redo" });
  assert.deepEqual(redone.root, next.root);
  for (const op of [{ kind: "arrange", id: "d0", side: "left" }, { kind: "arrange", id: "root", side: "left" }, { kind: "arrange", side: "left" }, { kind: "arrange", id: "build", side: "up" }, { kind: "arrange", x: 100 }]) {
    assert.throws(() => edit(redone, [op])); assert.deepEqual(readMindmap(next.id), redone);
  }
  assert.throws(() => parseMindmapProposal(JSON.stringify({ reply: "Tidy", operations: [{ kind: "arrange" }] }), original, true), /Discussion/);
  assert.equal(parseMindmapProposal(JSON.stringify({ reply: "Tidy", operations: [{ kind: "arrange" }] }), original, false).operations[0].kind, "arrange");
  assert.throws(() => validateMindTree({ ...original, branchSide: "up" }), /side/);
});

test("1,000 topics persist and reopen; exceeding either bound rejects the whole edit", () => {
  const original = node("root", "R", Array.from({ length: 999 }, (_, i) => node(`n${i}`, "文".repeat(i === 0 ? 119 : 60))));
  assert.equal(original.children.reduce((sum, child) => sum + child.label.length, original.label.length), 60_000);
  const doc = createMindmap(randomUUID(), original);
  assert.deepEqual(readMindmap(doc.id).root, original);
  assert.throws(() => edit(doc, [{ kind: "add", parent: "root", node: node("overflow") }]), /1000 nodes/);
  assert.throws(() => edit(doc, [{ kind: "rename", id: "n1", label: "文".repeat(61) }]), /60,000 total label characters/);
  assert.deepEqual(readMindmap(doc.id), doc);
  const changed = edit(doc, [{ kind: "rename", id: "n1", label: "Changed" }]);
  assert.equal(readMindmap(doc.id).root.children[1].label, "Changed");
  const undone = mutateMindmap({ id: doc.id, revision: changed.revision, requestId: randomUUID(), action: "undo" });
  assert.deepEqual(undone.root, original);
});
test("resource links save atomically with text, preserve children, undo/redo and export", () => {
  const initial = createMindmap(randomUUID(), tree());
  const request = { id: initial.id, revision: 0, requestId: randomUUID(), action: "edit", operations: [{ kind: "rename", id: "a", label: "Resource" }, { kind: "link", id: "a", url: "example.com/docs?q=a(b)" }] };
  const linked = mutateMindmap(request);
  assert.equal(linked.root.children[0].url, "https://example.com/docs?q=a(b)");
  assert.deepEqual(linked.root.children[0].children, initial.root.children[0].children);
  assert.deepEqual(readMindmap(initial.id), linked);
  assert.deepEqual(mutateMindmap(request), linked, "lost-receipt retries never duplicate changes");
  assert.match(mindmapMarkdown(linked.root), /\[Resource\]\(<https:\/\/example\.com\/docs\?q=a\(b\)>\)/);
  const undone = mutateMindmap({ id: initial.id, revision: linked.revision, requestId: randomUUID(), action: "undo" });
  assert.deepEqual(undone.root, initial.root);
  const redone = mutateMindmap({ id: initial.id, revision: undone.revision, requestId: randomUUID(), action: "redo" });
  assert.deepEqual(redone.root, linked.root);
  const removed = edit(redone, [{ kind: "link", id: "a", url: null }]);
  assert.equal(removed.root.children[0].url, undefined);
  assert.deepEqual(removed.root.children[0].children, initial.root.children[0].children);
  for (const url of ["javascript:alert(1)", "data:text/html,evil", "file:///tmp/x", "mailto:a@example.com", "https://user:password@example.com", "https://exa\nmple.com", "https://example.com/" + "x".repeat(2048), "", 12]) {
    assert.throws(() => edit(removed, [{ kind: "rename", id: "b", label: "Must not save" }, { kind: "link", id: "a", url }]));
    assert.throws(() => validateMindTree({ ...tree(), url }));
    assert.deepEqual(readMindmap(initial.id), removed);
  }
  const moved = applyMindmapOperations(linked.root, [{ kind: "move", id: "a", parent: "b" }]);
  assert.equal(moved.children[0].children[0].url, linked.root.children[0].url);
  assert.throws(() => validateMindTree(node("root", "Map", Array.from({ length: 201 }, (_, i) => ({ ...node(`n${i}`), url: "https://example.com/" + "x".repeat(500) })))), /100,000 resource URL/);
});
test("file names are bounded and damaged files fail closed", () => {
  assert.throws(() => readMindmap("../../secret"), /Invalid/);
  const id = randomUUID(); createMindmap(id, tree());
  writeFileSync(join(dir, "mindmaps", `${id}.json`), '{"version":900,"root":{}}');
  assert.throws(() => readMindmap(id), /damaged/);
  assert.throws(() => listMindmaps(), /damaged/);
});
