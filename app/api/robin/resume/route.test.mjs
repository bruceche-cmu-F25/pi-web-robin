import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const previous = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), "resume-api-"));
process.env.ROBIN_DATA_DIR = dir;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const route = await jiti.import("./route.ts");
const documents = await jiti.import("./documents/route.ts");
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
test("named resumes are selectable and saved independently", async () => {
  const input = (method, url, value, origin = "http://localhost") => new Request(`http://localhost/api/robin/resume${url}`, { method,
    headers: { Host: "localhost", Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  const created = await documents.POST(input("POST", "/documents", { name: "Target role", source: "" }));
  assert.equal(created.status, 200);
  const { document: first, resumes } = await created.json();
  assert.equal(resumes.length, 2);
  assert.equal((await route.GET(new Request(`http://localhost/api/robin/resume?id=${first.id}`, { headers: { Host: "localhost" } }))).status, 200);
  assert.equal((await route.PUT(input("PUT", `?id=${first.id}`, { source: "two", revision: first.revision }))).status, 200);
  assert.equal((await route.GET(request("GET"))).status, 200);
  assert.equal((await route.PUT(input("PUT", "?id=../resume", { source: "x", revision: "empty" }))).status, 404);
  assert.equal((await documents.PATCH(input("PATCH", "/documents", { id: first.id, name: "Updated" }))).status, 200);
  assert.equal((await documents.POST(input("POST", "/documents", { name: "", source: "" }))).status, 400);
  assert.equal((await documents.POST(input("POST", "/documents", { name: "Invalid", source: "" }, "https://evil.example"))).status, 403);
});
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
