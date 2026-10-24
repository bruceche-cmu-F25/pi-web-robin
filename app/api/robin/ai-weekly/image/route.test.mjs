import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, test } from "node:test";
import { createJiti } from "jiti";
const dir = mkdtempSync(join(tmpdir(), "weekly-image-route-"));
const stub = join(dir, "media.mjs");
writeFileSync(stub, `export async function weeklyImage(week, day) {
  globalThis.__weeklyImageRequest = [week, day];
  return day === "2026-06-16" ? null : { body: new Uint8Array([137,80,78,71]), contentType: "image/png" };
}`);
const jiti = createJiti(import.meta.url, { alias: { "@/extension/robin/ai-weekly-media-domain": stub, "@": process.cwd() }, moduleCache: false });
const { GET } = await jiti.import("./route.ts");
after(() => { rmSync(dir, { recursive: true, force: true }); delete globalThis.__weeklyImageRequest; });
const request = (day = "2026-06-15", origin = "http://localhost") => new Request(`http://localhost/api/robin/ai-weekly/image?week=2026-06-15&day=${day}&url=https://evil.example/ignored`, { headers: { Host: "localhost", Origin: origin } });
test("image route only passes edition/day, returns private cache and restrictive raster headers", async () => {
  const response = await GET(request());
  assert.deepEqual(globalThis.__weeklyImageRequest, ["2026-06-15", "2026-06-15"]);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy"), /sandbox/);
  assert.match(response.headers.get("cache-control"), /^private/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});
test("missing imagery is a cacheable 404, while untrusted origins cannot trigger a fetch", async () => {
  assert.equal((await GET(request("2026-06-16"))).status, 404);
  delete globalThis.__weeklyImageRequest;
  assert.equal((await GET(request("2026-06-15", "https://evil.example"))).status, 403);
  assert.equal(globalThis.__weeklyImageRequest, undefined);
  assert.equal((await GET(request("not-a-day"))).status, 400);
  assert.equal(globalThis.__weeklyImageRequest, undefined);
});
