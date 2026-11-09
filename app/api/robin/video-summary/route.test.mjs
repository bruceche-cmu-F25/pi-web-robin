import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";
const root = mkdtempSync(join(tmpdir(), "video-route-"));
process.env.ROBIN_DATA_DIR = root;
after(() => { rmSync(root, { recursive: true, force: true }); delete globalThis.__videoCalls; delete globalThis.__videoFail; });
globalThis.__videoCalls = [];
const domain = join(root, "domain.mjs"), assistant = join(root, "assistant.mjs");
writeFileSync(domain, `export function videoSummaryHistory() { return []; }
export async function summarizeVideoUrl(url, ask, options) {
  globalThis.__videoCalls.push(url);
  options.onStage('captions');
  if (globalThis.__videoFail) throw new Error('No captions available');
  if (globalThis.__videoWait) await new Promise(resolve => { globalThis.__videoRelease = resolve; });
  await ask('test instructions', 'test captions', new AbortController().signal);
  options.onStage('saving');
  return { summary: { videoId: '67BmkptgTms' }, details: null };
}`);
writeFileSync(assistant, `export async function runScopedAssistantTurn(options) { globalThis.__videoCalls.push(options); return {reply:'test reply'}; }`);
const jiti = createJiti(import.meta.url, { alias: { "@/extension/robin/podcast-scan": domain, "@/lib/robin-assistant": assistant, "@": process.cwd() }, moduleCache: false });
const route = await jiti.import("./route.ts");
const url = "https://www.youtube.com/watch?v=67BmkptgTms";
function req(method, body, headers = {}) {
  return new Request("http://localhost/api/robin/video-summary", { method, headers: { Host: "localhost", Origin: "http://localhost", "Content-Type": "application/json", ...headers }, ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) });
}
test("GET is read-only, uncached; origin/content type/URL/body bounds precede model work", async () => {
  const get = await route.GET(req("GET"));
  assert.deepEqual(await get.json(), { results: [] });
  assert.equal(get.headers.get("cache-control"), "no-store");
  assert.equal((await route.POST(req("POST", { url }, { Origin: "https://evil.test" }))).status, 403);
  assert.equal((await route.POST(req("POST", { url }, { "Content-Type": "text/plain" }))).status, 415);
  for (const body of ["{", "null", { url: "https://127.0.0.1/private" }, { url: "x".repeat(5000) }]) assert.equal((await route.POST(req("POST", body))).status, 400);
  assert.deepEqual(globalThis.__videoCalls, []);
});
test("streams real stages and final result; AI turn has zero tools and a deadline", async () => {
  const response = await route.POST(req("POST", { url }));
  assert.equal(response.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  const events = (await response.text()).trim().split("\n").map(JSON.parse);
  assert.deepEqual(events.map(event => event.stage).filter(Boolean), ["captions", "saving"]);
  assert.equal(events.at(-1).result.summary.videoId, "67BmkptgTms");
  const options = globalThis.__videoCalls.at(-1);
  assert.deepEqual(options.toolNames, []);
  assert.equal(options.oneShot, true);
  assert.equal(options.remembered, null);
  assert.equal(options.timeoutMs, 240_000);
});
test("a failed source streams an error, never a successful summary", async () => {
  globalThis.__videoFail = true;
  const response = await route.POST(req("POST", { url }));
  const events = (await response.text()).trim().split("\n").map(JSON.parse);
  assert.equal(events.at(-1).error, "No captions available");
  assert.ok(events.every(event => !event.result));
});
test("disconnecting progress does not cancel the submitted paid work", async () => {
  globalThis.__videoFail = false;
  globalThis.__videoWait = true;
  const before = globalThis.__videoCalls.length;
  try {
    const response = await route.POST(req("POST", { url }));
    while (!globalThis.__videoRelease) await new Promise(resolve => setImmediate(resolve));
    await response.body.cancel();
    globalThis.__videoRelease();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(globalThis.__videoCalls.length, before + 2, "source and AI work both complete after disconnect");
  } finally { delete globalThis.__videoWait; delete globalThis.__videoRelease; }
});
