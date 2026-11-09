import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createMindmap, deleteMindmap, mindmapExplanationHash, mutateMindmap, readMindmap, readMindmapExplanation } from "./mindmap-domain.ts";
import { applyMindmapOperations } from "./mindmap.ts";
import { MAX_EXPLANATION_CHARS, mindmapExplanationSource } from "./mindmap-explanation.ts";

const before = process.env.ROBIN_DATA_DIR, dir = mkdtempSync(join(tmpdir(), "map-explanations-"));
process.env.ROBIN_DATA_DIR = dir;
after(() => { if (before === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = before; rmSync(dir, { recursive: true, force: true }); });
const tree = () => ({ id: "root", label: "Plan", children: [
  { id: "a", label: "Target", children: [{ id: "detail", label: "Folded detail", children: [] }] },
  { id: "b", label: "Neighbour", children: [{ id: "unrelated", label: "Unrelated deep content", children: [] }] },
] });
const patch = (doc, operations) => mutateMindmap({ id: doc.id, revision: doc.revision, requestId: randomUUID(), action: "edit", operations });
const save = (doc, nodeId = "a", markdown = "# Explanation\n\nSaved independently.") => ({ id: doc.id, revision: doc.revision, requestId: randomUUID(), action: "explain", nodeId, markdown, sourceHash: mindmapExplanationHash(doc.root, nodeId) });

test("legacy documents open empty; explanations persist outside chat and undo, with body reads on demand", () => {
  let doc = createMindmap(randomUUID(), tree());
  assert.deepEqual(doc.explanations, []);
  assert.equal(readMindmapExplanation(doc.id, "a").explanation, null);
  doc = patch(doc, [{ kind: "rename", id: "detail", label: "First edit" }]);
  const payload = save(doc), saved = mutateMindmap(payload);
  assert.deepEqual(saved.root, doc.root); assert.deepEqual(saved.messages, doc.messages);
  assert.equal(saved.canUndo, doc.canUndo); assert.equal(saved.explanations.length, 1);
  assert.equal(saved.explanations[0].markdown, undefined, "ordinary canvas payload excludes bodies");
  assert.equal(saved.explanations[0].stale, false);
  assert.deepEqual(readMindmap(saved.id), saved);
  const body = readMindmapExplanation(saved.id, "a").explanation;
  assert.equal(body.markdown, payload.markdown); assert.equal(body.sourceRevision, doc.revision);
  const undone = mutateMindmap({ id: saved.id, revision: saved.revision, requestId: randomUUID(), action: "undo" });
  assert.equal(undone.root.children[0].children[0].label, "Folded detail", "explanation save does not occupy an undo step");
  assert.equal(undone.explanations[0].stale, true);
  const redoSaved = mutateMindmap(save(undone));
  assert.equal(redoSaved.canRedo, true, "explanations do not clear content redo history");
  doc = redoSaved;
  for (let i = 0; i < 16; i++) doc = mutateMindmap({ id: doc.id, revision: doc.revision, requestId: randomUUID(), action: "edit", operations: [], conversation: { user: `Question ${i}`, reply: "Answer" } });
  assert.equal(doc.messages.length, 24);
  assert.equal(readMindmapExplanation(doc.id, "a").explanation.markdown, payload.markdown);
  assert.equal(doc.explanations[0].stale, false, "chat-only revisions are not source changes");
});

test("freshness covers subtree and immediate neighbourhood, not presentation or unrelated descendants", () => {
  const root = tree(), fingerprint = mindmapExplanationHash(root, "a");
  assert.equal(mindmapExplanationSource(root, "a").branch.children[0].label, "Folded detail");
  assert.equal(JSON.stringify(mindmapExplanationSource(root, "a")).includes("Unrelated deep content"), false);
  const changed = (operations) => mindmapExplanationHash(applyMindmapOperations(root, operations), "a");
  assert.equal(changed([{ kind: "arrange" }]), fingerprint);
  assert.equal(changed([{ kind: "rename", id: "unrelated", label: "Remote deep edit" }]), fingerprint);
  for (const operations of [
    [{ kind: "rename", id: "a", label: "New title" }],
    [{ kind: "rename", id: "detail", label: "Changed descendant" }],
    [{ kind: "link", id: "detail", url: "https://example.com/source" }],
    [{ kind: "rename", id: "root", label: "New parent context" }],
    [{ kind: "link", id: "root", url: "https://example.com/parent" }],
    [{ kind: "rename", id: "b", label: "New sibling context" }],
    [{ kind: "link", id: "b", url: "https://example.com/sibling" }],
    [{ kind: "remove", id: "b" }],
    [{ kind: "add", parent: "a", node: { id: "new", label: "Added", children: [] } }],
    [{ kind: "add", parent: "root", node: { id: "new", label: "Sibling", children: [] } }],
    [{ kind: "move", id: "a", parent: "b" }],
  ]) assert.notEqual(changed(operations), fingerprint, JSON.stringify(operations));
  assert.notEqual(mindmapExplanationHash(applyMindmapOperations(root, [{ kind: "rename", id: "unrelated", label: "Edit" }]), "root"), mindmapExplanationHash(root, "root"));
});

test("deleting a branch retains its explanation; undo recovers freshness without generating", () => {
  const saved = mutateMindmap(save(createMindmap(randomUUID(), tree())));
  const removed = patch(saved, [{ kind: "remove", id: "a" }]);
  assert.equal(removed.explanations[0].missing, true);
  assert.equal(readMindmapExplanation(removed.id, "a").node, null);
  assert.equal(readMindmapExplanation(removed.id, "a").explanation.markdown, "# Explanation\n\nSaved independently.");
  assert.throws(() => mutateMindmap({ ...save(saved), revision: removed.revision }), (e) => e.status === 409);
  const restored = mutateMindmap({ id: removed.id, revision: removed.revision, requestId: randomUUID(), action: "undo" });
  assert.equal(restored.explanations[0].stale, false); assert.equal(restored.explanations[0].missing, false);
  deleteMindmap(restored.id, restored.revision);
  assert.throws(() => readMindmapExplanation(restored.id, "a"), (e) => e.status === 404);
});

test("failed refreshes preserve the old document; exact retries cannot duplicate or overwrite a later generation", () => {
  const doc = createMindmap(randomUUID(), tree()), input = save(doc), saved = mutateMindmap(input);
  assert.deepEqual(mutateMindmap(input), saved);
  assert.throws(() => mutateMindmap({ ...input, markdown: "Different text" }), /reused/);
  const replacement = save(saved, "a", "# Replacement");
  const newer = patch(saved, [{ kind: "rename", id: "detail", label: "Changed during inference" }]);
  assert.throws(() => mutateMindmap(replacement), (e) => e.status === 409);
  assert.throws(() => mutateMindmap({ ...replacement, revision: newer.revision }), /source changed/);
  assert.equal(readMindmapExplanation(doc.id, "a").explanation.markdown, input.markdown);
  const final = mutateMindmap(save(newer, "a", "# New generation"));
  assert.equal(final.explanations.length, 1);
  assert.equal(mutateMindmap(input).revision, final.revision, "late replay returns current index");
  assert.equal(readMindmapExplanation(doc.id, "a").explanation.markdown, "# New generation");
});

test("explanation writes are bounded, isolated and fail closed on malformed stored data", () => {
  const doc = createMindmap(randomUUID(), tree()), input = save(doc);
  for (const patch of [{ markdown: " " }, { markdown: "x".repeat(MAX_EXPLANATION_CHARS + 1) }, { nodeId: "../secret" }, { operations: [] }, { conversation: { user: "x", reply: "x" } }, { sourceHash: "invalid" }]) {
    assert.throws(() => mutateMindmap({ ...input, ...patch })); assert.deepEqual(readMindmap(doc.id), doc);
  }
  const saved = mutateMindmap(input), file = join(dir, "mindmaps", `${doc.id}.json`);
  const stored = JSON.parse(readFileSync(file, "utf8")); stored.explanations[0].markdown = 42;
  writeFileSync(file, JSON.stringify(stored));
  assert.throws(() => readMindmap(doc.id), (e) => e.status === 500);
  assert.throws(() => mutateMindmap({ ...save(saved), markdown: "Do not overwrite damaged data" }), (e) => e.status === 500);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).explanations[0].markdown, 42);
});
