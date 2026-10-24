import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";
import { weeklyClock } from "../extension/robin/ai-weekly.ts";
import { weeklyView, setWeeklyPreferences } from "../extension/robin/ai-weekly-domain.ts";
import { resetTaskStore } from "../extension/robin/task-store.test-support.mjs";

const root = mkdtempSync(join(tmpdir(), "weekly-runner-"));
const oldDir = process.env.ROBIN_DATA_DIR, oldFetch = globalThis.fetch;
process.env.ROBIN_DATA_DIR = root;
resetTaskStore(root);
setWeeklyPreferences({ timezone: "UTC" });
const stub = join(root, "assistant.mjs");
writeFileSync(stub, "export const runScopedAssistantTurn = (options) => globalThis.__weeklyTurn(options);\n");
const jiti = createJiti(import.meta.url, { alias: { "./robin-assistant": stub }, moduleCache: false });
const runner = await jiti.import("./ai-weekly-runner.ts");
after(() => { globalThis.fetch = oldFetch; delete globalThis.__weeklyTurn; if (oldDir === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = oldDir; rmSync(root, { recursive: true, force: true }); });

test("the real runner gives harvest only public research tools and editing no tools, in separate one-shot sessions", async () => {
  const date = weeklyClock(new Date(), "UTC").through;
  const quote = "The new preview is available to a small number of developers; no general release date has been announced.";
  const candidate = { key: `test-event-${date}`, title: "A test preview", lane: "practical", status: "announced", eventDate: date,
    source: { url: "https://example.com/news", title: "Original announcement", publishedOn: date, dateQuote: date, quote } };
  globalThis.fetch = async () => new Response(`<time>${date}</time><p>${quote}</p>`, { headers: { "content-type": "text/html" } });
  const calls = [];
  globalThis.__weeklyTurn = async (options) => {
    calls.push(options);
    assert.equal(options.oneShot, true); assert.equal(options.remembered, null); assert.ok(options.signal);
    options.remember(`session-${calls.length}`);
    return { reply: calls.length === 1
      ? `<ai-harvest>${JSON.stringify({ candidates: [candidate], gaps: [] })}</ai-harvest>`
      : `<ai-brief>${JSON.stringify({ headline: "Test week", items: [{ candidateKey: candidate.key, what: "A preview was announced", why: "Worth observing", action: "No action required", caveat: "Not generally available" }], ignored: [] })}</ai-brief>` };
  };
  await runner.tickWeekly(); assert.equal(calls.length, 0, "disabled automation spends nothing");
  assert.equal(runner.startWeeklyGeneration(), true);
  assert.equal(runner.startWeeklyGeneration(), false, "a second page cannot start duplicate work");
  for (let n = 0; n < 200 && weeklyView().running; n++) await new Promise((resolve) => setTimeout(resolve, 10));
  const view = weeklyView();
  assert.equal(view.run.stage, "done", view.run.error);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].toolNames, ["web_search", "fetch_content", "get_search_content"]);
  assert.deepEqual(calls[1].toolNames, []);
  assert.equal(calls[0].timeoutMs, 600000); assert.equal(calls[1].timeoutMs, 180000);
  assert.deepEqual(view.run.sessions, ["session-1", "session-2"]);
  assert.equal(runner.startWeeklyGeneration(), false, "published editions are immutable");
});
