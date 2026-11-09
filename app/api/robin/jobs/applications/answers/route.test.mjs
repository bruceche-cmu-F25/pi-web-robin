import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";
import { resetTaskStore } from "../../../../../../extension/robin/task-store.test-support.mjs";
import { applicationSettings } from "../../../../../../extension/robin/job-application-domain.ts";
import { readJobs, writeJobs } from "../../../../../../extension/robin/store.ts";

const previous = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), "robin-approved-answers-"));
process.env.ROBIN_DATA_DIR = dir;
resetTaskStore(dir);
const route = await createJiti(import.meta.url, { alias: { "@": process.cwd() } }).import("./route.ts");
after(() => {
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
  rmSync(dir, { recursive: true, force: true });
});
const request = (method, body, origin = "http://localhost") => new Request("http://localhost/api/robin/jobs/applications/answers", {
  method, headers: { Host: "localhost", Origin: origin, "Content-Type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test("private editor reads only approved answers, never resume, credentials or submission policy", async () => {
  const response = await route.GET(request("GET"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  const editor = await response.json();
  assert.deepEqual(Object.keys(editor).sort(), ["answers", "confirmedFacts", "revision", "standing"]);
  assert.deepEqual({ confirmedFacts: editor.confirmedFacts, answers: editor.answers, standing: editor.standing }, { confirmedFacts: "", answers: {}, standing: {} });
  assert.match(editor.revision, /^[0-9a-f]{64}$/);
});

test("facts cannot overwrite concurrent edits and cannot change submission authorization", async () => {
  assert.equal((await route.PATCH(request("PATCH", { kind: "facts", facts: "I do not need visa sponsorship.", expected: "" }))).status, 200);
  assert.equal((await route.PATCH(request("PATCH", { kind: "facts", facts: "lost update", expected: "" }))).status, 409);
  assert.equal(applicationSettings().confirmedFacts, "I do not need visa sponsorship.");
  assert.equal(applicationSettings().submissionPolicy, "");
  for (const bad of [
    { kind: "facts", facts: "x", expected: "", submissionPolicy: "jobright-checked-v1" },
    { kind: "field", id: "1", label: "Citizenship", answer: "Yes", resumePath: "/etc/passwd" },
  ]) assert.equal((await route.PATCH(request("PATCH", bad))).status, 400);
  assert.equal((await route.PATCH(request("PATCH", { kind: "facts", facts: "other", expected: "I do not need visa sponsorship." }, "https://evil.test"))).status, 403);
});

test("one reusable personal profile applies across jobs without granting legal consent or changing the submission policy", async () => {
  const before = await (await route.GET(request("GET"))).json();
  const standing = { pronouns: "he/him", raceEthnicity: "Asian", sponsorshipNow: "No", sponsorshipFuture: "No" };
  const profile = { kind: "profile", confirmedFacts: "Confirmed experience and relocation facts", standing,
    generalAnswers: { "Preferred city?": "Seattle" }, expectedRevision: before.revision };
  const saved = await route.PATCH(request("PATCH", profile));
  assert.equal(saved.status, 200);
  const editor = await saved.json();
  assert.deepEqual(editor.standing, standing);
  assert.equal(editor.answers["Preferred city?"], "Seattle");
  assert.equal(applicationSettings().submissionPolicy, "");
  assert.equal((await route.PATCH(request("PATCH", profile))).status, 409);
  for (const bad of [
    { ...profile, standing: { ...standing, consent: "Yes" } },
    { ...profile, standing: { sponsorshipNow: 100 } },
    { ...profile, generalAnswers: { "I agree to arbitration": "Yes" } },
    { ...profile, generalAnswers: { "What are your salary expectations?": "$120,000" } },
    { ...profile, submissionPolicy: "jobright-checked-v1" },
  ]) assert.equal((await route.PATCH(request("PATCH", bad))).status, 400);
});

test("a job-specific approval requires an exact question on a real attention record", async () => {
  const job = { id: "1", company: "Example", title: "Engineer", status: "new", url: "https://job-boards.greenhouse.io/example/jobs/1",
    location: "Remote US", source: "greenhouse", discoveredAt: new Date().toISOString(), application: {
      attemptId: "attempt", workflowVersion: 2, stage: "attention", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      days: [], url: "https://job-boards.greenhouse.io/example/jobs/1", blockers: [], fields: [
        { key: "pronouns", label: "Pronouns?*", kind: "select", options: ["He/Him", "She/Her"], value: "", required: true, check: "empty" },
      ], resumeVerified: false, resumeHash: "", preferencesHash: "",
    } };
  writeJobs([job]);
  const before = readJobs();
  for (const patch of [
    { kind: "field", id: "1", label: "Citizenship", answer: "Yes" },
    { kind: "field", id: "1", label: "Pronouns?*", answer: "Not an available option" },
    { kind: "field", id: "missing", label: "Pronouns?*", answer: "He/Him" },
  ]) assert.equal((await route.PATCH(request("PATCH", patch))).status, 400);
  const response = await route.PATCH(request("PATCH", { kind: "field", id: "1", label: "Pronouns?*", answer: "He/Him" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).answers["[job:1] Pronouns?*"], "He/Him");
  assert.deepEqual(readJobs(), before);
});
