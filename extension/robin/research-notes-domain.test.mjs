import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { appendResearchNote, createResearchProject, readResearchObjective, saveResearchObjective, updateResearchProject } from "./research-domain.ts";

const previous = process.env.ROBIN_DATA_DIR;
const directory = mkdtempSync(join(tmpdir(), "research-notes-"));
process.env.ROBIN_DATA_DIR = directory;
let id;
beforeEach(() => {
  rmSync(directory, { recursive: true, force: true });
  id = createResearchProject({ name: "Notes", objective: "Initial focus" }).id;
});
after(() => {
  rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
});
const conflict = (error) => error.status === 409;

test("an old editor cannot overwrite an answer appended after its read", () => {
  const old = readResearchObjective(id);
  appendResearchNote("A newly kept answer", id);
  assert.throws(() => saveResearchObjective({ ...old, objective: "Edited focus" }, id), conflict);
  assert.equal(readResearchObjective(id).note, "A newly kept answer");
  assert.equal(readResearchObjective(id).objective, "Initial focus");
});

test("concurrent editors conflict, including when only the notebook is changed", () => {
  const base = readResearchObjective(id);
  const saved = saveResearchObjective({ revision: base.revision, note: "First editor" }, id);
  assert.notEqual(saved.revision, base.revision);
  assert.equal(saved.objective, "Initial focus");
  assert.throws(() => saveResearchObjective({ revision: base.revision, note: "Second editor" }, id), conflict);
  assert.deepEqual(readResearchObjective(id), saved);
});

test("omitted fields survive a partial save and unrelated project metadata does not conflict", () => {
  appendResearchNote("Keep this", id);
  const base = readResearchObjective(id);
  updateResearchProject(id, { name: "Renamed" });
  const saved = saveResearchObjective({ revision: base.revision, objective: "New focus" }, id);
  assert.equal(saved.note, "Keep this");
  assert.equal(saved.objective, "New focus");
});

test("unversioned clients cannot bypass conflict protection", () => {
  const base = readResearchObjective(id);
  assert.throws(() => saveResearchObjective({ objective: "Old client" }, id), conflict);
  assert.deepEqual(readResearchObjective(id), base);
});

test("the empty store has a revision for the first explicit save", () => {
  rmSync(directory, { recursive: true, force: true });
  const base = readResearchObjective();
  assert.equal(typeof base.revision, "string");
  const saved = saveResearchObjective({ revision: base.revision, objective: "First goal", note: "First note" });
  assert.deepEqual(readResearchObjective(), saved);
});
