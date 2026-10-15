import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { archiveNoteToObsidian, listObsidianArchives, listObsidianVaults } from "./obsidian-domain.ts";
import { createNoteDraft, readNoteDrafts, updateNoteDraft } from "./notes-domain.ts";
import { addNoteAttachment } from "./note-attachments.ts";

const previous = { data: process.env.ROBIN_DATA_DIR, config: process.env.ROBIN_OBSIDIAN_CONFIG };
const root = mkdtempSync(join(tmpdir(), "robin-obsidian-"));
const vault = join(root, "知识库");
const data = join(root, "data");
process.env.ROBIN_DATA_DIR = data;
process.env.ROBIN_OBSIDIAN_CONFIG = join(root, "obsidian.json");
beforeEach(() => {
  rmSync(vault, { recursive: true, force: true });
  rmSync(data, { recursive: true, force: true });
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  writeFileSync(process.env.ROBIN_OBSIDIAN_CONFIG, JSON.stringify({ vaults: { local: { path: vault } } }));
});
after(() => {
  rmSync(root, { recursive: true, force: true });
  for (const [key, value] of [["ROBIN_DATA_DIR", previous.data], ["ROBIN_OBSIDIAN_CONFIG", previous.config]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
function request(draft, extra = {}) {
  return { confirmed: true, vaultId: "local", draftId: draft.id, title: draft.title, content: draft.text,
    expectedDraft: { title: draft.title, text: draft.text }, attachmentIds: [], ...extra };
}
function file(draftId, name = "原始 图.png") {
  return addNoteAttachment(draftId, { name, kind: "image", mimeType: "image/png", bytes: Buffer.from("original bytes"), modelImages: [] });
}

test("discovery is read-only and does not silently choose between vaults", () => {
  assert.deepEqual(listObsidianVaults(), [{ id: "local", name: "知识库", path: vault }]);
  assert.deepEqual(listObsidianArchives(), []);
  assert.deepEqual(readdirSync(vault), [".obsidian"]);
});

test("archives Markdown and original attachments, rewrites references, and appends unused files", () => {
  const draft = createNoteDraft({ title: "闭包与 React", text: "My understanding" });
  const image = file(draft.id);
  const pdf = addNoteAttachment(draft.id, { name: "lecture.pdf", kind: "pdf", mimeType: "application/pdf", bytes: Buffer.from("pdf bytes"), modelImages: [] });
  const input = request(draft, { content: `# 理解\n\n![截图](attachment:${image.id})`, attachmentIds: [image.id, pdf.id] });
  const archive = archiveNoteToObsidian(input);
  const markdown = readFileSync(join(vault, archive.relativePath), "utf8");
  assert.match(markdown, /^# 理解/);
  assert.ok(!markdown.includes("attachment:"));
  assert.match(markdown, /## Attachments/);
  const paths = [...markdown.matchAll(/\]\((Attachments\/[^)]+)\)/g)].map((match) => join(vault, dirname(archive.relativePath), decodeURIComponent(match[1])));
  assert.deepEqual(paths.map((path) => readFileSync(path, "utf8")), ["original bytes", "pdf bytes"]);
  assert.equal(new URL(archive.url).searchParams.get("path"), join(realpathSync(vault), archive.relativePath));
  assert.equal(readNoteDrafts().length, 0);
  assert.deepEqual(listObsidianArchives(), [archive]);
  assert.deepEqual(archiveNoteToObsidian(input), archive, "a retried POST returns the original receipt");
});

test("retry never overwrites edits made in Obsidian", () => {
  const draft = createNoteDraft({ title: "Note", text: "original" });
  const input = request(draft);
  const archive = archiveNoteToObsidian(input);
  writeFileSync(join(vault, archive.relativePath), "Edited in Obsidian");
  archiveNoteToObsidian(input);
  assert.equal(readFileSync(join(vault, archive.relativePath), "utf8"), "Edited in Obsidian");
  assert.throws(() => archiveNoteToObsidian({ ...input, content: "overwrite" }), /already archived/);
});

test("recovery after publication but before the Robin index commit does not rewrite the bundle", () => {
  const draft = createNoteDraft({ title: "Recovery", text: "before" });
  const input = request(draft);
  const archive = archiveNoteToObsidian(input);
  rmSync(join(data, "obsidian-archives.json"));
  writeFileSync(join(data, "note-drafts.json"), JSON.stringify([draft]));
  writeFileSync(join(vault, archive.relativePath), "User has already edited it");
  assert.deepEqual(archiveNoteToObsidian(input), archive);
  assert.equal(readFileSync(join(vault, archive.relativePath), "utf8"), "User has already edited it");
  assert.deepEqual(readNoteDrafts(), []);
});

test("retry after an index commit never drops a newer edit left in the draft store", () => {
  const draft = createNoteDraft({ title: "Recovery conflict", text: "before" });
  const input = request(draft);
  archiveNoteToObsidian(input);
  writeFileSync(join(data, "note-drafts.json"), JSON.stringify([{ ...draft, text: "newer unsaved work" }]));
  assert.throws(() => archiveNoteToObsidian(input), /changed elsewhere/);
  assert.equal(readNoteDrafts()[0].text, "newer unsaved work");
});

test("a missing original attachment fails without publishing or deleting the draft", () => {
  const draft = createNoteDraft({ title: "Missing file", text: "keep" });
  const image = file(draft.id);
  rmSync(join(data, "note-attachments", draft.id, `${image.id}.bin`));
  assert.throws(() => archiveNoteToObsidian(request(draft, { attachmentIds: [image.id] })), /Attachment is missing/);
  assert.equal(readNoteDrafts()[0].text, "keep");
  assert.deepEqual(listObsidianArchives(), []);
  assert.deepEqual(readdirSync(join(vault, "Notes")), []);
});

test("confirmation, registered destinations, draft conflicts and attachment conflicts fail closed", () => {
  const draft = createNoteDraft({ title: "Conflicts", text: "keep" });
  for (const input of [null, {}, request(draft, { confirmed: false }), request(draft, { draftId: "../escape" })]) {
    assert.throws(() => archiveNoteToObsidian(input));
  }
  assert.throws(() => archiveNoteToObsidian(request(draft, { vaultId: "unknown" })), /registered/);
  updateNoteDraft(draft.id, { text: "newer edit" });
  assert.throws(() => archiveNoteToObsidian(request(draft)), /changed elsewhere/);
  const current = readNoteDrafts()[0];
  file(draft.id);
  assert.throws(() => archiveNoteToObsidian(request(current)), /Attachments changed/);
  assert.equal(readNoteDrafts()[0].text, "newer edit");
});

test("symlink destinations, existing bundles and unknown attachment references never overwrite files", () => {
  const draft = createNoteDraft({ title: "../../escape [bad]", text: "keep" });
  const outside = join(root, "outside");
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, join(vault, "Notes"), "dir");
  assert.throws(() => archiveNoteToObsidian(request(draft)), /symlinks/);
  assert.deepEqual(readdirSync(outside), []);
  rmSync(join(vault, "Notes"));
  mkdirSync(join(vault, "Notes", `Robin-${draft.id}`), { recursive: true });
  assert.throws(() => archiveNoteToObsidian(request(draft)), /already exists/);
  rmSync(join(vault, "Notes", `Robin-${draft.id}`), { recursive: true });
  assert.throws(() => archiveNoteToObsidian(request(draft, { content: "![unknown](attachment:missing)" })), /Unknown attachment/);
  const archive = archiveNoteToObsidian(request(draft));
  assert.equal(dirname(archive.relativePath), `Notes/Robin-${draft.id}`);
  assert.equal(readFileSync(join(vault, archive.relativePath), "utf8"), "keep\n");
});

test("same titles and empty-body attachment notes remain distinct archives", () => {
  const first = createNoteDraft({ title: "Repeated", text: "first" });
  const second = createNoteDraft({ title: "Repeated", text: "" });
  const image = file(second.id, `${"图".repeat(100)}.png`);
  const a = archiveNoteToObsidian(request(first));
  const b = archiveNoteToObsidian(request(second, { attachmentIds: [image.id] }));
  assert.notEqual(a.relativePath, b.relativePath);
  const attachments = readdirSync(join(vault, dirname(b.relativePath), "Attachments"));
  assert.ok(attachments[0].endsWith(".png"));
});
