import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, PATCH } = await jiti.import("./route.ts");
const previous = process.env.ROBIN_DATA_DIR;
const directory = mkdtempSync(join(tmpdir(), "robin-watch-route-"));
process.env.ROBIN_DATA_DIR = directory;
after(() => {
  rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
});

const request = (method = "GET", body, headers = {}) => new Request("http://localhost:30141/api/robin/watch", {
  method,
  headers: { host: "localhost:30141", "content-type": "application/json", ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test("watch API rejects cross-origin, non-JSON, malformed and unknown-lecture writes", async () => {
  assert.equal((await GET(request("GET", undefined, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await PATCH(request("PATCH", {}, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await PATCH(request("PATCH", {}, { "content-type": "text/plain" }))).status, 415);
  for (const body of [null, [], {}, { item: "x", watched: "true" }]) {
    assert.equal((await PATCH(request("PATCH", body))).status, 400);
  }
  assert.equal((await PATCH(request("PATCH", { item: "x", watched: true }))).status, 404);
});

test("a tick and its undo return the persisted plan", async () => {
  const initial = await (await GET(request())).json();
  assert.equal(initial.watched, 0);
  const item = initial.courses[0].nextId;
  const ticked = await (await PATCH(request("PATCH", { item, watched: true }))).json();
  assert.deepEqual(ticked.watchedIds, [item]);
  assert.deepEqual(await (await GET(request())).json(), ticked);
  await PATCH(request("PATCH", { item, watched: false }));
  assert.equal((await (await GET(request())).json()).watched, 0);
});
