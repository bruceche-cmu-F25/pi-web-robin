import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, beforeEach, test } from "node:test";
import { createJiti } from "jiti";
import { addPaper, recordPaperTurn } from "./papers-domain.ts";
import { attachResearchSession, beginResearchRun, cancelResearchRun, createResearchProject, createResearchSession, finishResearchRun, readResearchConversation, readResearchSession, recordResearchPaper, updateResearchSession } from "./research-domain.ts";

const root = mkdtempSync(join(tmpdir(), "research-sessions-"));
const previous = process.env.ROBIN_DATA_DIR;
const data = join(root, "data"); process.env.ROBIN_DATA_DIR = data;
const stub = join(root, "runtime.mjs"), next = join(root, "next.mjs");
writeFileSync(stub, "export async function runScopedAssistantTurn(options) { return globalThis.__sessionTurn(options); }");
writeFileSync(next, `export { NextResponse } from ${JSON.stringify(import.meta.resolve("next/server.js"))}; export function after(work) { globalThis.__sessionAfter.push(work); }`);
const jiti = createJiti(import.meta.url, { alias: { "next/server": next, "@/lib/robin-assistant": stub, "@": process.cwd() } });
const api = await jiti.import("../../app/api/research/sessions/route.ts");
const { startResearchTask } = await jiti.import("../../lib/research-agent.ts");
let project, a, b, prompts;
beforeEach(() => {
  rmSync(data, { recursive: true, force: true }); mkdirSync(data, { recursive: true });
  project = createResearchProject({ name: "Session project", objective: "Shared project goal" });
  const meta = (name) => ({ title: `Paper ${name}`, url: `https://example.org/${name}`, pdfUrl: `https://example.org/${name}.pdf`, authors: [], year: "", abstract: "Source abstract", provider: "Test" });
  a = addPaper(meta("A")); b = addPaper(meta("B")); prompts = [];
  globalThis.__sessionAfter = [];
  globalThis.__sessionTurn = async (options) => { prompts.push(options.message); return { reply: "Answer", sessionId: "execution", usedTools: [] }; };
});
after(() => {
  delete globalThis.__sessionAfter; delete globalThis.__sessionTurn;
  rmSync(root, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
});
const jsonFile = () => JSON.parse(readFileSync(join(data, "research-conversation.json"), "utf8"));
const conversation = (paperId) => readResearchSession(project.id, undefined, paperId).conversation;
function turn(text, paperId, id) { const run = beginResearchRun(text, paperId, project.id, id); finishResearchRun(run.id, { reply: `Reply: ${text}`, sessionId: `model-${run.id}` }); return run; }
const req = (method, body, query = "", headers = {}) => new Request(`http://localhost/api/research/sessions${query}`, {
  method, headers: { host: "localhost", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test("legacy migration is read-only until mutation; preserves IDs, uncertain ownership and a backup", () => {
  const at = "2026-10-20T10:00:00Z";
  const messages = [
    { id: "unknown-q", role: "user", text: `Compare ${a.title} and ${b.title}`, at },
    { id: "a-q", role: "user", text: "Explain A", paperId: a.id, at },
    { id: "a-answer", role: "assistant", text: "Original answer", paperId: a.id, sessionId: "old-model", at },
    { id: "unknown-answer", role: "assistant", text: "An AI link is not ownership", at },
  ];
  const legacy = { threads: { [project.id]: messages }, run: null, errors: { [project.id]: "Previous error" } };
  writeFileSync(join(data, "research-conversation.json"), JSON.stringify(legacy));
  assert.equal(readResearchSession(project.id).messages.length, 0);
  assert.deepEqual(readResearchSession(project.id, undefined, a.id).messages.map((m) => m.id), ["a-q", "a-answer"]);
  const history = readResearchSession(project.id).sessions.find((s) => s.kind === "history");
  assert.deepEqual(readResearchSession(project.id, history.id).messages.map((m) => m.id), ["unknown-q", "unknown-answer"]);
  assert.deepEqual(jsonFile(), legacy); assert.equal(existsSync(join(data, "research-conversation-pre-sessions.json")), false);
  createResearchSession(project.id, { title: "New topic" });
  assert.equal(jsonFile().version, 2);
  assert.deepEqual(JSON.parse(readFileSync(join(data, "research-conversation-pre-sessions.json"), "utf8")), legacy);
  assert.equal(readResearchConversation(project.id).messages.length, 4);
  assert.equal(readResearchSession(project.id, undefined, a.id).messages[1].sessionId, "old-model");
  assert.equal(readResearchSession(project.id, history.id).error, "Previous error");
});

test("paper defaults are reused; topics and projects stay separate and metadata uses revisions", () => {
  const first = createResearchSession(project.id, { paperId: a.id, ensure: true });
  assert.equal(createResearchSession(project.id, { paperId: a.id, ensure: true }).id, first.id);
  turn("A-only", a.id); turn("B-only", b.id);
  const topic = createResearchSession(project.id, { title: "Methods", paperId: a.id }); turn("Topic-only", a.id, topic.id);
  assert.equal(readResearchSession(project.id, first.id).messages.length, 2);
  assert.equal(readResearchSession(project.id, topic.id).messages[0].text, "Topic-only");
  const other = createResearchProject({ name: "Other" });
  assert.throws(() => readResearchSession(other.id, topic.id), /not found/);
  assert.throws(() => beginResearchRun("wrong", b.id, project.id, topic.id), /different paper/);
  const renamed = updateResearchSession(project.id, topic.id, topic.revision, { title: "Method details" });
  assert.throws(() => updateResearchSession(project.id, topic.id, topic.revision, { title: "stale" }), /changed elsewhere/);
  const archived = updateResearchSession(project.id, topic.id, renamed.revision, { archived: true });
  assert.throws(() => beginResearchRun("archived", a.id, project.id, topic.id), /Restore/);
  assert.equal(readResearchSession(project.id, topic.id).messages.length, 2);
  updateResearchSession(project.id, topic.id, archived.revision, { archived: false });
  turn("Restored", a.id, topic.id);
  assert.equal(readResearchSession(project.id, topic.id).messages.length, 4);
});

test("turn ownership survives selection changes; running sessions cannot archive and stale stop cannot cancel another run", () => {
  const run = beginResearchRun("A question", a.id, project.id);
  const current = conversation(a.id);
  assert.throws(() => updateResearchSession(project.id, current.id, current.revision, { archived: true }), /running/);
  assert.equal(readResearchSession(project.id, undefined, b.id).run.conversationId, current.id);
  assert.throws(() => cancelResearchRun("another-run"), /changed/);
  assert.equal(readResearchSession(project.id, current.id).run.cancelled, undefined);
  finishResearchRun(run.id, { error: "A failed" });
  assert.equal(readResearchSession(project.id, current.id).error, "A failed");
  assert.equal(readResearchSession(project.id, undefined, b.id).error, undefined);
  finishResearchRun(run.id, { reply: "late" });
  assert.equal(readResearchSession(project.id, current.id).messages.length, 1);
});

test("conversations retain more than 100 messages instead of silently trimming history", () => {
  for (let i = 0; i < 55; i++) turn(`Question ${i}`, a.id);
  const state = readResearchSession(project.id, undefined, a.id);
  assert.equal(state.messages.length, 110); assert.equal(state.messages[0].text, "Question 0");
});

test("one pasted paper URL gets a separate conversation and only a verified matching tool result binds it", () => {
  turn("Unrelated project history");
  let run = beginResearchRun(`Read ${a.url}`, undefined, project.id);
  assert.equal(run.conversationId, conversation(a.id).id);
  finishResearchRun(run.id, { reply: "A" });
  const url = "https://example.org/new";
  run = beginResearchRun(`Read ${url}`, undefined, project.id);
  attachResearchSession(run.id, "reader");
  recordResearchPaper("reader", b.id);
  assert.equal(readResearchSession(project.id, run.conversationId).conversation.paperId, undefined);
  const added = addPaper({ title: "New paper", url, authors: [], year: "", abstract: "", pdfUrl: "", provider: "Test" });
  recordResearchPaper("reader", added.id);
  const bound = readResearchSession(project.id, run.conversationId);
  assert.equal(bound.conversation.paperId, added.id); assert.equal(bound.conversation.title, "New paper");
  finishResearchRun(run.id, { reply: "New reading" });
  assert.equal(conversation(added.id).id, run.conversationId);
  assert.ok(readResearchSession(project.id, run.conversationId).messages.every((m) => m.paperId === added.id));
  assert.equal(readResearchSession(project.id).messages.length, 2);
});

test("model context uses only the selected conversation, not another paper, topic or legacy transcript", async () => {
  turn("SECRET_GENERAL"); turn("SECRET_A", a.id); turn("SECRET_B", b.id);
  recordPaperTurn(a.id, a.revision, "SECRET_LEGACY", "Legacy reply", "legacy");
  const topic = createResearchSession(project.id, { title: "Separate topic", paperId: a.id });
  const run = startResearchTask({ projectId: project.id, conversationId: topic.id, question: "First topic question" });
  await globalThis.__sessionAfter.shift()();
  assert.equal(run.paperId, a.id);
  assert.match(prompts[0], /Shared project goal/); assert.match(prompts[0], /First topic question/);
  for (const secret of ["SECRET_GENERAL", "SECRET_A", "SECRET_B", "SECRET_LEGACY"]) assert.ok(!prompts[0].includes(secret), secret);
  startResearchTask({ projectId: project.id, conversationId: topic.id, question: "Follow up" });
  await globalThis.__sessionAfter.shift()(); assert.match(prompts[1], /First topic question/);
});

test("session HTTP CRUD validates scope and untrusted inputs, and listing excludes message bodies", async () => {
  let response = await api.POST(req("POST", { projectId: project.id, title: "Topic", paperId: a.id }));
  assert.equal(response.status, 201); const saved = (await response.json()).conversation;
  turn("Private message", a.id, saved.id);
  response = await api.GET(req("GET", undefined, `?project=${project.id}`));
  const list = await response.json(); assert.ok(list.sessions.some((s) => s.id === saved.id)); assert.ok(!JSON.stringify(list).includes("Private message"));
  assert.equal((await api.POST(req("POST", { projectId: project.id, title: "" }))).status, 400);
  assert.equal((await api.POST(req("POST", { projectId: project.id, title: "x", paperId: "missing" }))).status, 404);
  assert.equal((await api.POST(req("POST", { projectId: "missing", title: "x" }))).status, 404);
  assert.equal((await api.POST(req("POST", { projectId: project.id, title: "x" }, "", { origin: "https://evil.example" }))).status, 403);
  assert.equal((await api.PATCH(req("PATCH", { projectId: project.id, id: saved.id, revision: 0, patch: { archived: "yes" } }))).status, 400);
  assert.equal((await api.PATCH(req("PATCH", { projectId: project.id, id: saved.id, revision: 0, patch: { messages: [] } }))).status, 400);
});

test("a pre-migration in-flight run finishes in its original paper conversation", () => {
  const run = { id: "old-run", projectId: project.id, paperId: a.id, sessionId: "old-sdk", startedAt: new Date().toISOString(), phase: "reading", detail: "" };
  writeFileSync(join(data, "research-conversation.json"), JSON.stringify({ threads: { [project.id]: [{ id: "old-question", role: "user", text: "Still working", paperId: a.id, at: run.startedAt }] }, run }));
  finishResearchRun(run.id, { reply: "Completed", sessionId: "old-sdk" });
  assert.deepEqual(readResearchSession(project.id, undefined, a.id).messages.map((m) => m.text), ["Still working", "Completed"]);
  assert.equal(jsonFile().run, null);
});
