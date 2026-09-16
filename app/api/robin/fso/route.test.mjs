import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, PATCH, PUT } = await jiti.import("./route.ts");
const { describeOpenFsoChapter } = await jiti.import("../../../../extension/robin/fso-tools.ts");
const previous = process.env.ROBIN_DATA_DIR;
const directory = mkdtempSync(join(tmpdir(), "robin-fso-route-"));
process.env.ROBIN_DATA_DIR = directory;
beforeEach(() => {
  for (const file of ["fso.json", "fullstack-open-progress.json", "practice.json", "practice-state.json"]) {
    rmSync(join(directory, file), { force: true });
  }
});
after(() => {
  rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
});
const chapter = "/en/part1/java_script";
const request = (method = "GET", body, headers = {}) => new Request("http://localhost:30141/api/robin/fso", {
  method, headers: { host: "localhost:30141", "content-type": "application/json", ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test("FSO and its mentor read course ticks and notes without reading practice", async () => {
  writeFileSync(join(directory, "practice.json"), "{");
  writeFileSync(join(directory, "practice-state.json"), "{");
  writeFileSync(join(directory, "fullstack-open-progress.json"), JSON.stringify({ completedIds: [`${chapter}/1.3`] }));
  assert.equal((await PATCH(request("PATCH", { chapter }))).status, 200);
  assert.equal((await PUT(request("PUT", { chapter, text: "map returns a new array" }))).status, 200);
  const response = await GET(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.openChapterId, chapter);
  assert.deepEqual(body.fullstack.completedIds, [`${chapter}/1.3`]);
  assert.equal(body.notes[chapter].text, "map returns a new array");
  assert.match(describeOpenFsoChapter(), /\[x\] 1\.3/);
  assert.match(describeOpenFsoChapter(), /map returns a new array/);
});

test("opening a chapter confirms just the saved identity, not unrelated progress reads", async () => {
  writeFileSync(join(directory, "fullstack-open-progress.json"), "{");
  const opened = await PATCH(request("PATCH", { chapter }));
  assert.equal(opened.status, 200);
  assert.deepEqual(await opened.json(), { openChapterId: chapter });
  assert.equal((await GET(request())).status, 500, "corrupt course data must remain a visible error");
  assert.equal(readFileSync(join(directory, "fullstack-open-progress.json"), "utf8"), "{");
});

test("FSO rejects untrusted and invalid writes without changing the open chapter", async () => {
  await PATCH(request("PATCH", { chapter }));
  assert.equal((await GET(request("GET", undefined, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await PATCH(request("PATCH", { chapter }, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await PATCH(request("PATCH", { chapter }, { "content-type": "text/plain" }))).status, 415);
  for (const body of [null, [], {}, { chapter: 7 }]) assert.equal((await PATCH(request("PATCH", body))).status, 400);
  assert.equal((await PATCH(request("PATCH", { chapter: "unknown" }))).status, 404);
  assert.equal((await (await GET(request())).json()).openChapterId, chapter);
});
