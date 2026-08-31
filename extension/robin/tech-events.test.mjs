import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyTechEvent,
  hasPassed,
  inBayArea,
  isScanDue,
  mergeTechEvents,
  rateTechEventForFullStackAi,
  sortTechEvents,
  SCAN_INTERVAL_MS,
} from "./tech-events.ts";

const event = (over = {}) => ({
  id: "luma:evt-1",
  title: "Agent Build Night",
  url: "https://luma.com/build",
  source: "luma-place-sf",
  startAt: "2026-09-01T02:00:00.000Z",
  online: false,
  topics: ["ai"],
  score: 3,
  matched: ["agent"],
  discoveredAt: "2026-08-27T00:00:00.000Z",
  ...over,
});

/* ─────────────────────────── the classifier ─────────────────────────── */

test("a title has to say something technical to get in", () => {
  assert.equal(classifyTechEvent({ title: "Agentic + AI Night" }).admit, true);
  assert.equal(classifyTechEvent({ title: "Open Source AI Summit SF" }).admit, true);
  assert.equal(classifyTechEvent({ title: "Pokémon Drone Show Watch Party" }).admit, false);
  assert.equal(classifyTechEvent({ title: "NUMB Tasting: Modern Sichuan in SF" }).admit, false);
});

test("terms match whole words, not substrings", () => {
  // Every one of these is a real row from one week of the San Francisco feed,
  // and every one was admitted by an earlier substring match: "Eragon" holds
  // "rag", "Escaping" holds "api", "Flatland" holds "ml". All three are
  // parties. This is the single check that keeps the page worth opening.
  assert.equal(classifyTechEvent({ title: "Gallery After Dark: Merge x Eragon x Corgi" }).admit, false);
  assert.equal(classifyTechEvent({ title: "Escaping Flatland - SF Meetup" }).admit, false);
});

test("a host's own name admits an event whose title says nothing", () => {
  // "Supabase Select 2026" is a developer conference; nothing in the title
  // says so. A dev-tool company's community calendar is the evidence.
  const verdict = classifyTechEvent({ title: "Select 2026", host: "Supabase Community Events" });
  assert.equal(verdict.admit, true);
  assert.ok(verdict.topics.includes("swe"));
});

test("a brand-only match still lands in a topic", () => {
  // A row with no topic is present in the data and invisible behind every
  // filter but "All".
  const verdict = classifyTechEvent({ title: "Coffeehouse by Ode with Anthropic" });
  assert.equal(verdict.admit, true);
  assert.deepEqual(verdict.topics, ["ai"]);
});

test("startup vocabulary alone is not an engineering event", () => {
  assert.equal(classifyTechEvent({ title: "Raising Your Seed Round" }).admit, false);
  assert.equal(classifyTechEvent({ title: "Startup Pitch Night" }).admit, false);
});

test("the veto settles it before the vocabulary gets a vote", () => {
  assert.equal(classifyTechEvent({ title: "Founder Comedy Night" }).admit, false);
  assert.equal(classifyTechEvent({ title: "Tech Book Club: Designing Data-Intensive Applications" }).admit, false);
});

test("a host blurb raises the score but cannot admit on its own", () => {
  const blurbOnly = classifyTechEvent({
    title: "Summer Mixer",
    host: "Bayview Neighbours",
    hostDescription: "A community for software engineers building with LLMs.",
  });
  assert.equal(blurbOnly.admit, false);

  const bare = classifyTechEvent({ title: "Agent Night" });
  const corroborated = classifyTechEvent({
    title: "Agent Night",
    hostDescription: "Machine learning and inference talks for software engineers.",
  });
  assert.ok(corroborated.score > bare.score);
});

test("the score is capped so one keyword-stuffed title cannot own the day", () => {
  const stuffed = classifyTechEvent({
    title: "AI LLM agents inference embeddings rust kubernetes python api hackathon demo",
  });
  assert.ok(stuffed.score <= 5);
});

test("Full-stack AI build events outrank adjacent single-topic talks", () => {
  const build = rateTechEventForFullStackAi(event({
    title: "Agentic Full Stack Build Night",
    topics: ["ai", "swe"],
    score: 4.5,
    free: true,
  }), []);
  const systems = rateTechEventForFullStackAi(event({
    title: "Beyond Containers",
    topics: ["swe"],
    score: 1.5,
  }), []);

  assert.ok(build.relevance > systems.relevance);
  assert.ok(build.suitability > systems.suitability);
  assert.ok(build.signals.includes("fullstack-ai"));
  assert.ok(build.signals.includes("hands-on"));
});

