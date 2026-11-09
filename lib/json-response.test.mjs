import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { jsonResponse } = await jiti.import("./json-response.ts");

test("does not gzip a large JSON response when the client disables gzip", async () => {
  const response = jsonResponse(
    new Request("http://localhost/test", { headers: { "Accept-Encoding": "gzip;q=0, br" } }),
    { value: "large payload ".repeat(200) },
  );

  assert.equal(response.headers.get("Content-Encoding"), null);
  assert.match(response.headers.get("Vary") ?? "", /(?:^|,\s*)Accept-Encoding(?:\s*,|$)/i);
  assert.equal((await response.json()).value, "large payload ".repeat(200));
});

test("does not gzip when the gzip quality value is invalid", async () => {
  const response = jsonResponse(
    new Request("http://localhost/test", { headers: { "Accept-Encoding": "gzip;q=invalid, *;q=1" } }),
    { value: "large payload ".repeat(200) },
  );

  assert.equal(response.headers.get("Content-Encoding"), null);
  assert.equal((await response.json()).value, "large payload ".repeat(200));
});

test("gzip round-trips UTF-8 JSON and preserves response headers", async () => {
  const data = { text: "中文 ✓ ".repeat(1000) };
  const response = jsonResponse(new Request("http://localhost/test", { headers: { "Accept-Encoding": "gzip" } }), data,
    { status: 201, headers: { Vary: "Origin", "Cache-Control": "no-store" } });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Content-Encoding"), "gzip");
  assert.equal(response.headers.get("Vary"), "Origin, Accept-Encoding");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString()), data);
});

test("completed gzip responses do not retain one backing buffer per request", () => {
  const run = spawnSync(process.execPath, ["--expose-gc", "--experimental-strip-types", "--input-type=module", "-e", `
    import { setImmediate as tick } from 'node:timers/promises';
    import { jsonResponse } from ${JSON.stringify(new URL("./json-response.ts", import.meta.url).href)};
    const req = new Request('http://localhost/test', {headers: {'Accept-Encoding': 'gzip'}});
    const data = {text: 'x'.repeat(512 * 1024)};
    async function consume() { await jsonResponse(req, data).arrayBuffer(); }
    async function retained() { await tick(); global.gc(); await tick(); global.gc(); return process.memoryUsage().arrayBuffers; }
    await consume(); const before = await retained();
    for (let i = 0; i < 16; i++) await consume();
    console.log(JSON.stringify({growth: (await retained()) - before}));
  `], { encoding: "utf8", timeout: 20000 });
  assert.equal(run.status, 0, run.stderr);
  const { growth } = JSON.parse(run.stdout);
  assert.ok(growth < 3 * 1024 * 1024, `retained ${growth} buffer bytes after completed reads`);
});

test("leaves small JSON responses uncompressed", async () => {
  const response = jsonResponse(
    new Request("http://localhost/test", { headers: { "Accept-Encoding": "gzip" } }),
    { ok: true },
  );

  assert.equal(response.headers.get("Content-Encoding"), null);
  assert.deepEqual(await response.json(), { ok: true });
});
