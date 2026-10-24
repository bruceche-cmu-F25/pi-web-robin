import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverPapers, discoveryQueries } from "./paper-discovery-domain.ts";
import { addPaper, listPapers, updatePaper } from "./papers-domain.ts";
import { createResearchProject, readResearchObjective, saveResearchObjective as writeObjective } from "./research-domain.ts";

const previous = process.env.ROBIN_DATA_DIR, directory = mkdtempSync(join(tmpdir(), "paper-discovery-"));
process.env.ROBIN_DATA_DIR = directory;
beforeEach(() => rmSync(directory, { recursive: true, force: true }));
after(() => { rmSync(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
function saveResearchObjective(input, projectId) {
  return writeObjective({ ...input, revision: readResearchObjective(projectId).revision }, projectId);
}
const metadata = (extra = {}) => ({ title: "Reducing false positives in hallucination detection", url: "https://arxiv.org/abs/2401.12345v2", authors: ["A. Researcher"], year: "2024", abstract: "We study RAG consistency and false positive rates for large language models.", pdfUrl: "https://arxiv.org/pdf/2401.12345", provider: "arXiv", ...extra });
const project = (extra = {}) => createResearchProject({ name: "HEAT", brief: "Hallucination detection for RAG answers", objective: "Improve false positives, one optimization at a time", ...extra });

test("default queries use recognised public concepts, never private notebook/brief contents", async () => {
  const p = project({ brief: "Secret customer ZZZ. Hallucination detection for RAG answers" });
  saveResearchObjective({ objective: p.objective, note: "private diary" }, p.id);
  const requests = [];
  const result = await discoverPapers({ projectId: p.id, query: "" }, undefined, async (source, query) => { requests.push({ source, query }); return []; });
  assert.deepEqual(result.queries, ["hallucination retrieval augmented generation", "hallucination false positive"]);
  assert.equal(requests.length, 6);
  assert.ok(requests.every(({ query }) => !/Secret|ZZZ|private|optimization/.test(query)));
  assert.equal(listPapers().length, 0);
  assert.equal(readResearchObjective(p.id).note, "private diary");
  assert.deepEqual(discoveryQueries("降低误报率", p.brief, p.objective), ["false positive hallucination"]);
  assert.throws(() => discoveryQueries("", "Private unknown customer project", ""), /Enter scholarly keywords/);
  assert.throws(() => discoveryQueries("中世纪诗歌", "", ""), /English scholarly keywords/);
});

test("cross-catalog dedupe merges DOI/preprint aliases, preserves abstracts and existing human notes", async () => {
  const p = project();
  const saved = addPaper(metadata(), "general");
  updatePaper(saved.id, saved.revision, { note: "My existing notes" });
  const sources = {
    arxiv: [metadata(), metadata({ title: "A study of unrelated cloud infrastructure", url: "https://arxiv.org/abs/2401.99999", abstract: "Container orchestration.", authors: ["Different Author"] })],
    crossref: [metadata({ url: "https://doi.org/10.1234/PAPER", doi: "10.1234/paper", abstract: "", provider: "Crossref", venue: "Proceedings of EMNLP" })],
    "semantic-scholar": [metadata({ url: "https://doi.org/10.1234/paper", doi: "10.1234/paper", provider: "Semantic Scholar" })],
  };
  const result = await discoverPapers({ projectId: p.id, query: "hallucination detection" }, undefined, async source => sources[source]);
  assert.equal(result.found, 2);
  const top = result.results[0];
  assert.equal(top.url, "https://doi.org/10.1234/paper");
  assert.deepEqual(top.catalogs, ["arxiv", "crossref", "semantic-scholar"]);
  assert.equal(top.abstract, metadata().abstract);
  assert.equal(top.abstractSource, "Semantic Scholar");
  assert.equal(top.venue, "Proceedings of EMNLP");
  assert.equal(top.libraryId, saved.id);
  assert.equal(top.inProject, false);
  assert.ok(top.projectMatches.includes("false positive"));
  assert.ok(top.queryMatches.includes("hallucination"));
  assert.ok(top.score > result.results[1].score);
  assert.equal(listPapers().length, 1, "search never gathers candidates into the library");
  assert.equal(listPapers()[0].note, "My existing notes");
});

test("venue matching uses publication metadata, not title mentions; unknown metadata stays honest", async () => {
  const p = project();
  const rows = [
    metadata({ url: "https://doi.org/10.1234/1", title: "One", venue: "Transactions of the Association for Computational Linguistics" }),
    metadata({ url: "https://doi.org/10.1234/2", title: "NeurIPS ACL EMNLP is in this title", venue: "", year: "2025", abstract: "" }),
    metadata({ url: "https://doi.org/10.1234/3", title: "Three", venue: "EMNLP", year: "2020" }),
    metadata({ url: "https://doi.org/10.1234/4", title: "Four", venue: "Lecture Notes in Computer Science" }),
  ];
  const search = async () => rows;
  const result = await discoverPapers({ projectId: p.id, query: "hallucination", sources: ["crossref"], venue: "nlp", fromYear: 2024 }, undefined, search);
  assert.equal(result.results.length, 1); assert.equal(result.filtered, 3);
  const journals = await discoverPapers({ projectId: p.id, query: "hallucination", sources: ["crossref"], venue: "journals" }, undefined, search);
  assert.deepEqual(journals.results.map(p=>p.title), ["One"]);
  const all = await discoverPapers({ projectId: p.id, query: "hallucination", sources: ["crossref"] }, undefined, search);
  assert.equal(all.results.length, 4);
  assert.equal(all.results.find(p=>p.title.startsWith("NeurIPS")).abstract, "");
});

test("text RAG project ranks task matches before visual hallucinations without hiding them", async () => {
  const p = project();
  const rows = [metadata({ title: "Reducing false positives in Visual Language Models", url: "https://doi.org/10.1234/vision" }), metadata({ title: "Hallucination detection for retrieval augmented generation", url: "https://doi.org/10.1234/rag" })];
  const result = await discoverPapers({ projectId: p.id, query: "hallucination", sources: ["crossref"] }, undefined, async () => rows);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].url, "https://doi.org/10.1234/rag");
  assert.equal(result.results[1].differentModality, true);
  assert.ok(!result.projectTerms.includes("time"), "generic planning words are not research concepts");
  const visual = project({ name: "Visual", brief: "Hallucination in visual language models" });
  const visualResult = await discoverPapers({ projectId: visual.id, query: "hallucination", sources: ["crossref"] }, undefined, async () => rows);
  assert.ok(visualResult.results.every(p=>!p.differentModality));
});

test("provider failures return partial results and all-failed is distinguishable from no matches", async () => {
  const p = project();
  const result = await discoverPapers({ projectId: p.id, query: "RAG" }, undefined, async source => {
    if (source !== "crossref") throw new Error("HTTP 429");
    return [metadata({ provider: "Crossref" })];
  });
  assert.equal(result.results.length, 1);
  assert.equal(result.sources.filter(s=>s.errors.length).length, 2);
  const none = await discoverPapers({ projectId: p.id, query: "RAG" }, undefined, async () => { throw new Error("Timeout"); });
  assert.equal(none.results.length, 0);
  assert.ok(none.sources.every(s=>s.errors.length));
  assert.ok(none.scholarUrl.startsWith("https://scholar.google.com/scholar?"));
});

test("ranking uses the current project, not another project's notes or an old focus", async () => {
  const p = project({ brief: "", objective: "false positive" });
  const other = project({ name: "Other", brief: "Secret other project", objective: "protein" });
  const rows = [metadata({ title: "False positives", abstract: "", url: "https://doi.org/10.1234/1" }), metadata({ title: "Calibration", abstract: "", url: "https://doi.org/10.1234/2" })];
  const search = async () => rows;
  assert.equal((await discoverPapers({ projectId: p.id, query: "language models", sources: ["crossref"] }, undefined, search)).results[0].title, "False positives");
  saveResearchObjective({ objective: "calibration" }, p.id);
  const result = await discoverPapers({ projectId: p.id, query: "language models", sources: ["crossref"] }, undefined, search);
  assert.equal(result.results[0].title, "Calibration");
  assert.ok(!result.projectTerms.includes("protein"));
  assert.equal(readResearchObjective(other.id).objective, "protein");
});

test("invalid filters, unsafe source metadata and cancellation never import papers", async () => {
  const p = project(); let calls = 0;
  const search = async () => { calls++; return []; };
  for (const patch of [{ sources: [] }, { sources: ["google"] }, { venue: "top-everything" }, { fromYear: 1700 }, { query: "x".repeat(501) }, { projectId: "missing" }]) {
    await assert.rejects(discoverPapers({ projectId: p.id, query: "RAG", ...patch }, undefined, search));
  }
  assert.equal(calls, 0);
  const result = await discoverPapers({ projectId: p.id, query: "RAG", sources: ["arxiv"] }, undefined, async () => [metadata({ url: "javascript:alert(1)" }), metadata()]);
  assert.equal(result.results.length, 1);
  assert.match(result.sources[0].errors[0], /Invalid/);
  const controller = new AbortController();
  await assert.rejects(discoverPapers({ projectId: p.id, query: "RAG" }, controller.signal, async () => { controller.abort(); throw controller.signal.reason; }));
  assert.equal(listPapers().length, 0);
});
