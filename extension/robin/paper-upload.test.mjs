import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { createJiti } from "jiti";
import { importResearchPdf, readResearchPaper } from "./paper-reading-domain.ts";
import { getPaperPdf } from "./paper-pdf-domain.ts";
import { getPaper, listPapers, updatePaper, paperEvidenceKey, paperMarkdown } from "./papers-domain.ts";
import { beginResearchRun, createResearchProject, updateResearchProject } from "./research-domain.ts";
import { discoverPapers } from "./paper-discovery-domain.ts";

const previous = process.env.ROBIN_DATA_DIR;
const root = mkdtempSync(join(tmpdir(), "paper-upload-test-"));
process.env.ROBIN_DATA_DIR = join(root, "data");
const pdf = Buffer.from("%PDF-1.7 original upload bytes");
const extracted = { text: "--- page 1 ---\nEvidence from a local paper. ".repeat(20), pages: 1, truncated: false };
const extract = async () => extracted;
const stub = join(root, "render.mjs");
writeFileSync(stub, `export async function extractPdfText() { return ${JSON.stringify(extracted)}; }`);
const jiti = createJiti(import.meta.url, { alias: { "@/lib/pdf-render": stub, "@": process.cwd() } });
const route = await jiti.import("../../app/api/research/papers/source/route.ts");
beforeEach(() => rmSync(process.env.ROBIN_DATA_DIR, { recursive: true, force: true }));
after(() => { rmSync(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });

function request({ projectId = "general", bytes = pdf, name = "local.pdf", fields = {}, headers = {} } = {}) {
  const form = new FormData(); form.set("projectId", projectId); form.set("file", new Blob([bytes], { type: "application/pdf" }), name);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("http://localhost/api/research/papers/source", { method: "POST", headers: { host: "localhost", ...headers }, body: form });
}

test("home imports without a URL, persists exact original, and reads by ID without network", async () => {
  const response = await route.POST(request({ name: "My local paper.pdf" }));
  assert.equal(response.status, 200);
  const { paper } = await response.json();
  assert.equal(paper.title, "My local paper"); assert.equal(paper.url, ""); assert.equal(paper.pdfUrl, "");
  assert.deepEqual(paper.projectIds, []); assert.equal(listPapers().length, 1);
  assert.equal(paper.source.text, extracted.text);
  const failNetwork = async () => { throw new Error("must not fetch"); };
  assert.equal((await readResearchPaper(paper.id, { extract: failNetwork, download: failNetwork, fetchPage: failNetwork })).id, paper.id);
  assert.deepEqual((await getPaperPdf(paper.id, { pageCount: async () => 1, download: failNetwork })).bytes, pdf);
  assert.match(paperMarkdown(paper), /source: "My local paper.pdf"/);
  assert.doesNotMatch(paperMarkdown(paper), /<>/);
  const run = beginResearchRun("Read the supplied PDF", paper.id, "general");
  assert.equal(run.paperId, paper.id); assert.equal(run.conversationId, `paper:general:${paper.id}`);
});

test("a real PDF passes Poppler extraction and direct HTTP import", { skip: !!spawnSync("pdftotext", ["-v"]).error }, async () => {
  const stream = "BT /F1 12 Tf 20 120 Td (A local research paper) Tj 0 -20 Td (We compare methods and report experimental evidence.) Tj 0 -20 Td (Results depend on the dataset and have limitations.) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let content = "%PDF-1.4\n"; const offsets = [];
  objects.forEach((object, index) => { offsets.push(content.length); content += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = content.length;
  content += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const realJiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });
  const realRoute = await realJiti.import("../../app/api/research/papers/source/route.ts");
  const response = await realRoute.POST(request({ bytes: Buffer.from(content), name: "real-paper.pdf" }));
  const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body));
  assert.match(body.paper.source.text, /A local research paper/);
  assert.match(body.paper.source.text, /experimental evidence/);
  assert.equal(body.paper.source.pages, 1); assert.equal(body.paper.source.truncated, false);
});

