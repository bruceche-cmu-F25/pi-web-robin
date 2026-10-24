import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";
import { createRecording, deleteRecording, readRecording } from "../../../../extension/robin/recordings-domain.ts";
import { setTranscription } from "../../../../extension/robin/settings.ts";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const collection = await jiti.import("./route.ts");
const item = await jiti.import("./[id]/route.ts");
const previous = process.env.ROBIN_DATA_DIR;
const directory = mkdtempSync(join(tmpdir(), "recordings-api-"));
process.env.ROBIN_DATA_DIR = directory;
after(() => { rmSync(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
const req = (method = "GET", body, headers = {}, suffix = "") => new Request(`http://localhost:30141/api/robin/recordings${suffix}`, {
  method, headers: { host: "localhost:30141", ...(body ? { "content-type": "application/json" } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
});

test("all recording routes reject cross-site access and oversized bodies before processing", async () => {
  const ctx = { params: Promise.resolve({ id: "bad" }) };
  for (const route of [collection.GET, item.GET]) assert.equal((await route(req("GET", null, { origin: "https://evil.example" }), ctx)).status, 403);
  for (const [method, route] of [["POST", collection.POST], ["POST", item.POST], ["PATCH", item.PATCH], ["DELETE", item.DELETE]]) {
    assert.equal((await route(req(method, {}, { origin: "https://evil.example" }), ctx)).status, 403);
  }
  assert.equal((await collection.POST(req("POST", {}))).status, 415);
  assert.equal((await collection.POST(req("POST", null, { "content-type": "multipart/form-data; boundary=x", "content-length": "200000000" }))).status, 413);
  assert.equal((await item.POST(req("POST"), ctx)).status, 415);
  assert.equal((await item.GET(req(), ctx)).status, 404);
});

test("metadata hides secrets; audio supports bounded byte ranges; writes respect domain validation", { skip: !["ffmpeg", "ffprobe"].every((command) => spawnSync(command, ["-version"]).status === 0) && "ffmpeg and ffprobe are not installed" }, async () => {
  setTranscription({ enabled: false, baseUrl: "https://stt.example/v1", model: "whisper-1" }, "private-key-never-return");
  const data = Buffer.alloc(16044); data.write("RIFF"); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write("data", 36); data.writeUInt32LE(16000, 40);
  const record = await createRecording(new File([data], "test.wav"), "API test");
  const ctx = { params: Promise.resolve({ id: record.id }) };
  assert.ok(!(await (await collection.GET(req())).text()).includes("private-key-never-return"));
  const audioReq = (range) => req("GET", null, range ? { range } : {}, `/${record.id}?audio=1`);
  const first = await item.GET(audioReq("bytes=0-43"), ctx);
  assert.equal(first.status, 206);
  assert.equal(first.headers.get("content-range"), `bytes 0-43/${data.length}`);
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), data.subarray(0, 44));
  const tail = await item.GET(audioReq("bytes=-5"), ctx);
  assert.equal(tail.status, 206); assert.equal((await tail.arrayBuffer()).byteLength, 5);
  for (const range of ["bytes=999999-", "bytes=5-2", "bytes=0-3,8-9", "bytes=-0", "bytes=-"]) {
    assert.equal((await item.GET(audioReq(range), ctx)).status, 416, range);
  }
  const unavailable = await item.POST(req("POST", {}), ctx);
  assert.equal(unavailable.status, 400);
  assert.match((await unavailable.json()).error, /Local Whisper/);
  assert.equal(readRecording(record.id).busyUntil, undefined, "local setup failure releases its claim");
  assert.equal((await item.PATCH(req("PATCH", { revision: 1, title: "x", text: "x" }), ctx)).status, 409, "unfinished transcript cannot be overwritten");
  assert.equal((await item.PATCH(req("PATCH", { title: "" }), ctx)).status, 400);
  deleteRecording(record.id, readRecording(record.id).revision);
});
