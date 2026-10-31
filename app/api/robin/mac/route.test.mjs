import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";
const { GET, POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
const req = (body, headers = {}, raw = false) => new Request("http://localhost:30141/api/robin/mac", {
  method: "POST", headers: { host: "localhost:30141", origin: "http://localhost:30141", "content-type": "application/json", ...headers }, body: raw ? body : JSON.stringify(body),
});
test("route rejects remote hosts, rebinding and cross-site requests before disk work", async () => {
  for (const headers of [{ host: "192.168.1.12:30141" }, { host: "evil.example:30141" }, { origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }, { origin: "null" }]) {
    assert.equal((await POST(req({ action: "scan" }, headers))).status, 403);
  }
  assert.equal((await GET(new Request("http://localhost:30141/api/robin/mac", { headers: { host: "192.168.1.12:30141" } }))).status, 403);
});
test("route validates JSON, bounds and actions without moving anything", { skip: process.platform !== "darwin" || process.getuid?.() === 0 }, async () => {
  assert.equal((await POST(req({ action: "scan" }, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await POST(req("{", {}, true))).status, 400);
  assert.equal((await POST(req({ action: "rm", path: "/Users" }))).status, 400);
  assert.equal((await POST(req({ action: "trash", scanId: "invented", ids: ["npm"], confirmed: true }))).status, 409);
  assert.equal((await POST(req({ action: "scan", padding: "x".repeat(5000) }))).status, 413);
});
