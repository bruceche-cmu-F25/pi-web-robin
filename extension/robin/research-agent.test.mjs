import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { createJiti } from "jiti";
import { writeFileSync, mkdirSync } from "node:fs";
import { UNTITLED_PAPER, addPaper, getPaper, listPapers, paperEvidenceKey, paperMarkdown, savePaperAnalysis, savePaperSource, updatePaper } from "./papers-domain.ts";
import { appendResearchNote, attachResearchSession, beginResearchRun, cancelResearchRun, createResearchProject, finishResearchRun, listResearchProjects, readResearchConversation, readResearchObjective, researchContext, researchProgress, saveResearchObjective, setActiveResearchProject, updateResearchProject } from "./research-domain.ts";
import { knownPdfLinks, paperPageMetadata, readResearchPaper, rememberPaperCandidates } from "./paper-reading-domain.ts";
import { ROBIN_RESEARCH_TOOL_NAMES } from "./tools.ts";

const oldData = process.env.ROBIN_DATA_DIR;
const directory = mkdtempSync(join(tmpdir(), "research-agent-"));
process.env.ROBIN_DATA_DIR = directory;
const jiti = createJiti(import.meta.url);
const { registerResearchTools } = await jiti.import("./research-tools.ts");
const candidate = { title: "An evidence-backed paper", url: "https://example.org/paper", pdfUrl: "https://example.org/paper.pdf", authors: ["Author"], abstract: "We compare multiple sampled answers to identify inconsistency.", year: "2025", provider: "Test" };
const sourceText = "--- page 1 ---\n" + "We compare sampled answers, but agreement does not establish truth. ".repeat(300);
const extract = async () => ({ text: sourceText, pages: 2, truncated: false });
beforeEach(() => rmSync(directory, { recursive: true, force: true }));
after(() => { rmSync(directory, { recursive: true, force: true }); if (oldData === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = oldData; });
function registry() {
  const tools = new Map(); registerResearchTools({ registerTool: (tool) => tools.set(tool.name, tool) });
  const call = async (name, params = {}, signal) => JSON.parse((await tools.get(name).execute("test", params, signal, undefined, { sessionManager: { getSessionId: () => "test-session" } })).content[0].text);
  return { tools, call };
}
function storedPaper() {
  const paper = addPaper(candidate);
  return savePaperSource(paper.id, paper.revision, { text: sourceText, kind: "pdf", label: candidate.pdfUrl, pages: 2, truncated: false, loadedAt: new Date().toISOString() });
}

test("current objectives are shared with the existing notebook; omitted notes are preserved", () => {
  saveResearchObjective({ objective: "Check NLI direction", note: "Human project note" });
  saveResearchObjective({ objective: "Test atomic extraction" });
  assert.equal(readResearchObjective().note, "Human project note");
  const context = researchContext();
  assert.equal(context.weeklyObjective, "Test atomic extraction");
  assert.equal(context.projectNotes, "Human project note");
  assert.equal(context.project.name, "Research", "a first write without a project creates a general one");
  assert.equal(context.reference, undefined, "only HEAT carries the authored HEAT reference");
});

test("data saved before projects becomes the HEAT project, with its links and dated reference", () => {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "research-objective.json"), JSON.stringify({ objective: "Rerun the experiment", note: "Old notes", updatedAt: "2026-09-12T00:00:00.000Z" }));
  writeFileSync(join(directory, "research-conversation.json"), JSON.stringify({ messages: [{ id: "m1", role: "user", text: "Old question", at: "2026-09-12T00:00:00.000Z" }], run: null }));
  const { activeId, projects } = listResearchProjects();
  assert.equal(activeId, "heat");
  assert.equal(projects[0].name, "HEAT");
  assert.equal(readResearchObjective().objective, "Rerun the experiment");
  assert.equal(readResearchConversation().messages[0].text, "Old question");
  const context = researchContext();
  assert.match(context.reference.caveat, /NOT a live code audit/);
  assert.ok(context.project.links.some((link) => link.title.includes("Status")));
  // The first write persists the migration without losing the legacy content.
  appendResearchNote("New insight");
  assert.equal(readResearchObjective("heat").note, "Old notes\n\nNew insight");
});

