import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { FULLSTACK_STEPS } from "./learning.ts";
import {
  FSO_CHAPTERS, FSO_PARTS, chapterForStep, continueChapter, exerciseRange, findChapter, nextChapter,
} from "./fso.ts";
import { fsoSnapshot, openChapter, saveNote, NOTE_MAX_LENGTH } from "./fso-domain.ts";
import { describeOpenFsoChapter } from "./fso-tools.ts";
import { setFullstackCompleted } from "./learning-domain.ts";

const previous = process.env.ROBIN_DATA_DIR;
let directory;
beforeEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = mkdtempSync(join(tmpdir(), "robin-fso-"));
  process.env.ROBIN_DATA_DIR = directory;
});
after(() => {
  rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
});

test("every course step belongs to exactly one chapter, in course order", () => {
  assert.deepEqual(FSO_PARTS.map((part) => part.part), [...Array(15).keys()]);
  const stepIds = FSO_PARTS.flatMap((part) => part.stepIds);
  assert.deepEqual(stepIds, FULLSTACK_STEPS.map((step) => step.id));
  for (const step of FULLSTACK_STEPS) assert.ok(chapterForStep(step.id), step.id);
});

test("chapters carry the course's lettering, exercises, and project groups", () => {
  const unicafe = findChapter("/en/part1/a_more_complex_state_debugging_react_apps");
  assert.equal(unicafe.letter, "d");
  assert.equal(exerciseRange(unicafe.exercises), "1.6–1.14");
  assert.deepEqual(unicafe.projects.map((project) => [project.name, project.steps.length]), [["unicafe", 6], ["anecdotes", 3]]);
  assert.equal(nextChapter(unicafe).id, "/en/part2/rendering_a_collection_modules");
});

test("parts that moved to mooc.fi are external single-chapter parts", () => {
  const moved = FSO_CHAPTERS.filter((chapter) => chapter.external);
  assert.deepEqual(moved.map((chapter) => chapter.part), [8, 9, 10, 11, 12, 13, 14]);
  for (const chapter of moved) assert.match(chapter.url, /^https:\/\/courses\.mooc\.fi\//);
  for (const chapter of FSO_CHAPTERS.filter((entry) => !entry.external)) {
    assert.match(chapter.url, /^https:\/\/fullstackopen\.com\/en\/part\d+\//);
  }
});

test("continue points at the chapter holding the first unfinished step", () => {
  assert.equal(continueChapter([]).id, "/en/part0/general_info");
  assert.equal(continueChapter(["/en/part0/general_info", "/en/part0/fundamentals_of_web_apps"]).id,
    "/en/part0/fundamentals_of_web_apps", "its exercises are still open");
  assert.equal(continueChapter(FULLSTACK_STEPS.map((step) => step.id)), null);
});

test("notes save per chapter, and saving an empty note deletes it", () => {
  const id = "/en/part3/node_js_and_express";
  assert.equal(saveNote(id, "Express: app.get(path, handler)").text, "Express: app.get(path, handler)");
  assert.equal(fsoSnapshot().notes[id].text, "Express: app.get(path, handler)");
  assert.equal(saveNote(id, "   "), null);
  assert.deepEqual(fsoSnapshot().notes, {});
  assert.throws(() => saveNote("/en/part99/nope", "x"), /Unknown/);
  assert.throws(() => saveNote(id, "x".repeat(NOTE_MAX_LENGTH + 1)), /limited/);
});

test("the mentor sees the open chapter with its ticks and notes", () => {
  const id = "/en/part1/java_script";
  assert.equal(describeOpenFsoChapter(), null);
  openChapter(id);
  saveNote(id, "map returns a new array");
  setFullstackCompleted(`${id}/1.3`, true);
  const context = describeOpenFsoChapter();
  assert.match(context, /Chapter 1b JavaScript/);
  assert.match(context, /\[x\] 1\.3: Course Information step 3/);
  assert.match(context, /\[ \] 1\.4/);
  assert.match(context, /<notes>\nmap returns a new array\n<\/notes>/);
});
