import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_JOB_PROFILE, buildTitleFilter, buildLocationFilter, extractYearsRequired, jobKey } from "./jobs.ts";
import { runDirectorySweep } from "./job-directory.ts";
import { absorb } from "./job-intake.ts";
import { hydrateDescriptions, providerById } from "./job-providers.ts";
import { readJobs, writeJobs, writeJobSweepState } from "./store.ts";

const previous = process.env.ROBIN_DATA_DIR;
process.env.ROBIN_DATA_DIR = mkdtempSync(join(tmpdir(), "robin-job-quality-"));
after(() => {
  rmSync(process.env.ROBIN_DATA_DIR, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
});
const offline = { async fetchJson() { throw Error("offline"); }, async fetchText() { throw Error("offline"); } };
const rules = { profile: { ...DEFAULT_JOB_PROFILE, sinceDays: 0, maxYears: 3 }, undated: "keep" };
const posting = (over = {}) => ({
  url: "https://jobs.ashbyhq.com/acme/role-1", company: "Acme", title: "Software Engineer",
  location: "San Francisco", source: "ashby", ...over,
});
const stored = (over = {}) => ({ ...posting(), id: "saved", status: "new", discoveredAt: new Date().toISOString(), ...over });

test("title aliases widen recall without weakening seniority exclusions", () => {
  const matches = buildTitleFilter(["Software Engineer", "Full Stack Engineer", "AI Engineer"], ["senior", "lead", "ii"]);
  for (const title of ["Software Development Engineer", "Software Developer", "Full-Stack Engineer", "Fullstack Engineer", "AI/ML Engineer", "Software Engineer, Leadership Tools"]) {
    assert.notEqual(matches(title), null, title);
  }
  for (const title of ["Senior Software Developer", "Lead Full-Stack Engineer", "Software Engineer II", "Software Engineer, Team Lead"]) {
    assert.equal(matches(title), null, title);
  }
});

test("Bay Area locations and genuine alternatives pass; foreign remote restrictions do not", () => {
  const matches = buildLocationFilter({ always: [], allow: ["Bay Area", "Remote", "United States"], block: ["Canada", "UK", "India"] });
  for (const location of ["San Mateo, CA", "San Bruno, CA", "San Jose, CA; Toronto, Canada", "Mountain View, CA · London, UK", "San Jose, CA or London, UK"]) {
    assert.equal(matches(location), true, location);
  }
  for (const location of ["Remote, UK", "Remote - India", "Remote in UK · Remote in Canada", "Toronto, Canada", "Remote | UK", "London, UK / Canada"]) {
    assert.equal(matches(location), false, location);
  }
});

test("degree-dependent experience is deferred rather than rejected by the largest alternative", () => {
  assert.equal(extractYearsRequired("Bachelor's degree and 5 years of software experience OR Master's degree and 2 years of software experience."), null);
  assert.equal(extractYearsRequired("BS + 5 years of engineering experience or MS + 2 years of experience."), null);
  assert.equal(extractYearsRequired("5 years of engineering experience AND 2 years of Python experience."), 5);
  assert.equal(extractYearsRequired("Five years of software engineering experience required."), 5);
  assert.equal(extractYearsRequired("Requires 4&#43; years of software engineering experience."), 4);
});

test("degree choices do not erase independent experience requirements or extend preferred sections incorrectly", () => {
  assert.equal(extractYearsRequired("Bachelor's degree or Master's degree accepted. Minimum 5 years of professional software experience required."), 5);
  assert.equal(extractYearsRequired("Preferred qualifications: " + "Knowledge of distributed platforms and testing. ".repeat(12) + "5 years of industry experience."), null);
  assert.equal(extractYearsRequired("Preferred qualifications: " + "Knowledge of distributed platforms and testing. ".repeat(12) + "Minimum qualifications: 2 years of industry experience."), 2);
  assert.equal(extractYearsRequired("Preferred qualifications\n" + "Strong communication skills. ".repeat(15) + "5 years of industry experience."), null);
  assert.equal(extractYearsRequired("Preferred qualifications Python. Minimum qualifications 2 years of industry experience."), 2);
  assert.equal(extractYearsRequired("0–2 years of professional software engineering experience."), 0);
});

test("ATS identity ignores application routes/tracking but never merges distinct reqs", () => {
  assert.equal(jobKey("https://jobs.ashbyhq.com/acme/abc"), jobKey("https://jobs.ashbyhq.com/acme/abc/application?embed=true"));
  assert.equal(jobKey("https://boards.greenhouse.io/acme/jobs/123"), jobKey("https://job-boards.greenhouse.io/acme/jobs/123?utm_source=feed"));
  assert.equal(jobKey("https://jobs.lever.co/acme/abc"), jobKey("https://jobs.lever.co/acme/abc/apply?lever-source=feed"));
  assert.equal(jobKey("https://acme.wd5.myworkdayjobs.com/en-US/External/job/SF/Engineer_JR123"), jobKey("https://acme.wd5.myworkdayjobs.com/External/job/Remote/New-Title_JR123?source=feed"));
  assert.notEqual(jobKey("https://careers.ibm.com/careers/JobDetail?jobId=1"), jobKey("https://careers.ibm.com/careers/JobDetail?jobId=2"));
  assert.notEqual(jobKey("https://jobs.ashbyhq.com/acme/abc"), jobKey("https://jobs.ashbyhq.com/acme/def"));
});

test("budgeted sweeps resume from the first unvisited board, including partial final batches", async () => {
  writeJobSweepState({ cursors: {} });
  const asked = [];
  const fake = async (url) => {
    if (String(url).includes("raw.githubusercontent.com")) return Response.json(Array.from({ length: 800 }, (_,i) => `quality-${i}`));
    asked.push(String(url));
    return Response.json({ jobs: [] });
  };
  const first = await runDirectorySweep({ profile: rules.profile, directories: ["greenhouse"], limit: 260, fetchImpl: fake });
  assert.equal(first.cursors.greenhouse, 260);
  const second = await runDirectorySweep({ profile: rules.profile, directories: ["greenhouse"], limit: 260, resume: true, fetchImpl: fake });
  assert.equal(second.cursors.greenhouse, 520);
  assert.match(asked[260], /quality-260\/jobs$/);
  assert.equal(new Set(asked).size, 520);
});

test("aborting a concurrent sweep does not checkpoint boards that were never visited", async () => {
  const controller = new AbortController();
  let calls = 0;
  const fake = async (url) => {
    if (String(url).includes("raw.githubusercontent.com")) return Response.json([]);
    if (++calls === 7) controller.abort();
    await new Promise(resolve => setTimeout(resolve, calls % 3));
    return Response.json({ jobs: [] });
  };
  const result = await runDirectorySweep({ profile: rules.profile, directories: ["greenhouse"], limit: 50, signal: controller.signal, fetchImpl: fake });
  assert.equal(result.cursors.greenhouse, calls);
  assert.ok(calls < 50);
});

test("a better description enriches an existing row without changing user state", async () => {
  writeJobs([stored({ status: "applied", score: 4.5, appliedAt: "2026-09-01", notifiedAt: "2026-09-01", note: "referral" })]);
  await absorb([posting({ description: "Requirements: 6 years of software engineering experience." })], rules, offline);
  const [job] = readJobs();
  assert.match(job.description, /6 years/);
  assert.equal(job.yearsRequired, 6);
  assert.equal(job.scoreStale, true);
  assert.equal(job.score, 4.5);
  assert.equal(job.status, "applied");
  assert.equal(job.appliedAt, "2026-09-01");
  assert.equal(job.notifiedAt, "2026-09-01");
  assert.equal(job.note, "referral");
});

test("same ATS id merges aliases; same title with different ids remains discoverable", async () => {
  writeJobs([]);
  const result = await absorb([
    posting(),
    posting({ url: "https://jobs.ashbyhq.com/acme/role-1/application?embed=true", location: "SF · Redwood City", source: "simplify" }),
    posting({ url: "https://jobs.ashbyhq.com/acme/role-2" }),
  ], rules, offline);
  assert.equal(result.added, 2);
  assert.equal(readJobs().length, 2);
  assert.ok(readJobs()[0].alternateUrls.includes("https://jobs.ashbyhq.com/acme/role-1/application?embed=true"));
});

test("providers preserve late hard requirements rather than storing a 2500-character summary", async () => {
  const full = "About our team. ".repeat(220) + "Requirements: Python. " + "We build products. ".repeat(150) + "Must hold an active security clearance.";
  const ctx = { async fetchJson() { return { jobs: [{ title: "SWE", jobUrl: "https://jobs.ashbyhq.com/acme/a", descriptionPlain: full }] }; } };
  const [job] = await providerById("ashby").fetch({ url: "https://jobs.ashbyhq.com/acme", name: "Acme" }, ctx);
  assert.match(job.description, /Must hold an active security clearance\.$/);
  assert.ok(job.description.length > 5000);
});

test("short or truncated snippets are hydrated, and failed native hydration gets a safe fallback", async () => {
  const full = "Requirements: Python skills and two years of software engineering experience. ".repeat(12);
  const job = posting({ source: "ibm", url: "https://careers.example.com/jobs/1", description: "Level: Entry Level We are..." });
  await hydrateDescriptions([job], { async fetchJson() { throw Error("no API"); }, async fetchText() { return `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", description: full })}</script>`; } }, { readUnknownBoards: true });
  assert.match(job.description, /two years/);
  const native = posting({ source: "greenhouse", url: "https://job-boards.greenhouse.io/acme/jobs/1", description: "Old summary…" });
  await hydrateDescriptions([native], { async fetchJson() { throw Error("503"); }, async fetchText() { return `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", description: full })}</script>`; } }, { readUnknownBoards: true });
  assert.match(native.description, /two years/);
});
