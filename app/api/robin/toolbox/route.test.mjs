import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, POST } = await jiti.import("./route.ts");
const root = mkdtempSync(join(tmpdir(), "toolbox-api-")), previous = process.env.ROBIN_DATA_DIR;
process.env.ROBIN_DATA_DIR = root;
after(() => { rmSync(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
const url = "http://localhost:30141/api/robin/toolbox";
const headers = { host: "localhost:30141" };

test("toolbox rejects cross-origin, wrong content type and oversized wire bodies", async () => {
  for (const [method, handler] of [["GET", GET], ["POST", POST]]) {
    const response = await handler(new Request(url, { method, headers: { ...headers, origin: "https://evil.example" } }));
    assert.equal(response.status, 403);
  }
  assert.equal((await POST(new Request(url, { method: "POST", headers }))).status, 415);
  assert.equal((await POST(new Request(url, { method: "POST", headers: { ...headers, "content-type": "multipart/form-data; boundary=x", "content-length": "200000000" } }))).status, 413);
  const form = new FormData(); form.set("options", "{}");
  assert.equal((await POST(new Request(url, { method: "POST", headers, body: form }))).status, 400);
  form.set("file", new File(["data"], "file.wav")); form.set("options", '{"kind":"audio","format":"../../bad"}');
  assert.equal((await POST(new Request(url, { method: "POST", headers, body: form }))).status, 400);
});

test("capabilities contain no secrets and valid media returns a download, not a public file path", async (t) => {
  const response = await GET(new Request(url, { headers }));
  assert.equal(response.headers.get("cache-control"), "no-store");
  const capabilities = await response.json();
  assert.deepEqual(Object.keys(capabilities).sort(), ["media", "ocr", "subtitles"]);
  if (!capabilities.media) { t.skip("ffmpeg unavailable"); return; }
  const wav = Buffer.alloc(16044); wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(16000, 40);
  const form = new FormData(); form.set("file", new File([wav], "../../my name.wav")); form.set("options", JSON.stringify({ kind: "audio", format: "mp3" }));
  const converted = await POST(new Request(url, { method: "POST", headers, body: form }));
  assert.equal(converted.status, 200);
  assert.equal(converted.headers.get("content-type"), "audio/mpeg");
  assert.equal(converted.headers.get("content-disposition"), 'attachment; filename="converted.mp3"');
  assert.equal(converted.headers.get("x-content-type-options"), "nosniff");
  assert.ok((await converted.arrayBuffer()).byteLength > 40);
  assert.deepEqual(readdirSync(join(root, "toolbox-tmp")), []);
});
