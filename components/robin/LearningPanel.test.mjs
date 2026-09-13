import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Daily puts Learning Hub in its own full-width row below Jobs", () => {
  assert.match(read("./Dashboard.tsx"), /<JobsPanel \/>\s*<LearningPanel \/>\s*<LinksPanel \/>/);
});

test("the hub adds course history without making the existing curriculum trackable", () => {
  assert.match(read("./LearningHub.tsx"), /<LearningPanel showCourseOutline \/>/);
  const panel = read("./LearningPanel.tsx");
  assert.match(panel, /\/api\/robin\/learning/);
  assert.doesNotMatch(panel, /\/api\/robin\/study/);
  // Course steps open in the Full Stack Open workspace, not the companion curriculum.
  assert.match(panel, /\/learn\/fso\?step=/);
  assert.doesNotMatch(panel, /\/coding\?track=curriculum/);
  assert.match(panel, /role="alert"/);
  assert.match(panel, /aria-current=.*"step"/);
});

test("the hub's course outline is one ruler of parts, closed until a part is picked", () => {
  const panel = read("./LearningPanel.tsx");
  assert.match(panel, /showCourseOutline && <CourseMap /);
  assert.match(panel, /useState<number \| null>\(null\)/);
  assert.match(panel, /aria-expanded=\{open === part\}/);
  // The per-part <details> stack it replaced took ~600px above the fold.
  assert.doesNotMatch(panel, /PARTS\.map\(\(part\) => \{\s*const steps/);
});

test("the practice deep link selects the named problem through the existing server write", () => {
  assert.match(read("./CodingBoard.tsx"), /initialProblem=\{searchParams.get\("problem"\)\}/);
  const workspace = read("./PracticeWorkspace.tsx");
  assert.match(workspace, /findProblem\(initialProblem\)/);
  assert.match(workspace, /runAction\(\(\) => select\(problem, nextList\)\)/);
  assert.match(workspace, /initialList as PracticeList/);
});
