import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";
import { PDFDocument, degrees } from "pdf-lib";
import { unzipSync } from "fflate";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { cleanText, developerTool, pageNumbers, renamedFiles, safeFilename, tableConvert, wifiPayload, editPdf, zipFiles } = await jiti.import("./toolbox-browser.ts");

test("text cleanup is explicit and Unicode encoding is lossless", async () => {
  assert.equal(cleanText("a\r\na\n\nb", "dedupe"), "a\n\nb");
  assert.equal(cleanText(" A \n\n B ", "blank"), " A \n B ");
  assert.equal(cleanText("Hello\nworld\n\nNext", "unwrap"), "Hello world\n\nNext");
  assert.equal(cleanText("中文Hello123中文", "spacing"), "中文 Hello123 中文");
  const input = "中文 🌍\n".repeat(10000);
  assert.equal(await developerTool(await developerTool(input, "base64-encode"), "base64-decode"), input);
  assert.equal(await developerTool("0", "seconds"), "1970-01-01T00:00:00.000Z");
  assert.equal(await developerTool("1000", "milliseconds"), "1970-01-01T00:00:01.000Z");
  assert.match(await developerTool("a\nb\n", "diff", "a\nc\n"), /- b\n\+ c/);
  await assert.rejects(developerTool("not json", "json"));
  await assert.rejects(developerTool("2026-01-01T12:00:00", "iso"), /timezone/);
  assert.throws(() => cleanText("x", "unknown"));
});

test("rename previews preserve extensions and never create archive paths or collisions", async () => {
  assert.deepEqual(renamedFiles(["会议.m4a", "notes.txt"], "{date}-{n}-{name}", "notes", "$&", "2030-01-02"), ["2030-01-02-001-会议.m4a", "2030-01-02-002-$&.txt"]);
  assert.throws(() => renamedFiles(["A.txt", "a.txt"], "{name}", "", "", ""), /collide/);
  assert.equal(safeFilename("../bad/file.txt"), ".._bad_file.txt");
  assert.equal(safeFilename("CON.txt"), "_CON.txt");
  assert.ok(renamedFiles(["x".repeat(240) + ".txt"], "{n}-{name}", "", "", "")[0].endsWith(".txt"));
  const result = await zipFiles([{ name: "../x.txt", data: new TextEncoder().encode("kept") }]);
  const entries = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  assert.deepEqual(Object.keys(entries), [".._x.txt"]);
  assert.equal(new TextDecoder().decode(entries[".._x.txt"]), "kept");
});

test("CSV round trips quoted cells, keeps columns ordered, and escapes formulas only for spreadsheets", () => {
  const source = 'name,note\r\n中文,"a,b\nsecond"\r\n中文,"a,b\nsecond"';
  const converted = tableConvert(source, "csv", "json", "2,1", true, true);
  assert.deepEqual(JSON.parse(converted.text), [{ note: "a,b\nsecond", name: "中文" }]);
  assert.match(tableConvert('name,value\nx,=1+1', "csv", "csv", "", false, true).text, /'=1\+1/);
  assert.equal(JSON.parse(tableConvert('name,value\nx,=1+1', "csv", "json", "", false, true).text)[0].value, "=1+1");
  assert.throws(() => tableConvert("x,x\n1,2", "csv", "json", "", false, true), /unique/);
  assert.throws(() => tableConvert("x,y\n1", "csv", "csv", "", false, true), /different/);
  assert.throws(() => tableConvert('[{"nested":{}}]', "json", "csv", "", false, true), /Nested/);
  assert.equal(JSON.parse(tableConvert('__proto__,x\nvalue,1', "csv", "json", "", false, true).text)[0].__proto__, "value");
  assert.match(wifiPayload("A;B", "p:a"), /S:A\\;B;P:p\\:a/);
});

test("PDF merge, reorder, split and selective rotation produce usable pages", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]); doc.addPage([200, 200]); doc.addPage([300, 300]).setRotation(degrees(90));
  const file = new File([await doc.save()], "pages.pdf", { type: "application/pdf" });
  assert.deepEqual(pageNumbers("3-1,2", 3), [2, 1, 0, 1]);
  assert.throws(() => pageNumbers("0,1", 3));
  assert.throws(() => pageNumbers("1-999999999", 3));
  const extract = await PDFDocument.load(await (await editPdf([file], "extract", "3,1", 0)).blob.arrayBuffer());
  assert.deepEqual(extract.getPages().map((p) => p.getWidth()), [300, 100]);
  const merged = await PDFDocument.load(await (await editPdf([file, file], "merge", "", 0)).blob.arrayBuffer());
  assert.equal(merged.getPageCount(), 6);
  const rotated = await PDFDocument.load(await (await editPdf([file], "rotate", "2", 90)).blob.arrayBuffer());
  assert.deepEqual(rotated.getPages().map((p) => p.getRotation().angle), [0, 90, 90]);
  const split = unzipSync(new Uint8Array(await (await editPdf([file], "split", "3,1", 0)).blob.arrayBuffer()));
  assert.equal(Object.keys(split).length, 2);
  for (const bytes of Object.values(split)) assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  await assert.rejects(editPdf([new File(["bad pdf"], "bad.pdf")], "merge", "", 0));
});
