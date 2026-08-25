import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./pdf-render.ts");
  } catch {
    return import("./pdf-render.ts");
  }
}

function onePagePdf() {
  const stream = "BT /F1 24 Tf 20 100 Td (Hello) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test("recognizes a PDF header near the start of a file", async () => {
  const { hasPdfHeader } = await loadSubject();
  assert.equal(hasPdfHeader(Buffer.from("\n%PDF-1.7")), true);
  assert.equal(hasPdfHeader(Buffer.from("not a pdf")), false);
});

test("renders a PDF page to an attachable JPEG", { skip: spawnSync("pdftoppm", ["-v"]).error ? "pdftoppm is unavailable" : false }, async () => {
  const { renderPdfPages } = await loadSubject();
  const rendered = await renderPdfPages(onePagePdf(), 2);

  assert.equal(rendered.images.length, 1);
  assert.equal(rendered.images[0].mimeType, "image/jpeg");
  assert.deepEqual(Buffer.from(rendered.images[0].data, "base64").subarray(0, 2), Buffer.from([0xff, 0xd8]));
  assert.equal(rendered.truncated, false);
});
