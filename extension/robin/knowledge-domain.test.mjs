import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { createKnowledgeProposal, knowledgeCandidates, listKnowledgeProposals, saveKnowledgeProposal } from "./knowledge-domain.ts";
import { listObsidianArchives } from "./obsidian-domain.ts";
import { knowledgeSource } from "../../lib/knowledge-source.ts";

const original = { data: process.env.ROBIN_DATA_DIR, config: process.env.ROBIN_OBSIDIAN_CONFIG };
const root = mkdtempSync(join(tmpdir(), "robin-knowledge-"));
const vault = join(root, "Vault");
const data = join(root, "data");
process.env.ROBIN_DATA_DIR = data;
process.env.ROBIN_OBSIDIAN_CONFIG = join(root, "registry.json");
beforeEach(() => {
  rmSync(vault, { recursive: true, force: true }); rmSync(data, { recursive: true, force: true });
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  writeFileSync(process.env.ROBIN_OBSIDIAN_CONFIG, JSON.stringify({ vaults: { test: { path: vault } } }));
});
after(() => {
  rmSync(root, { recursive: true, force: true });
  for (const [key, value] of [["ROBIN_DATA_DIR", original.data], ["ROBIN_OBSIDIAN_CONFIG", original.config]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
const source = knowledgeSource([{ type: "message", id: "entry", parentId: null, message: { role: "user", content: "Use Markdown as the knowledge source." } }], {
  sessionId: "session", leafId: "entry", scope: "all", sessionName: "Knowledge design", project: "Robin", origin: "http://localhost:30141",
});
const note = (extra = {}) => ({ id: "n1", title: "Markdown knowledge", kind: "decision", content: "Keep knowledge in Markdown.", links: [], sourceIds: ["entry"], targetId: null, ...extra });
const propose = (notes, extra = {}) => createKnowledgeProposal({ source, project: "Robin", vaultId: "test", candidates: knowledgeCandidates("test").notes, reply: JSON.stringify({ notes }), ...extra });

test("preparation writes no vault files, validates references and creates a native linked graph only on confirmation", () => {
  const proposal = propose([note({ links: ["n2"] }), note({ id: "n2", title: "Notes integration", kind: "architecture", links: ["n1"] })]);
  assert.deepEqual(readdirSync(vault), [".obsidian"]);
  assert.throws(() => saveKnowledgeProposal("session", proposal.id, false), /Confirm/);
  const saved = saveKnowledgeProposal("session", proposal.id, true);
  assert.ok(saved.notes.every((item) => item.saved));
  assert.ok(readFileSync(join(vault, saved.hubPath), "utf8").startsWith("# Robin"));
  const first = readFileSync(join(vault, saved.notes[0].path), "utf8");
  assert.ok(first.includes(`[[${saved.hubPath.replace(/\.md$/, "")}|Robin]]`));
  assert.ok(first.includes(`[[${saved.notes[1].path.replace(/\.md$/, "")}|Notes integration]]`));
  assert.match(first, /http:\/\/localhost:30141\/\?session=session/);
  assert.match(first, /Branch: `entry`/);
  assert.equal(new URL(saved.notes[0].url).searchParams.get("path"), join(realpathSync(vault), saved.notes[0].path));
  assert.equal(listObsidianArchives().length, 2, "captures appear in the existing Notes library");
  assert.equal(listKnowledgeProposals("session")[0].source.messages, undefined, "do not copy the raw conversation into the store");
  const same = propose([note()]);
  assert.equal(same.id, saved.id, "same source and destination reuse the existing capture");
});

test("append preview preserves original text; confirmation adds only the reviewed block and retries are idempotent", () => {
  writeFileSync(join(vault, "Architecture.md"), "# My architecture\n\nHand-written content.\n");
  const existing = knowledgeCandidates("test").notes[0];
  assert.deepEqual(Object.keys(existing).sort(), ["id", "path", "title"], "model catalog contains no note bodies");
  const proposal = propose([note({ targetId: existing.id })]);
  assert.equal(proposal.notes[0].before, "# My architecture\n\nHand-written content.\n");
  const snapshot = structuredClone(proposal);
  saveKnowledgeProposal("session", proposal.id, true);
  const savedText = readFileSync(join(vault, "Architecture.md"), "utf8");
  assert.equal(savedText, proposal.notes[0].before + "\n\n" + proposal.notes[0].markdown);
  // Simulate a crash after publication but before the proposal/index write.
  writeFileSync(join(data, "knowledge-proposals.json"), JSON.stringify({ [snapshot.id]: snapshot }));
  saveKnowledgeProposal("session", proposal.id, true);
  assert.equal(readFileSync(join(vault, "Architecture.md"), "utf8"), savedText);
  writeFileSync(join(vault, "Architecture.md"), "Edited later in Obsidian");
  saveKnowledgeProposal("session", proposal.id, true);
  assert.equal(readFileSync(join(vault, "Architecture.md"), "utf8"), "Edited later in Obsidian");
});

test("partial failure is explicit, concurrent edits survive, and a fresh preview can be requested", () => {
  writeFileSync(join(vault, "Existing.md"), "Original");
  const target = knowledgeCandidates("test").notes[0];
  const proposal = propose([note(), note({ id: "n2", title: "Supplement", targetId: target.id })]);
  writeFileSync(join(vault, "Existing.md"), "New user edit");
  const partial = saveKnowledgeProposal("session", proposal.id, true);
  assert.equal(partial.notes[0].saved, true);
  assert.equal(partial.notes[1].saved, undefined);
  assert.match(partial.error, /changed in Obsidian/);
  assert.equal(readFileSync(join(vault, "Existing.md"), "utf8"), "New user edit");
  const fresh = propose([note({ targetId: target.id })], { regenerate: true });
  assert.notEqual(fresh.id, proposal.id);
  assert.equal(fresh.notes[0].before, "New user edit");
  assert.ok(saveKnowledgeProposal("session", fresh.id, true).notes[0].saved);
});

test("untrusted model IDs, invented sources and filesystem targets cannot become write operations", () => {
  for (const invalid of [note({ targetId: "../../outside" }), note({ sourceIds: ["invented"] }), note({ links: ["missing"] }), note({ content: "[[invented]]" }), note({ id: "../../x" })]) {
    assert.throws(() => propose([invalid]));
  }
  assert.deepEqual(readdirSync(vault), [".obsidian"]);
  const proposal = propose([note()]);
  assert.throws(() => saveKnowledgeProposal("another-session", proposal.id, true), /not found/);
  const outside = join(root, "outside"); mkdirSync(outside, { recursive: true });
  symlinkSync(outside, join(vault, "Knowledge"), "dir");
  const refused = saveKnowledgeProposal("session", proposal.id, true);
  assert.match(refused.error, /symlinks/);
  assert.deepEqual(readdirSync(outside), []);
});

test("catalog skips hidden and symlinked files and is bounded", () => {
  writeFileSync(join(vault, ".private.md"), "private");
  const outside = join(root, "private.md"); writeFileSync(outside, "outside");
  symlinkSync(outside, join(vault, "link.md"));
  for (let i = 0; i < 205; i++) writeFileSync(join(vault, `Note-${i}.md`), "body should not be sent");
  const catalog = knowledgeCandidates("test");
  assert.equal(catalog.notes.length, 200);
  assert.equal(catalog.limited, true);
  assert.ok(catalog.notes.every((item) => item.title.startsWith("Note-")));
});
