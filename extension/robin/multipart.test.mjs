import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { multipartBody } from "./multipart.ts";
import { transcribe } from "./transcription.ts";

test("multipart bytes match native FormData, including binary, UTF-8, CRLF and header escaping", async () => {
  for (const file of [
    { name: '图"片\r\n.png', type: "IMAGE/PNG", bytes: new Uint8Array([0, 255, 13, 10, 34]) },
    { name: "audio.ogg", type: "bad\r\nInjected: yes", bytes: new Uint8Array([1, 2, 3]) },
    { name: "", type: "", bytes: new Uint8Array() },
  ]) {
    const parts = [['mod"el\nname', '中文\rline\nend\r\n'], ["file", file], ["response_format", "text"]];
    const original = new FormData();
    for (const [key, value] of parts) {
      if (typeof value === "string") original.append(key, value);
      else original.append(key, new Blob([value.bytes], { type: value.type }), value.name);
    }
    const request = new Request("http://localhost/unused", { method: "POST", body: original });
    const boundary = request.headers.get("Content-Type").split("boundary=")[1];
    const encoded = multipartBody(parts);
    const ownBoundary = encoded.contentType.split("boundary=")[1];
    const expected = Buffer.from(await request.arrayBuffer()).toString("latin1").replaceAll(boundary, "BOUNDARY");
    assert.equal(encoded.body.toString("latin1").replaceAll(ownBoundary, "BOUNDARY"), expected);
  }
});

test("completed uploads release backing buffers instead of retaining one file per call", () => {
  const result = spawnSync(process.execPath, ["--expose-gc", "--experimental-strip-types", "--input-type=module", "-e", `
    import { setImmediate as tick } from 'node:timers/promises';
    import { multipartBody } from ${JSON.stringify(new URL("./multipart.ts", import.meta.url).href)};
    const bytes = new Uint8Array(512 * 1024).fill(7);
    async function upload() { const form = multipartBody([['file', {name: 'fixture.bin', bytes}]]); await new Request('http://localhost/unused', {method:'POST', headers:{'Content-Type':form.contentType}, body:form.body}).arrayBuffer(); }
    async function retained() { await tick(); global.gc(); await tick(); global.gc(); return process.memoryUsage().arrayBuffers; }
    await upload(); const before=await retained();
    for(let i=0;i<16;i++) await upload();
    console.log(JSON.stringify({growth:(await retained())-before}));
  `], { encoding: "utf8", timeout: 20000 });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).growth < 3 * 1024 * 1024);
});

test("transcription keeps model, filename, binary data, cancellation and credential boundary", async () => {
  const bytes = new Uint8Array([0, 255, 5, 10]);
  const text = await transcribe({ enabled: true, apiKey: "fixture-key", model: "test-model", baseUrl: "https://speech.example/v1/" }, { filePath: "private/voice.WAV", bytes }, {
    fetch: async (url, options) => {
      assert.equal(url, "https://speech.example/v1/audio/transcriptions");
      assert.equal(options.redirect, "error"); assert.ok(options.signal);
      assert.equal(options.headers.Authorization, "Bearer fixture-key");
      const form = await new Response(options.body, { headers: options.headers }).formData();
      assert.equal(form.get("model"), "test-model");
      assert.equal(form.get("response_format"), "text");
      const file = form.get("file");
      assert.equal(file.name, "voice.wav");
      assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
      assert.ok(!Buffer.from(options.body).includes(Buffer.from("fixture-key")));
      return new Response("fixture transcript");
    },
  });
  assert.equal(text, "fixture transcript");
});
