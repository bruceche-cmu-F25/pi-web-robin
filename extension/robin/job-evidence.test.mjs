import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_JOB_PROFILE, digestCandidates, pendingJobs } from "./jobs.ts";
import { ELIGIBILITY_CHECKS, jobSummary, scoringContext } from "./job-evidence.ts";
import { scoreJob, getJobDetails } from "./job-domain.ts";
import { readJobs, writeJobs, writeJobProfile } from "./store.ts";
import { resetTaskStore } from "./task-store.test-support.mjs";
import { makeFetchContext } from "./job-providers.ts";

const previous = process.env.ROBIN_DATA_DIR;
process.env.ROBIN_DATA_DIR = mkdtempSync(join(tmpdir(), "robin-job-evidence-"));
resetTaskStore(process.env.ROBIN_DATA_DIR);
after(() => {
  rmSync(process.env.ROBIN_DATA_DIR, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
});
const cvEvidence = "Built FastAPI backend services and LangGraph agent workflows.";
const roleEvidence = "Requirements: Build Python backend services and agent workflows.";
const profile = { ...DEFAULT_JOB_PROFILE, cv: cvEvidence, maxYears: 3, notes: "Graduate December 2026; start January 2027." };
const job = (over = {}) => ({
  id: "test", url: "https://jobs.ashbyhq.com/acme/1", source: "ashby", company: "Acme",
  title: "AI Engineer", location: "Remote US", status: "new", discoveredAt: new Date().toISOString(),
  description: roleEvidence + " Our engineering team builds reliable systems for customers every day.".repeat(12), ...over,
});
const review = (posting, over = {}) => ({
  context: scoringContext(posting, profile), roleEvidence, cvEvidence,
  checks: Object.fromEntries(ELIGIBILITY_CHECKS.map(field => [field, field === "location"
    ? { status: "met", quote: posting.location } : { status: "not-stated" }])), ...over,
});
function seed(posting = job()) { writeJobProfile(profile); writeJobs([posting]); return posting; }

test("a high score needs full JD evidence; a snippet alone is capped and labelled", () => {
  seed(job({ description: "Level: Entry Level We are..." }));
  const result = scoreJob({ id: "test", score: 4.5, reason: "Title matches" }).job;
  assert.equal(result.score, 3.9);
  assert.ok(result.flags.includes("incomplete-jd"));
  assert.match(result.reason, /verif/i);
  assert.equal(digestCandidates(readJobs(), profile).length, 0);
});

test("high-score verification binds exact JD and CV quotes to the current context", () => {
  const posting = seed();
  const result = scoreJob({ id: "test", score: 4.5, reason: "Agent/backend match", review: review(posting) }).job;
  assert.equal(result.score, 4.5);
  assert.equal(digestCandidates(readJobs(), profile).length, 1);
  assert.equal(pendingJobs(readJobs(), profile).length, 0);
  assert.equal(result.scoreContext, scoringContext(result, profile));
  const summary = jobSummary(result, profile);
  assert.equal(summary.description, undefined);
  assert.equal(summary.review, undefined, "list payloads do not ship CV evidence");
  assert.equal(summary.score, 4.5);
});

test("a 3.8 score cannot bypass review at a 3.75 push floor", () => {
  const candidate = { ...profile, minScore: 3.75 };
  const posting = job();
  writeJobProfile(candidate); writeJobs([posting]);
  const provisional = scoreJob({ id: "test", score: 3.8, reason: "Promising title" }).job;
  assert.ok(provisional.score < candidate.minScore);
  assert.ok(provisional.flags.includes("needs-review"));
  assert.equal(pendingJobs(readJobs(), candidate).length, 0, "failed verification must not loop indefinitely");
  assert.equal(digestCandidates(readJobs(), candidate).length, 0);

  writeJobs([posting]);
  const verified = scoreJob({ id: "test", score: 3.8, reason: "Agent/backend match",
    review: review(posting, { context: scoringContext(posting, candidate) }) }).job;
  assert.equal(verified.score, 3.8);
  assert.equal(digestCandidates(readJobs(), candidate).length, 1);
});

test("the minimum configurable floor cannot create an endless verification queue", () => {
  const candidate = { ...profile, minScore: 1 };
  writeJobProfile(candidate); writeJobs([job()]);
  const result = scoreJob({ id: "test", score: 1, reason: "Weak match" }).job;
  assert.equal(result.score, 1);
  assert.equal(pendingJobs(readJobs(), candidate).length, 0);
  assert.equal(digestCandidates(readJobs(), candidate).length, 0);
});

test("discovery keyword and blacklist edits do not invalidate JD evidence", () => {
  const posting = seed();
  scoreJob({ id: "test", score: 4.5, reason: "Match", review: review(posting) });
  const changed = { ...profile, titles: ["AI Engineer", "Deployed Engineer"], blacklist: ["OtherCo"] };
  assert.equal(scoringContext(posting, changed), scoringContext(posting, profile));
  assert.equal(pendingJobs(readJobs(), changed).length, 0);
  assert.equal(digestCandidates(readJobs(), changed).length, 1);
});

test("invented quotes and changed descriptions cannot certify a high score", () => {
  let posting = seed();
  let result = scoreJob({ id: "test", score: 4.8, reason: "Match", review: review(posting, { cvEvidence: "Trained frontier foundation models at scale." }) }).job;
  assert.equal(result.score, 3.9);
  assert.ok(result.flags.includes("unsupported-evidence"));
  posting = seed();
  result = scoreJob({ id: "test", score: 4.8, reason: "Match", review: review(posting, { context: "old-jd" }) }).job;
  assert.equal(result.score, 3.9);
});

test("blocked start dates and unresolved eligibility cannot receive an apply-now score", () => {
  const posting = seed(job({ description: job().description + " Must start by September 15, 2026." }));
  const checked = review(posting);
  checked.checks.startDate = { status: "blocked", quote: "Must start by September 15, 2026." };
  const result = scoreJob({ id: "test", score: 4.5, reason: "Good stack", review: checked }).job;
  assert.equal(result.score, 2);
  assert.ok(result.flags.includes("blocked-startDate"));
  seed();
  const uncertain = review(job());
  uncertain.checks.education = { status: "unknown" };
  assert.equal(scoreJob({ id: "test", score: 4.5, reason: "Good stack", review: uncertain }).job.score, 3.9);
});

test("hard experience cap is enforced even if the model ignores it", () => {
  const posting = seed(job({ yearsRequired: 5, description: job().description + " Requires 5 years of software engineering experience." }));
  const result = scoreJob({ id: "test", score: 4.5, reason: "Good stack", review: review(posting) }).job;
  assert.equal(result.score, 2.5);
  assert.ok(result.flags.includes("asks 5+ yrs"));
});

test("profile changes invalidate recommendations without rewriting user state", () => {
  const posting = seed();
  scoreJob({ id: "test", score: 4.5, reason: "Match", review: review(posting) });
  const changed = { ...profile, notes: "Only remote roles now." };
  assert.equal(digestCandidates(readJobs(), changed).length, 0);
  assert.equal(pendingJobs(readJobs(), changed).length, 1);
  assert.equal(readJobs()[0].status, "new");
  assert.equal(digestCandidates(readJobs(), { ...profile, digestSize: 20 }).length, 1, "delivery preferences do not invalidate scores");
});

test("low provisional scores do not loop forever, and rescores clear obsolete flags", () => {
  seed(job({ flags: ["no-sponsorship", "score-stale"], scoreStale: true }));
  scoreJob({ id: "test", score: 3, reason: "Specialism mismatch", flags: [] });
  assert.deepEqual(readJobs()[0].flags, undefined);
  assert.equal(pendingJobs(readJobs(), profile).length, 0);
});

test("one or two year requirements are stretch roles, not hard rejections", () => {
  const candidate = { ...profile, professionalExperienceMonths: 8, experienceStretchYears: 2 };
  for (const years of [1, 2]) {
    const requirement = `Minimum ${years} years of professional software engineering experience required.`;
    const posting = job({ description: job().description + requirement, yearsRequired: years });
    writeJobProfile(candidate); writeJobs([posting]);
    const checked = review(posting, { context: scoringContext(posting, candidate) });
    checked.checks.experience = { status: "met", quote: requirement };
    const result = scoreJob({ id: "test", score: 4.5, reason: "Great stack", review: checked }).job;
    assert.equal(result.score, 3.9, `${years} years`);
    assert.ok(result.flags.includes("stretch-experience"));
    assert.equal(digestCandidates(readJobs(), { ...candidate, minScore: 3.9 }).length, 1);
  }
});

test("honestly declared, quoted experience stretches can pass without claiming the requirement is met", () => {
  const candidate = { ...profile, minScore: 3.75, professionalExperienceMonths: 8, experienceStretchYears: 2 };
  const requirement = "Minimum 2 years of professional software engineering experience required.";
  const posting = job({ description: job().description + requirement, yearsRequired: 2 });
  for (const quote of [requirement, roleEvidence, undefined]) {
    writeJobProfile(candidate); writeJobs([posting]);
    const checked = review(posting, { context: scoringContext(posting, candidate) });
    checked.checks.experience = { status: "unknown", quote };
    const result = scoreJob({ id: "test", score: 4.2, reason: "Backend match; 8 months versus 2 years is a stretch", review: checked }).job;
    assert.equal(digestCandidates(readJobs(), candidate).length, quote === requirement ? 1 : 0);
    if (quote === requirement) {
      assert.equal(result.score, 3.9);
      assert.ok(result.flags.includes("stretch-experience"));
      assert.equal(result.review.checks.experience.status, "unknown");
      checked.checks.workAuthorization = { status: "unknown" };
      scoreJob({ id: "test", score: 4.2, reason: "Authorization unresolved", review: checked });
      assert.equal(digestCandidates(readJobs(), candidate).length, 0, "stretch is not a bypass for other unknown eligibility");
    }
  }
});

test("requirements above the stretch ceiling remain hard experience blockers", () => {
  const candidate = { ...profile, professionalExperienceMonths: 8, experienceStretchYears: 2 };
  const requirement = "Minimum 3 years of professional software engineering experience required.";
  const posting = job({ description: job().description + requirement, yearsRequired: 3 });
  writeJobProfile(candidate); writeJobs([posting]);
  const checked = review(posting, { context: scoringContext(posting, candidate) });
  checked.checks.experience = { status: "met", quote: requirement };
  const result = scoreJob({ id: "test", score: 4.5, reason: "Great stack", review: checked }).job;
  assert.equal(result.score, 2);
  assert.ok(result.flags.includes("blocked-experience"));
  assert.equal(digestCandidates(readJobs(), { ...candidate, minScore: 1 }).length, 0);
});

test("the stretch ceiling is separate from both confirmed months and the scan ceiling", () => {
  const requirement = "Minimum 2 years of Python experience, including academic projects.";
  const posting = job({ description: job().description + requirement, yearsRequired: 2 });
  const candidate = { ...profile, professionalExperienceMonths: 8, experienceStretchYears: 2, maxYears: 5 };
  writeJobProfile(candidate); writeJobs([posting]);
  const checked = review(posting, { context: scoringContext(posting, candidate) });
  checked.checks.experience = { status: "met", quote: requirement };
  const result = scoreJob({ id: "test", score: 4.5, reason: "Good fit", review: checked }).job;
  assert.equal(result.score, 3.9);
  assert.ok(result.flags.includes("stretch-experience"));
});

test("blacklist changes stop delivery without invalidating the role's evidence", () => {
  const posting = seed();
  scoreJob({ id: "test", score: 4.5, reason: "Match", review: review(posting) });
  const blocked = { ...profile, blacklist: ["acME"] };
  assert.equal(scoringContext(posting, blocked), scoringContext(posting, profile));
  assert.equal(digestCandidates(readJobs(), blocked).length, 0);
  assert.equal(digestCandidates([job({ score: 3.5 })], { ...blocked, minScore: 3 }).length, 0);
  assert.equal(readJobs()[0].status, "new");
});

test("resolving a legacy shortlink replaces its unbound JD, or clears it if the real JD is unavailable", async () => {
  const short = "https://go.vansh.nyc/Aw";
  const canonical = "https://jobs.ashbyhq.com/acme/1";
  for (const available of [true, false]) {
    seed(job({ source: "newgradlist", url: short, status: "applied", note: "Keep my note", score: 4.5,
      description: "Wrong employer: Boeing security clearance and flight tests. ".repeat(20) }));
    const ctx = makeFetchContext(async (url) => String(url) === short
      ? new Response(null, { status: 302, headers: { location: canonical } })
      : String(url).includes("api.ashbyhq.com")
        ? available ? Response.json({ jobs: [{ id: "1", descriptionPlain: job().description }] }) : new Response(null, { status: 503 })
        : new Response("Public job page"));
    const result = await getJobDetails("test", ctx);
    assert.equal(result.description, available ? job().description : undefined);
    assert.equal(result.url, canonical);
    assert.ok(result.alternateUrls.includes(short));
    assert.equal(result.status, "applied");
    assert.equal(result.note, "Keep my note");
    assert.equal(result.scoreStale, true);
  }
});

test("an unresolved legacy shortlink cannot keep recommending its unbound cached JD", async () => {
  seed(job({ url: "https://go.vansh.nyc/Aw", source: "newgradlist", score: 4.5 }));
  const ctx = makeFetchContext(async () => new Response(null, { status: 503 }));
  const result = await getJobDetails("test", ctx);
  assert.equal(result.url, "https://go.vansh.nyc/Aw");
  assert.equal(result.description, undefined);
  assert.equal(result.scoreStale, true);
});

test("explicit refresh removes suspect full text when the source cannot verify it", async () => {
  seed(job({ score: 4.5, yearsRequired: 18, note: "Keep" }));
  const ctx = { async fetchJson() { throw Error("HTTP 429"); }, async fetchText() { throw Error("HTTP 429"); } };
  assert.equal((await getJobDetails("test", ctx)).description, job().description, "ordinary reads reuse full text");
  const refreshed = await getJobDetails("test", ctx, true);
  assert.equal(refreshed.description, undefined);
  assert.equal(refreshed.yearsRequired, undefined);
  assert.equal(refreshed.scoreStale, true);
  assert.equal(refreshed.note, "Keep");
});

test("reading full details upgrades legacy snippets but never changes applied state", async () => {
  const posting = seed(job({ description: "Old snippet…", status: "applied", score: 4.5 }));
  const result = await getJobDetails(posting.id, {
    async fetchJson() { return { jobs: [{ id: "1", descriptionPlain: job().description }] }; },
    async fetchText() { throw Error("no fallback"); },
  });
  assert.equal(result.description, job().description);
  assert.equal(result.status, "applied");
  assert.equal(result.scoreStale, true);
});
