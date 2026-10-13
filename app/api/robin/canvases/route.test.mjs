import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";

const previous = process.env.ROBIN_DATA_DIR;
const directory = mkdtempSync(join(tmpdir(), "robin-canvas-api-"));
process.env.ROBIN_DATA_DIR = directory;
const { GET, POST, PATCH, DELETE } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
after(() => { rmSync(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
const request = (method, body, headers = {}, query = "") => new Request(`http://localhost:30141/api/robin/canvases${query}`, {
  method, headers: { host: "localhost:30141", "content-type": "application/json", ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

test("canvas API persists independent documents, protects stale writes and keeps scene data out of lists", async () => {
  const created = await POST(request("POST", { title: "API board" }));
  assert.equal(created.status, 201);
  const { canvas } = await created.json();
  const patch = { ...canvas, title: "Saved" };
  assert.equal((await PATCH(request("PATCH", patch))).status, 200);
  assert.equal((await PATCH(request("PATCH", patch))).status, 409);
  const listed = await (await GET(request("GET"))).json();
  assert.equal(listed.canvases[0].title, "Saved");
  assert.equal(listed.canvases[0].scene, undefined);
  assert.equal((await DELETE(request("DELETE", { id: canvas.id, revision: 0 }))).status, 409);
  assert.equal((await DELETE(request("DELETE", { id: canvas.id, revision: 1 }))).status, 200);
  assert.equal((await GET(request("GET", undefined, {}, `?id=${canvas.id}`))).status, 404);
});

test("origin/content-type/body-size/ID guards reject malformed requests before writes", async () => {
  assert.equal((await POST(request("POST", { title: "No" }, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await POST(request("POST", { title: "No" }, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await POST(request("POST", { title: "No" }, { "content-length": "999999999" }))).status, 413);
  assert.equal((await GET(request("GET", undefined, {}, "?id=../../secrets"))).status, 400);
  assert.equal((await POST(request("POST", { title: "" }))).status, 400);
});
