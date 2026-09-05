import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./FullstackLearningPrototype.tsx", import.meta.url), "utf8");

test("the prototype keeps the agreed map, book, and mentor hierarchy", () => {
  assert.match(source, /\[directoryOpen, setDirectoryOpen\] = useState\(true\)/);
  assert.match(source, /\[mentorOpen, setMentorOpen\] = useState\(false\)/);
  assert.match(source, /SYSTEM_LANES/);
  assert.match(source, /learningSpine/);
  assert.match(source, /<AgentPanel/);
});

test("chapters expose one primary resource, two supplements, and folded extras", () => {
  assert.match(source, /rest\.slice\(0, 2\)/);
  assert.match(source, /rest\.slice\(2\)/);
  assert.match(source, /<details/);
  assert.match(source, /courseModule\.guide\.smallExercise/);
});

test("the prototype is navigation, not fake reading progress", () => {
  assert.doesNotMatch(source, /progress|completed|markDone|StudyRecord/);
  assert.match(source, /aria-current/);
});
