import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const original = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), "robin-study-plan-"));
process.env.ROBIN_DATA_DIR = dir;
after(() => { rmSync(dir, { recursive: true, force: true }); if (original === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = original; });
const { readStudyPlan, saveStudyWeek, saveStudySessions, savePythonReviewCheck, studyEvents } = await import("./study-plan-domain.ts");
const { DEFAULT_SESSIONS, dueStudySession, safeStudyLink } = await import("./study-plan.ts");

test("week starts on Monday and user-confirmed changes survive a read; stale edits are refused", () => {
  {
    const initial = readStudyPlan("2026-11-03");
    assert.equal(initial.week.week, "2026-11-02");
    assert.equal(initial.week.updatedAt, "");
    assert.equal(initial.sessions[0].start, "10:00");
    assert.deepEqual(studyEvents("2026-11-02", "2026-11-04").map((e) => e.date), ["2026-11-03", "2026-11-04"]);
    assert.deepEqual(studyEvents("2027-01-01", "2027-01-02"), []);
    const saved = saveStudyWeek("2026-11-03", { objective: "Python 字典", milestones: [{ title: "写三个练习", done: true }] }, "");
    assert.equal(readStudyPlan("2026-11-04").week.milestones[0].done, true);
    assert.equal(readStudyPlan("2026-11-09").week.updatedAt, "");
    assert.throws(() => saveStudyWeek("2026-11-03", { objective: "覆盖", milestones: [{ title: "X" }] }, ""), /changed/);
    assert.equal(readStudyPlan("2026-11-03").week.updatedAt, saved.updatedAt);
  }
});

test("only explicit dated checks count; unchecking, stale tabs and legacy answers are handled safely", () => {
  const date = "2026-11-04";
  const original = readStudyPlan(date);
  const path = join(dir, "study-plan.json");
  const old = { revision: "old", attempts: [{ recall: "old answer", exercise: "old code", outcome: "review", at: "2026-11-04T00:00:00Z" }] };
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), reviews: { [date]: old } }));
  assert.deepEqual(readStudyPlan(date).reviewChecks, {});
  assert.equal("reviews" in readStudyPlan(date), false, "old answers are no longer returned to the UI");
  assert.throws(() => savePythonReviewCheck("2026-11-23", true, ""), /not available/);
  assert.throws(() => savePythonReviewCheck(date, "true", ""), /boolean/);
  assert.throws(() => savePythonReviewCheck(date, { recall: "answer" }, ""), /boolean/);
  const first = savePythonReviewCheck(date, true, "");
  assert.equal(first.checked, true);
  assert.ok(first.checkedAt);
  assert.equal(readStudyPlan(date).week.milestones[0].done, original.week.milestones[0].done);
  assert.throws(() => savePythonReviewCheck(date, false, ""), /changed/);
  const second = savePythonReviewCheck(date, false, first.revision);
  assert.equal(second.checked, false);
  assert.notEqual(second.revision, first.revision);
  assert.equal(readStudyPlan(date).reviewChecks[date].checked, false);
  assert.equal(readStudyPlan(date).week.updatedAt, original.week.updatedAt);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).reviews[date], old, "old records are preserved, not shown or overwritten");
});

test("a recurring study session projects only selected days and rejects unsafe links", () => {
  const session = { id: "python", title: "Python", days: [1, 3], start: "19:00", end: "20:00", url: "https://www.freecodecamp.org/learn/python-v9/", enabled: true };
  assert.equal(safeStudyLink("javascript:alert(1)"), false);
  assert.equal(safeStudyLink("//example.com"), false);
  assert.equal(safeStudyLink("/coding"), true);
  assert.throws(() => saveStudySessions([{ ...session, url: "javascript:alert(1)" }]), /link/);
  saveStudySessions([session]);
  assert.deepEqual(studyEvents("2026-11-09", "2026-11-11").map((event) => event.date), ["2026-11-09", "2026-11-11"]);
});

test("reminders are due near the start, and snooze or acknowledgement defers them", () => {
  const now = new Date(2026, 10, 3, 10, 5);
  const key = "2026-11-03:leetcode:10:00";
  assert.equal(dueStudySession(DEFAULT_SESSIONS, now, {})?.session.id, "leetcode");
  assert.equal(dueStudySession(DEFAULT_SESSIONS, now, { [key]: now.getTime() + 600_000 }), null);
  assert.equal(dueStudySession(DEFAULT_SESSIONS, new Date(2026, 10, 3, 11, 0), {}), null);
});
