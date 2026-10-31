import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COURSE_LESSONS, COURSE_STAGES, COURSE_SOURCES, COURSE_NAMESPACE } from "./learning-course.ts";
import { learningCourse, saveCourseRecord } from "./learning-roadmap-domain.ts";
import { courseEnglish, courseChinese, courseTraditional } from "../../lib/i18n/messages/learning-course.ts";

const root = mkdtempSync(join(tmpdir(), "learning-course-"));
const before = [process.env.ROBIN_DATA_DIR, process.env.ROBIN_OBSIDIAN_CONFIG];
process.env.ROBIN_DATA_DIR = root;
process.env.ROBIN_OBSIDIAN_CONFIG = join(root, "unavailable-registry.json");
after(() => {
  rmSync(root, { recursive: true, force: true });
  for (const [key, value] of [["ROBIN_DATA_DIR", before[0]], ["ROBIN_OBSIDIAN_CONFIG", before[1]]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("every lesson has substantive teaching, a worked case, specific practice and a hidden-answer structure", () => {
  assert.equal(COURSE_LESSONS.length, 23);
  assert.equal(new Set(COURSE_LESSONS.map((lesson) => lesson.id)).size, COURSE_LESSONS.length);
  assert.equal(new Set(COURSE_LESSONS.map((lesson) => lesson.exercise.task)).size, COURSE_LESSONS.length);
  const seen = new Set();
  for (const lesson of COURSE_LESSONS) {
    assert.match(lesson.id, /^[a-z][a-z-]+$/);
    assert.ok(COURSE_STAGES.some((stage) => stage.id === lesson.stage));
    for (const prerequisite of lesson.prerequisites) assert.ok(seen.has(prerequisite), `${lesson.id}: prerequisite ${prerequisite} must precede it`);
    seen.add(lesson.id);
    assert.ok(lesson.outcome.length > 20, lesson.id);
    assert.ok(lesson.diagram.nodes.length >= 3, lesson.id);
    assert.equal(lesson.explanation.length, 3, lesson.id);
    assert.ok(lesson.explanation.reduce((sum, part) => sum + part.body.length, 0) >= 400, lesson.id);
    assert.ok(lesson.worked.body.length >= 130, lesson.id);
    assert.equal(lesson.check.choices.length, 3, lesson.id);
    assert.ok(Number.isInteger(lesson.check.answer) && lesson.check.answer >= 0 && lesson.check.answer < lesson.check.choices.length);
    for (const choice of lesson.check.choices) assert.ok(choice.feedback.length > 12, lesson.id);
    assert.equal(lesson.exercise.hints.length, 2);
    assert.ok(lesson.exercise.task.length >= 80 && lesson.exercise.solution.length >= 130, lesson.id);
    assert.equal(lesson.exercise.rubric.length, 3);
    assert.ok(lesson.notes.length && lesson.sources.length);
    for (const id of lesson.sources) assert.match(COURSE_SOURCES[id]?.url ?? "", /^https:\/\//);
  }
  for (const stage of COURSE_STAGES) assert.ok(COURSE_LESSONS.some((lesson) => lesson.stage === stage.id));
  assert.equal(new Set(COURSE_LESSONS.flatMap((lesson) => lesson.notes)).size, 18, "the eighteen source titles have a course connection, not invented paths");
  for (const messages of [courseChinese, courseTraditional]) assert.deepEqual(Object.keys(messages).sort(), Object.keys(courseEnglish).sort());
});

test("the authored numerical examples and answer keys agree", () => {
  const check = (id) => { const lesson = COURSE_LESSONS.find((lesson) => lesson.id === id); return lesson.check.choices[lesson.check.answer].text; };
  assert.match(check("training-lifecycle"), /0\.72/);
  assert.match(check("evaluation"), /60%/);
  assert.match(check("sft-lora"), /8,192/);
  assert.match(check("preferences-rl"), /0/);
  assert.match(check("inference-infra"), /1GiB/);
  assert.match(check("discovery"), /增加 1 分钟/);
  assert.match(check("uat-handoff"), /50 分钟/);
});

test("course is independent of vault availability and only explicit saves create records", () => {
  const course = learningCourse();
  assert.equal(course.lessons.length, 23);
  assert.deepEqual(course.progress, []);
  for (const lesson of course.lessons) assert.match(lesson.fingerprint, /^[a-f0-9]{64}$/);
  const first = course.lessons[0], second = course.lessons[1];
  const input = { lessonId: first.id, fingerprint: first.fingerprint, revision: 0, status: "gap", evidence: "I confused context with weights." };
  const saved = saveCourseRecord({ ...input, vaultId: "untrusted", title: "Fake title", path: "../outside" });
  assert.equal(saved.vaultId, COURSE_NAMESPACE);
  assert.equal(saved.title, first.title);
  assert.equal(saved.revision, 1);
  assert.equal(learningCourse().progress[0].evidence, input.evidence);
  assert.throws(() => saveCourseRecord(input), (error) => error.status === 409);
  assert.throws(() => saveCourseRecord({ ...input, revision: 1, fingerprint: "old-content" }), (error) => error.status === 409);
  assert.throws(() => saveCourseRecord({ ...input, revision: 1, status: "confident", evidence: " " }), /evidence/);
  saveCourseRecord({ ...input, lessonId: second.id, fingerprint: second.fingerprint });
  assert.equal(learningCourse().progress.length, 2, "independent lesson saves merge");
  const confirmed = saveCourseRecord({ ...input, revision: 1, status: "confident", evidence: "Compared context changes without training; saved the result." });
  assert.equal(confirmed.revision, 2);
  assert.equal(learningCourse().progress.find((record) => record.section === first.id).status, "confident");
  for (const patch of [{ lessonId: "missing" }, { lessonId: "" }, { status: "verified" }, { evidence: "x".repeat(20_001) }, { revision: -1 }, { revision: 0.5 }, { fingerprint: null }]) {
    assert.throws(() => saveCourseRecord({ ...input, revision: 2, ...patch }));
  }
  for (const input of [null, [], "text", {}]) assert.throws(() => saveCourseRecord(input));
});

test("source-note records coexist untouched, stale evidence stays visible and corrupt progress fails closed", () => {
  const file = join(root, "learning-roadmap-progress.json");
  const saved = JSON.parse(readFileSync(file, "utf8"));
  const source = { vaultId: "real-vault", path: "Roadmap.md", section: "intro", title: "Original", evidence: "Original evidence", fingerprint: "source-hash", revision: 1, status: "gap", updatedAt: new Date().toISOString() };
  const key = JSON.stringify([source.vaultId, source.path, source.section]);
  saved[key] = source;
  const courseRecordKey = Object.keys(saved).find((key) => key.includes(COURSE_NAMESPACE));
  saved[courseRecordKey].fingerprint = "old-version";
  writeFileSync(file, JSON.stringify(saved));
  const course = learningCourse();
  assert.equal(course.progress.length, 2);
  assert.equal(course.progress.find((record) => record.section === saved[courseRecordKey].section).fingerprint, "old-version");
  const lesson = course.lessons[2];
  saveCourseRecord({ lessonId: lesson.id, fingerprint: lesson.fingerprint, revision: 0, status: "learning", evidence: "" });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8"))[key], source);
  writeFileSync(file, '{"bad":{"status":"gap"}}');
  assert.throws(() => learningCourse(), /Invalid learning roadmap progress/);
  assert.throws(() => saveCourseRecord({ lessonId: lesson.id, fingerprint: lesson.fingerprint, revision: 1, status: "learning", evidence: "" }), /Invalid learning roadmap progress/);
});