test("identical bytes are deduplicated, project membership is merged without replacing notes or evidence", async () => {
  const project = createResearchProject({ name: "Upload project", brief: "Study local PDFs", objective: "", links: [] });
  let paper = await importResearchPdf(pdf, "original.pdf", "general", { extract });
  paper = updatePaper(paper.id, paper.revision, { note: "Keep my notes", tags: "my-tag" });
  const key = paperEvidenceKey(paper);
  const repeated = await importResearchPdf(pdf, "renamed.pdf", project.id, { extract });
  assert.equal(repeated.id, paper.id); assert.equal(repeated.revision, paper.revision);
  assert.equal(repeated.note, "Keep my notes"); assert.equal(repeated.title, "original");
  assert.equal(paperEvidenceKey(repeated), key); assert.deepEqual(repeated.projectIds, [project.id]);
  assert.equal(listPapers().length, 1);
  const other = await importResearchPdf(Buffer.from("%PDF-1.7 different bytes"), "original.pdf", project.id, { extract });
  assert.notEqual(other.id, paper.id); assert.equal(listPapers().length, 2);
});

test("invalid, unreadable, failed and cancelled uploads never publish incomplete papers", async () => {
  await assert.rejects(importResearchPdf(Buffer.from("not PDF"), "fake.pdf", "general", { extract }), /not a PDF/);
  await assert.rejects(importResearchPdf(Buffer.alloc(20 * 1024 * 1024 + 1), "large.pdf", "general", { extract }), /20 MB/);
  await assert.rejects(importResearchPdf(pdf, "scan.pdf", "general", { extract: async () => ({ ...extracted, text: "--- page 1 ---\n" }) }), /OCR/);
  await assert.rejects(importResearchPdf(pdf, "broken.pdf", "general", { extract: async () => { throw new Error("Encrypted PDF"); } }), /Encrypted/);
  await assert.rejects(importResearchPdf(pdf, "local.pdf", "missing", { extract }), /not found/);
  const controller = new AbortController();
  await assert.rejects(importResearchPdf(pdf, "local.pdf", "general", { signal: controller.signal, extract: async () => { controller.abort(); return extracted; } }), /abort/i);
  assert.equal(listPapers().length, 0);
});

test("HTTP guards cover origin, scope, bytes and existing-paper revision without falling back to import", async () => {
  assert.equal((await route.POST(request({ headers: { origin: "https://evil.example" } }))).status, 403);
  assert.equal((await route.POST(request({ projectId: "missing" }))).status, 404);
  assert.equal((await route.POST(request({ bytes: Buffer.from("fake PDF") }))).status, 422);
  assert.equal((await route.POST(request({ headers: { "content-length": String(22 * 1024 * 1024) } }))).status, 413);
  assert.equal((await route.POST(request({ fields: { id: "missing", revision: "1" } }))).status, 404);
  assert.equal((await route.POST(request({ fields: { id: "", revision: "1" } }))).status, 400);
  const project = createResearchProject({ name: "Archived", brief: "", objective: "", links: [] });
  updateResearchProject(project.id, { archived: true });
  assert.equal((await route.POST(request({ projectId: project.id }))).status, 409);
  assert.equal(listPapers().length, 0);
});

test("local PDFs do not break public-link conversations or discovery library matching", async () => {
  const local = await importResearchPdf(pdf, "Local.pdf", "general", { extract });
  const run = beginResearchRun("https://example.org/new-paper", undefined, "general");
  assert.equal(run.paperId, undefined);
  const result = await discoverPapers({ projectId: "general", query: "retrieval", sources: ["crossref"] }, undefined, async () => [{
    title: "A public retrieval paper", url: "https://doi.org/10.1234/test", authors: ["Author"], year: "2025", abstract: "Retrieval results", pdfUrl: "", provider: "Crossref",
  }]);
  assert.equal(result.results.length, 1); assert.equal(result.results[0].libraryId, undefined);
  assert.equal(getPaper(local.id).title, "Local");
});
