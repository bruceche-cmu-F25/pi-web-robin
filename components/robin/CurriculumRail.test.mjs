import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");

const rail = await read("CurriculumRail.tsx");
const overview = await read("CurriculumOverview.tsx");
const workspace = await read("StudyWorkspace.tsx");
const syllabus = await read("SyllabusBoard.tsx");

test("the curriculum path is a real side pane on desktop and mobile", () => {
  assert.match(workspace, /<CurriculumRail/);
  assert.match(workspace, /pane === "path"/);
  assert.match(workspace, /usePaneWidths\(true\)/);
  assert.match(workspace, /edge="left"/);
});

test("the path is ordered navigation, not progress", () => {
  assert.match(rail, /curriculumPath\(\)/);
  assert.match(rail, /<ol/);
  assert.match(rail, /aria-current=\{active \? "step"/);
  assert.doesNotMatch(rail, /StudyRecord|StudyStatus|statsFor|recordMap/);
});

test("the overview is the front page of the eight-unit path", () => {
  assert.match(rail, /coding\.study\.overviewTitle/);
  assert.match(workspace, /const \[showOverview, setShowOverview\] = useState\(true\)/);
  assert.match(workspace, /onOverview=\{chooseOverview\}/);
  assert.match(syllabus, /<CurriculumOverview onSelect=\{onModuleChange\}/);
  assert.match(overview, /coding\.study\.overviewStage\./);
});

test("the overview and units use a single readable card column", () => {
  assert.match(rail, /background: "var\(--nav-panel-background\)"/);
  assert.match(overview, /className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-4"/);
  assert.match(syllabus, /className="pi-panel flex flex-col p-5"/);
  assert.match(syllabus, /className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4"/);
  assert.doesNotMatch(`${overview}\n${syllabus}`, /gridTemplateColumns/);
});

test("the rail, overview, and middle cards localize curriculum prose", () => {
  assert.match(rail, /localizeCurriculumModule\(rawModule, locale\)/);
  assert.match(overview, /localizeCurriculumModule\(rawModule, locale\)/);
  assert.match(syllabus, /localizeCurriculumModule\(rawModule, locale\)/);
  assert.match(syllabus, /coding\.trackOutcome\./);
});

test("every core unit renders the fixed learning brief before its resources", () => {
  for (const field of [
    "plainLanguage",
    "prerequisites",
    "applicationRole",
    "jobRelevance",
    "minimumResource",
    "smallExercise",
    "exitCriteria",
  ]) {
    assert.match(syllabus, new RegExp(`coding\\.study\\.${field}`), field);
  }
  assert.match(syllabus, /coding\.study\.objective/);
  assert.match(syllabus, /coding\.study\.resources/);
});

test("choosing a path step reveals its unit without replacing the track", () => {
  assert.match(workspace, /onSelect=\{chooseModule\}/);
  assert.match(workspace, /focusedModuleId=\{activeModuleId\}/);
  assert.match(syllabus, /track\.modules\.map\(\(rawModule\) =>/);
  assert.match(syllabus, /data-study-module=\{courseModule\.id\}/);
  assert.match(syllabus, /scrollIntoView\(\{ block: "start" \}\)/);
});
