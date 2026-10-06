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
  globalThis.fetch = async () => new Response("", { status: 404 });
  globalThis.__jarvisTestTurn = async (options) => {
    calls++;
    assert.equal(options.oneShot, true);
    assert.equal(options.remembered, null);
    assert.deepEqual(options.toolNames, ["web_search", "fetch_content", "get_search_content"]);
    assert.equal(options.timeoutMs, 360000);
    assert.deepEqual(options.model, { provider: "openai-codex", modelId: "gpt-5.6-sol" });
    return response();
  };
});
after(() => { rmSync(root, { recursive: true, force: true }); delete globalThis.__jarvisTestTurn; });

test("the CRM exposes the effective email template before any custom save", () => {
  assert.deepEqual(jobs.readJarvisView().template, domain.DEFAULT_JARVIS_TEMPLATE);
});

test("background research persists incremental batches and stops at the target", async () => {
  jobs.startJarvisDiscovery(2);
  assert.throws(() => jobs.startJarvisDiscovery(2), /already running/);
  const state = await settled();
  assert.equal(state.leads.filter((lead) => lead.audienceFit === "core").length, 2);
  assert.equal(state.run.added, 2);
  assert.equal(state.run.status, "done", state.run.message);
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
  assert.equal(state.run.status, "done", state.run.message);
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
  domain.writeJarvisRescore({ id: "old-score", status: "running", total: 1, assessed: 0, startedAt: new Date().toISOString(), message: "" });
  domain.writeJarvisWebsiteRun({ id: "old-web", status: "running", total: 1, checked: 0, found: 0, failed: 0, activeWorkers: 1, startedAt: new Date().toISOString(), message: "" });
  const view = jobs.readJarvisView();
  assert.equal(view.run.status, "error");
  assert.equal(view.rescore.status, "error");
  assert.equal(view.websiteRun.status, "error");
  assert.equal(domain.readJarvis().run.status, "running");
  assert.equal(domain.readJarvis().rescore.status, "running");
  assert.equal(domain.readJarvis().websiteRun.status, "running");
});

