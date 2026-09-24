import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "jarvis-run-"));
process.env.ROBIN_DATA_DIR = join(root, "data");
const stub = join(root, "assistant.mjs");
writeFileSync(stub, "export const runScopedAssistantTurn = (options) => globalThis.__jarvisTestTurn(options);\n");
const jiti = createJiti(import.meta.url, { alias: { "./robin-assistant": stub } });
const jobs = await jiti.import("./jarvis-discovery.ts");
const domain = await import("../extension/robin/jarvis-domain.ts");
let calls = 0;
// Source checks must not reach the network in tests; an unreachable page leaves emails "unconfirmed".
globalThis.fetch = async () => new Response("", { status: 404 });
const response = (count = 1) => ({ usedTools: ["web_search", "fetch_content"], reply: `<jarvis-leads>${JSON.stringify({ leads: Array.from({ length: count }, (_, i) => ({ name: `Person ${calls}-${i}`, company: "Example", role: "CTO", seniority: "Executive", industry: "AI", segment: "clinic", profileUrl: `https://example.com/people/${calls}-${i}`, evidence: "Public professional evidence", evidenceUrl: "https://example.com/team", needHypothesis: "Needs to be tested", email: `p${calls}-${i}@example.com`, emailSource: "https://example.com/team", emailQuote: `Email p${calls}-${i}@example.com`, opener: "I came across your work on AI tools." })) })}</jarvis-leads>` });
const settled = async () => {
  for (let i = 0; i < 100 && globalThis.__jarvisDiscovery; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(globalThis.__jarvisDiscovery, undefined, "job must settle");
  return jobs.readJarvisView();
};
beforeEach(() => {
  rmSync(process.env.ROBIN_DATA_DIR, { recursive: true, force: true });
  calls = 0;
  globalThis.__jarvisTestTurn = async (options) => {
    calls++;
    assert.equal(options.oneShot, true);
    assert.equal(options.remembered, null);
    assert.deepEqual(options.toolNames, ["web_search", "fetch_content", "get_search_content"]);
    assert.equal(options.timeoutMs, 360000);
    return response();
  };
});
after(() => { rmSync(root, { recursive: true, force: true }); delete globalThis.__jarvisTestTurn; });

test("background research persists incremental batches and stops at the target", async () => {
  jobs.startJarvisDiscovery(2);
  assert.throws(() => jobs.startJarvisDiscovery(2), /already running/);
  const state = await settled();
  assert.equal(state.leads.filter((lead) => lead.audienceFit === "core").length, 2);
  assert.equal(state.run.added, 2);
  assert.equal(state.run.status, "done");
  assert.throws(() => jobs.startJarvisDiscovery(2), /target already/i);
});

test("failure preserves completed batches and a new run can continue", async () => {
  globalThis.__jarvisTestTurn = async () => { calls++; if (calls > 1) throw new Error("Search provider unavailable"); return response(); };
  jobs.startJarvisDiscovery(3);
  const state = await settled();
  assert.equal(state.leads.filter((lead) => lead.audienceFit === "core").length, 1);
  assert.equal(state.run.status, "error");
  assert.equal(calls, 4, "one success plus three bounded failures");
  assert.match(state.run.message, /provider unavailable/);
  globalThis.__jarvisTestTurn = async () => { calls++; return response(); };
  jobs.startJarvisDiscovery(2);
  assert.equal((await settled()).leads.filter((lead) => lead.audienceFit === "core").length, 2);
});

test("one failed batch does not terminate the campaign", async () => {
  globalThis.__jarvisTestTurn = async () => {
    calls++;
    if (calls === 1) throw new Error("The assistant took too long to respond.");
    return response();
  };
  jobs.startJarvisDiscovery(2);
  const state = await settled();
  assert.equal(calls, 3);
  assert.equal(state.leads.filter((lead) => lead.audienceFit === "core").length, 2);
  assert.equal(state.run.status, "done");
});

test("no web tools means no fabricated contacts are imported", async () => {
  globalThis.__jarvisTestTurn = async () => ({ ...response(), usedTools: [] });
  jobs.startJarvisDiscovery(1);
  const state = await settled();
  assert.equal(state.leads.length, 0);
  assert.equal(state.run.status, "error");
});

test("cancellation aborts and discards late results", async () => {
  let release;
  globalThis.__jarvisTestTurn = () => new Promise((r) => { release = r; });
  jobs.startJarvisDiscovery(2);
  jobs.stopJarvisDiscovery();
  assert.throws(() => jobs.startJarvisDiscovery(2), /already running/);
  release(response());
  const state = await settled();
  assert.equal(state.run.status, "cancelled");
  assert.equal(state.leads.length, 0);
});

test("restart shows interrupted without mutating the stored run on GET", () => {
  domain.writeJarvisRun({ id: "old", status: "running", target: 100, added: 0, batches: 1, startedAt: new Date().toISOString(), message: "" });
  assert.equal(jobs.readJarvisView().run.status, "error");
  assert.equal(domain.readJarvis().run.status, "running");
});

test("three empty batches stop research rather than spending indefinitely", async () => {
  globalThis.__jarvisTestTurn = async () => { calls++; return response(0); };
  jobs.startJarvisDiscovery(10);
  const state = await settled();
  assert.equal(calls, 3);
  assert.equal(state.run.status, "error");
});
