import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";
const route = await createJiti(import.meta.url, { alias: { "@": process.cwd() } }).import("./route.ts");
const request = (form, origin = "http://localhost") => new Request("http://localhost/api/robin/resume/import", {
  method: "POST", headers: { Host: "localhost", Origin: origin }, body: form,
});
const form = (...files) => {
  const body = new FormData(); body.set("locale", "zh-CN");
  for (const file of files) body.append("file", file);
  return body;
};
test("PDF upload checks origin, multipart shape, signature and bounds before any paid generation", async () => {
  assert.equal((await route.POST(request(form(), "https://evil.example"))).status, 403);
  const json = new Request("http://localhost/api/robin/resume/import", { method: "POST", headers: { Host: "localhost", Origin: "http://localhost", "Content-Type": "application/json" }, body: "{}" });
  assert.equal((await route.POST(json)).status, 415);
  assert.equal((await route.POST(request(form()))).status, 400);
  const fake = new File(["not a pdf"], "resume.pdf", { type: "application/pdf" });
  assert.equal((await route.POST(request(form(fake)))).status, 415);
  assert.equal((await route.POST(request(form(fake, fake)))).status, 400);
  const huge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.pdf");
  assert.equal((await route.POST(request(form(huge)))).status, 413);
  const oversized = request(form(fake)); oversized.headers.set("content-length", String(6 * 1024 * 1024));
  assert.equal((await route.POST(oversized)).status, 413);
});
