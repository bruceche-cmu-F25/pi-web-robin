import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";
const { POST } = await createJiti(import.meta.url, { alias: { "@": process.cwd() } }).import("./route.ts");
const request = (body, origin = "http://localhost", type = "application/json") => new Request("http://localhost/api/robin/resume/preview", {
  method: "POST", headers: { Host: "localhost", Origin: origin, "Content-Type": type }, body: JSON.stringify(body),
});
test("preview requires same origin and bounded valid JSON, returns uncached errors", async () => {
  assert.equal((await POST(request({}, "https://evil.example"))).status, 403);
  assert.equal((await POST(request({}, "http://localhost", "text/plain"))).status, 415);
  for (const body of [null, {}, { source: "" }, { source: 42 }, { source: "\0" }]) assert.equal((await POST(request(body))).status, 400);
  const large = await POST(request({ source: "x".repeat(200001) }));
  assert.equal(large.status, 413); assert.equal(large.headers.get("cache-control"), "no-store");
  assert.equal((await POST(request({ source: "x".repeat(1_250_001) }))).status, 413);
  const aborted = new Request("http://localhost/api/robin/resume/preview", { method: "POST", headers: { Host: "localhost", Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ source: "source" }), signal: AbortSignal.abort() });
  assert.equal((await POST(aborted)).status, 499);
});
