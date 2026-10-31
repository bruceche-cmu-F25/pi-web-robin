import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createJiti } from "jiti";
const { readResumePdf } = await createJiti(import.meta.url).import("./resume-pdf.ts");
const unavailable = spawnSync("pdfinfo", ["-v"]).error || spawnSync("pdftotext", ["-v"]).error;
const pdf = async (texts) => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const text of texts) document.addPage([600, 800]).drawText(text, { x: 30, y: 750, font, size: 10, lineHeight: 16 });
  return document.save();
};
const text = "Ada Example\nada@example.test\nSoftware Engineer - Example Company\n2024 - 2026\nBuilt internal reporting tools in Python.";

test("PDF byte validation happens before starting local tools", async () => {
  await assert.rejects(readResumePdf(new Uint8Array()), error => error.status === 413);
  await assert.rejects(readResumePdf(new Uint8Array(5 * 1024 * 1024 + 1)), error => error.status === 413);
  await assert.rejects(readResumePdf(Buffer.from("not a PDF")), error => error.status === 415);
});
test("real Poppler extraction preserves every page of a selectable-text resume", { skip: unavailable ? "Poppler unavailable" : false }, async () => {
  const result = await readResumePdf(await pdf([text, text.replace("Ada", "Second page")]));
  assert.equal(result.pages, 2);
  assert.match(result.text, /Ada Example/); assert.match(result.text, /ada@example\.test/);
  assert.match(result.text, /--- page 2 ---/); assert.match(result.text, /Second page Example/);
});
test("scans/blank pages, mixed unreadable pages, too many pages and broken PDFs never partially convert", { skip: unavailable ? "Poppler unavailable" : false }, async () => {
  for (const pages of [[""], [text, ""]]) await assert.rejects(readResumePdf(await pdf(pages)), error => error.status === 422 && /OCR/.test(error.message));
  await assert.rejects(readResumePdf(await pdf(Array(6).fill(text))), error => error.status === 413);
  await assert.rejects(readResumePdf(Buffer.from("%PDF-1.7 broken")), error => error.status === 422);
});
test("abandoned uploads never continue into extraction", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readResumePdf(Buffer.from("%PDF-1.7"), controller.signal), { name: "AbortError" });
});
