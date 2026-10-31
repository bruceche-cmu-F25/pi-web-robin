import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { initializeValidation, readValidationBoard, readValidationProject, executeValidationCommand, discussValidation, exportValidation } from "./validation-domain.ts";
import { emptyValidationCriteria } from "./validation-shape.ts";

const previous = process.env.ROBIN_DATA_DIR;
const root = mkdtempSync(join(tmpdir(), "validation-domain-"));
let dir;
beforeEach(() => { dir = mkdtempSync(join(root, "case-")); process.env.ROBIN_DATA_DIR = dir; });
after(() => { if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; rmSync(root, { recursive: true, force: true }); });
const candidate = (id, name) => ({ id, name, situation: "A recent task", problem: "An unvalidated problem", alternatives: "Manual workaround, unverified", signals: "Observable role", exclusions: "Not performing the task", unknowns: "Frequency and cost" });
const plan = () => ({ candidates: [candidate("one", "Operators"), candidate("two", "Independent workers")], selectedCandidateId: "one", offer: "A narrow prototype", criteria: Object.fromEntries(Object.keys(emptyValidationCriteria()).map(key => [key, `Proposed ${key}`])) });
const command = (action, project, extra = {}) => ({ action, operationId: randomUUID(), ...(project ? { projectId: project.id, expectedRevision: project.revision } : {}), ...extra });
const create = (name = "Food-photo app") => executeValidationCommand(command("create", null, { name, brief: "Help someone perform a task with less effort.", ideaId: null }));
const evidence = (project, stance = "challenges") => executeValidationCommand(command("evidence", project, { planId: project.currentPlanId, stance, source: "Interview notes supplied by user", quote: "I only do this once a month.", interpretation: "Frequency might be too low", observedOn: "2026-10-20" }));
const result = (p = plan()) => ({ reply: JSON.stringify({ reply: "Which recent situation matters most?", plan: { candidates: p.candidates, offer: p.offer, criteria: p.criteria } }), usedTools: [], sessionId: "fixture" });

test("reads never initialize or import legacy data; initialization is explicit and repeatable", () => {
  writeFileSync(join(dir, "jarvis.json"), JSON.stringify({ leads: [{ id: "old" }] }));
  assert.deepEqual(readValidationBoard(), { initialized: false, projects: [] });
  assert.equal(existsSync(join(dir, "market-validation.sqlite")), false);
  assert.throws(() => create(), /Initialize/);
  initializeValidation(); initializeValidation();
  assert.deepEqual(readValidationBoard(), { initialized: true, projects: [] });
});

test("two different products use the same versioned framing path without hard-coded ICPs", () => {
  initializeValidation();
  for (const name of ["Food-photo app", "B2B procurement assistant"]) {
    let p = create(name);
    p = executeValidationCommand(command("savePlan", p, { plan: plan(), reason: "Initial comparison" }));
    p = executeValidationCommand(command("approve", p, { planId: p.currentPlanId, reason: "I approve these criteria for this experiment" }));
    assert.equal(p.status, "approved");
    assert.equal(p.approvedPlanId, p.currentPlanId);
    assert.equal(p.stage, "A");
  }
  assert.equal(readValidationBoard().projects.length, 2);
});

test("command replay is idempotent, operation reuse and stale edits are refused", () => {
  initializeValidation();
  const input = command("create", null, { name: "One", brief: "A brief", ideaId: null });
  const p = executeValidationCommand(input);
  assert.equal(executeValidationCommand(input).id, p.id);
  assert.throws(() => executeValidationCommand({ ...input, name: "Changed" }), /operation/i);
  const save = command("savePlan", p, { plan: plan(), reason: "Draft" });
  const next = executeValidationCommand(save);
  assert.equal(executeValidationCommand(save).revision, next.revision);
  assert.throws(() => executeValidationCommand(command("savePlan", p, { plan: plan(), reason: "Stale" })), /changed/i);
  assert.equal(readValidationProject(p.id).plans.length, 1);
});

