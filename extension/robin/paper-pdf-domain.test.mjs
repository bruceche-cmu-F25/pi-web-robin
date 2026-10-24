import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { createJiti } from "jiti";
import { addPaper, getPaper, savePaperSource, paperEvidenceKey } from "./papers-domain.ts";
import { storePaperPdf, getPaperPdf, getPaperPdfPage } from "./paper-pdf-domain.ts";

const previous = process.env.ROBIN_DATA_DIR;
const root = mkdtempSync(join(tmpdir(), "paper-pdf-test-"));
process.env.ROBIN_DATA_DIR = join(root, "data");
const pdf = Buffer.from("%PDF-test original bytes"), image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const stub = join(root, "render.mjs");
writeFileSync(stub, `export async function pdfPageCount() { return 11; }
export async function renderPdfPage() { return new Uint8Array([255,216,255,217]); }
export async function extractPdfText() { return { text: 'Extracted evidence. '.repeat(20), pages: 11, truncated: false }; }`);
const jiti = createJiti(import.meta.url, { alias: { "@/lib/pdf-render": stub, "@": process.cwd() } });
const route = await jiti.import("../../app/api/research/papers/pdf/route.ts");
const upload = await jiti.import("../../app/api/research/papers/source/route.ts");
beforeEach(() => rmSync(process.env.ROBIN_DATA_DIR, { recursive: true, force: true }));
after(() => { rmSync(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
const add = () => addPaper({ title: "Paper", url: "https://example.org/paper", pdfUrl: "https://example.org/paper.pdf", authors: [], year: "", abstract: "", provider: "Test" });
const source = (extra = {}) => ({ text: "Evidence from the paper. ".repeat(20), kind: "pdf", label: "https://example.org/paper.pdf", pages: 11, truncated: false, loadedAt: new Date().toISOString(), ...extra });
const pageCount = async () => 11;

test("legacy remote originals are cached without altering the reading or evidence key", async () => {
  let paper = add(); paper = savePaperSource(paper.id, paper.revision, source());
  const key = paperEvidenceKey(paper); let downloads = 0, counts = 0;
  const options = { pageCount: async () => { counts++; return 11; }, download: async (url) => { downloads++; assert.equal(url, paper.source.label); return pdf; } };
  const first = await getPaperPdf(paper.id, options);
  assert.deepEqual(first.bytes, pdf); assert.equal(first.pages, 11);
  assert.equal((await getPaperPdf(paper.id, options)).hash, first.hash);
  assert.equal(downloads, 1); assert.equal(counts, 1);
  assert.equal(paperEvidenceKey(getPaper(paper.id)), key); assert.equal(getPaper(paper.id).revision, paper.revision);
  let renders = 0;
  const render = async (_bytes, page) => { renders++; assert.equal(page, 11); return image; };
  assert.deepEqual(await getPaperPdfPage(first, 11, render), image);
  assert.deepEqual(await getPaperPdfPage(first, 11, render), image);
  assert.equal(renders, 1);
  await assert.rejects(getPaperPdfPage(first, 12, render), /Invalid PDF page/);
});

test("new uploads retain their exact original bytes; old uploads do not silently substitute a remote PDF", async () => {
  const paper = add();
  const form = new FormData(); form.set("id", paper.id); form.set("revision", "1"); form.set("file", new Blob([pdf], { type: "application/pdf" }), "original.pdf");
  const response = await upload.POST(new Request("http://localhost/api/research/papers/source", { method: "POST", headers: { host: "localhost" }, body: form }));
  assert.equal(response.status, 200);
  const saved = (await response.json()).paper;
  assert.match(saved.source.pdfHash, /^[a-f0-9]{64}$/);
  assert.deepEqual((await getPaperPdf(paper.id, { pageCount, download: async () => { throw new Error("must not download"); } })).bytes, pdf);
  savePaperSource(paper.id, saved.revision, source({ label: "old-upload.pdf" }));
  await assert.rejects(getPaperPdf(paper.id, { pageCount, download: async () => { throw new Error("must not download"); } }), /Upload the PDF again/);
});

test("stored references, non-PDF content and oversized downloads are refused", async () => {
  assert.throws(() => storePaperPdf(Buffer.from("<html>not PDF</html>")), /not a PDF/);
  assert.throws(() => storePaperPdf(Buffer.alloc(20 * 1024 * 1024 + 1)), /20 MB/);
  const paper = add(); savePaperSource(paper.id, paper.revision, source({ pdfHash: "../../secret" }));
  await assert.rejects(getPaperPdf(paper.id, { pageCount }), /Invalid PDF reference/);
});

test("preview route serves only saved paper originals and rejects stale versions and invalid pages", async () => {
  const paper = add(); const hash = storePaperPdf(pdf);
  savePaperSource(paper.id, paper.revision, source({ pdfHash: hash, label: "upload.pdf" }));
  const req = (query) => new Request(`http://localhost/api/research/papers/pdf?${query}`, { headers: { host: "localhost" } });
  const meta = await route.GET(req(`id=${paper.id}`)); assert.equal(meta.status, 200); assert.deepEqual(await meta.json(), { hash, pages: 11 });
  const page = await route.GET(req(`id=${paper.id}&page=11&hash=${hash}`));
  assert.equal(page.headers.get("content-type"), "image/jpeg"); assert.deepEqual(Buffer.from(await page.arrayBuffer()), image);
  const original = await route.GET(req(`id=${paper.id}&download=1&hash=${hash}`));
  assert.equal(original.headers.get("content-type"), "application/pdf"); assert.deepEqual(Buffer.from(await original.arrayBuffer()), pdf);
  assert.equal((await route.GET(req(`id=${paper.id}&page=0`))).status, 400);
  assert.equal((await route.GET(req(`id=${paper.id}&page=12`))).status, 400);
  assert.equal((await route.GET(req(`id=${paper.id}&hash=wrong`))).status, 409);
  assert.equal((await route.GET(req("id=missing"))).status, 404);
});
