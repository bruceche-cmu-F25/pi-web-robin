import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";

const previous = process.env.ROBIN_DATA_DIR;
const directory = mkdtempSync(join(tmpdir(), "robin-canvas-library-"));
process.env.ROBIN_DATA_DIR = directory;
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, PUT } = await jiti.import("./route.ts");
const { createCanvas, deleteCanvas, listCanvases } = await jiti.import("../../../../../extension/robin/canvas-domain.ts");
after(() => { rmSync(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
const request = (body, headers = {}) => new Request("http://localhost:30141/api/robin/canvases/library", {
  method: body === undefined ? "GET" : "PUT", headers: { host: "localhost:30141", "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const item = { id: "item-1", status: "published", created: Date.now(), elements: [{ id: "shape-1", type: "rectangle", x: 0, y: 0, width: 100, height: 100 }] };

test("library survives board deletion, round-trips items/removals and rejects stale writes", async () => {
  assert.deepEqual(await (await GET(request())).json(), { revision: 0, libraryItems: [] });
  const board = createCanvas("Not a library");
  const saved = await PUT(request({ revision: 0, libraryItems: [item] }));
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { revision: 1 });
  deleteCanvas(board.id, 0);
  assert.deepEqual(listCanvases(), []);
  assert.deepEqual(await (await GET(request())).json(), { revision: 1, libraryItems: [item] });
  assert.equal((await PUT(request({ revision: 0, libraryItems: [] }))).status, 409);
  assert.equal((await PUT(request({ revision: 1, libraryItems: [] }))).status, 200);
  assert.deepEqual(await (await GET(request())).json(), { revision: 2, libraryItems: [] });
});

test("library boundary rejects untrusted content and bounded/origin/content-type violations without writes", async () => {
  const save = (libraryItems, headers) => PUT(request({ revision: 2, libraryItems }, headers));
  for (const bad of [null, {}, [item, item], [{ ...item, status: "bad" }], [{ ...item, elements: [] }],
    [{ ...item, elements: [{ ...item.elements[0], x: "bad" }] }],
    [{ ...item, elements: [{ ...item.elements[0], type: "embeddable" }] }],
    [{ ...item, elements: [{ ...item.elements[0], type: "image" }] }],
    [{ ...item, elements: [{ ...item.elements[0], link: "javascript:alert(1)" }] }]]) {
    assert.equal((await save(bad)).status, 400);
  }
  assert.equal((await PUT(request(null))).status, 400);
  assert.equal((await save([], { origin: "https://evil.example" })).status, 403);
  assert.equal((await save([], { "content-type": "text/plain" })).status, 415);
  assert.equal((await save([], { "content-length": "999999999" })).status, 413);
  assert.deepEqual(await (await GET(request())).json(), { revision: 2, libraryItems: [] });
});