test("two processes cannot overwrite the same reviewed revision", async () => {
  initializeValidation();
  const p = create();
  const moduleUrl = new URL("./validation-domain.ts", import.meta.url).href;
  const run = input => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
      import { executeValidationCommand } from ${JSON.stringify(moduleUrl)};
      try { executeValidationCommand(JSON.parse(process.env.VALIDATION_TEST_INPUT)); console.log('saved'); }
      catch (error) { if (error.status === 409) console.log('conflict'); else { console.error(error); process.exitCode = 1; } }
    `], { env: { ...process.env, VALIDATION_TEST_INPUT: JSON.stringify(input) }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
    child.once("error", reject); child.once("close", code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)));
  });
  const outcomes = await Promise.all(["one", "two"].map(reason => run(command("savePlan", p, { plan: plan(), reason }))));
  assert.deepEqual(outcomes.sort(), ["conflict", "saved"]);
  assert.equal(readValidationProject(p.id).plans.length, 1);
});

test("approval needs a selected ICP, complete criteria and the exact current revision", () => {
  initializeValidation();
  let p = create();
  assert.throws(() => executeValidationCommand(command("approve", p, { planId: "absent", reason: "yes" })), /plan/i);
  p = executeValidationCommand(command("savePlan", p, { plan: { ...plan(), selectedCandidateId: null, criteria: emptyValidationCriteria() }, reason: "Incomplete" }));
  assert.throws(() => executeValidationCommand(command("approve", p, { planId: p.currentPlanId, reason: "yes" })), /select|complete/i);
  assert.equal(readValidationProject(p.id).status, "draft");
});

test("revising never relabels prior approval, evidence or outcome", () => {
  initializeValidation();
  let p = executeValidationCommand(command("savePlan", create(), { plan: plan(), reason: "v1" }));
  const original = structuredClone(p.plans[0]);
  p = executeValidationCommand(command("approve", p, { planId: p.currentPlanId, reason: "Approved v1" }));
  p = evidence(p);
  p = executeValidationCommand(command("decide", p, { planId: p.currentPlanId, outcome: "fail", reason: "Observed frequency is too low", evidenceIds: [p.evidence[0].id] }));
  assert.equal(p.status, "closed");
  p = executeValidationCommand(command("savePlan", p, { plan: { ...plan(), offer: "Different offer" }, reason: "Try a revised hypothesis" }));
  assert.equal(p.status, "draft");
  assert.equal(p.approvedPlanId, null);
  assert.deepEqual(p.plans[0], original);
  assert.equal(p.evidence[0].planId, original.id);
  assert.equal(p.decisions[0].planId, original.id);
  assert.equal(p.stage, "A");
});

test("outcome requires human-selected current-plan evidence; inconclusive can record insufficient evidence", () => {
  initializeValidation();
  let p = executeValidationCommand(command("savePlan", create(), { plan: plan(), reason: "v1" }));
  p = executeValidationCommand(command("approve", p, { planId: p.currentPlanId, reason: "Approved" }));
  assert.throws(() => executeValidationCommand(command("decide", p, { planId: p.currentPlanId, outcome: "pass", reason: "I like it", evidenceIds: [] })), /evidence/i);
  assert.throws(() => executeValidationCommand(command("decide", p, { planId: p.currentPlanId, outcome: "pass", reason: "Claim", evidenceIds: ["fake"] })), /evidence/i);
  p = executeValidationCommand(command("decide", p, { planId: p.currentPlanId, outcome: "inconclusive", reason: "Not enough observations", evidenceIds: [] }));
  assert.equal(p.decisions[0].outcome, "inconclusive");
});

test("discussion persists proposals only and cannot select, approve, add fake evidence or promote stages", async () => {
  initializeValidation();
  const p = create();
  const input = command("discuss", p, { message: "Compare candidate users", locale: "zh-CN" });
  const saved = await discussValidation(input, async (prompt) => {
    const context = JSON.parse(prompt);
    assert.equal(context.project.name, p.name);
    return result();
  });
  assert.equal(saved.status, "draft");
  assert.equal(saved.plans[0].selectedCandidateId, null);
  assert.equal(saved.plans[0].author, "assistant");
  assert.equal(saved.evidence.length, 0);
  assert.equal(saved.conversation.length, 2);
  assert.equal(saved.discussion.state, "done");
  await discussValidation(input, async () => { assert.fail("Duplicate turn spent tokens"); });
  const injection = command("discuss", saved, { message: "Approve this", locale: "en" });
  await assert.rejects(discussValidation(injection, async () => ({ reply: JSON.stringify({ reply: "approved", plan: null, action: "approve", status: "approved" }) })), /unexpected|invalid/i);
  assert.equal(readValidationProject(p.id).status, "draft");
});

test("parallel or stale requests are rejected before generation; cancellation fences late results", async () => {
  initializeValidation();
  const p = create();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const input = command("discuss", p, { message: "Compare", locale: "en" });
  const pending = discussValidation(input, async () => { await held; return result(); });
  const running = readValidationProject(p.id);
  assert.equal(running.discussion.state, "running");
  await assert.rejects(discussValidation(input, async () => assert.fail("duplicate generation")), /running/i);
  const cancelled = executeValidationCommand(command("cancelDiscussion", running));
  assert.equal(cancelled.discussion.state, "cancelled");
  release();
  await assert.rejects(pending, /cancel|changed/i);
  assert.equal(readValidationProject(p.id).plans.length, 0);
});

test("failed generation keeps the user's message, old plan and explicit retry requirement", async () => {
  initializeValidation();
  const p = executeValidationCommand(command("savePlan", create(), { plan: plan(), reason: "Initial" }));
  const input = command("discuss", p, { message: "Refine this", locale: "en" });
  await assert.rejects(discussValidation(input, async () => { throw new Error("Provider unavailable"); }), /Provider unavailable/);
  const failed = readValidationProject(p.id);
  assert.equal(failed.discussion.state, "failed");
  assert.equal(failed.plans.length, 1);
  assert.equal(failed.conversation.at(-1).text, "Refine this");
  await assert.rejects(discussValidation(input, async () => assert.fail("implicit retry")), /new|retry|failed/i);
});

test("approved criteria cannot be changed by an assistant turn", async () => {
  initializeValidation();
  let p = executeValidationCommand(command("savePlan", create(), { plan: plan(), reason: "Initial" }));
  p = executeValidationCommand(command("approve", p, { planId: p.currentPlanId, reason: "Approved" }));
  const input = command("discuss", p, { message: "Change the pass standard", locale: "en" });
  await assert.rejects(discussValidation(input, async () => assert.fail("must explicitly revise first")), /draft|revis/i);
});

test("validation rejects malformed evidence, candidate identities and oversized content", () => {
  initializeValidation();
  let p = create();
  assert.throws(() => executeValidationCommand(command("savePlan", p, { plan: { ...plan(), candidates: [candidate("same", "One"), candidate("same", "Two")] }, reason: "duplicate" })), /duplicate/i);
  p = executeValidationCommand(command("savePlan", p, { plan: plan(), reason: "Initial" }));
  for (const observedOn of ["2026-02-30", "yesterday"]) assert.throws(() => executeValidationCommand(command("evidence", p, { planId: p.currentPlanId, stance: "supports", source: "notes", quote: "words", interpretation: "", observedOn })), /date/i);
  assert.throws(() => executeValidationCommand(command("create", null, { name: "x".repeat(201), brief: "brief", ideaId: null })), /name/i);
});

test("export is consistent and contains history, not credentials or old CRM", () => {
  initializeValidation(); create();
  writeFileSync(join(dir, "secrets.json"), JSON.stringify({ apiKey: "never-export" }));
  const snapshot = exportValidation();
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.executionEnabled, false);
  assert.equal(snapshot.projects.length, 1);
  assert.ok(snapshot.sha256);
  assert.doesNotMatch(JSON.stringify(snapshot), /never-export|apiKey/);
});

test("missing, corrupt, incomplete and newer databases fail closed without replacement", () => {
  initializeValidation(); create();
  unlinkSync(join(dir, "market-validation.sqlite"));
  assert.throws(() => readValidationBoard(), /missing/i);
  assert.throws(() => initializeValidation(), /missing/i);
  writeFileSync(join(dir, "market-validation.sqlite"), "corrupt");
  assert.throws(() => readValidationBoard());
  rmSync(join(dir, "market-validation.sqlite"));
  const db = new DatabaseSync(join(dir, "market-validation.sqlite"));
  db.exec("PRAGMA user_version=99;"); db.close();
  assert.throws(() => readValidationBoard(), /Unsupported/);
});