test("a fresh lease in another process blocks duplicate research and can be stopped here", () => {
  const heartbeatAt = new Date().toISOString();
  domain.writeJarvisRun({ id: "remote", ownerId: "another-process", heartbeatAt, status: "running", target: 100, added: 0, batches: 1, startedAt: heartbeatAt, message: "Working" });
  domain.writeJarvisRescore({ id: "remote-score", ownerId: "another-process", heartbeatAt, status: "running", total: 1, assessed: 0, startedAt: heartbeatAt, message: "Working" });
  domain.writeJarvisWebsiteRun({ id: "remote-web", ownerId: "another-process", heartbeatAt, status: "running", total: 1, checked: 0, found: 0, failed: 0, activeWorkers: 1, startedAt: heartbeatAt, message: "Working" });
  const view = jobs.readJarvisView();
  assert.equal(view.run.status, "running");
  assert.equal(view.rescore.status, "running");
  assert.equal(view.websiteRun.status, "running");
  assert.equal(domain.claimJarvisDeliveryLease("another-process:outbox", Date.now() - 120_000), true);
  assert.equal(jobs.readJarvisView().deliveryLease, undefined, "runtime coordination is not part of the browser view");
  assert.ok(domain.readJarvis().deliveryLease);
  assert.throws(() => jobs.startJarvisDiscovery(2), /already running/);
  jobs.stopJarvisDiscovery();
  assert.equal(domain.readJarvis().run.status, "cancelled");
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

test("persona research rotates by priority share and counts people with personal Instagram without an email", async () => {
  const score = (n) => ({ score: n, evidence: "sourced reason" });
  const personaForLane = { dtc_shopify: "ecommerce_owner", healthcare_operations: "healthcare_operator", cross_source_operations: "cross_source_operator" };
  globalThis.fetch = async () => new Response("health@example.com", { headers: { "Content-Type": "text/html" } });
  const personaLead = (lane, burden) => ({ name: `Person ${calls}`, company: `Firm ${calls}`, role: lane === "healthcare_operations" ? "Practice Administrator" : "Founder and CEO", seniority: "Executive", industry: lane === "healthcare_operations" ? "Healthcare" : "Ecommerce", segment: "info_exec", persona: personaForLane[lane], sourcingLane: lane, watchList: "customers, platforms, regulation, inventory and competitors",
    newsBurden: { change: score(burden), breadth: score(3), unfiltered: score(3), footprint: score(2) }, profileUrl: `https://example.com/p/${calls}`, evidence: "Public evidence", evidenceUrl: "https://example.com/team",
    shopifyEvidence: { url: "https://example.com/shopify", quote: "Built on Shopify Plus" }, informationNeedEvidence: { url: "https://example.com/interview", quote: "The founder reviews customer, channel, platform and inventory signals." }, whyNow: { summary: "Recent retail expansion", url: "https://example.com/news", quote: "Expanded into retail in 2026" },
    companyFit: { score: 42, evidence: "Small multi-channel DTC brand" }, reachability: { score: 40, evidence: "Current founder with a public route" },
    needHypothesis: "待验证", email: lane === "healthcare_operations" ? "health@example.com" : "", emailSource: lane === "healthcare_operations" ? "https://example.com/team" : "", emailQuote: lane === "healthcare_operations" ? "Contact health@example.com" : "", socials: { instagram: `https://www.instagram.com/example${calls}/` }, opener: "I came across your work leading current operations." });
  const asked = [];
  globalThis.__jarvisTestTurn = async (options) => {
    calls++;
    const lane = options.message.match(/Lane (\w+)[.;]/)[1];
    asked.push(lane);
    const leads = [personaLead(lane, 3)];
    return { usedTools: ["web_search", "fetch_content"], reply: `<jarvis-leads>${JSON.stringify({ leads })}</jarvis-leads>` };
  };
  // A rescored contact from another cohort qualifies, but does not count toward the run.
  domain.addJarvisCandidates([{ ...personaLead("dtc_shopify", 3), name: "Rescored", segment: "clinic", email: "r@example.com", emailSource: "https://example.com/team", emailQuote: "r@example.com" }]);
  jobs.startJarvisDiscovery(3, "info_exec");
  const state = await settled();
  assert.equal(state.run.status, "done", state.run.message);
  assert.deepEqual(new Set(asked), new Set(["dtc_shopify", "healthcare_operations", "cross_source_operations"]), "the three current ICP lanes run in parallel");
  const counted = state.leads.filter((lead) => lead.segment === "info_exec" && lead.newsBurden.change.score === 3);
  assert.equal(counted.length, 3, "email-less qualified people advance the target; the rescored one does not");
  const current = state.leads.filter((lead) => lead.segment === "info_exec");
  assert.ok(current.filter((lead) => lead.persona !== "healthcare_operator").every((lead) => !lead.email && lead.socials?.instagram));
  assert.ok(current.filter((lead) => lead.persona === "healthcare_operator").every((lead) => lead.email === "health@example.com" && lead.emailCheck === "source_found"));
  assert.equal(state.run.batches, 3, "one wave records three assistant turns");
});

test("Instagram-focused research counts only new DTC owners with a trustworthy Instagram route", async () => {
  const score = (n) => ({ score: n, evidence: "sourced reason" });
  const personaForLane = { dtc_shopify: "ecommerce_owner", healthcare_operations: "healthcare_operator", cross_source_operations: "cross_source_operator" };
  globalThis.fetch = async () => new Response("health@example.com", { headers: { "Content-Type": "text/html" } });
  globalThis.__jarvisTestTurn = async (options) => {
    calls++;
    assert.equal(options.timeoutMs, 360000);
    assert.equal(options.thinkingLevel, "low");
    assert.match(options.message, /ONE query each/);
    assert.match(options.message, /company\/contact-route-first sequence/);
    assert.match(options.message, /trustworthy PERSONAL Instagram/);
    assert.match(options.message, /current role/);
    assert.match(options.message, /specifically building the personal instagram outreach lane/);
    const lane = options.message.match(/Lane (\w+)[.;]/)[1];
    const lead = { name: `Instagram Person ${calls}`, company: `Instagram Brand ${calls}`, role: lane === "healthcare_operations" ? "Practice Administrator" : "Founder and CEO", seniority: "Executive", industry: lane === "healthcare_operations" ? "Healthcare" : "Ecommerce", segment: "info_exec", persona: personaForLane[lane], sourcingLane: lane, watchList: "customers, platforms, regulation, inventory and competitors",
      newsBurden: { change: score(3), breadth: score(3), unfiltered: score(3), footprint: score(2) }, profileUrl: `https://example.com/founder/${calls}`, evidence: "Current founder evidence", evidenceUrl: "https://example.com/team",
      informationNeedEvidence: { url: "https://example.com/interview", quote: "The founder reviews customer, platform and inventory signals." }, whyNow: { summary: "New launch", url: "https://example.com/news", quote: "Launched a new line in 2026." },
      companyFit: { score: 42, evidence: "Small DTC brand" }, reachability: { score: 40, evidence: "Founder-led public Instagram account" },
      needHypothesis: "待验证", email: lane === "healthcare_operations" ? "health@example.com" : "", emailSource: lane === "healthcare_operations" ? "https://example.com/team" : "", emailQuote: lane === "healthcare_operations" ? "Contact health@example.com" : "", socials: { instagram: `https://www.instagram.com/founder${calls}/` }, opener: "I came across your current operating work." };
    return { usedTools: ["web_search", "fetch_content"], reply: `<jarvis-leads>${JSON.stringify({ leads: [lead] })}</jarvis-leads>` };
  };
  assert.throws(() => jobs.startJarvisDiscovery(2, "clinic", false, "instagram"), /supports Instagram only/);
  const run = jobs.startJarvisDiscovery(2, "info_exec", false, "instagram");
  assert.equal(run.channelFocus, "instagram");
  const state = await settled();
  assert.equal(state.run.status, "done", state.run.message);
  assert.equal(state.leads.filter((lead) => lead.segment === "info_exec" && lead.socials?.instagram).length, 2);
  assert.equal(calls, 2, "reserved target slots prevent parallel workers from overshooting the Instagram target");
});

test("three empty batches stop research rather than spending indefinitely", async () => {
  globalThis.__jarvisTestTurn = async () => { calls++; return response(0); };
  jobs.startJarvisDiscovery(10);
  const state = await settled();
  assert.equal(calls, 3);
  assert.equal(state.run.status, "error");
});

test("daily research waits for its hour, starts one strict-ICP run for N more contactable people, and only once a day", async () => {
  const daily = await jiti.import("./jarvis-daily.ts");
  assert.equal(daily.tickJarvisDaily(new Date(2026, 8, 28, 9)), "off", "off by default");
  domain.setJarvisDaily({ enabled: true, count: 2, hour: 6 });
  assert.equal(daily.tickJarvisDaily(new Date(2026, 8, 28, 5, 59)), "too-early");
  const seen = [];
  globalThis.__jarvisTestTurn = async (options) => { seen.push(options.message); return response(0, "info_exec"); };
  assert.equal(daily.tickJarvisDaily(new Date(2026, 8, 28, 6, 5)), "started");
  const view = await settled();
  assert.equal(view.run.focus, "info_exec");
  assert.equal(view.run.wide, undefined);
  assert.equal(view.run.target, 2, "target is today's count on top of the contactable ICPs already found");
  assert.ok(seen.length > 0);
  assert.equal(domain.readJarvisDaily().lastRunOn, "2026-09-28");
  assert.equal(daily.tickJarvisDaily(new Date(2026, 8, 28, 15)), "done-today");
  assert.throws(() => domain.setJarvisDaily({ count: 0 }), /count/);
  assert.throws(() => domain.setJarvisDaily({ hour: 24 }), /hour/);
});

test("daily target counts contactable current operators without requiring a full evidence dossier", async () => {
  const daily = await jiti.import("./jarvis-daily.ts");
  domain.addJarvisCandidates([{ name: "New DTC Founder", company: "Example Store", role: "Founder", seniority: "Founder", industry: "DTC skincare", segment: "info_exec", persona: "ecommerce_owner", sourcingLane: "dtc_shopify", profileUrl: "https://example.com/founder", evidenceUrl: "https://example.com/about", evidence: "Founder of a store", needHypothesis: "Information overload needs validation", opener: "I came across your store.", socials: { instagram: "https://www.instagram.com/example/" }, watchList: "Ingredients and ecommerce", newsBurden: Object.fromEntries(["change", "breadth", "unfiltered", "footprint"].map(key => [key, { score: 1, evidence: "Needs validation" }])) }]);
  domain.setJarvisDaily({ enabled: true, count: 2, hour: 6 });
  globalThis.__jarvisTestTurn = async () => response(0, "info_exec");
  assert.equal(daily.tickJarvisDaily(new Date(2026, 8, 30, 7)), "started");
  assert.equal((await settled()).run.target, 3);
});

test("DTC failures stop with a retained error instead of spending the full worker budget", async () => {
  globalThis.__jarvisTestTurn = async () => { calls++; throw new Error("Search timed out"); };
  jobs.startJarvisDiscovery(2, "info_exec");
  const state = await settled();
  assert.equal(state.run.status, "error");
  assert.equal(state.run.lastError, "Search timed out");
  assert.ok(calls <= 8, "bounded failures plus at most two already active workers");
  assert.match(state.run.message, /Search timed out/);
});
