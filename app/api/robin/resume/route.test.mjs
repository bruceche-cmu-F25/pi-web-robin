import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const previous = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), "resume-api-"));
process.env.ROBIN_DATA_DIR = dir;
const route = await createJiti(import.meta.url, { alias: { "@": process.cwd() } }).import("./route.ts");
after(() => {
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
  rmSync(dir, { recursive: true, force: true });
});
function request(method, value, origin = "http://localhost", type = "application/json") {
  return new Request("http://localhost/api/robin/resume", { method,
    headers: { Host: "localhost", Origin: origin, "Content-Type": type },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
}
test("inert private reads, bounded guarded saves, explicit conflict", async () => {
  const read = await route.GET(request("GET"));
  assert.equal(read.status, 200); assert.equal(read.headers.get("cache-control"), "no-store");
  const { document } = await read.json();
  assert.equal((await route.PUT(request("PUT", { revision: document.revision, source: "one" }))).status, 200);
  assert.equal((await route.PUT(request("PUT", { revision: document.revision, source: "two" }))).status, 409);
  assert.equal((await route.PUT(request("PUT", { source: "two" }))).status, 409);
  assert.equal((await route.PUT(request("PUT", {}, "https://evil.example"))).status, 403);
  assert.equal((await route.PUT(request("PUT", {}, "http://localhost", "text/plain"))).status, 415);
  assert.equal((await route.PUT(request("PUT", { revision: "empty", source: "x".repeat(200001) }))).status, 413);
  assert.equal((await route.POST(request("POST", { instruction: "x" }))).status, 400);
  assert.equal((await route.POST(request("POST", { source: "", instruction: "Make a CV", useProfile: false, jobDescription: "" }))).status, 400);
  assert.equal((await route.POST(request("POST", {}, "https://evil.example"))).status, 403);
  const oversized = new Request("http://localhost/api/robin/resume", { method: "PUT", headers: { Host: "localhost", Origin: "http://localhost", "Content-Type": "application/json", "Content-Length": "1500001" }, body: "{}" });
  assert.equal((await route.PUT(oversized)).status, 413);
});
