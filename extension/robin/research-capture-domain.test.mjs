import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, after, test } from "node:test";
import { createJiti } from "jiti";
import { captureResearchMessage, readResearchCaptures } from "./research-capture-domain.ts";
import { createResearchProject, beginResearchRun, finishResearchRun, readResearchConversation, readResearchObjective, saveResearchObjective as writeObjective } from "./research-domain.ts";
import { addPaper, addUploadedPaper } from "./papers-domain.ts";
import { readNoteDrafts } from "./notes-domain.ts";
import { listObsidianArchives } from "./obsidian-domain.ts";

const root = mkdtempSync(join(tmpdir(), "research-capture-"));
const data = join(root, "data"), vault = join(root, "vault"), registry = join(root, "obsidian.json");
const previous = { data: process.env.ROBIN_DATA_DIR, registry: process.env.ROBIN_OBSIDIAN_CONFIG };
process.env.ROBIN_DATA_DIR = data; process.env.ROBIN_OBSIDIAN_CONFIG = registry;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const route = await jiti.import("../../app/api/research/objective/route.ts");
let project;
const register = (vaults) => writeFileSync(registry, JSON.stringify({ vaults }));
beforeEach(() => {
  rmSync(data, { recursive: true, force: true }); rmSync(vault, { recursive: true, force: true });
  mkdirSync(join(vault, ".obsidian"), { recursive: true }); register({ local: { path: vault } });
  project = createResearchProject({ name: "HEAT", objective: "Keep the current goal" });
  saveResearchObjective({ objective: project.objective, note: "Human notes" }, project.id);
});
after(() => {
  rmSync(root, { recursive: true, force: true });
  for (const [key, value] of [["ROBIN_DATA_DIR", previous.data], ["ROBIN_OBSIDIAN_CONFIG", previous.registry]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
function saveResearchObjective(input, projectId) {
  return writeObjective({ ...input, revision: readResearchObjective(projectId).revision }, projectId);
}
function answer(text = "An evidence-backed answer", paperId) {
  const run = beginResearchRun("Read", paperId, project.id);
  finishResearchRun(run.id, { reply: text, sessionId: "session" });
  return readResearchConversation(project.id).messages.at(-1);
}
function request(method, body, extraHeaders = {}) {
  return new Request(`http://localhost/api/research/objective?project=${project.id}&captures=1`, {
    method, headers: { host: "localhost", "content-type": "application/json", ...extraHeaders }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("Keep appends the stored answer and original sources, archives once, and survives reload and Obsidian edits", () => {
  const paper = addPaper({ title: "A Paper", url: "https://arxiv.org/abs/2303.08896", authors: [], year: "2023", abstract: "", pdfUrl: "", provider: "arXiv" });
  const message = answer("Use this finding [paper](/research?paper=" + paper.id + ")", paper.id);
  const first = captureResearchMessage(project.id, message.id);
  assert.equal(first.notebookSaved, true); assert.ok(first.archive); assert.equal(first.error, undefined);
  const notes = readResearchObjective(project.id);
  assert.equal(notes.objective, project.objective); assert.match(notes.note, /^Human notes/);
  assert.match(notes.note, /https:\/\/arxiv.org\/abs\/2303.08896/);
  const path = join(vault, first.archive.relativePath);
  const markdown = readFileSync(path, "utf8");
  assert.match(markdown, /Project: \[\[HEAT\]\]/); assert.ok(markdown.includes(message.text));
  assert.ok(markdown.includes(message.id)); assert.match(markdown, /Sources/);
  writeFileSync(path, markdown + "\nMy edits in Obsidian");
  assert.deepEqual(captureResearchMessage(project.id, message.id), first);
  assert.equal(readResearchObjective(project.id).note, notes.note);
  assert.equal(readFileSync(path, "utf8"), markdown + "\nMy edits in Obsidian");
  assert.equal(listObsidianArchives().length, 1); assert.equal(readNoteDrafts().length, 0);
  assert.deepEqual(readResearchCaptures(project.id).captures, [first]);
});

test("Keep identifies an uploaded PDF without inventing an external source link", () => {
  const paper = addUploadedPaper({ kind: "pdf", label: "local-paper.pdf", text: "Local PDF evidence. ".repeat(10), pages: 1, truncated: false, loadedAt: new Date().toISOString(), pdfHash: "a".repeat(64) }, project.id);
  const message = answer("Finding from the uploaded paper [p. 1].", paper.id);
  const capture = captureResearchMessage(project.id, message.id);
  assert.ok(capture.archive);
  const markdown = readFileSync(join(vault, capture.archive.relativePath), "utf8");
  assert.ok(markdown.includes(`paper ID: ${paper.id}`));
  assert.match(markdown, /uploaded PDF/); assert.doesNotMatch(markdown, /\]\(<>\)/);
});

test("a stale editor cannot undo a successful Keep while leaving a saved receipt", () => {
  const stale = readResearchObjective(project.id);
  const message = answer("New kept finding");
  const receipt = captureResearchMessage(project.id, message.id);
  assert.ok(receipt.archive);
  assert.throws(() => writeObjective({ ...stale, objective: "A stale editor's focus" }, project.id), (error) => error.status === 409);
  assert.ok(readResearchObjective(project.id).note.includes(message.text));
  assert.deepEqual(captureResearchMessage(project.id, message.id), receipt);
});

test("no vault is a partial success; later retry archives without appending the answer twice", () => {
  register({}); const message = answer();
  const failed = captureResearchMessage(project.id, message.id);
  assert.equal(failed.notebookSaved, true); assert.equal(failed.archive, undefined); assert.match(failed.error, /Open a vault/);
  const notes = readResearchObjective(project.id).note;
  register({ local: { path: vault } });
  assert.ok(captureResearchMessage(project.id, message.id).archive);
  assert.equal(readResearchObjective(project.id).note, notes);
});

test("multiple vaults require a choice; the chosen destination is remembered for later answers", () => {
  const other = join(root, "other-vault"); mkdirSync(join(other, ".obsidian"), { recursive: true });
  register({ local: { path: vault }, other: { path: other } });
  const message = answer();
  assert.match(captureResearchMessage(project.id, message.id).error, /Choose an Obsidian vault/);
  assert.equal(readResearchCaptures(project.id).vaultId, "");
  const selected = captureResearchMessage(project.id, message.id, "other");
  assert.equal(selected.archive.vaultId, "other");
  assert.equal(readResearchCaptures(project.id).vaultId, "other");
  assert.equal(captureResearchMessage(project.id, answer("Second answer").id).archive.vaultId, "other");
});

test("unsafe archive folders fail visibly, keep the notebook and reuse the same draft on retry", () => {
  const outside = join(root, "outside"); mkdirSync(outside, { recursive: true });
  symlinkSync(outside, join(vault, "Notes"));
  const message = answer(); const failed = captureResearchMessage(project.id, message.id);
  assert.equal(failed.notebookSaved, true); assert.match(failed.error, /symlinks/);
  assert.deepEqual(readdirSync(outside), []);
  const draftId = readNoteDrafts()[0].id;
  rmSync(join(vault, "Notes"));
  const success = captureResearchMessage(project.id, message.id);
  assert.equal(success.archive.draftId, draftId); assert.equal(success.error, undefined);
  assert.equal(readResearchObjective(project.id).note.split(message.text).length, 2);
});

test("publication receipts recover a lost capture checkpoint without overwriting the user's file", () => {
  const message = answer(); const success = captureResearchMessage(project.id, message.id);
  const path = join(vault, success.archive.relativePath);
  writeFileSync(path, "A later user edit");
  const file = join(data, "research-captures.json"), state = JSON.parse(readFileSync(file, "utf8"));
  delete Object.values(state.captures)[0].archive;
  writeFileSync(file, JSON.stringify(state));
  assert.deepEqual(captureResearchMessage(project.id, message.id).archive, success.archive);
  assert.equal(readFileSync(path, "utf8"), "A later user edit");
  assert.equal(listObsidianArchives().length, 1);
});

test("retry uses the frozen answer after history trimming and refuses a moved vault", () => {
  const message = answer("Frozen finding");
  const outside = join(root, "blocked-target"); mkdirSync(outside, { recursive: true });
  symlinkSync(outside, join(vault, "Notes"));
  assert.equal(captureResearchMessage(project.id, message.id).notebookSaved, true);
  const notes = readResearchObjective(project.id).note;
  writeFileSync(join(data, "research-conversation.json"), JSON.stringify({ threads: {}, run: null }));
  const moved = join(root, "moved-vault"); mkdirSync(join(moved, ".obsidian"), { recursive: true });
  register({ local: { path: moved } });
  const failed = captureResearchMessage(project.id, message.id);
  assert.match(failed.error, /location changed/); assert.equal(failed.archive, undefined);
  assert.deepEqual(readdirSync(moved), [".obsidian"]);
  register({ local: { path: vault } }); rmSync(join(vault, "Notes"));
  const recovered = captureResearchMessage(project.id, message.id);
  assert.ok(recovered.archive);
  assert.match(readFileSync(join(vault, recovered.archive.relativePath), "utf8"), /Frozen finding/);
  assert.equal(readResearchObjective(project.id).note, notes);
});

test("a full notebook or a mismatched vault cannot claim complete success", () => {
  const message = answer();
  saveResearchObjective({ objective: project.objective, note: "n".repeat(100_000) }, project.id);
  const full = captureResearchMessage(project.id, message.id);
  assert.equal(full.notebookSaved, false); assert.equal(full.archive, undefined); assert.match(full.error, /exceeds/);
  assert.equal(listObsidianArchives().length, 0);
  saveResearchObjective({ objective: project.objective, note: "" }, project.id);
  const missing = captureResearchMessage(project.id, message.id, "not-registered");
  assert.equal(missing.notebookSaved, true); assert.equal(missing.archive, undefined);
  assert.match(missing.error, /registered/);
});

test("GET is read-only and archive requests are scoped to actual assistant answers, not supplied content", async () => {
  const message = answer(); const user = readResearchConversation(project.id).messages[0];
  const other = createResearchProject({ name: "Other project" });
  assert.throws(() => captureResearchMessage(other.id, message.id), /not found/);
  assert.throws(() => captureResearchMessage(project.id, user.id), /not found/);
  const before = readdirSync(vault);
  const state = await (await route.GET(request("GET"))).json();
  assert.equal(state.captureState.vaults.length, 1); assert.deepEqual(readdirSync(vault), before);
  const denied = await route.PATCH(request("PATCH", { messageId: message.id }, { origin: "https://evil.example" }));
  assert.equal(denied.status, 403);
  assert.equal((await route.PATCH(request("PATCH", { messageId: "missing" }))).status, 404);
  const response = await route.PATCH(request("PATCH", { messageId: message.id, text: "Injected content", vaultId: "local" }));
  assert.equal(response.status, 200);
  const result = await response.json(); assert.ok(result.capture.archive);
  assert.ok(!readFileSync(join(vault, result.capture.archive.relativePath), "utf8").includes("Injected content"));
  assert.equal((await (await route.GET(request("GET"))).json()).captureState.captures[0].archive.draftId, result.capture.archive.draftId);
});

test("broken vault discovery never hides saved notebook content", async () => {
  writeFileSync(registry, "not json");
  const response = await route.GET(request("GET"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.note, "Human notes"); assert.ok(body.captureState.vaultError);
});