test("projects keep separate focus, notebook, discussion and reading lists", async () => {
  const heat = createResearchProject({ name: "HEAT", brief: "Hallucination detection" });
  const bio = createResearchProject({ name: "Protein design", brief: "Inverse folding", objective: "Compare ProteinMPNN baselines", links: [{ title: "Repo", url: "https://github.com/example/repo" }] });
  assert.equal(listResearchProjects().activeId, bio.id, "a new project becomes the current one");
  saveResearchObjective({ objective: "Atomic facts" }, heat.id);
  appendResearchNote("Bio finding", bio.id);
  assert.equal(readResearchObjective(heat.id).note, "");
  assert.equal(readResearchObjective(bio.id).note, "Bio finding");
  const run = beginResearchRun("Which baselines?", undefined, bio.id);
  assert.equal(run.projectId, bio.id);
  finishResearchRun(run.id, { reply: "ProteinMPNN", sessionId: "s" });
  assert.equal(readResearchConversation(bio.id).messages.length, 2);
  assert.equal(readResearchConversation(heat.id).messages.length, 0);
  assert.throws(() => updateResearchProject(bio.id, { links: [{ url: "http://127.0.0.1/secret" }] }), /public/);
  assert.throws(() => updateResearchProject(bio.id, { note: "not editable here" }), /Invalid project edit/);
  updateResearchProject(bio.id, { archived: true });
  assert.equal(listResearchProjects().activeId, heat.id, "an archived project is not the current one");
  setActiveResearchProject(bio.id);
  assert.equal(listResearchProjects().projects.find((item) => item.id === bio.id).archived, undefined);

  const { call } = registry();
  const paper = storedPaper();
  setActiveResearchProject(heat.id);
  await call("research_context");
  const chunk = await call("research_read", { reference: paper.id });
  await call("research_read", { reference: paper.id, offset: chunk.nextOffset });
  await call("research_save_summary", { id: paper.id, sourceKey: chunk.sourceKey, abstractExplanation: "A", summary: "S", projectConnection: "For HEAT: compare sampled answers." });
  assert.deepEqual(getPaper(paper.id).projectIds, [heat.id]);
  assert.deepEqual(researchContext(bio.id).elsewhereInLibrary.map((item) => [item.id, item.hasReading]), [[paper.id, true]]);
  // Relating a read paper to another project reuses its reading and keeps the first connection.
  setActiveResearchProject(bio.id);
  await assert.rejects(registry().call("research_relate", { id: paper.id, projectConnection: "x" }), /research_context/);
  await call("research_context");
  const related = await call("research_relate", { id: paper.id, projectConnection: "For proteins: sample agreement as a confidence proxy." });
  assert.equal(related.project, "Protein design");
  const stored = getPaper(paper.id);
  assert.deepEqual(stored.projectIds, [heat.id, bio.id]);
  assert.equal(stored.analysis.connections[heat.id].text, "For HEAT: compare sampled answers.");
  assert.equal(stored.analysis.connections[bio.id].basis, "saved reading");
  assert.equal(stored.analysis.connections[bio.id].objective, "Compare ProteinMPNN baselines");
  const markdown = paperMarkdown(stored, false, { [heat.id]: "HEAT", [bio.id]: "Protein design" });
  assert.match(markdown, /projects: \["\[\[HEAT\]\]","\[\[Protein design\]\]"\]/);
  assert.match(markdown, /Connection to Protein design/);
  assert.match(markdown, /"Protein-design"/);
});

