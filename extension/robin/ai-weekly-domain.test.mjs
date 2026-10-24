import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { resetTaskStore } from "./task-store.test-support.mjs";
import { setTelegramToken, setTelegramChatIds } from "./settings.ts";
import { generateWeekly, weeklyView, weeklyPreferences, setWeeklyPreferences, setWeeklyRead, deliverWeeklyDay } from "./ai-weekly-domain.ts";
import { parseHarvest, parseBrief, verifyWeeklySources, sourceText, canonicalSource } from "./ai-weekly-research.ts";
import { weeklyClock, calendarDay } from "./ai-weekly.ts";
import { cancelBackgroundRun } from "./background-run-domain.ts";

const root = mkdtempSync(join(tmpdir(), "ai-weekly-test-"));
const previous = process.env.ROBIN_DATA_DIR;
process.env.ROBIN_DATA_DIR = root;
after(() => { rmSync(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
beforeEach(() => {
  rmSync(join(root, "ai-weekly"), { recursive: true, force: true });
  resetTaskStore(root);
  setTelegramToken("test-token"); setTelegramChatIds([42]);
  setWeeklyPreferences({ timezone: "UTC", at: "08:00" });
});
const monday = new Date("2026-06-15T09:00:00Z");
const candidates = Array.from({ length: 7 }, (_, i) => ({
  key: `vendor-event-${i}-2026-06-10`, lane: i % 2 ? "world" : "practical", title: `A consequential event ${i}`,
  eventDate: "2026-06-10", status: "announced",
  source: { url: `https://example.com/news/${i}`, title: `Original source ${i}`, publishedOn: "2026-06-10", dateQuote: "June 10, 2026",
    quote: `The vendor announced milestone ${i}, with access restricted to a private preview and no production availability yet.` },
}));
const harvest = (items = candidates) => `<ai-harvest>${JSON.stringify({ candidates: items, gaps: ["Policy coverage is limited"] })}</ai-harvest>`;
const brief = (items = candidates) => `<ai-brief>${JSON.stringify({ headline: "七件值得关注的变化", items: items.map((c) => ({
  candidateKey: c.key, what: "发布了一项预览。", why: "判断：值得观察，但尚未验证。", action: "暂无需行动", caveat: "仅宣布，不代表已经开放。",
})), ignored: [] })}</ai-brief>`;
function deps(overrides = {}) {
  return {
    harvest: async (_message, _signal, remember) => { remember("harvest-session"); return harvest(); },
    brief: async (message, _signal, remember) => { remember("brief-session"); return brief(JSON.parse(message).candidates); },
    fetchImpl: async (url) => {
      const candidate = candidates.find((c) => c.source.url === url);
      return new Response(`<html><time>June 10, 2026</time><p>${candidate.source.quote}</p></html>`, { headers: { "content-type": "text/html" } });
    }, ...overrides,
  };
}

test("calendar weeks use configured timezone and survive DST/year boundaries", () => {
  assert.deepEqual(weeklyClock(new Date("2026-06-15T02:00:00Z"), "America/Los_Angeles"), {
    today: "2026-06-14", week: "2026-06-08", time: "19:00", from: "2026-06-01", through: "2026-06-07",
  });
  assert.equal(weeklyClock(new Date("2026-03-09T08:00:00Z"), "America/Los_Angeles").week, "2026-03-09");
  assert.equal(weeklyClock(new Date("2026-01-01T12:00:00Z"), "UTC").week, "2025-12-29");
  assert.equal(calendarDay("2026-02-30"), false);
  assert.throws(() => setWeeklyPreferences({ timezone: "not/a-zone" }));
  assert.throws(() => setWeeklyPreferences({ at: "25:00" }));
  assert.throws(() => setWeeklyPreferences({ enabled: "yes" }));
  assert.throws(() => setWeeklyPreferences({ injected: "command" }));
});

test("one complete publication yields seven alternating days, persisted reading, and no repeated paid work", async () => {
  assert.equal((await generateWeekly(deps(), false, monday)).value, "not-due");
  const result = await generateWeekly(deps(), true, monday);
  assert.equal(result.value, "published");
  const view = weeklyView(undefined, monday);
  assert.equal(view.edition.slots.length, 7);
  assert.deepEqual(view.edition.slots.map((s) => s.lane), ["practical", "world", "practical", "world", "practical", "world", "practical"]);
  assert.equal(view.edition.slots[6].date, "2026-06-21");
  assert.equal(view.edition.slots.filter((s) => s.story).length, 7);
  assert.ok(view.edition.slots.every((s) => s.story.source.checkedAt));
  assert.equal(view.run.stage, "done"); assert.deepEqual(view.run.sessions, ["harvest-session", "brief-session"]);
  setWeeklyRead(view.week, view.today, true);
  assert.deepEqual(weeklyView(undefined, monday).read, ["2026-06-15:2026-06-15"]);
  setWeeklyRead(view.week, view.today, false);
  assert.deepEqual(weeklyView(undefined, monday).read, []);
  await generateWeekly(deps({ harvest: () => assert.fail("must not regenerate published week") }), true, monday);
  assert.throws(() => setWeeklyRead(view.week, "2026-06-30", true), /not found/);
});

test("incomplete evidence creates visible empty days, not filler; source quotes are not model assertions", async () => {
  await generateWeekly(deps({ harvest: async () => harvest(candidates.slice(0, 2)) }), true, monday);
  const edition = weeklyView(undefined, monday).edition;
  assert.equal(edition.slots.length, 7);
  assert.equal(edition.slots.filter((s) => !s.story).length, 5);
  assert.equal(edition.gaps.length, 6);
  assert.throws(() => setWeeklyRead(edition.week, "2026-06-17", true), /not found/);
});

test("deduplication, reporting window, public URL and editor key validation fail closed", () => {
  const old = structuredClone(candidates[0]); old.eventDate = "2025-06-10";
  const future = structuredClone(candidates[1]); future.source.publishedOn = "2026-06-20";
  assert.equal(parseHarvest(harvest([old, future]), "2026-06-08", "2026-06-14", []).candidates.length, 0);
  assert.equal(parseHarvest(harvest([candidates[0], candidates[0]]), "2026-06-08", "2026-06-14", []).candidates.length, 1);
  assert.equal(parseHarvest(harvest(), "2026-06-08", "2026-06-14", [{ slots: candidates.map((story) => ({ story })) }]).candidates.length, 0);
  const later = structuredClone(candidates[0]);
  later.key = "vendor-new-milestone-2026-06-11"; later.eventDate = "2026-06-11";
  later.source.publishedOn = "2026-06-11"; later.source.quote += " A genuinely new entry in the same changelog.";
  assert.equal(parseHarvest(harvest([later]), "2026-06-08", "2026-06-14", [{ slots: [{ story: candidates[0] }] }]).candidates.length, 1, "new dated changelog entries remain eligible on the same URL");
  later.source.quote = candidates[0].source.quote;
  assert.equal(parseHarvest(harvest([later]), "2026-06-08", "2026-06-14", [{ slots: [{ story: candidates[0] }] }]).candidates.length, 0, "relabeling a date does not make an old passage new");
  assert.equal(canonicalSource("https://example.com/news?utm_source=x#part"), "https://example.com/news");
  for (const url of ["http://example.com", "https://127.0.0.1/", "https://localhost/", "https://user:pass@example.com", "file:///etc/passwd", "https://example.com:8080"]) assert.throws(() => canonicalSource(url));
  assert.throws(() => parseBrief(brief([candidates[0], candidates[0]]), candidates), /duplicate/);
  assert.throws(() => parseBrief(brief([{ key: "fabricated" }]), candidates), /unknown/);
  assert.throws(() => parseHarvest("truncated", "2026-06-08", "2026-06-14", []), /complete/);
});

test("verification bounds reads and excludes script-only quotes, mismatched dates and unsupported bodies", async () => {
  assert.equal(sourceText("<p>A&nbsp;B &#x1f600;</p><script>hidden</script>"), "A B 😀");
  const signal = new AbortController().signal;
  for (const html of [
    `<time>June 10, 2026</time><script>${candidates[0].source.quote}</script>`,
    `<time>June 10, 2026</time><script>${candidates[0].source.quote}${"x".repeat(2 * 1024 * 1024)}`,
    `<time>June 11, 2026</time><p>${candidates[0].source.quote}</p>`,
    "x".repeat(2 * 1024 * 1024 + 1),
  ]) {
    const result = await verifyWeeklySources([candidates[0]], signal, async () => new Response(html, { headers: { "content-type": "text/html" } }));
    assert.equal(result.verified.length, 0); assert.equal(result.gaps.length, 1);
  }
  const large = await verifyWeeklySources([candidates[0]], signal, async () => new Response(`<time>June 10, 2026</time><p>${candidates[0].source.quote}</p>${"x".repeat(2 * 1024 * 1024)}`, { headers: { "content-type": "text/html" } }));
  assert.equal(large.verified.length, 1, "a long changelog can supply evidence in its bounded prefix");
  const response = await verifyWeeklySources([candidates[0]], signal, async () => new Response("%PDF", { headers: { "content-type": "application/pdf" } }));
  assert.equal(response.verified.length, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(verifyWeeklySources([candidates[0]], controller.signal, deps().fetchImpl));
});

test("failure preserves old editions and preferences; automatic retries respect budget/backoff", async () => {
  await generateWeekly(deps(), true, monday);
  setWeeklyPreferences({ enabled: true, interests: "My interests" });
  const next = new Date("2026-06-22T09:00:00Z");
  const broken = deps({ harvest: async () => { throw new Error("429 quota exceeded"); } });
  await assert.rejects(generateWeekly(broken, false, next), /quota/);
  const view = weeklyView(undefined, next);
  assert.equal(view.edition, null); assert.equal(view.archive.length, 1); assert.equal(view.run.stage, "failed");
  assert.ok(view.run.retryAt); assert.equal(weeklyPreferences().interests, "My interests");
  assert.equal((await generateWeekly(broken, false, next)).value, "not-due");
  await assert.rejects(generateWeekly(broken, true, next));
  await assert.rejects(generateWeekly(broken, true, next));
  assert.equal((await generateWeekly(broken, false, new Date("2026-06-28T09:00:00Z"))).value, "not-due");
});

test("concurrent generation uses one lease; replaced owners cannot publish", async () => {
  let resume, arrived;
  const entered = new Promise((resolve) => { arrived = resolve; });
  const slow = generateWeekly(deps({ harvest: async () => { arrived(); await new Promise((resolve) => { resume = resolve; }); return harvest(); } }), true, monday);
  await entered;
  assert.equal(weeklyView(undefined, monday).running, true);
  assert.equal((await generateWeekly(deps(), true, monday)).started, false);
  cancelBackgroundRun("ai-weekly:generate");
  assert.equal(weeklyView(undefined, monday).interrupted, true);
  resume(); await assert.rejects(slow, /ownership/);
  assert.equal(weeklyView(undefined, monday).edition, null);
});

test("daily Telegram delivery is opt-in, latest-day only, and deduplicated", async () => {
  await generateWeekly(deps(), true, monday);
  const sent = [];
  const delivery = { audience: [42, 42], send: async (chat, text) => { sent.push({ chat, text }); return true; } };
  await deliverWeeklyDay(delivery, monday); assert.equal(sent.length, 0);
  setWeeklyPreferences({ enabled: true, telegram: true });
  const thursday = new Date("2026-06-18T09:00:00Z");
  await deliverWeeklyDay(delivery, thursday); await deliverWeeklyDay(delivery, thursday);
  assert.equal(sent.length, 1); assert.match(sent[0].text, /2026-06-18/);
  assert.match(sent[0].text, /consequential event 3/);
  assert.equal(weeklyView(undefined, thursday).deliveries[0].status, "sent");
  await deliverWeeklyDay(delivery, new Date("2026-06-19T07:00:00Z")); assert.equal(sent.length, 1);
  await deliverWeeklyDay(delivery, new Date("2026-06-22T09:00:00Z")); assert.equal(sent.length, 1, "old editions never masquerade as today's news");
});

test("unknown delivery is never resent; explicit refusals retry after an hour", async () => {
  await generateWeekly(deps(), true, monday);
  setWeeklyPreferences({ enabled: true, telegram: true });
  let calls = 0;
  const ambiguous = { audience: [42], send: async () => { calls++; throw new Error("socket lost"); } };
  await deliverWeeklyDay(ambiguous, monday); await deliverWeeklyDay(ambiguous, monday);
  assert.equal(calls, 1); assert.equal(weeklyView(undefined, monday).deliveries[0].status, "uncertain");
  const rejected = { audience: [84], send: async () => { calls++; return false; } };
  await deliverWeeklyDay(rejected, monday); await deliverWeeklyDay(rejected, monday);
  assert.equal(calls, 2);
  await deliverWeeklyDay(rejected, new Date("2026-06-15T10:01:00Z")); assert.equal(calls, 3);
});

test("malformed storage is not treated as empty", () => {
  writeFileSync(join(root, "ai-weekly/state.json"), '{"version":999}');
  assert.throws(() => weeklyView(), /invalid/);
  assert.throws(() => setWeeklyPreferences({ enabled: true }), /invalid/);
});
