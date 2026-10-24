import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createRecording, readRecording, listRecordings, recordingConfig, transcribeRecording, editRecording, deleteRecording, recordingAudio } from "./recordings-domain.ts";
import { setTranscription } from "./settings.ts";
import { transcribe } from "./transcription.ts";
import { LOCAL_TRANSCRIPTION_TIMEOUT_MS } from "./local-transcription.ts";

const mediaToolsAvailable = ["ffmpeg", "ffprobe"].every((command) => spawnSync(command, ["-version"]).status === 0);
const needsMedia = { skip: !mediaToolsAvailable && "ffmpeg and ffprobe are not installed" };
const previous = process.env.ROBIN_DATA_DIR;
const root = mkdtempSync(join(tmpdir(), "robin-recordings-"));
process.env.ROBIN_DATA_DIR = root;
after(() => { rmSync(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
// PCM fixture: real decoding/segmentation, no cloud calls, microphone, or user's files.
function wav(seconds) {
  const data = Buffer.alloc(44 + seconds * 8000 * 2);
  data.write("RIFF"); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(data.length - 44, 40);
  return new File([data], "meeting.wav", { type: "audio/wav" });
}
function setup() { setTranscription({ enabled: true, baseUrl: "https://stt.example/v1", model: "whisper-1" }, "test-secret"); }

test("long audio is segmented, resumed locally without repeating success, editable and deletable", needsMedia, async () => {
  setup();
  let record = await createRecording(wav(601), "Meeting");
  assert.equal(record.chunks, 2);
  assert.ok(record.seconds > 600 && record.seconds < 602);
  assert.ok(statSync(recordingAudio(record.id).path).size > 0);
  assert.equal(statSync(join(root, "recordings", record.id)).mode & 0o777, 0o700);
  assert.equal(recordingConfig().engine, "local");
  assert.equal(recordingConfig().ready, false, "this isolated fixture has no local model");
  assert.ok(!JSON.stringify(recordingConfig()).includes("test-secret"));
  let calls = 0;
  const deps = { transcribe: async (audioPath) => {
    calls++;
    assert.equal(audioPath, join(root, "recordings", record.id, `chunk-${String(calls - 1).padStart(3, "0")}.mp3`));
    assert.ok(statSync(audioPath).size > 0);
    return `Part ${calls}`;
  } };
  record = await transcribeRecording(record.id, deps);
  assert.equal(record.text, "Part 1");
  await assert.rejects(transcribeRecording(record.id, { transcribe: async () => { throw new Error("Local process interrupted"); } }), /Local process interrupted/);
  assert.deepEqual(readRecording(record.id).parts, ["Part 1"]);
  assert.equal(readRecording(record.id).busyUntil, undefined);
  record = await transcribeRecording(record.id, deps);
  assert.equal(record.text, "Part 1\n\nPart 2");
  assert.equal((await transcribeRecording(record.id, deps)).text, record.text);
  assert.equal(calls, 2);
  const saved = editRecording(record.id, { revision: record.revision, title: "Edited", text: "修正的文字稿" });
  assert.equal(readRecording(record.id).text, "修正的文字稿");
  assert.throws(() => editRecording(record.id, { revision: record.revision, title: "stale", text: "stale" }), /another tab/);
  assert.throws(() => deleteRecording(record.id, record.revision), /changed/);
  deleteRecording(record.id, saved.revision);
  assert.throws(() => readRecording(record.id), /not found/);
  assert.deepEqual(listRecordings(), []);
});

test("concurrent requests cannot process the same chunk; failures preserve the original", needsMedia, async () => {
  setup();
  const record = await createRecording(wav(1), "Concurrent");
  let release;
  const arrived = new Promise((resolve) => { release = resolve; });
  let respond;
  const work = transcribeRecording(record.id, { transcribe: () => { release(); return new Promise((resolve) => { respond = resolve; }); } });
  await arrived;
  await assert.rejects(transcribeRecording(record.id, { transcribe: () => assert.fail("must not run") }), /already running/);
  assert.throws(() => deleteRecording(record.id, record.revision), /already running/);
  respond("done");
  const done = await work;
  assert.equal(done.text, "done");
  assert.ok(!("owner" in done));
  deleteRecording(record.id, done.revision);
});

test("validation refuses invalid audio; local transcription does not need enabled cloud settings", needsMedia, async () => {
  await assert.rejects(createRecording(new File([], "zero.wav"), "Zero"), /between/);
  await assert.rejects(createRecording(new File(["abc"], "x.html"), "HTML"), /format/);
  await assert.rejects(createRecording(wav(1), " "), /title/);
  await assert.rejects(createRecording(new File(["#EXTM3U\nhttp://127.0.0.1/private"], "fake.mp3"), "Playlist"), /decoded/);
  assert.deepEqual(listRecordings(), []);
  assert.throws(() => recordingAudio("../../secrets.json"), /not found/);
  setTranscription({ enabled: false, baseUrl: "https://stt.example/v1", model: "whisper-1" });
  const record = await createRecording(wav(1), "Cloud disabled");
  const completed = await transcribeRecording(record.id, { transcribe: async () => "" });
  assert.deepEqual(completed.parts, [""], "silent segments are completed without inventing speech");
  assert.equal(completed.text, "");
  deleteRecording(record.id, completed.revision);
});

test("expired workers cannot overwrite a retry or invalidate its revision", needsMedia, async (t) => {
  setup();
  const record = await createRecording(wav(1), "Expired owner");
  let entered, resolveOld;
  const arrived = new Promise((resolve) => { entered = resolve; });
  const old = transcribeRecording(record.id, { transcribe: () => { entered(); return new Promise((resolve) => { resolveOld = resolve; }); } });
  await arrived;
  const later = Date.now() + LOCAL_TRANSCRIPTION_TIMEOUT_MS + 2 * 60_000;
  t.mock.method(Date, "now", () => later);
  const newer = await transcribeRecording(record.id, { transcribe: async () => "New owner" });
  resolveOld("Old owner");
  await assert.rejects(old, /ownership expired/);
  assert.deepEqual(readRecording(record.id), newer);
  deleteRecording(record.id, newer.revision);
});

test("over-two-hour compressed audio is rejected rather than published truncated", needsMedia, async () => {
  const bytes = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", "7202", "-c:a", "flac", "-f", "flac", "pipe:1"], { maxBuffer: 4 * 1024 * 1024 });
  await assert.rejects(createRecording(new File([bytes], "long.flac"), "Too long"), /2 hours/);
  assert.deepEqual(listRecordings(), []);
});

test("browser-style WebM without duration and Safari-style fragmented MP4 both decode", needsMedia, async () => {
  for (const [extension, format, codec, extra] of [["webm", "webm", "libopus", []], ["m4a", "mp4", "aac", ["-movflags", "frag_keyframe+empty_moov"]]]) {
    const bytes = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", codec, ...extra, "-f", format, "pipe:1"]);
    const record = await createRecording(new File([bytes], `capture.${extension}`), "Browser audio");
    assert.equal(record.chunks, 1); assert.ok(record.seconds >= 1 && record.seconds < 2);
    deleteRecording(record.id, record.revision);
  }
});

test("shared transport respects cancellation and rejects empty provider responses", async () => {
  const config = { enabled: true, apiKey: "secret", baseUrl: "https://stt.example/v1/", model: "whisper-1" };
  const audio = { bytes: new Uint8Array([1]), filePath: "x.wav" };
  await assert.rejects(transcribe(config, audio, { fetch: async () => new Response(" ") }), /empty/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(transcribe(config, audio, { signal: abort.signal, fetch: async (_url, init) => { init.signal.throwIfAborted(); } }), /abort/i);
});
