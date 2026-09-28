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
const response = (count = 1, segment = "clinic") => ({ usedTools: ["web_search", "fetch_content"], reply: `<jarvis-leads>${JSON.stringify({ leads: Array.from({ length: count }, (_, i) => ({ name: `Person ${calls}-${i}`, company: "Example", role: "CTO", seniority: "Executive", industry: "AI", segment, profileUrl: `https://example.com/people/${calls}-${i}`, evidence: "Public professional evidence", evidenceUrl: "https://example.com/team", needHypothesis: "Needs to be tested", email: `p${calls}-${i}@example.com`, emailSource: "https://example.com/team", emailQuote: `Email p${calls}-${i}@example.com`, opener: "I came across your work on AI tools." })) })}</jarvis-leads>` });
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

test("focused executive research accepts a larger target and excludes other cohorts", async () => {
  assert.throws(() => jobs.startJarvisDiscovery(101), /target/);
  assert.throws(() => jobs.startJarvisDiscovery(151, "nontech_exec"), /target/);
  assert.throws(() => jobs.startJarvisDiscovery(2, "invalid"), /cohort/);
  globalThis.__jarvisTestTurn = async (options) => {
    calls++;
    assert.match(options.message, /cohort nontech_exec/);
    return calls === 1 ? response(1, "clinic") : response(1, "nontech_exec");
  };
  const run = jobs.startJarvisDiscovery(2, "nontech_exec");
  assert.equal(run.focus, "nontech_exec");
  const state = await settled();
  assert.equal(state.run.status, "done");
  assert.equal(state.leads.length, 2);
  assert.ok(state.leads.every((lead) => lead.segment === "nontech_exec"));
  globalThis.__jarvisTestTurn = async () => { calls++; return response(0); };
  jobs.startJarvisDiscovery(101, "nontech_exec");
  assert.equal((await settled()).run.status, "error", "101 is allowed but still obeys the bounded empty-batch stop");
});

test("persona research rotates by priority share and counts qualified people without an email", async () => {
  const score = (n) => ({ score: n, evidence: "sourced reason" });
  const personaLead = (persona, burden) => ({ name: `Person ${calls}`, company: `Firm ${calls}`, role: "Partner", seniority: "Partner", industry: "Venture", segment: "info_exec", persona, watchList: "a seed portfolio in vertical AI",
    newsBurden: { change: score(burden), breadth: score(3), unfiltered: score(3), footprint: score(2) }, profileUrl: `https://example.com/p/${calls}`, evidence: "Public evidence", evidenceUrl: "https://example.com/team",
    needHypothesis: "待验证", email: "", emailSource: "", emailQuote: "", opener: "I came across your portfolio." });
  const asked = [];
  globalThis.__jarvisTestTurn = async (options) => {
    calls++;
    const persona = options.message.match(/Persona (\w+)\./)[1];
    asked.push(persona);
    // The second answer is below the bar, and one answers with the wrong persona: neither counts.
    const leads = calls === 2 ? [personaLead(persona, 0)] : calls === 3 ? [personaLead("vc", 3)] : [personaLead(persona, 3)];
    return { usedTools: ["web_search", "fetch_content"], reply: `<jarvis-leads>${JSON.stringify({ leads })}</jarvis-leads>` };
  };
  // A rescored contact from another cohort qualifies, but does not count toward the run.
  domain.addJarvisCandidates([{ ...personaLead("vc", 3), name: "Rescored", segment: "clinic", email: "r@example.com", emailSource: "https://example.com/team", emailQuote: "r@example.com" }]);
  jobs.startJarvisDiscovery(3, "info_exec");
  const state = await settled();
  assert.equal(state.run.status, "done");
  assert.deepEqual(asked.slice(0, 2), ["vc", "client_advisor"], "highest-priority personas are asked first");
  assert.ok(asked.includes("startup_leader"), "an attempt counts toward a persona's share, so the rotation moves on");
  const counted = state.leads.filter((lead) => lead.segment === "info_exec" && lead.newsBurden.change.score === 3);
  assert.equal(counted.length, 3, "email-less qualified people advance the target; the rescored one does not");
  assert.ok(state.leads.filter((lead) => lead.segment === "info_exec").every((lead) => !lead.email));
  assert.equal(asked[2], "startup_leader");
  assert.equal(state.leads.filter((lead) => lead.segment === "info_exec" && lead.persona === "vc").length, 1, "an answer for a persona that was not asked is dropped");
});

test("three empty batches stop research rather than spending indefinitely", async () => {
  globalThis.__jarvisTestTurn = async () => { calls++; return response(0); };
  jobs.startJarvisDiscovery(10);
  const state = await settled();
  assert.equal(calls, 3);
  assert.equal(state.run.status, "error");
});

test("daily research waits for its hour, starts one wide-net run for N more reachable executives, and only once a day", async () => {
  const daily = await jiti.import("./jarvis-daily.ts");
  assert.equal(daily.tickJarvisDaily(new Date(2026, 8, 28, 9)), "off", "off by default");
  domain.setJarvisDaily({ enabled: true, count: 2, hour: 6 });
  assert.equal(daily.tickJarvisDaily(new Date(2026, 8, 28, 5, 59)), "too-early");
  const seen = [];
  globalThis.__jarvisTestTurn = async (options) => { seen.push(options.message); return response(0, "info_exec"); };
  assert.equal(daily.tickJarvisDaily(new Date(2026, 8, 28, 6, 5)), "started");
  const view = await settled();
  assert.equal(view.run.focus, "info_exec");
  assert.equal(view.run.wide, true);
  assert.equal(view.run.target, 2, "target is today's count on top of the reachable executives already found");
  assert.ok(seen.length > 0);
  assert.equal(domain.readJarvisDaily().lastRunOn, "2026-09-28");
  assert.equal(daily.tickJarvisDaily(new Date(2026, 8, 28, 15)), "done-today");
  assert.throws(() => domain.setJarvisDaily({ count: 0 }), /count/);
  assert.throws(() => domain.setJarvisDaily({ hour: 24 }), /hour/);
});
