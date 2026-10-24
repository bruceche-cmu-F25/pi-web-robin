import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { createJiti } from "jiti";
import { addPaper, addPaperToProject, paperEvidenceKey, savePaperAccess, savePaperAnalysis, savePaperSource } from "./papers-domain.ts";
import { appendResearchNote, beginResearchRun, createResearchProject, createResearchSession, finishResearchRun, listResearchSessions, readResearchRun, researchProjectBoard, updateResearchSession } from "./research-domain.ts";

const previous = process.env.ROBIN_DATA_DIR;
const directory = fs.mkdtempSync(join(tmpdir(), "research-queries-"));
process.env.ROBIN_DATA_DIR = directory;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const route = await jiti.import("../../app/api/research/projects/route.ts");
beforeEach(() => { fs.rmSync(directory, { recursive: true, force: true }); fs.mkdirSync(directory, { recursive: true }); });
after(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
});
const meta = (name) => ({ title: name, url: `https://example.org/${name}`, authors: [], year: "", abstract: "Evidence", pdfUrl: "", provider: "Test" });

test("overview counts shared papers, access, current readings and archived conversations without exposing bodies", () => {
  const a = createResearchProject({ name: "A" }), b = createResearchProject({ name: "B" });
  appendResearchNote("PRIVATE_NOTE", a.id);
  const paper = addPaper(meta("shared"), a.id); addPaperToProject(paper.id, b.id);
  const analyzed = savePaperAnalysis(paper.id, paperEvidenceKey(paper), { abstractExplanation: "Explanation", summary: "PRIVATE_READING", connection: "Connection" }, a);
  const missing = addPaper(meta("missing"), a.id); savePaperAccess(missing.id, missing.revision, [], [missing.url]);
  const session = createResearchSession(a.id, { title: "Archived topic" });
  const run = beginResearchRun("PRIVATE_QUESTION", undefined, a.id, session.id);
  finishResearchRun(run.id, { reply: "PRIVATE_REPLY" });
  updateResearchSession(a.id, session.id, session.revision, { archived: true });
  const board = researchProjectBoard();
  const counts = (id) => { const { papers, needsPdf, read, messages, hasNotes } = board.projects.find((p) => p.id === id); return { papers, needsPdf, read, messages, hasNotes }; };
  assert.deepEqual(counts(a.id), { papers: 2, needsPdf: 1, read: 1, messages: 2, hasNotes: true });
  assert.deepEqual(counts(b.id), { papers: 1, needsPdf: 0, read: 1, messages: 0, hasNotes: false });
  assert.equal(board.activeId, b.id);
  assert.ok(!JSON.stringify(board).includes("PRIVATE_"));
  savePaperSource(paper.id, analyzed.revision, { kind: "pasted", text: "Changed source evidence. ".repeat(20), label: "Excerpt", loadedAt: new Date().toISOString() });
  assert.ok(researchProjectBoard().projects.every((p) => p.read === 0), "outdated readings do not count as read");
});

test("project overview HTTP reads the conversation document once for any number of projects", async () => {
  for (let i = 0; i < 5; i++) createResearchProject({ name: `Project ${i}` });
  const run = beginResearchRun("Question"); finishResearchRun(run.id, { reply: "Answer" });
  const original = fs.readFileSync; let reads = 0;
  fs.readFileSync = function(path, ...args) {
    if (String(path) === join(directory, "research-conversation.json")) reads++;
    return original.call(this, path, ...args);
  };
  syncBuiltinESMExports();
  try {
    const response = await route.GET(new Request("http://localhost/api/research/projects", { headers: { host: "localhost" } }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).projects.length, 5);
    assert.equal(reads, 1);
  } finally { fs.readFileSync = original; syncBuiltinESMExports(); }
});

test("metadata and run queries preserve legacy ownership without writing a migration", () => {
  fs.writeFileSync(join(directory, "research-objective.json"), JSON.stringify({ objective: "Legacy goal", note: "Legacy note" }));
  const legacy = { messages: [{ id: "old", role: "user", text: "PRIVATE_LEGACY", at: "2026-10-01T00:00:00Z" }],
    run: { id: "old-run", sessionId: "execution", startedAt: new Date().toISOString(), phase: "reading", detail: "" } };
  fs.writeFileSync(join(directory, "research-conversation.json"), JSON.stringify(legacy));
  const before = fs.readFileSync(join(directory, "research-conversation.json"), "utf8");
  const board = researchProjectBoard();
  assert.equal(board.projects[0].id, "heat"); assert.equal(board.projects[0].messages, 1);
  assert.equal(readResearchRun().projectId, "heat"); assert.equal(readResearchRun().conversationId, "history:heat");
  const list = listResearchSessions("heat");
  assert.ok(list.sessions.some((s) => s.kind === "history" && s.messageCount === 1));
  assert.ok(list.sessions.some((s) => s.default && s.messageCount === 0));
  assert.ok(!JSON.stringify(list).includes("PRIVATE_LEGACY"));
  assert.equal(fs.readFileSync(join(directory, "research-conversation.json"), "utf8"), before);
  assert.equal(fs.existsSync(join(directory, "research-projects.json")), false);
  assert.throws(() => listResearchSessions("missing"), /not found/);
});
