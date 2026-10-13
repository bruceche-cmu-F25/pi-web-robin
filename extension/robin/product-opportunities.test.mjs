import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.ROBIN_DATA_DIR = mkdtempSync(join(tmpdir(), "robin-opportunities-"));
const { parseListings, recommend, appendOpportunities, opportunityBoard, startOpportunityScan, saveOpportunity } = await import("./product-opportunities.ts");
const { listIdeas } = await import("./product-domain.ts");
const { localDate } = await import("./dates.ts");

function row(path, title, revenue, detail = 'title="Estimated from public sources by our research agent — not self-reported."') {
  return `<a ${detail === "locked" ? 'class="blur-row"' : ""} data-posthog-action="view_case_study" href="${path}"><div class="text-sm font-semibold text-slate-900 truncate">${title}</div>${detail === "generic" ? `<span>${revenue.replace("/mo", "")}</span><span>/mo</span>` : `<span ${detail}>${revenue}</span>`}</a>`;
}
const page = (...rows) => `id="db-view-rows"><div>${rows.join("")}</div>id="db-view-cards"`;
const main = page(
  row("/businesses/mail-tool", "Gmail email campaign tool", "$100K/mo"),
  row("/businesses/resume", "AI resume builder", "$400/mo", 'title="Self-reported"'),
  row("/businesses/locked", "AI voice note transcriber", "$200K/mo", "locked"),
);
const saas = page(
  row("/stories/voice", "AI voice note transcriber", "$8.33K/mo", "generic"),
  row("/businesses/demo", "Ai-powered interactive demos", "$20K/mo", "generic"),
  row("/businesses/store", "Store locator software", "$7K/mo", "generic"),
);
const apps = page(
  row("/stories/job", "Make job search easier", "$12K/mo", "generic"),
  row("/stories/note", "AI-powered note-taking app", "$15K/mo", "generic"),
);
const wrappers = page(row("/stories/voice", "AI voice note transcriber", "$8.33K/mo", "generic"));
const pages = [main, saas, apps, wrappers];
const fetchPages = async (url) => ({ ok: true, text: async () => pages[["/data", "micro-saas-ideas", "ios-app-ideas", "gpt-wrapper-ideas"].findIndex((key) => url.endsWith(key))] });
const wait = async (at) => {
  for (let i = 0; i < 80 && opportunityBoard(at).scanning; i++) await new Promise((resolve) => setTimeout(resolve, 5));
};

test("parses public monthly claims from both source templates but excludes locked rows", () => {
  assert.equal(parseListings(main).length, 2);
  assert.equal(parseListings(main)[0].revenueBasis, "estimated");
  assert.equal(parseListings(main)[1].revenueBasis, "reported");
  assert.equal(parseListings(saas)[0].monthlyUsd, 8_330);
  assert.equal(parseListings(saas)[0].revenueBasis, "unspecified");
  assert.equal(parseListings(saas)[0].id, "stories-voice");
  const withLogo = main.replace('href="/businesses/mail-tool"><div', 'href="/businesses/mail-tool"><img alt="" src="https://d1coqmn8qm80r4.cloudfront.net/abc123"><div');
  assert.equal(parseListings(withLogo)[0].logoUrl, "https://d1coqmn8qm80r4.cloudfront.net/abc123");
  assert.equal(recommend(parseListings(main), [{ name: "面向executive的email整理器" }])[0].relatedIdea, undefined, "email marketing is not inbox triage");
  assert.equal(recommend(parseListings(apps), [{ name: "个人agent工作台抽象成产品" }])[0].relatedIdea, "个人agent工作台抽象成产品");
  assert.deepEqual(parseListings("site redesign or paywall"), []);
});

test("append adds at most three distinct URLs per local day, never drops old entries", () => {
  const candidates = recommend([...parseListings(main), ...parseListings(saas), ...parseListings(apps)], []);
  const day1 = appendOpportunities([], candidates, "2026-10-01");
  assert.equal(day1.length, 3);
  assert.equal(appendOpportunities(day1, candidates, "2026-10-01").length, 3);
  const enriched = appendOpportunities([{ ...day1[0], logoUrl: undefined }], [{ ...day1[0], logoUrl: "https://d1coqmn8qm80r4.cloudfront.net/abc123" }], "2026-10-01");
  assert.equal(enriched.length, 1);
  assert.equal(enriched[0].logoUrl, "https://d1coqmn8qm80r4.cloudfront.net/abc123");
  assert.equal(enriched[0].discoveredOn, "2026-10-01");
  const day2 = appendOpportunities(day1, candidates, "2026-10-02");
  assert.equal(day2.length, 6);
  assert.deepEqual(day2.slice(-3), day1);
  assert.equal(new Set(day2.map((item) => item.url)).size, 6);
  assert.equal(appendOpportunities(day2, candidates, "2026-10-03").length, 6, "no invented daily additions");
});

test("a daily scan appends to persistent list; manual repeats and failures preserve the list", async () => {
  const now = Date.now();
  assert.equal(startOpportunityScan(fetchPages, now), true);
  assert.equal(startOpportunityScan(async () => { throw Error("should not run"); }), false);
  await wait(now);
  const first = opportunityBoard(now);
  assert.equal(first.opportunities.length, 3);
  assert.equal(first.opportunities.filter((item) => item.discoveredOn === localDate(new Date(now))).length, 3);
  const saved = saveOpportunity(first.opportunities[0].id);
  assert.equal(saveOpportunity(first.opportunities[0].id).id, saved.id);
  assert.equal(listIdeas().length, 1);
  assert.equal(opportunityBoard(now).savedIds.length, 1);
  assert.equal(startOpportunityScan(fetchPages, now), true);
  await wait(now);
  assert.equal(opportunityBoard(now).opportunities.length, 3, "manual refresh cannot exceed daily quota");
  const tomorrow = now + 86_400_000;
  assert.equal(startOpportunityScan(fetchPages, tomorrow), true);
  await wait(tomorrow);
  assert.equal(opportunityBoard(tomorrow).opportunities.length, 6);
  const before = opportunityBoard(tomorrow).opportunities;
  assert.equal(startOpportunityScan(async () => { throw Error("offline"); }, tomorrow), true);
  await wait(tomorrow);
  assert.match(opportunityBoard(tomorrow).error, /offline/);
  assert.deepEqual(opportunityBoard(tomorrow).opportunities, before);
  assert.throws(() => saveOpportunity("unknown"), /not found/);
});
