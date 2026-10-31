import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readResume, saveResume } from "./resume-domain.ts";
import { MAX_RESUME_BYTES, RESUME_TEMPLATE, parseResumeProposal, resumeRequest } from "./resume.ts";

const previous = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), "resume-domain-"));
process.env.ROBIN_DATA_DIR = dir;
beforeEach(() => { rmSync(join(dir, "resume.json"), { force: true }); });
after(() => {
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
  rmSync(dir, { recursive: true, force: true });
});
const conflict = (error) => error.status === 409;
test("read is inert; save round-trips exact Unicode/LaTeX without touching the scoring CV", () => {
  writeFileSync(join(dir, "job-profile.json"), JSON.stringify({ cv: "Original CV" }));
  const original = readFileSync(join(dir, "job-profile.json"), "utf8");
  const empty = readResume();
  assert.equal(existsSync(join(dir, "resume.json")), false);
  const source = RESUME_TEMPLATE + "% 中文 \\ & $ <script>not executed</script>\r\n";
  const saved = saveResume({ ...empty, source });
  assert.deepEqual(readResume(), saved);
  assert.equal(saved.source, source);
  assert.notEqual(saved.revision, empty.revision);
  assert.equal(readFileSync(join(dir, "job-profile.json"), "utf8"), original);
});
test("stale and unversioned writes cannot overwrite; lost-response retries are harmless", () => {
  const first = saveResume({ ...readResume(), source: "first" });
  const second = saveResume({ revision: first.revision, source: "second" });
  assert.throws(() => saveResume({ revision: first.revision, source: "lost edits" }), conflict);
  assert.throws(() => saveResume({ source: "no revision" }), conflict);
  assert.deepEqual(saveResume({ revision: first.revision, source: "second" }), second);
  assert.deepEqual(readResume(), second);
});
test("corruption is not replaced by a blank resume", () => {
  for (const text of ["{", "[]", "{}", '{"source":false,"revision":"r","updatedAt":"2026-01-01"}']) {
    writeFileSync(join(dir, "resume.json"), text);
    assert.throws(() => readResume());
    assert.throws(() => saveResume({ revision: "empty", source: "replacement" }));
    assert.equal(readFileSync(join(dir, "resume.json"), "utf8"), text);
  }
});
test("write and generation input limits are UTF-8 bounds, not character guesses", () => {
  for (const source of [null, 42, "x\0y", "中".repeat(MAX_RESUME_BYTES / 3 + 1)]) assert.throws(() => saveResume({ revision: "empty", source }));
  const input = { source: RESUME_TEMPLATE, instruction: "Tighten bullets", useProfile: false, jobDescription: "", locale: "zh-CN" };
  assert.equal(resumeRequest(input).locale, "zh-CN");
  for (const value of [null, [], {}, { ...input, instruction: " " }, { ...input, useProfile: "false" }, { ...input, jobDescription: "x".repeat(30001) }]) assert.throws(() => resumeRequest(value));
});
test("proposals require complete structured data; clarification never supplies a replacement", () => {
  const proposal = { source: RESUME_TEMPLATE, summary: "Please check facts.", questions: ["Which date is current?"] };
  assert.deepEqual(parseResumeProposal(JSON.stringify(proposal)), proposal);
  assert.deepEqual(parseResumeProposal('```json\n' + JSON.stringify(proposal) + '\n```'), proposal);
  assert.equal(parseResumeProposal(JSON.stringify({ ...proposal, source: null })).source, null);
  for (const reply of ["I saved your resume!", JSON.stringify({ ...proposal, source: "truncated" }), JSON.stringify({ ...proposal, questions: [123] }), JSON.stringify({ ...proposal, source: RESUME_TEMPLATE.slice(0, -20) }), "{}"]) {
    assert.throws(() => parseResumeProposal(reply));
  }
});
