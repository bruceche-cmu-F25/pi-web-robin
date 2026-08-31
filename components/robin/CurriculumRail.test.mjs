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

test("the roadmap owns the canvas until the mentor is requested", () => {
  assert.match(workspace, /const \[mentorOpen, setMentorOpen\] = useState\(false\)/);
  assert.match(workspace, /aria-expanded=\{mentorOpen\}/);
  assert.match(workspace, /!isMobile && mentorOpen/);
  assert.match(workspace, /: \{ display: "none" \}/);
  assert.match(workspace, /id="study-mentor-panel"/);
});

test("the path is ordered navigation, not progress", () => {
  assert.match(rail, /curriculumPath\(\)/);
  assert.match(rail, /<ol/);
  assert.match(rail, /aria-current=\{active \? "step"/);
  assert.doesNotMatch(rail, /StudyRecord|StudyStatus|statsFor|recordMap/);
});

test("the overview is an interactive eight-node roadmap", () => {
  assert.match(rail, /coding\.study\.overviewTitle/);
  assert.match(workspace, /const \[showOverview, setShowOverview\] = useState\(true\)/);
  assert.match(workspace, /onOverview=\{chooseOverview\}/);
  assert.match(syllabus, /<CurriculumOverview[\s\S]*?onSelect=\{onModuleChange\}[\s\S]*?onOpen=\{onOpen\}/);
  assert.match(overview, /coding\.study\.roadmapNode\./);
  assert.match(overview, /<ol/);
  assert.match(overview, /<svg/);
  assert.match(overview, /strokeDasharray="2 9"/);
  assert.match(overview, /CHECKPOINT_KEYS/);
  assert.match(overview, /EVENT_COLOR_KEYS\[index % EVENT_COLOR_KEYS\.length\]/);
  assert.match(overview, /onClick=\{\(\) => onSelect/);
});

test("the roadmap keeps every stage link on the same page", () => {
  assert.match(overview, /coding\.study\.roadmapResources/);
  assert.match(overview, /courseModule\.items\.filter/);
  assert.match(overview, /href=\{item\.url\}/);
  assert.match(overview, /onClick=\{\(\) => onOpen\(item\)\}/);
  assert.match(overview, /coding\.study\.minimumMark/);
});

test("the roadmap uses the wide canvas without making prose unreadable", () => {
  assert.match(rail, /background: "var\(--nav-panel-background\)"/);
  assert.match(overview, /maxWidth: "72ch"/);
  assert.match(overview, /minWidth: CANVAS_WIDTH/);
  assert.match(overview, /maxWidth: 1500/);
  assert.match(syllabus, /maxWidth: 1500/);
  assert.match(syllabus, /desktop:grid-cols-\[minmax\(18rem,0\.72fr\)_minmax\(0,1\.55fr\)\]/);
  assert.match(syllabus, /maxWidth: "78ch"/);
  assert.match(syllabus, /textWrap: "balance"/);
});

test("the rail, overview, and middle cards localize curriculum prose", () => {
  assert.match(rail, /localizeCurriculumModule\(rawModule, locale\)/);
  assert.match(overview, /localizeCurriculumModule\(rawModule, locale\)/);
  assert.match(syllabus, /localizeCurriculumModule\(rawModule, locale\)/);
  assert.match(syllabus, /coding\.trackOutcome\./);
});

test("every core unit turns its brief into a progressive learning sequence", () => {
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
  assert.match(syllabus, /coding\.study\.what/);
  assert.match(syllabus, /coding\.study\.applicationRole/);
  assert.match(syllabus, /coding\.study\.jobRelevance/);
  assert.match(syllabus, /coding\.study\.how/);
  assert.match(syllabus, /courseModule\.items\.map/);
  assert.match(syllabus, /<ResourceCard/);
  assert.doesNotMatch(syllabus, /<details/);
  assert.match(syllabus, /minimumResource/);
});

test("choosing a path step replaces the center with that unit", () => {
  assert.match(workspace, /onSelect=\{chooseModule\}/);
  assert.match(workspace, /focusedModuleId=\{activeModuleId\}/);
  assert.match(syllabus, /track\.modules\.find/);
  assert.match(syllabus, /value=\{rawModule\.id\}/);
  assert.match(syllabus, /data-study-module=\{courseModule\.id\}/);
  assert.match(syllabus, /overviewIndex >= 0 \? overviewIndex : stageIndex/);
  assert.match(syllabus, /event-\$\{hue\}-faint/);
  assert.match(syllabus, /scrollTo\(\{ top: 0/);
});
