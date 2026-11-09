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
  const input = { id, revision: 0, requestId: randomUUID(), action: "edit", operations: [{ kind: "rename", id: "a", label: "Changed" }, { kind: "link", id: "a", url: "https://example.com/resource" }] };
  assert.equal((await PATCH(request("PATCH", input))).status, 200);
  assert.equal((await PATCH(request("PATCH", input))).status, 200, "identical retry is safe");
  assert.equal((await PATCH(request("PATCH", { ...input, requestId: randomUUID() }))).status, 409);
  const listed = await (await GET(request("GET"))).json();
  assert.equal(listed.maps[0].title, "Map"); assert.equal(listed.maps[0].root, undefined); assert.equal(listed.maps[0].messages, undefined);
  const doc = (await (await GET(request("GET", undefined, {}, `?id=${id}`))).json()).map;
  assert.equal(doc.root.children[0].label, "Changed"); assert.equal(doc.canUndo, true);
  assert.equal(doc.root.children[0].url, "https://example.com/resource");
  assert.equal((await PATCH(request("PATCH", { ...input, revision: doc.revision, requestId: randomUUID(), operations: [{ kind: "rename", id: "a", label: "Must not save" }, { kind: "link", id: "a", url: "javascript:alert(1)" }] }))).status, 400);
  assert.deepEqual((await (await GET(request("GET", undefined, {}, `?id=${id}`))).json()).map, doc);
  const base = { id, revision: doc.revision, mode: "edit", selectedIds: ["unknown"], message: "Explain", provider: "fixture", modelId: "fixture" };
  assert.equal((await agent.POST(request("POST", base))).status, 400, "invalid selection fails before invoking any model");
  assert.equal((await agent.POST(request("POST", { ...base, revision: 0 }))).status, 409);
  assert.equal((await DELETE(request("DELETE", { id, revision: 0 }))).status, 409);
  assert.equal((await DELETE(request("DELETE", { id, revision: doc.revision }))).status, 200);
  assert.equal((await GET(request("GET", undefined, {}, `?id=${id}`))).status, 404);
});
test("saved explanation adapter exposes on-demand Markdown and checks source/revision before writing", async () => {
  const { mindmapExplanationHash } = await jiti.import("../../../../extension/robin/mindmap-domain.ts");
  const id = randomUUID(); await POST(request("POST", { id, root }));
  const query = `?id=${id}&explanation=a`;
  assert.equal((await (await GET(request("GET", undefined, {}, query))).json()).explanation, null);
  const input = { id, revision: 0, requestId: randomUUID(), action: "explain", nodeId: "a", sourceHash: mindmapExplanationHash(root, "a"), markdown: "# Saved\n\n| A | B |\n| - | - |\n| 1 | 2 |" };
  assert.equal((await PATCH(request("PATCH", input))).status, 200);
  const response = await GET(request("GET", undefined, {}, query)), body = await response.json();
  assert.equal(body.explanation.markdown, input.markdown); assert.equal(body.explanation.stale, false);
  assert.equal(body.explanations[0].markdown, undefined);
  assert.equal((await PATCH(request("PATCH", input))).status, 200);
  assert.equal((await PATCH(request("PATCH", { ...input, revision: 1, requestId: randomUUID(), sourceHash: "forged" }))).status, 409);
  assert.equal((await GET(request("GET", undefined, {}, `?id=${id}&explanation=../../secret`))).status, 400);
  assert.equal((await agent.POST(request("POST", { id, revision: 1, message: "Explain", mode: "explain", selectedIds: [], provider: "fixture", modelId: "fixture" }))).status, 400);
});
test("1,000 multilingual topics and long selection IDs fit bounded HTTP bodies", async () => {
  const id = randomUUID(), large = { id: "root", label: "图", children: Array.from({ length: 999 }, (_, i) => ({ id: `n${i}`.padEnd(80, "x"), label: "文".repeat(60), children: [] })) };
  const payload = { id, root: large };
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) > 256_000, "fixture crosses the old CRUD body limit");
  assert.equal((await POST(request("POST", payload))).status, 201);
  const reopened = (await (await GET(request("GET", undefined, {}, `?id=${id}`))).json()).map;
  assert.deepEqual(reopened.root, large);
  const selection = { id, revision: 0, mode: "edit", selectedIds: [...large.children.map((n) => n.id), "missing"], message: "文".repeat(8000), provider: "fixture", modelId: "fixture" };
  assert.ok(Buffer.byteLength(JSON.stringify(selection)) > 64_000, "fixture crosses the old model request limit");
  const result = await agent.POST(request("POST", selection));
  assert.equal(result.status, 400);
  assert.match((await result.json()).error, /selected node no longer exists/, "body parsing succeeded; invalid selection prevents spending tokens");
  const overflow = await PATCH(request("PATCH", { id, revision: 0, requestId: randomUUID(), action: "edit", operations: [{ kind: "add", parent: "root", node: { id: "overflow", label: "One too many", children: [] } }] }));
  assert.equal(overflow.status, 413);
  assert.match((await overflow.json()).error, /1000 nodes/);
  assert.deepEqual((await (await GET(request("GET", undefined, {}, `?id=${id}`))).json()).map, reopened);
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
