import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const { GET, PATCH } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
const root = mkdtempSync(join(tmpdir(), "course-api-"));
const before = process.env.ROBIN_DATA_DIR;
process.env.ROBIN_DATA_DIR = root;
after(() => { rmSync(root, { recursive: true, force: true }); if (before === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = before; });
function request(method = "GET", body, headers = {}) {
  return new Request("http://localhost:30141/api/robin/learning/course", {
    method, headers: { host: "localhost:30141", ...(method === "PATCH" ? { origin: "http://localhost:30141", "Content-Type": "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}
test("prepared course and explicit evidence saves are uncached, origin-guarded and revision-aware", async () => {
  assert.equal((await GET(request("GET", undefined, { origin: "https://evil.test" }))).status, 403);
  const response = await GET(request());
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const course = await response.json();
  assert.equal(course.lessons.length, 23);
  assert.equal(course.stages.length, 6);
  assert.deepEqual(course.progress, []);
  const lesson = course.lessons[0];
  const input = { lessonId: lesson.id, fingerprint: lesson.fingerprint, revision: 0, status: "gap", evidence: "Need to separate layers." };
  assert.equal((await PATCH(request("PATCH", input, { origin: "https://evil.test" }))).status, 403);
  assert.equal((await PATCH(request("PATCH", input, { "Content-Type": "text/plain" }))).status, 415);
  assert.equal((await PATCH(request("PATCH", "{"))).status, 400);
  assert.equal((await PATCH(request("PATCH", { ...input, lessonId: "not-a-lesson" }))).status, 404);
  const saved = await PATCH(request("PATCH", input));
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get("cache-control"), "private, no-store");
  assert.equal((await saved.json()).record.revision, 1);
  assert.equal((await PATCH(request("PATCH", input))).status, 409);
  assert.equal((await PATCH(request("PATCH", { ...input, revision: 1, fingerprint: "stale" }))).status, 409);
  assert.equal((await PATCH(request("PATCH", { ...input, revision: 1, status: "confident", evidence: "" }))).status, 400);
  assert.equal((await (await GET(request())).json()).progress[0].status, "gap");
});