test("the research home reads a paper without a project and files it into one later", async () => {
  const project = createResearchProject({ name: "Protein design", brief: "Inverse folding" });
  assert.equal(researchContext("general").project.general, true, "the home exists before anything is written");
  assert.deepEqual(researchContext("general").otherProjects.map((item) => item.name), ["Protein design"]);
  const run = beginResearchRun("Summarise this paper", undefined, "general");
  assert.equal(run.projectId, "general");
  attachResearchSession(run.id, "test-session");
  const { call } = registry();
  const paper = storedPaper();
  await call("research_context");
  const chunk = await call("research_read", { reference: paper.id });
  await call("research_read", { reference: paper.id, offset: chunk.nextOffset });
  const saved = await call("research_save_summary", { id: paper.id, sourceKey: chunk.sourceKey, abstractExplanation: "A", summary: "S" });
  assert.equal(saved.url, `/research?paper=${paper.id}`);
  let stored = getPaper(paper.id);
  assert.deepEqual(stored.projectIds, ["general"]);
  assert.deepEqual(stored.analysis.connections, {}, "a home reading invents no project connection");
  await assert.rejects(call("research_relate", { id: paper.id, projectConnection: "x" }), /no project/);
  finishResearchRun(run.id, { reply: "Summary", sessionId: "test-session" });
  assert.equal(readResearchConversation("general").messages.length, 2);
  assert.equal(readResearchConversation(project.id).messages.length, 0);
  assert.throws(() => updateResearchProject("general", { archived: true }), /cannot be renamed or archived/);
  // A project reading still requires its connection.
  setActiveResearchProject(project.id);
  const { call: projectCall } = registry();
  await projectCall("research_context");
  await projectCall("research_read", { reference: paper.id });
  await projectCall("research_read", { reference: paper.id, offset: chunk.nextOffset });
  await assert.rejects(projectCall("research_save_summary", { id: paper.id, sourceKey: chunk.sourceKey, abstractExplanation: "A", summary: "S" }), /Expected non-empty text/);
  stored = getPaper(paper.id);
  assert.deepEqual(stored.projectIds, ["general", project.id]);
});

test("bounded notebook context retains both project framing and the newest saved insights", () => {
  saveResearchObjective({ objective: "Current objective", note: `Project framing\n${"old context ".repeat(2500)}\nNewest evidence and next experiment` });
  const context = researchContext();
  assert.equal(context.projectNotesTruncated, true);
  assert.match(context.projectNotes, /^Project framing/);
  assert.match(context.projectNotes, /Newest evidence and next experiment$/);
  assert.match(context.projectNotes, /Middle of notebook omitted/);
  assert.ok(context.projectNotes.length < 20_100);
});

test("a new research turn serializes, keeps history, supports cancellation before session acquisition and ignores late writes", () => {
  const first = beginResearchRun("Read papers for my goal");
  assert.throws(() => beginResearchRun("Overlap"), /already running/);
  cancelResearchRun();
  assert.equal(attachResearchSession(first.id, "too-late"), false);
  finishResearchRun(first.id, { error: "Stopped" });
  const second = beginResearchRun("Continue");
  assert.equal(attachResearchSession(second.id, "session2"), true);
  researchProgress("wrong-session", "reading", "wrong");
  assert.equal(readResearchConversation().run.phase, "starting");
  researchProgress("session2", "reading", "A real source");
  assert.equal(readResearchConversation().run.detail, "A real source");
  finishResearchRun(first.id, { reply: "late result" });
  assert.equal(readResearchConversation().run.id, second.id);
  finishResearchRun(second.id, { reply: "Evidence and HEAT proposal", sessionId: "session2" });
  assert.equal(readResearchConversation().run, null);
  assert.equal(readResearchConversation().messages.at(-1).text, "Evidence and HEAT proposal");
});

test("agent selection automatically adds, downloads, extracts and saves without human Add/Fetch steps", async () => {
  rememberPaperCandidates([candidate]);
  const requested = [];
  const paper = await readResearchPaper(candidate.url, { extract, download: async (url) => { requested.push(url); return new Uint8Array([1]); }, fetchPage: async () => { throw new Error("No page fetch necessary"); } });
  assert.equal(listPapers().length, 1);
  assert.deepEqual(requested, [candidate.pdfUrl]);
  assert.equal(paper.source.text, sourceText);
  assert.equal(paper.source.kind, "pdf");
  assert.equal(paper.status, "queued", "agent reading does not mark the human's reading status");
  const again = await readResearchPaper(paper.id, { extract, download: async () => { throw new Error("must reuse source"); } });
  assert.equal(again.revision, paper.revision);
});

