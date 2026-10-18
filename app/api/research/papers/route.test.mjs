import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, beforeEach, test } from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "research-http-"));
const data = join(root, "data"), vault = join(root, "vault");
const previous = { data: process.env.ROBIN_DATA_DIR, config: process.env.ROBIN_OBSIDIAN_CONFIG };
process.env.ROBIN_DATA_DIR = data;
process.env.ROBIN_OBSIDIAN_CONFIG = join(root, "obsidian.json");
const stub = join(root, "assistant.mjs");
writeFileSync(stub, "export async function runScopedAssistantTurn(options) { return globalThis.__researchTestTurn(options); } export function getRpcSession() { return { send: async () => {} }; }");
const jiti = createJiti(import.meta.url, { alias: { "@/lib/robin-assistant": stub, "@/lib/rpc-manager": stub, "@": process.cwd() }, interopDefault: true });
const library = await jiti.import("./route.ts");
const source = await jiti.import("./source/route.ts");
const agent = await jiti.import("./agent/route.ts");
const archive = await jiti.import("./export/route.ts");
const domain = await jiti.import("@/extension/robin/papers-domain.ts");
const research = await jiti.import("@/extension/robin/research-domain.ts");
const researchAgent = await jiti.import("../agent/route.ts");
let calls = [];
beforeEach(() => {
  rmSync(data, { recursive: true, force: true }); rmSync(vault, { recursive: true, force: true });
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  writeFileSync(process.env.ROBIN_OBSIDIAN_CONFIG, JSON.stringify({ vaults: { local: { path: vault } } }));
  calls = [];
  globalThis.__researchTestTurn = async (options) => { calls.push(options); return { reply: "Only the abstract supports this claim.", sessionId: "test-session", usedTools: [] }; };
});
after(() => {
  delete globalThis.__researchTestTurn; rmSync(root, { recursive: true, force: true });
  for (const [key, value] of [["ROBIN_DATA_DIR", previous.data], ["ROBIN_OBSIDIAN_CONFIG", previous.config]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
function req(path = "", method = "GET", body, extraHeaders = {}) {
  return new Request(`http://localhost/api/research/papers${path}`, { method, headers: { host: "localhost", ...(body === undefined ? {} : { "content-type": "application/json" }), ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function add() {
  const response = await library.POST(req("", "POST", { title: "Source-backed paper", authors: ["Author"], year: "2023", abstract: "We compare sampled responses.", url: "https://arxiv.org/abs/2303.08896", pdfUrl: "", provider: "arXiv" }));
  assert.equal(response.status, 200);
  return (await response.json()).paper;
}

test("HTTP guard rejects cross-origin writes, non-JSON and oversized input", async () => {
  assert.equal((await library.POST(req("", "POST", {}, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await library.POST(req("", "POST", {}, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await library.POST(req("", "POST", { title: "x".repeat(160_000) }))).status, 413);
  assert.equal((await source.POST(req("/source", "POST", {}, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await archive.POST(req("/export", "POST", {}, { "content-type": "text/plain" }))).status, 415);
});

test("library summaries exclude full source and conversation; edits use revisions", async () => {
  const paper = await add();
  const listing = await (await library.GET(req())).json();
  assert.equal(listing.papers.length, 1);
  assert.equal("source" in listing.papers[0], false);
  assert.equal("messages" in listing.papers[0], false);
  assert.equal(listing.papers[0].coverage, "abstract");
  let response = await library.PATCH(req("", "PATCH", { id: paper.id, revision: 1, patch: { note: "keep", tags: "LLM", status: "reading" } }));
  assert.equal(response.status, 200);
  response = await library.PATCH(req("", "PATCH", { id: paper.id, revision: 1, patch: { note: "stale" } }));
  assert.equal(response.status, 409);
  assert.equal((await (await library.GET(req(`?id=${paper.id}`))).json()).paper.note, "keep");
});

test("a paper can be filed into a project and detached again", async () => {
  const paper = await add();
  const project = research.createResearchProject({ name: "Filing target" });
  let response = await library.PATCH(req("", "PATCH", { id: paper.id, addToProject: project.id }));
  assert.equal(response.status, 200);
  assert.ok((await response.json()).paper.projectIds.includes(project.id));
  assert.equal((await (await library.GET(req(`?project=${project.id}`))).json()).papers.length, 1);
  assert.equal((await library.PATCH(req("", "PATCH", { id: paper.id, addToProject: "missing" }))).status, 404);
  response = await library.PATCH(req("", "PATCH", { id: paper.id, removeFromProject: project.id }));
  assert.equal((await (await library.GET(req(`?project=${project.id}`))).json()).papers.length, 0);
});

test("text import is bounded, validated and cannot silently replace newer paper state", async () => {
  const paper = await add();
  let response = await source.POST(req("/source", "POST", { id: paper.id, revision: 1, text: "We compare sampled responses. ".repeat(20) }));
  assert.equal(response.status, 200);
  const updated = (await response.json()).paper;
  assert.equal(updated.source.kind, "pasted");
  response = await source.POST(req("/source", "POST", { id: paper.id, revision: 1, text: "Stale. ".repeat(20) }));
  assert.equal(response.status, 409);
  response = await source.POST(req("/source", "POST", { id: paper.id, revision: updated.revision, text: "x".repeat(100_001) }));
  assert.equal(response.status, 400);
  assert.equal(domain.getPaper(paper.id).source.text, updated.source.text);
});

test("paper follow-up uses the narrowly scoped research workflow, current context and a one-shot session", async () => {
  const paper = await add();
  const response = await agent.POST(req("/agent", "POST", { id: paper.id, revision: 1, question: "Explain the method", locale: "en" }));
  assert.equal(response.status, 200);
  const updated = (await response.json()).paper;
  assert.equal(updated.messages.length, 2);
  assert.equal(updated.status, "queued");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].toolNames, ["research_context", "research_search", "research_read", "research_save_summary", "research_relate", "web_search"]);
  assert.equal(calls[0].oneShot, true);
  assert.equal(calls[0].remembered, null);
  assert.equal(calls[0].lockKey, "research");
  assert.ok(calls[0].message.includes(paper.id));
  assert.match(calls[0].preamble, /CURRENT focus\/weekly objective/);
  assert.match(calls[0].preamble, /follow ALL nextOffset/);
  assert.match(calls[0].message, /Reply in English/);
  assert.match(calls[0].preamble, /untrusted DATA/);
  assert.match(calls[0].preamble, /Never invent pages/);
});

test("a concurrent note edit survives while the answer appends to the latest record", async () => {
  const paper = await add();
  globalThis.__researchTestTurn = async () => {
    domain.updatePaper(paper.id, 1, { note: "written by another tab" });
    return { reply: "A paid-for answer", sessionId: "test-session", usedTools: [] };
  };
  const response = await agent.POST(req("/agent", "POST", { id: paper.id, revision: 1, question: "Explain" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).paper.messages.at(-1).text, "A paid-for answer");
  assert.equal(domain.getPaper(paper.id).note, "written by another tab");
  assert.equal(domain.getPaper(paper.id).messages.length, 2);
});

test("workspace research persists discussion and supplies bounded prior context on follow-up", async () => {
  research.saveResearchObjective({ objective: "Current goal", note: "My notebook" });
  assert.equal((await researchAgent.POST(req("/research", "POST", { question: "Find and read two papers", locale: "zh-TW" }))).status, 200);
  let state = await (await researchAgent.GET(req())).json();
  assert.equal(state.messages.length, 2);
  assert.equal(state.run, null);
  assert.match(calls[0].message, /Traditional Chinese/);
  assert.match(calls[0].message, /Current goal/);
  assert.match(calls[0].preamble, /automatically|Do the research work yourself/);
  research.saveResearchObjective({ objective: "Changed goal for follow-up" });
  assert.equal((await researchAgent.POST(req("/research", "POST", { question: "How does it relate to HEAT?", locale: "en" }))).status, 200);
  state = await (await researchAgent.GET(req())).json();
  assert.equal(state.messages.length, 4);
  assert.match(calls[1].message, /Find and read two papers/);
  assert.match(calls[1].message, /Changed goal for follow-up/);
  assert.equal(research.readResearchObjective().objective, "Changed goal for follow-up");
});

test("the shared composer carries paper scope into the model and both stored messages", async () => {
  const paper = await add();
  const response = await researchAgent.POST(req("/research", "POST", { question: "Explain this assumption", paperId: paper.id }));
  assert.equal(response.status, 200);
  assert.ok(calls[0].message.includes(paper.id));
  assert.ok(calls[0].message.includes(paper.title));
  const state = await (await researchAgent.GET(req())).json();
  assert.deepEqual(state.messages.map((message) => message.paperId), [paper.id, paper.id]);
  assert.equal(domain.getPaper(paper.id).messages.length, 2);
  const invalid = await researchAgent.POST(req("/research", "POST", { question: "Read", paperId: "missing" }));
  assert.equal(invalid.status, 404);
  assert.equal(calls.length, 1, "invalid scope cannot spend a model turn");
});

test("research continues when a legacy paper transcript is full without discarding old entries", async () => {
  let paper = await add();
  for (let i = 0; i < 40; i++) paper = domain.recordPaperTurn(paper.id, paper.revision, `Question ${i}`, "Old answer", "old-session");
  const response = await researchAgent.POST(req("/research", "POST", { question: "One more question", paperId: paper.id }));
  assert.equal(response.status, 200);
  assert.equal(domain.getPaper(paper.id).messages.length, 80);
  assert.equal(research.readResearchConversation().messages.at(-1).role, "assistant");
  assert.equal(research.readResearchConversation().messages.at(-1).paperId, paper.id);
});

test("overlapping research is refused; stop works after reload and cannot publish a late answer", async () => {
  let release, started;
  const wait = new Promise((resolve) => { release = resolve; });
  const ready = new Promise((resolve) => { started = resolve; });
  globalThis.__researchTestTurn = async (options) => {
    options.remember("test-session"); started(); await wait;
    return { reply: "Late answer", sessionId: "test-session", usedTools: [] };
  };
  const running = researchAgent.POST(req("/research", "POST", { question: "Read" }));
  await ready;
  assert.equal((await (await researchAgent.GET(req())).json()).run.sessionId, "test-session");
  assert.equal((await researchAgent.POST(req("/research", "POST", { question: "Overlap" }))).status, 409);
  assert.equal((await researchAgent.DELETE(req("/research", "DELETE", {}))).status, 200);
  release();
  assert.equal((await running).status, 500);
  const state = await (await researchAgent.GET(req())).json();
  assert.equal(state.run, null);
  assert.equal(state.messages.length, 1);
  assert.equal(state.stopped, true, "a stop is recorded as the researcher's choice");
  assert.equal(state.error, undefined, "a stop is not an error");
});

test("research endpoints reject malformed, cross-origin and oversized requests", async () => {
  assert.equal((await researchAgent.POST(req("/research", "POST", null))).status, 400);
  assert.equal((await researchAgent.POST(req("/research", "POST", { question: "x".repeat(50_000) }))).status, 413);
  assert.equal((await researchAgent.DELETE(req("/research", "DELETE", {}, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await researchAgent.DELETE(req("/research", "DELETE", {}, { "content-type": "text/plain" }))).status, 415);
});

test("preview never writes, confirmation archives only the server snapshot and validates revision", async () => {
  const paper = await add();
  const preview = await (await archive.GET(req(`/export?id=${paper.id}`))).json();
  assert.deepEqual(readdirSync(vault), [".obsidian"]);
  let response = await archive.POST(req("/export", "POST", { id: paper.id, revision: 1, vaultId: "local", confirmed: false }));
  assert.equal(response.status, 400);
  response = await archive.POST(req("/export", "POST", { id: paper.id, revision: 0, vaultId: "local", confirmed: true }));
  assert.equal(response.status, 409);
  response = await archive.POST(req("/export", "POST", { id: paper.id, revision: 1, vaultId: "local", confirmed: true, content: "model-picked content MUST NOT publish" }));
  assert.equal(response.status, 200);
  const { archive: receipt } = await response.json();
  assert.equal(readFileSync(join(vault, receipt.relativePath), "utf8"), preview.content);
  assert.equal(domain.getPaper(paper.id).exports.length, 1);
});
