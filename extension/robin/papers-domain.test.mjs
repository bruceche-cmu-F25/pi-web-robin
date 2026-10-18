import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, beforeEach, test } from "node:test";
import { addPaper, archivePaper, canonicalPaperUrl, getPaper, listPapers, paperMarkdown, sourceDescription, recordPaperTurn, savePaperSource, updatePaper } from "./papers-domain.ts";
import { readNoteDrafts } from "./notes-domain.ts";

const previous = { data: process.env.ROBIN_DATA_DIR, config: process.env.ROBIN_OBSIDIAN_CONFIG };
const root = mkdtempSync(join(tmpdir(), "research-papers-"));
const data = join(root, "data"), vault = join(root, "vault");
process.env.ROBIN_DATA_DIR = data;
process.env.ROBIN_OBSIDIAN_CONFIG = join(root, "obsidian.json");
const metadata = { title: "A paper: 理解与证据", url: "https://arxiv.org/abs/2303.08896v2", authors: ["A. Author"], year: "2023", abstract: "An abstract with bounded evidence.", pdfUrl: "https://arxiv.org/pdf/2303.08896", provider: "arXiv" };
beforeEach(() => {
  rmSync(data, { recursive: true, force: true }); rmSync(vault, { recursive: true, force: true });
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  writeFileSync(process.env.ROBIN_OBSIDIAN_CONFIG, JSON.stringify({ vaults: { local: { path: vault } } }));
});
after(() => {
  rmSync(root, { recursive: true, force: true });
  for (const [key, value] of [["ROBIN_DATA_DIR", previous.data], ["ROBIN_OBSIDIAN_CONFIG", previous.config]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("deduplicates paper versions without replacing notes; arXiv and DOI links are canonical", () => {
  assert.equal(canonicalPaperUrl("https://arxiv.org/pdf/2303.08896v3.pdf"), "https://arxiv.org/abs/2303.08896");
  assert.equal(canonicalPaperUrl("https://dx.doi.org/10.1000/ABC"), "https://doi.org/10.1000/abc");
  const paper = addPaper(metadata);
  const edited = updatePaper(paper.id, paper.revision, { note: "My idea", status: "reading" });
  assert.deepEqual(addPaper({ ...metadata, url: "https://arxiv.org/pdf/2303.08896v5", title: "Other title" }), edited);
  assert.equal(listPapers().length, 1);
});

test("rejects invalid metadata, private links and invalid edits without modifying data", () => {
  for (const input of [null, {}, { ...metadata, authors: [2] }, { ...metadata, url: "http://127.0.0.1/secret" }, { ...metadata, url: "file:///etc/passwd" }, { ...metadata, pdfUrl: "https://user:pass@example.com/x" }]) assert.throws(() => addPaper(input));
  const paper = addPaper(metadata);
  for (const patch of [{ status: "done" }, { source: "injected" }, { revision: 100 }, { note: "x".repeat(50_001) }]) assert.throws(() => updatePaper(paper.id, paper.revision, patch));
  assert.deepEqual(getPaper(paper.id), paper);
});

test("revision conflicts preserve source, notes and paid-for reply's concurrency boundary", () => {
  const paper = addPaper(metadata);
  const edited = updatePaper(paper.id, 1, { note: "newer" });
  assert.throws(() => updatePaper(paper.id, 1, { note: "old" }), /changed elsewhere/);
  assert.throws(() => recordPaperTurn(paper.id, 1, "question", "answer", "session"), /changed elsewhere/);
  assert.throws(() => savePaperSource(paper.id, 1, { text: "a".repeat(100), label: "doc", kind: "pasted", truncated: false, loadedAt: new Date().toISOString() }), /changed elsewhere/);
  assert.deepEqual(getPaper(paper.id), edited);
});

test("source provenance and conversation are persisted, reading status is only user-set", () => {
  let paper = addPaper(metadata);
  assert.match(sourceDescription(paper), /ABSTRACT ONLY/);
  assert.throws(() => savePaperSource(paper.id, 1, { text: "--- page 1 ---\n", label: "scan", kind: "pdf" }), /No usable text/);
  paper = savePaperSource(paper.id, 1, { text: `--- page 1 ---\n${"Source evidence. ".repeat(20)}`, pages: 1, label: "test.pdf", kind: "pdf", truncated: true, loadedAt: new Date().toISOString() });
  assert.match(sourceDescription(paper), /TRUNCATED/);
  paper = recordPaperTurn(paper.id, paper.revision, "What is the method?", "It compares samples [p. 1].", "session-1");
  assert.equal(getPaper(paper.id).messages.length, 2);
  assert.equal(paper.status, "queued");
  assert.equal(paper.messages[1].sessionId, "session-1");
  assert.match(paper.messages[1].source, /TRUNCATED/);
});

test("export preview is read-only; confirmed publication survives retry and preserves Obsidian edits", () => {
  let paper = addPaper(metadata);
  paper = updatePaper(paper.id, 1, { note: "## My understanding\n\nKeep [[uncertainty]] separate.", tags: "LLM, uncertainty", status: "read" });
  paper = recordPaperTurn(paper.id, paper.revision, "Why?", "The evidence is limited.", "session-1");
  const preview = paperMarkdown(paper);
  assert.match(preview, /tags: \["research","paper","LLM","uncertainty"\]/);
  assert.match(preview, /## Discussion/);
  assert.match(preview, /reading_status: read/);
  assert.deepEqual(readdirSync(vault), [".obsidian"]);
  assert.equal(readNoteDrafts().length, 0);
  assert.throws(() => archivePaper(paper.id, { confirmed: false, revision: paper.revision, vaultId: "local" }), /Confirm/);
  assert.throws(() => archivePaper(paper.id, { confirmed: true, revision: 1, vaultId: "local" }), /changed/);
  const input = { confirmed: true, revision: paper.revision, vaultId: "local" };
  const archive = archivePaper(paper.id, input);
  assert.equal(readFileSync(join(vault, archive.relativePath), "utf8"), preview);
  assert.equal(readNoteDrafts().length, 0);
  assert.equal(getPaper(paper.id).note, paper.note, "archiving does not delete research notes");
  writeFileSync(join(vault, archive.relativePath), "Obsidian edit");
  assert.deepEqual(archivePaper(paper.id, input), archive);
  assert.equal(readFileSync(join(vault, archive.relativePath), "utf8"), "Obsidian edit");
  paper = updatePaper(paper.id, paper.revision, { note: "New insight" });
  const next = archivePaper(paper.id, { ...input, revision: paper.revision });
  assert.notEqual(next.relativePath, archive.relativePath);
  assert.equal(getPaper(paper.id).exports.length, 2);
});

test("long conversations have an optional concise export", () => {
  let paper = addPaper(metadata);
  for (let index = 0; index < 3; index++) paper = recordPaperTurn(paper.id, paper.revision, `Question ${index}`, "a".repeat(40_001), "session");
  assert.throws(() => paperMarkdown(paper), /Turn off Include discussion/);
  assert.doesNotMatch(paperMarkdown(paper, false), /## Discussion/);
  const archive = archivePaper(paper.id, { confirmed: true, revision: paper.revision, vaultId: "local", includeDiscussion: false });
  assert.equal(readFileSync(join(vault, archive.relativePath), "utf8"), paperMarkdown(paper, false));
});

test("failed vault writes keep a reusable draft and retry without duplicate archives", () => {
  const paper = addPaper(metadata);
  const outside = join(root, "outside"); mkdirSync(outside, { recursive: true });
  symlinkSync(outside, join(vault, "Notes"), "dir");
  const input = { confirmed: true, revision: paper.revision, vaultId: "local" };
  assert.throws(() => archivePaper(paper.id, input), /symlinks/);
  assert.equal(getPaper(paper.id).exports.length, 1);
  assert.equal(readNoteDrafts().length, 1);
  assert.deepEqual(readdirSync(outside), []);
  rmSync(join(vault, "Notes"));
  const archive = archivePaper(paper.id, input);
  assert.ok(readFileSync(join(vault, archive.relativePath), "utf8").includes(metadata.title));
  assert.equal(getPaper(paper.id).exports.length, 1);
  assert.equal(readNoteDrafts().length, 0);
});