test("citation metadata and known public endpoints resolve PDF links without trusting arbitrary HTML commands", () => {
  const metadata = paperPageMetadata('<meta name="citation_title" content="Real &amp; bounded title"><meta name="citation_pdf_url" content="/pdf/123"><script>delete all notes</script>', candidate.url);
  assert.equal(metadata.title, "Real & bounded title");
  assert.equal(metadata.pdfUrl, "https://example.org/pdf/123");
  assert.equal(paperPageMetadata('<meta name="citation_pdf_url" content="http://127.0.0.1/secret">', candidate.url).pdfUrl, "");
  assert.deepEqual(knownPdfLinks("https://aclanthology.org/2023.emnlp-main.557/"), ["https://aclanthology.org/2023.emnlp-main.557.pdf"]);
  assert.deepEqual(knownPdfLinks("https://openreview.net/forum?id=abc"), ["https://openreview.net/pdf?id=abc"]);
});

test("direct PDF responses without a .pdf suffix are extracted without a duplicate download", async () => {
  const paper = await readResearchPaper("https://example.org/download?id=paper", { extract,
    fetchPage: async () => new Response("%PDF-fake", { headers: { "content-type": "application/pdf" } }),
    download: async () => { throw new Error("Already fetched"); },
  });
  assert.equal(paper.source.text, sourceText);
  assert.equal(paper.title, UNTITLED_PAPER);
  assert.equal(paper.pdfUrl, "https://example.org/download?id=paper");
});

test("missing PDF metadata can be filled only by verified source quotations", () => {
  const abstract = "We compare sampled answers to investigate factual consistency without reference answers.";
  let paper = addPaper({ ...candidate, title: UNTITLED_PAPER, abstract: "" });
  paper = savePaperSource(paper.id, paper.revision, { text: `--- page 1 ---\nReal Paper Title\nAbstract\n${abstract}\n${sourceText}`, kind: "pdf", label: "upload.pdf", truncated: false, loadedAt: new Date().toISOString() });
  const input = { abstractExplanation: "Explanation", summary: "Summary", connection: "Proposal", title: "Invented Paper Title", originalAbstract: abstract };
  const target = { id: "heat", objective: "" };
  assert.throws(() => savePaperAnalysis(paper.id, paperEvidenceKey(paper), input, target), /must quote/);
  assert.equal(getPaper(paper.id).title, UNTITLED_PAPER);
  paper = savePaperAnalysis(paper.id, paperEvidenceKey(paper), { ...input, title: "Real Paper Title" }, target);
  assert.equal(paper.title, "Real Paper Title");
  assert.equal(paper.abstract, abstract);
  assert.equal(paper.analysis.sourceKey, paperEvidenceKey(paper));
  assert.equal(paper.analysis.outdated, undefined);
});

test("after a failed direct PDF the resolver tries landing-page citation metadata", async () => {
  rememberPaperCandidates([candidate]);
  const attempts = [];
  const paper = await readResearchPaper(candidate.url, { extract,
    download: async (url) => { attempts.push(url); if (url === candidate.pdfUrl) throw new Error("404"); return new Uint8Array([1]); },
    fetchPage: async () => new Response('<meta name="citation_pdf_url" content="/open-access.pdf">'),
  });
  assert.deepEqual(attempts, [candidate.pdfUrl, "https://example.org/open-access.pdf"]);
  assert.equal(paper.source.label, "https://example.org/open-access.pdf");
  assert.equal(paper.access, undefined);
});

