import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, parse } from "node:path";
import { after, beforeEach, test } from "node:test";
import { localTranscriptionConfig, localWhisperModelPath, transcribeLocalAudio, LOCAL_TRANSCRIPTION_TIMEOUT_MS } from "./local-transcription.ts";

const previous = { data: process.env.ROBIN_DATA_DIR, bin: process.env.ROBIN_WHISPER_BIN };
const root = mkdtempSync(join(tmpdir(), "local-whisper-test-"));
process.env.ROBIN_DATA_DIR = root;
process.env.ROBIN_WHISPER_BIN = process.execPath; // Executable stand-in; never launched by these tests.
after(() => {
  rmSync(root, { recursive: true, force: true });
  for (const [key, value] of [["ROBIN_DATA_DIR", previous.data], ["ROBIN_WHISPER_BIN", previous.bin]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
beforeEach(() => {
  process.env.ROBIN_WHISPER_BIN = process.execPath;
  mkdirSync(dirname(localWhisperModelPath()), { recursive: true });
  writeFileSync(localWhisperModelPath(), "test model, never loaded");
});
const audio = join(root, "chunk with spaces.mp3");
function outputPath(args) { return join(args[args.indexOf("--output_dir") + 1], `${parse(basename(args[0])).name}.${args[args.indexOf("--output_format") + 1]}`); }

test("local readiness needs an executable and a downloaded model, never a cloud key", async () => {
  assert.deepEqual(localTranscriptionConfig(), { engine: "local", model: "small", ready: true });
  rmSync(localWhisperModelPath());
  assert.equal(localTranscriptionConfig().reason, "missing-model");
  await assert.rejects(transcribeLocalAudio(audio, { execute: () => assert.fail("must not run without a model") }), /model is missing/);
  process.env.ROBIN_WHISPER_BIN = join(root, "missing-command");
  assert.equal(localTranscriptionConfig().reason, "missing-engine");
  await assert.rejects(transcribeLocalAudio(audio), /not installed/);
});

test("inference uses an offline checkpoint, no credentials, bounded CPU time and fresh output", async () => {
  let output;
  const text = await transcribeLocalAudio(audio, { execute: async (command, args, options) => {
    assert.equal(command, process.execPath);
    assert.equal(args[0], audio);
    assert.equal(args[args.indexOf("--model") + 1], localWhisperModelPath());
    assert.equal(args[args.indexOf("--task") + 1], "transcribe");
    assert.equal(args[args.indexOf("--device") + 1], "cpu");
    assert.equal(options.env.OPENAI_API_KEY, undefined);
    assert.equal(options.env.PI_WEB_PASSWORD, undefined);
    assert.equal(options.timeout, LOCAL_TRANSCRIPTION_TIMEOUT_MS);
    assert.equal(options.killSignal, "SIGKILL");
    assert.equal(options.shell, undefined);
    output = outputPath(args);
    writeFileSync(output, " 本机转写\nLocal transcription \n");
  } });
  assert.equal(text, "本机转写\nLocal transcription");
  assert.equal(existsSync(dirname(output)), false, "temporary transcript is removed after reading");
});

test("exit zero without output is a failure; valid empty speech is a completed silent segment", async () => {
  let output;
  await assert.rejects(transcribeLocalAudio(audio, { execute: async (_command, args) => { output = outputPath(args); } }), /no readable transcript/);
  assert.equal(existsSync(dirname(output)), false);
  assert.equal(await transcribeLocalAudio(audio, { execute: async (_command, args) => { writeFileSync(outputPath(args), "\n"); } }), "");
});

test("subtitle output uses Whisper timestamps and forwards cancellation", async () => {
  for (const format of ["srt", "vtt"]) {
    const controller = new AbortController();
    const sample = format === "srt" ? "1\n00:00:00,000 --> 00:00:01,000\nHello" : "WEBVTT\n\n00:00.000 --> 00:01.000\nHello";
    assert.equal(await transcribeLocalAudio(audio, { format, signal: controller.signal, execute: async (_command, args, options) => {
      assert.equal(options.signal, controller.signal);
      assert.equal(args[args.indexOf("--output_format") + 1], format);
      writeFileSync(outputPath(args), sample);
    } }), sample);
  }
  await assert.rejects(transcribeLocalAudio(audio, { format: "../escape" }), /Unsupported/);
});

test("timeout/process errors and oversized output never leak child output or leave temp files", async () => {
  let output;
  await assert.rejects(transcribeLocalAudio(audio, { execute: async (_command, args) => {
    output = outputPath(args); throw new Error("secret private audio text");
  } }), (err) => /Local transcription failed/.test(err.message) && !err.message.includes("secret"));
  assert.equal(existsSync(dirname(output)), false);
  await assert.rejects(transcribeLocalAudio(audio, { execute: async (_command, args) => {
    output = outputPath(args); writeFileSync(output, "x".repeat(2 * 1024 * 1024 + 1));
  } }), /no readable transcript/);
  assert.equal(existsSync(dirname(output)), false);
});
