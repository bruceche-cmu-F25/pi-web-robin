import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { createJiti } from "jiti";
const previous = process.env.ROBIN_DATA_DIR, directory = mkdtempSync(join(tmpdir(), "mindmap-api-"));
process.env.ROBIN_DATA_DIR = directory;
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, POST, PATCH, DELETE } = await jiti.import("./route.ts");
const agent = await jiti.import("./agent/route.ts");
after(() => { rmSync(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
const request = (method, body, headers = {}, query = "") => new Request(`http://localhost:30141/api/robin/mindmaps${query}`, {
  method, headers: { host: "localhost:30141", "content-type": "application/json", ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
const root = { id: "root", label: "Map", children: [{ id: "a", label: "Branch", children: [] }] };
test("HTTP adapters preserve atomic edits, history, replay safety and stale-write refusal", async () => {
  const id = randomUUID(), created = await POST(request("POST", { id, root }));
  assert.equal(created.status, 201);
  const input = { id, revision: 0, requestId: randomUUID(), action: "edit", operations: [{ kind: "rename", id: "a", label: "Changed" }] };
  assert.equal((await PATCH(request("PATCH", input))).status, 200);
  assert.equal((await PATCH(request("PATCH", input))).status, 200, "identical retry is safe");
  assert.equal((await PATCH(request("PATCH", { ...input, requestId: randomUUID() }))).status, 409);
  const listed = await (await GET(request("GET"))).json();
  assert.equal(listed.maps[0].title, "Map"); assert.equal(listed.maps[0].root, undefined); assert.equal(listed.maps[0].messages, undefined);
  const doc = (await (await GET(request("GET", undefined, {}, `?id=${id}`))).json()).map;
  assert.equal(doc.root.children[0].label, "Changed"); assert.equal(doc.canUndo, true);
  const base = { id, revision: doc.revision, mode: "edit", selectedIds: ["unknown"], message: "Explain", provider: "fixture", modelId: "fixture" };
  assert.equal((await agent.POST(request("POST", base))).status, 400, "invalid selection fails before invoking any model");
  assert.equal((await agent.POST(request("POST", { ...base, revision: 0 }))).status, 409);
  assert.equal((await DELETE(request("DELETE", { id, revision: 0 }))).status, 409);
  assert.equal((await DELETE(request("DELETE", { id, revision: doc.revision }))).status, 200);
  assert.equal((await GET(request("GET", undefined, {}, `?id=${id}`))).status, 404);
});
test("both endpoints reject bad origin, content type and oversized bodies before spending tokens or writing", async () => {
  const body = { id: randomUUID(), root };
  for (const handler of [POST, agent.POST]) {
    assert.equal((await handler(request("POST", body, { origin: "https://evil.example" }))).status, 403);
    assert.equal((await handler(request("POST", body, { "content-type": "text/plain" }))).status, 415);
    assert.equal((await handler(request("POST", body, { "content-length": "999999999" }))).status, 413);
  }
  assert.equal((await POST(request("POST", null))).status, 400);
  assert.equal((await agent.POST(new Request("http://localhost:30141/api/robin/mindmaps/agent", { method: "POST", headers: { host: "localhost:30141", "content-type": "application/json" }, body: '{"broken":' }))).status, 400);
  assert.equal((await GET(request("GET", undefined, {}, "?id=../../secrets"))).status, 400);
});
