import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.ROBIN_DATA_DIR = mkdtempSync(join(tmpdir(), "robin-products-"));

const domain = await import("./product-domain.ts");

test("an idea is a name, a note, and links", () => {
  const idea = domain.addIdea({ name: "Input method + agent", note: "A keyboard that translates as you type." });
  assert.equal(idea.step, "spot", "a new idea starts at the first step");
  assert.deepEqual(idea.links, []);

  const updated = domain.updateIdea(idea.id, { note: "Rewritten", step: "build" });
  assert.equal(updated?.note, "Rewritten");
  assert.equal(domain.getIdea(idea.id)?.step, "build");

  assert.equal(domain.deleteIdea(idea.id)?.id, idea.id);
  assert.equal(domain.getIdea(idea.id), null);
});

test("saving a link is idempotent, so a retry cannot duplicate it", () => {
  const idea = domain.addIdea({ name: "Link target" });
  domain.addIdeaLink(idea.id, { id: "fixed", title: "Sensor Tower", url: "https://sensortower.com" });
  domain.addIdeaLink(idea.id, { id: "fixed", title: "Sensor Tower", url: "https://sensortower.com" });
  // The same URL under a fresh id is the same link, which is what a re-run of
  // the same research actually produces.
  domain.addIdeaLink(idea.id, { title: "Sensor Tower again", url: "https://sensortower.com" });
  assert.equal(domain.getIdea(idea.id)?.links.length, 1);

  domain.addIdeaLink(idea.id, { title: "Reddit", url: "https://reddit.com", addedBy: "agent" });
  const links = domain.getIdea(idea.id).links;
  assert.equal(links.length, 2);
  assert.equal(links.find((link) => link.title === "Reddit").addedBy, "agent");
  assert.throws(() => domain.addIdeaLink("nope", { title: "x", url: "https://example.com" }));
});

test("a record from the old schema folds into an idea without losing its prose or its links", () => {
  domain.writeIdeas([{
    id: "legacy",
    name: "Meeting cost ticker",
    summary: "A menubar app that prices the meeting you are in.",
    problem: "Meetings are invisible spend",
    targetUser: "Managers",
    nextAction: "Ship the macOS build",
    stage: "building",
    evidence: [{ title: "Interview note", note: "Three managers asked", url: "https://example.com/interview", collectedBy: "agent" }],
    stack: [{ category: "Backend", tool: "Supabase", reason: "Fast hosted Postgres", url: "https://supabase.com" }],
    // Everything below has no prose in it and is dropped by intent.
    scorecard: [{ key: "pain", score: 4, weight: 15 }],
    milestones: [{ id: "m1", name: "Clickable MVP", status: "todo" }],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  }]);

  const [idea] = domain.listIdeas();
  assert.equal(idea.step, "build", "the old building column is the build step");
  for (const fragment of ["menubar app", "Problem: Meetings are invisible spend", "For: Managers", "Next: Ship the macOS build"]) {
    assert.ok(idea.note.includes(fragment), `note should carry "${fragment}"`);
  }
  assert.deepEqual(idea.links.map((link) => link.url).sort(), ["https://example.com/interview", "https://supabase.com"]);
  assert.equal(idea.links.find((link) => link.url.includes("example.com")).addedBy, "agent");
  assert.equal(idea.scorecard, undefined);
  assert.equal(idea.milestones, undefined);

  // Reading is pure: nothing is rewritten until something is actually edited.
  domain.updateIdea("legacy", { parked: true });
  assert.equal(domain.getIdea("legacy").parked, true);
  assert.equal(domain.getIdea("legacy").step, "build", "parking keeps the step you had reached");
  assert.equal(domain.getIdea("legacy").links.length, 2, "an edit keeps the folded links");
});

test("a claim that did not hold parks the idea", () => {
  const idea = domain.addIdea({ name: "Worth a month?" });
  domain.updateIdea(idea.id, { step: "validate", bet: { claim: "Builders will pay $10/mo", by: "2026-10-01" } });
  assert.equal(domain.getIdea(idea.id).parked, undefined);

  // Holding changes nothing on its own — you decide what to do next.
  domain.updateIdea(idea.id, { bet: { claim: "Builders will pay $10/mo", settled: "held" } });
  assert.equal(domain.getIdea(idea.id).parked, undefined);

  // Breaking is the one move the tool makes for you.
  domain.updateIdea(idea.id, { bet: { claim: "Builders will pay $10/mo", settled: "broke" } });
  assert.equal(domain.getIdea(idea.id).parked, true);
  assert.equal(domain.getIdea(idea.id).step, "validate", "and it leaves you where you were");

  // And it only fires on the transition, so a later edit can un-park it and
  // it stays un-parked. Absent is how "not parked" is stored — the reader
  // normalises a false to no key at all rather than carrying both spellings.
  domain.updateIdea(idea.id, { parked: false });
  domain.updateIdea(idea.id, { note: "still curious" });
  assert.ok(!domain.getIdea(idea.id).parked);
  assert.equal(domain.getIdea(idea.id).parked, undefined);
});

