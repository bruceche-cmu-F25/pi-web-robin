import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const previousDataDir = process.env.ROBIN_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), "robin-note-files-"));
process.env.ROBIN_DATA_DIR = dataDir;
const {
  MAX_NOTE_ATTACHMENTS,
  addNoteAttachment,
  clearNoteAttachments,
  listNoteAttachments,
  readNoteAttachmentFile,
  readNoteAttachmentsForModel,
  removeNoteAttachment,
} = await import("./note-attachments.ts");

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previousDataDir;
});

const bytes = (text) => new TextEncoder().encode(text);

test("a draft keeps the original file for Notion and a separate reading for the model", () => {
  const photo = addNoteAttachment("draft1", {
    name: "board.jpg", kind: "image", mimeType: "image/jpeg", bytes: bytes("ORIGINAL"),
    modelImages: [{ bytes: bytes("SMALL"), mimeType: "image/jpeg" }],
  });
  const slides = addNoteAttachment("draft1", {
    name: "lecture.pdf", kind: "pdf", mimeType: "application/pdf", bytes: bytes("%PDF-1.7"),
    text: "--- page 1 ---\nbatching", pages: 1, modelImages: [],
  });

  assert.deepEqual(listNoteAttachments("draft1").map((item) => item.name), ["board.jpg", "lecture.pdf"]);
  assert.equal(readNoteAttachmentFile("draft1", photo.id).bytes.toString(), "ORIGINAL");

  const forModel = readNoteAttachmentsForModel("draft1", { images: 10, textChars: 1000 });
  assert.equal(Buffer.from(forModel.images[0].data, "base64").toString(), "SMALL");
  assert.deepEqual(forModel.documents, [{ name: "lecture.pdf", text: "--- page 1 ---\nbatching", pages: 1, truncated: false }]);

  const tight = readNoteAttachmentsForModel("draft1", { images: 0, textChars: 5 });
  assert.equal(tight.images.length, 0);
  assert.equal(tight.documents[0].text, "--- p");
  assert.equal(tight.documents[0].truncated, true);

  assert.equal(removeNoteAttachment("draft1", slides.id), true);
  assert.deepEqual(listNoteAttachments("draft1").map((item) => item.id), [photo.id]);
});

test("limits, unsafe ids and clearing", () => {
  for (let index = 0; index < MAX_NOTE_ATTACHMENTS; index += 1) {
    addNoteAttachment("draft2", { name: `${index}.png`, kind: "image", mimeType: "image/png", bytes: bytes("x"), modelImages: [] });
  }
  assert.throws(() => addNoteAttachment("draft2", { name: "one-more.png", kind: "image", mimeType: "image/png", bytes: bytes("x"), modelImages: [] }), /at most/);
  assert.throws(() => addNoteAttachment("../escape", { name: "x.png", kind: "image", mimeType: "image/png", bytes: bytes("x"), modelImages: [] }), /Invalid draft id/);
  assert.equal(readNoteAttachmentFile("draft2", "../../secrets"), null);

  clearNoteAttachments("draft2");
  assert.deepEqual(listNoteAttachments("draft2"), []);
  assert.equal(existsSync(join(dataDir, "note-attachments", "draft2")), false);
});
