import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const previous = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), "robin-canvases-"));
process.env.ROBIN_DATA_DIR = dir;
const { createCanvas, readCanvas, saveCanvas, deleteCanvas, listCanvases } = await import("./canvas-domain.ts");
const { canvasContext, snapshotCanvas } = await import("./canvas.ts");
after(() => { rmSync(dir, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
const element = { id: "text-1", type: "text", text: "你好 Canvas", x: 10, y: 20, width: 160, height: 30 };

test("independent boards round-trip scenes and images; lists contain only metadata", () => {
  const a = createCanvas("First");
  const b = createCanvas("Second");
  const scene = { ...a.scene, elements: [element], files: { image: { id: "image", mimeType: "image/png", dataURL: "data:image/png;base64,aGVsbG8=", created: 1 } } };
  const saved = saveCanvas(a.id, 0, { title: "Renamed", scene });
  assert.equal(saved.revision, 1);
  assert.deepEqual(readCanvas(a.id).scene, scene);
  assert.equal(readCanvas(b.id).title, "Second");
  assert.ok(listCanvases().every((entry) => !("scene" in entry)));
  assert.throws(() => saveCanvas(a.id, 0, { title: "Stale", scene }), (e) => e.status === 409);
  assert.throws(() => deleteCanvas(a.id, 0), (e) => e.status === 409);
  assert.equal(readCanvas(a.id).title, "Renamed");
  deleteCanvas(a.id, 1);
  assert.throws(() => readCanvas(a.id), (e) => e.status === 404);
  assert.throws(() => saveCanvas(a.id, 1, { title: "Resurrect", scene }), (e) => e.status === 404);
  assert.equal(readCanvas(b.id).revision, 0);
});

test("the domain rejects traversal, malformed geometry/assets and oversized scenes without touching saved data", () => {
  const board = createCanvas("Safe");
  const save = (scene) => saveCanvas(board.id, 0, { title: "Safe", scene });
  assert.throws(() => readCanvas("../../secrets"), /Invalid canvas id/);
  assert.throws(() => createCanvas(" "), /title/);
  assert.throws(() => saveCanvas(board.id, -1, board), /revision/);
  for (const bad of [{ ...element, x: NaN }, { ...element, type: "embeddable" }, { ...element, link: "javascript:alert(1)" }, { ...element, points: [[1, "oops"]] }]) {
    assert.throws(() => save({ ...board.scene, elements: [bad] }));
  }
  assert.throws(() => save({ ...board.scene, files: { x: { id: "x", mimeType: "image/png", dataURL: "https://example.com/track" } } }), /images/);
  assert.throws(() => save({ ...board.scene, files: { x: { id: "x", mimeType: "image/png", dataURL: `data:image/png;base64,${"a".repeat(17 * 1024 * 1024)}` } } }), (e) => e.status === 413);
  assert.equal(readCanvas(board.id).revision, 0);
});

test("snapshots reclaim removed image bytes without modifying the editor's undo history", () => {
  const board = createCanvas("Images");
  const elements = [{ ...element, type: "image", fileId: "keep" }, { ...element, id: "deleted", type: "image", fileId: "drop", isDeleted: true }];
  const files = { keep: { id: "keep" }, drop: { id: "drop" } };
  const snapshot = snapshotCanvas(elements, board.scene.appState, files);
  assert.deepEqual(Object.keys(snapshot.files), ["keep"]);
  assert.equal(snapshot.elements.length, 1);
  assert.equal(elements.length, 2);
  assert.ok(files.drop);
});

test("agent context includes text and arrow endpoints but never image bytes", () => {
  const board = createCanvas("Context");
  const scene = { ...board.scene, elements: [element, { id: "arrow", type: "arrow", x: 1, y: 2, width: 5, height: 5, startBinding: { elementId: "text-1" }, endBinding: { elementId: "image-1" } }], files: { private: { dataURL: "private-image-bytes" } } };
  const context = canvasContext(scene);
  assert.match(context, /你好 Canvas/);
  assert.match(context, /"from":"text-1"/);
  assert.match(context, /"to":"image-1"/);
  assert.doesNotMatch(context, /private-image-bytes/);
});
