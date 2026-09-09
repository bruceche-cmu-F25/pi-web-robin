import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, PATCH } = await jiti.import("./route.ts");
const previous = process.env.ROBIN_DATA_DIR;
const directory = mkdtempSync(join(tmpdir(), "robin-learning-route-"));
process.env.ROBIN_DATA_DIR = directory;
after(() => {
  rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
});

const request = (method = "GET", body, headers = {}) => new Request("http://localhost:30141/api/robin/learning", {
  method,
  headers: { host: "localhost:30141", "content-type": "application/json", ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test("learning API rejects cross-origin, non-JSON, malformed and unknown-step writes", async () => {
  assert.equal((await GET(request("GET", undefined, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await PATCH(request("PATCH", {}, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await PATCH(request("PATCH", {}, { "content-type": "text/plain" }))).status, 415);
  for (const body of [null, [], {}, { step: "x", completed: "true" }]) {
    assert.equal((await PATCH(request("PATCH", body))).status, 400);
  }
  assert.equal((await PATCH(request("PATCH", { step: "x", completed: true }))).status, 404);
  const malformed = new Request("http://localhost:30141/api/robin/learning", {
    method: "PATCH", headers: { host: "localhost:30141", "content-type": "application/json" }, body: "{",
  });
  assert.equal((await PATCH(malformed)).status, 400);
});

test("completion and undo return the same persisted plan that Daily reads", async () => {
  const initial = await (await GET(request())).json();
  const step = initial.fullstack.next.id;
  const result = await PATCH(request("PATCH", { step, completed: true }));
  assert.equal(result.status, 200);
  const completed = await result.json();
  assert.notEqual(completed.fullstack.next.id, step);
  assert.equal(completed.fullstack.completed, 1);
  assert.deepEqual(await (await GET(request())).json(), completed);
  await PATCH(request("PATCH", { step, completed: false }));
  assert.equal((await (await GET(request())).json()).fullstack.next.id, step);
});
