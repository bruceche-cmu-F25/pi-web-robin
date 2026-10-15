import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dir = mkdtempSync(join(tmpdir(), "robin-opportunities-"));
process.env.ROBIN_DATA_DIR = dir;
test.after(() => rmSync(dir, { recursive: true, force: true }));
const { parseListings, recommend, appendOpportunities, opportunityBoard, startOpportunityScan, saveOpportunity, updateDailyOpportunities } = await import("./product-opportunities.ts");
const { listIdeas, updateIdea } = await import("./product-domain.ts");
const { writeJsonObject } = await import("./paths.ts");
const SOURCE = "https://www.starterstory.com/data/ios-app-ideas";

function row(path, title, revenue, detail = 'title="Estimated from public sources — not self-reported."') {
  return `<a ${detail === "locked" ? 'class="blur-row"' : ""} data-posthog-action="view_case_study" href="${path}"><div class="text-sm font-semibold text-slate-900 truncate">${title}</div>${revenue === null ? '<span>—</span>' : detail === "generic" ? `<span>${revenue.replace("/mo", "")}</span><span>/mo</span>` : `<span ${detail}>${revenue}</span>`}</a>`;
}
const page = (...rows) => `id="db-view-rows"><div>${rows.join("")}</div>id="db-view-cards"`;
const apps = page(
  row("/stories/pushup-quest", "Every push-up becomes an attack in a camera-counted RPG.", "$800/mo", "generic"),
  row("/businesses/audiopen", "AI voice note transcriber", "$15K/mo", 'title="Self-reported"'),
  row("/businesses/reflect", "AI-powered note-taking app", "$30K/mo"),
  row("/stories/large-app", "Professional network", "$1M/mo", "generic"),
  row("/stories/no-revenue", "Another app", null),
  row("/stories/locked", "Locked app", "$20K/mo", "locked"),
);
const requested = [];
const fetchPage = async (url) => {
  requested.push(url);
  assert.equal(url, SOURCE, "No general database, SaaS page or interviews may supply candidates");
  return { ok: true, text: async () => apps };
};
const wait = async (at) => {
  for (let i = 0; i < 80 && opportunityBoard(at).scanning; i++) await new Promise((resolve) => setTimeout(resolve, 5));
};

test("public directory parser retains low, high and unknown revenue; locked rows remain excluded", () => {
  const parsed = parseListings(apps);
  assert.equal(parsed.length, 5);
  assert.equal(parsed[0].monthlyUsd, 800);
  assert.equal(parsed[1].revenueBasis, "reported");
  assert.equal(parsed[2].revenueBasis, "estimated");
  assert.equal(parsed[3].monthlyUsd, 1_000_000);
  assert.equal(parsed[4].monthlyUsd, null);
  assert.equal(parsed[4].revenue, "—");
  const withMeta = apps.replace('href="/stories/pushup-quest"><div', 'href="/stories/pushup-quest"><img alt="" src="https://d1coqmn8qm80r4.cloudfront.net/abc123"><span class="font-mono text-slate-400 truncate text-[11px]">pushup.quest</span><span>Solopreneur 78.4</span><div');
  const item = parseListings(withMeta)[0];
  assert.equal(item.productHost, "pushup.quest");
  assert.equal(item.soloScore, 78.4);
  assert.equal(item.logoUrl, "https://d1coqmn8qm80r4.cloudfront.net/abc123");
  const candidates = recommend(parsed, [{ name: "个人agent工作台" }]);
  assert.equal(candidates.length, 5, "No SaaS keyword or revenue-band filtering");
  assert.ok(candidates.every((entry) => entry.angle && entry.transfer && entry.experiment));
  assert.equal(candidates[0].relatedIdea, "个人agent工作台");
  assert.deepEqual(parseListings("site redesign or paywall"), []);
});

test("legacy daily history still appends at most three distinct URLs and never deletes older entries", () => {
  const candidates = recommend(parseListings(apps), []);
  const day1 = appendOpportunities([], candidates, "2026-10-01");
  assert.equal(day1.length, 3);
  assert.equal(appendOpportunities(day1, candidates, "2026-10-01").length, 3);
  const day2 = appendOpportunities(day1, candidates, "2026-10-02");
  assert.equal(day2.length, 5);
  assert.deepEqual(day2.slice(-3), day1);
  assert.equal(appendOpportunities(day2, candidates, "2026-10-03").length, 5);
});

test("one directory supplies the whole catalog; saving is explicit, idempotent and preserves edits", async () => {
  const now = Date.now();
  assert.equal(startOpportunityScan(fetchPage, now), true);
  assert.equal(startOpportunityScan(fetchPage, now), false);
  await wait(now);
  const first = opportunityBoard(now);
  assert.equal(first.source, SOURCE);
  assert.equal(first.opportunities.length, 5, "All public products, not only three daily picks");
  assert.ok(first.opportunities.every((entry) => entry.source === SOURCE));
  assert.equal(listIdeas().length, 0);
  assert.equal((await updateDailyOpportunities()).opportunities.length, 3, "Old history remains independently capped");
  const saved = saveOpportunity(first.opportunities[4].id);
  assert.ok(saved.note.includes(SOURCE));
  assert.ok(saved.note.includes("未验证假设"));
  assert.equal(saved.links.length, 2);
  updateIdea(saved.id, { name: "My edit", note: "Keep my words", parked: true });
  const repeated = saveOpportunity(first.opportunities[4].id);
  assert.equal(repeated.id, saved.id);
  assert.equal(repeated.name, "My edit");
  assert.equal(repeated.note, "Keep my words");
  assert.equal(repeated.parked, true);
  assert.equal(listIdeas().length, 1);
  assert.deepEqual(opportunityBoard(now).savedIds, [first.opportunities[4].id]);
  assert.deepEqual(requested, [SOURCE]);
  startOpportunityScan(async () => { throw Error("offline"); }, now);
  await wait(now);
  assert.match(opportunityBoard(now).error, /offline/);
  assert.deepEqual(opportunityBoard(now).opportunities, first.opportunities);
  startOpportunityScan(fetchPage, now);
  await wait(now);
  assert.equal(opportunityBoard(now).error, undefined, "A successful retry clears the previous error");
  assert.throws(() => saveOpportunity("unknown"), /not found/);
});

test("switching source refreshes even after a legacy scan today, without relabeling or deleting old picks", async () => {
  const now = Date.now();
  const legacy = { ...recommend(parseListings(apps), [])[0], id: "legacy", url: "https://www.starterstory.com/businesses/legacy", discoveredOn: "2020-01-01" };
  writeJsonObject("product-opportunities.json", { checkedAt: new Date(now).toISOString(), attemptedAt: new Date(now).toISOString(), opportunities: [legacy] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchPage;
  try {
    const pending = opportunityBoard(now);
    assert.equal(pending.scanning, true);
    assert.deepEqual(pending.opportunities, [], "Old general-source rows are not presented as iOS directory facts");
    await wait(now);
    assert.equal(opportunityBoard(now).opportunities.length, 5);
    assert.deepEqual((await updateDailyOpportunities()).opportunities.find((item) => item.id === "legacy"), legacy);
  } finally { globalThis.fetch = originalFetch; }
});