test("attention is about time passing, not about the idea's merits", () => {
  const day = 86_400_000;
  const ago = (days) => new Date(Date.parse("2026-09-04T00:00:00") - days * day).toISOString();
  const at = (step, updatedAt, bet, parked) => ({ step, updatedAt, ...(bet ? { bet } : {}), ...(parked ? { parked } : {}) });

  // A date you set and let pass is the one that should sting.
  assert.equal(domain.ideaAttention(at("spot", ago(1), { claim: "x", by: "2026-09-01" }), "2026-09-04"), "overdue");
  assert.equal(domain.ideaAttention(at("spot", ago(1), { claim: "x", by: "2026-09-30" }), "2026-09-04"), null);
  // Settling it stops the nagging, whichever way it went.
  assert.equal(domain.ideaAttention(at("validate", ago(1), { claim: "x", by: "2026-09-01", settled: "broke" }), "2026-09-04"), null);

  // Two months untouched says something about you, not about the idea.
  assert.equal(domain.ideaAttention(at("spot", ago(61)), "2026-09-04"), "stale");
  assert.equal(domain.ideaAttention(at("spot", ago(59)), "2026-09-04"), null);

  // Past validate you are building, and the work is the signal.
  assert.equal(domain.ideaAttention(at("build", ago(400), { claim: "x", by: "2020-01-01" }), "2026-09-04"), null);
  assert.equal(domain.ideaAttention(at("launch", ago(400)), "2026-09-04"), null);
  // Parked is a decision already made; nagging about it teaches you to ignore
  // the marker. An overdue claim on a parked idea still counts, though —
  // that is unfinished business either way.
  assert.equal(domain.ideaAttention(at("spot", ago(400), null, true), "2026-09-04"), null);
  assert.equal(domain.ideaAttention(at("build", ago(1), { claim: "x", by: "2020-01-01" }, true), "2026-09-04"), "overdue");
});

test("capture filing is idempotent and keeps the raw capture", () => {
  const capture = domain.addCapture({ text: "An idea worth keeping" });
  domain.fileCapture({ id: capture.id, kind: "idea", title: "Kept", summary: "From a capture" });
  domain.fileCapture({ id: capture.id, kind: "idea", title: "Kept twice", summary: "Should not happen" });
  assert.equal(domain.listIdeas().filter((idea) => idea.name === "Kept").length, 1);
  assert.equal(domain.listCaptures().find((item) => item.id === capture.id).text, "An idea worth keeping");
});

test("a captured link files onto an idea it names", () => {
  const idea = domain.addIdea({ name: "Filing target" });
  const capture = domain.addCapture({ text: "https://producthunt.com" });
  domain.fileCapture({ id: capture.id, kind: "link", title: "Product Hunt", url: "https://producthunt.com", ideaId: idea.id });
  assert.equal(domain.getIdea(idea.id).links.length, 1);

  const orphan = domain.addCapture({ text: "no home" });
  assert.throws(() => domain.fileCapture({ id: orphan.id, kind: "link", title: "x", url: "https://example.com" }), /ideaId/);
});

test("starter library keeps user overrides", () => {
  const saved = domain.updateLibraryResource("sensor-tower", { status: "using" });
  assert.equal(saved?.status, "using");
  assert.equal(domain.listLibraryResources().find((item) => item.id === "sensor-tower")?.status, "using");
});

test("a starter price is unverified until someone writes one", () => {
  assert.equal(domain.listLibraryResources().find((item) => item.id === "cursor")?.lastChecked, undefined);
  const stamped = domain.updateLibraryResource("cursor", { price: "$20/mo" });
  assert.match(stamped?.lastChecked ?? "", /^\d{4}-\d{2}-\d{2}$/);
  // Touching anything else must not date a price nobody looked at.
  assert.equal(domain.updateLibraryResource("cursor", { status: "using" })?.lastChecked, stamped?.lastChecked);
});

test("the price band answers whether you can start without paying", () => {
  assert.equal(domain.priceBand("Free"), "free");
  assert.equal(domain.priceBand("$0+"), "free");
  assert.equal(domain.priceBand("Free / Paid"), "free");
  assert.equal(domain.priceBand("Low"), "paid");
  assert.equal(domain.priceBand("Time"), "time");
  assert.equal(domain.priceBand("Check official pricing"), "unknown");
  assert.equal(domain.priceBand(""), "unknown");
});

test("the starter pack still covers every group that was agreed", () => {
  const pack = domain.STARTER_PRODUCT_LIBRARY;
  const counts = {};
  for (const item of pack) counts[item.category] = (counts[item.category] ?? 0) + 1;
  assert.ok(pack.length >= 20 && pack.length <= 40, `starter pack is ${pack.length} items`);
  for (const [category, least] of [["source", 9], ["test", 7], ["tool", 10], ["stack", 2], ["distribution", 4]]) {
    assert.ok(counts[category] >= least, `${category}: ${counts[category] ?? 0} < ${least}`);
  }
  const names = pack.map((item) => item.name.toLowerCase());
  for (const needle of [
    "sensor tower", "youtube", "reddit", "app store", "product hunt", "google trends", "meta ad library", "tiktok",
    "interview", "waitlist", "fake door", "pricing test", "smoke test", "concierge", "retention",
    "cursor", "claude code", "figma", "supabase", "superwall", "mixpanel", "loops", "apple developer",
    "founder-led", "creator", "community",
  ]) {
    assert.ok(names.some((name) => name.includes(needle)), `starter pack is missing "${needle}"`);
  }
  assert.ok(pack.every((item) => item.lastChecked === undefined), "no shipped price may claim to be verified");
});
