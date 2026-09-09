import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_JOB_PROFILE, digestCandidates, pendingJobs } from "./jobs.ts";
import { ELIGIBILITY_CHECKS, jobSummary, scoringContext } from "./job-evidence.ts";
import { scoreJob, getJobDetails } from "./job-domain.ts";
import { readJobs, writeJobs, writeJobProfile } from "./store.ts";

const previous = process.env.ROBIN_DATA_DIR;
process.env.ROBIN_DATA_DIR = mkdtempSync(join(tmpdir(), "robin-job-evidence-"));
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

test("blacklist changes invalidate evidence and stop even legacy low-score pushes", () => {
  const posting = seed();
  scoreJob({ id: "test", score: 4.5, reason: "Match", review: review(posting) });
  const blocked = { ...profile, blacklist: ["acME"] };
  assert.notEqual(scoringContext(posting, blocked), scoringContext(posting, profile));
  assert.equal(digestCandidates(readJobs(), blocked).length, 0);
  assert.equal(digestCandidates([job({ score: 3.5 })], { ...blocked, minScore: 3 }).length, 0);
  assert.equal(readJobs()[0].status, "new");
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
