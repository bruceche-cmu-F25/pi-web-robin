import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";
const dir = mkdtempSync(join(tmpdir(), "discovery-http-"));
const stub = join(dir, "discovery.mjs");
writeFileSync(stub, 'export async function discoverPapers(input, signal) { return globalThis.__discoveryHTTP(input, signal); }');
const jiti = createJiti(import.meta.url, { alias: { "@/extension/robin/paper-discovery-domain": stub, "@": process.cwd() } });
const route = await jiti.import("./route.ts");
after(() => { delete globalThis.__discoveryHTTP; rmSync(dir, { recursive: true, force: true }); });
const req = (body, headers = {}) => new Request("http://localhost/api/research/papers/search", { method: "POST", headers: { host: "localhost", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
test("discovery HTTP rejects cross-origin, non-JSON and oversized requests before searching", async () => {
  let calls = 0; globalThis.__discoveryHTTP = async () => { calls++; return {}; };
  assert.equal((await route.POST(req({}, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await route.POST(req({}, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await route.POST(req({ query: "x".repeat(9000) }))).status, 413);
  assert.equal(calls, 0);
});
test("discovery HTTP forwards explicit project/filter scope and cancellation, returning private metadata only", async () => {
  const input = { projectId: "heat", query: "hallucination", sources: ["arxiv"], fromYear: 2024, venue: "all" };
  globalThis.__discoveryHTTP = async (actual, signal) => { assert.deepEqual(actual, input); assert.ok(signal instanceof AbortSignal); return { results: [], sources: [{ source: "arxiv", errors: ["HTTP 429"] }] }; };
  const response = await route.POST(req(input));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual((await response.json()).sources[0].errors, ["HTTP 429"]);
});