test("unavailable full text records real failures and source/download links, and an alternate public PDF recovers", async () => {
  rememberPaperCandidates([candidate]);
  const paper = await readResearchPaper(candidate.url, { extract, download: async () => { throw new Error("HTTP 403"); }, fetchPage: async () => { throw new Error("Publisher unavailable"); } });
  assert.equal(paper.source, null);
  assert.equal(paper.access.state, "needs-pdf");
  assert.deepEqual(paper.access.links, [candidate.url, candidate.pdfUrl]);
  assert.match(paper.access.attempts[0].error, /403/);
  const recovered = await readResearchPaper(paper.id, { extract, download: async () => new Uint8Array([1]) }, "https://example.org/open.pdf");
  assert.equal(recovered.source.label, "https://example.org/open.pdf");
  assert.equal(recovered.access, undefined);
});

test("cancellation and concurrent human edits cannot publish extracted text over newer state", async () => {
  const paper = addPaper(candidate);
  const controller = new AbortController();
  await assert.rejects(readResearchPaper(paper.id, { signal: controller.signal, download: async () => new Uint8Array([1]), extract: async () => { controller.abort(); return extract(); } }));
  assert.equal(getPaper(paper.id).source, null);
  await assert.rejects(readResearchPaper(paper.id, { download: async () => new Uint8Array([1]), extract: async () => { updatePaper(paper.id, paper.revision, { note: "Concurrent human writing" }); return extract(); } }), /changed elsewhere/);
  assert.equal(getPaper(paper.id).note, "Concurrent human writing");
  assert.equal(getPaper(paper.id).source, null);
});

test("summary tool requires every real source chunk and current HEAT context, while preserving human notes", async () => {
  const { tools, call } = registry();
  assert.deepEqual([...tools.keys()], ["research_context", "research_search", "research_read", "research_save_summary", "research_relate"]);
  assert.ok([...tools.values()].every((tool) => tool.defaultActive === false));
  assert.deepEqual(ROBIN_RESEARCH_TOOL_NAMES, [...tools.keys(), "web_search"]);
  let paper = storedPaper();
  saveResearchObjective({ objective: "Compare atomic and sentence-level consistency" });
  assert.equal((await call("research_context")).weeklyObjective, "Compare atomic and sentence-level consistency");
  const chunk = await call("research_read", { reference: paper.id });
  assert.equal(chunk.nextOffset, 12_000);
  const summary = { id: paper.id, sourceKey: chunk.sourceKey, abstractExplanation: "Consistency can flag disagreements.", summary: "The source compares samples [p. 1].", projectConnection: "Proposal: compare atomic vs sentence-level consistency." };
  await assert.rejects(call("research_save_summary", summary), /every chunk/);
  await call("research_read", { reference: paper.id, offset: chunk.nextOffset });
  paper = updatePaper(paper.id, paper.revision, { note: "My independent interpretation" });
  assert.equal((await call("research_save_summary", summary)).saved, true);
  paper = getPaper(paper.id);
  assert.equal(paper.note, "My independent interpretation");
  assert.equal(paper.analysis.objective, "Compare atomic and sentence-level consistency");
  assert.equal(paper.status, "queued");
  assert.match(paperMarkdown(paper, false), /AI reading summary/);
  assert.match(paperMarkdown(paper, false), /Proposal: compare atomic/);
});

test("a changed source invalidates both stored analysis and the tool's read receipt", async () => {
  const { call } = registry();
  let paper = storedPaper();
  await call("research_context");
  const chunk = await call("research_read", { reference: paper.id });
  await call("research_read", { reference: paper.id, offset: chunk.nextOffset });
  const summary = { id: paper.id, sourceKey: chunk.sourceKey, abstractExplanation: "Abstract explained", summary: "Evidence", projectConnection: "Proposal" };
  await call("research_save_summary", summary);
  paper = getPaper(paper.id);
  paper = savePaperSource(paper.id, paper.revision, { ...paper.source, text: "New source evidence. ".repeat(20) });
  assert.equal(paper.analysis.outdated, true);
  await assert.rejects(call("research_save_summary", summary), /every chunk/);
  assert.throws(() => savePaperAnalysis(paper.id, chunk.sourceKey, { ...summary, connection: "Proposal" }, { id: "heat", objective: "" }), /source changed/);
  assert.notEqual(paperEvidenceKey(paper), chunk.sourceKey);
});