test("schedule conflicts are exact facts and lower suitability", () => {
  const starts = new Date("2026-09-01T18:00:00");
  const candidate = event({
    startAt: starts.toISOString(),
    endAt: new Date("2026-09-01T20:00:00").toISOString(),
    topics: ["ai", "swe"],
    score: 5,
  });
  const clear = rateTechEventForFullStackAi(candidate, []);
  const busy = rateTechEventForFullStackAi(candidate, [{
    id: "class",
    title: "Evening class",
    date: "2026-09-01",
    start: "18:30",
    end: "19:30",
    createdAt: "",
  }]);
  const adjacent = rateTechEventForFullStackAi(candidate, [{
    id: "lunch",
    title: "Lunch",
    date: "2026-09-01",
    start: "12:00",
    end: "13:00",
    createdAt: "",
  }]);

  assert.equal(busy.conflicts[0].title, "Evening class");
  assert.ok(busy.suitability < clear.suitability);
  assert.ok(busy.signals.includes("schedule-conflict"));
  assert.equal(adjacent.conflicts.length, 0);
});

/* ─────────────────────────── the region ─────────────────────────── */

test("the coordinate decides when there is one", () => {
  assert.equal(inBayArea({ latitude: 37.7749, longitude: -122.4194 }), true);
  assert.equal(inBayArea({ latitude: 34.0522, longitude: -118.2437 }), false);
});

test("a city name is the fallback, and California is not the test", () => {
  assert.equal(inBayArea({ city: "Palo Alto, CA" }), true);
  assert.equal(inBayArea({ city: "San Francisco, California" }), true);
  // The trap the city list exists for: a feed scoped to San Francisco still
  // carries events elsewhere, and "San Diego, CA" is in California.
  assert.equal(inBayArea({ city: "San Diego, CA" }), false);
  assert.equal(inBayArea({}), false);
});

test("a coordinate outside the box beats a Bay Area city name", () => {
  // Both are published by the host; the pin is the unambiguous one.
  assert.equal(inBayArea({ latitude: 40.7128, longitude: -74.006, city: "San Francisco, CA" }), false);
});

/* ─────────────────────────── list upkeep ─────────────────────────── */

test("a rescan refreshes the host's facts and keeps yours", () => {
  const stored = [event({ saved: true, hidden: true, discoveredAt: "2026-08-01T00:00:00.000Z" })];
  const scanned = [event({ title: "Agent Build Night (moved)", soldOut: true, discoveredAt: "2026-08-27T00:00:00.000Z" })];
  const { events, added } = mergeTechEvents(stored, scanned, Date.parse("2026-08-27T00:00:00.000Z"));

  assert.equal(added, 0);
  assert.equal(events[0].title, "Agent Build Night (moved)");
  assert.equal(events[0].soldOut, true);
  // Losing "I've already decided about this one" every Monday would make the
  // page useless exactly as it filled up.
  assert.equal(events[0].saved, true);
  assert.equal(events[0].hidden, true);
  assert.equal(events[0].discoveredAt, "2026-08-01T00:00:00.000Z");
});

test("events that have happened drop out, saved or not", () => {
  const now = Date.parse("2026-09-10T00:00:00.000Z");
  const { events, expired } = mergeTechEvents(
    [event({ id: "luma:old", startAt: "2026-09-01T02:00:00.000Z", saved: true })],
    [event({ id: "luma:new", startAt: "2026-09-20T02:00:00.000Z" })],
    now,
  );
  assert.deepEqual(events.map((e) => e.id), ["luma:new"]);
  assert.equal(expired, 1);
});

test("a talk that started an hour ago has not passed yet", () => {
  const start = Date.parse("2026-09-01T02:00:00.000Z");
  assert.equal(hasPassed(event(), start + 60 * 60 * 1_000), false);
  assert.equal(hasPassed(event(), start + 6 * 60 * 60 * 1_000), true);
  // An explicit end time beats the grace period in both directions.
  assert.equal(hasPassed(event({ endAt: "2026-09-01T03:00:00.000Z" }), start + 2 * 60 * 60 * 1_000), true);
});

test("soonest first, and the stronger match leads within a slot", () => {
  const sorted = sortTechEvents([
    event({ id: "b", startAt: "2026-09-02T02:00:00.000Z", score: 5 }),
    event({ id: "a2", startAt: "2026-09-01T02:00:00.000Z", score: 1 }),
    event({ id: "a1", startAt: "2026-09-01T02:00:00.000Z", score: 4 }),
  ]);
  assert.deepEqual(sorted.map((e) => e.id), ["a1", "a2", "b"]);
});

test("the week is counted from when a scan started, not when it finished", () => {
  const started = "2026-08-27T00:00:00.000Z";
  const state = { startedAt: started, seen: 0, kept: 0, added: 0, expired: 0, sources: [] };
  assert.equal(isScanDue(null), true);
  assert.equal(isScanDue(state, Date.parse(started) + SCAN_INTERVAL_MS - 1), false);
  assert.equal(isScanDue(state, Date.parse(started) + SCAN_INTERVAL_MS), true);
  // A scan that died halfway has still spent the week's requests; re-running
  // it on every page load until it succeeds is how this gets rate-limited.
  assert.equal(isScanDue({ ...state, finishedAt: undefined }, Date.parse(started) + 1_000), false);
});
