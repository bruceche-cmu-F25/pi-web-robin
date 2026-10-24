import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { runLocalTool, toolboxCapabilities } from "./toolbox-domain.ts";
import { parseLocalToolOptions } from "./toolbox.ts";
const previous = process.env.ROBIN_DATA_DIR, root = mkdtempSync(join(tmpdir(), "toolbox-test-"));
process.env.ROBIN_DATA_DIR = root;
after(() => { rmSync(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
const media = toolboxCapabilities().media;
function wav() {
  const data = Buffer.alloc(32044); data.write("RIFF"); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write("data", 36); data.writeUInt32LE(32000, 40); return new File([data], "source.wav");
}
const opts = (format) => ({ kind: "audio", format, start: 0, bitrate: 128 });
test("tool options reject commands, nonfinite and reversed ranges", () => {
  for (const value of [null, [], { kind: "__proto__", format: "mp3" }, { kind: "audio", format: ";curl evil" }, { ...opts("mp3"), start: Infinity }, { ...opts("mp3"), start: null }, { ...opts("mp3"), start: 10, end: 5 }, { ...opts("mp3"), bitrate: "128;ls" }]) assert.throws(() => parseLocalToolOptions(value));
});
test("real local audio outputs, input failures and cancellation always clear temporary files", { skip: !media }, async () => {
  for (const format of ["mp3", "m4a", "wav", "flac"]) {
    const result = await runLocalTool(wav(), opts(format));
    assert.ok(result.bytes.length > 40); assert.equal(result.name, `converted.${format}`);
    assert.deepEqual(readdirSync(join(root, "toolbox-tmp")), []);
  }
  await assert.rejects(runLocalTool(new File(["not audio"], "bad.mp3"), opts("mp3")), /processing failed/);
  await assert.rejects(runLocalTool(new File(["#EXTM3U\nhttp://localhost/secret"], "bad.m3u"), opts("mp3")), /Unsupported/);
  await assert.rejects(runLocalTool(wav(), { ...opts("mp3"), end: 20 }), /start\/end/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runLocalTool(wav(), opts("mp3"), controller.signal));
  const during = new AbortController();
  const interrupted = runLocalTool(wav(), opts("mp3"), during.signal);
  const timer = setTimeout(() => during.abort(), 1);
  await assert.rejects(interrupted); clearTimeout(timer);
  const first = runLocalTool(wav(), opts("mp3"));
  await assert.rejects(runLocalTool(wav(), opts("mp3")), /Another local tool/);
  await first;
  assert.deepEqual(readdirSync(join(root, "toolbox-tmp")), []);
});
test("real video compression, mute and GIF exports", { skip: !media }, async () => {
  const path = join(root, "fixture.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
  const file = new File([readFileSync(path)], "fixture.mp4");
  for (const format of ["720p", "1080p", "mute", "gif"]) {
    const result = await runLocalTool(file, { kind: "video", format });
    assert.ok(result.bytes.length > 100); assert.equal(result.type, format === "gif" ? "image/gif" : "video/mp4");
  }
  assert.deepEqual(readdirSync(join(root, "toolbox-tmp")), []);
});
test("macOS OCR really recognizes synthetic text without cloud calls", { skip: !(toolboxCapabilities().ocr && media) }, async () => {
  const fixture = readFileSync(new URL("./fixtures/toolbox-ocr.png", import.meta.url));
  const result = await runLocalTool(new File([fixture], "ocr.png"), { kind: "ocr", format: "txt" });
  const oversized = Buffer.from(fixture); oversized.writeUInt32BE(50000, 16);
  await assert.rejects(runLocalTool(new File([oversized], "large.png"), { kind: "ocr", format: "txt" }), /image limit/);
  assert.match(new TextDecoder().decode(result.bytes), /HELLO LOCAL 2026/);
  assert.deepEqual(readdirSync(join(root, "toolbox-tmp")), []);
});
