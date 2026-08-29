import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  CURRICULUM,
  CURRICULUM_OVERVIEW,
  CURRICULUM_PATH,
  ITEM_KINDS,
  LEARNING_SHELF,
} from "./curriculum.ts";
import { allItems, curriculumOverview, curriculumPath, findItem, learningShelf } from "./study.ts";
import { hasZhCNModuleCopy, localizeCurriculumModule } from "./curriculum-locales.ts";

const items = allItems();

test("every curriculum id is unique", () => {
  // Records are filed under these. A duplicate would silently merge two
  // resources' history into one, and the syllabus would mark both at once.
  const ids = items.map((item) => item.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);

  const moduleIds = CURRICULUM.flatMap((track) => track.modules.map((module) => module.id));
  assert.equal(new Set(moduleIds).size, moduleIds.length);
  const trackIds = CURRICULUM.map((track) => track.id);
  assert.equal(new Set(trackIds).size, trackIds.length);
});

test("everything that is not a milestone has somewhere to go", () => {
  for (const item of items) {
    assert.ok(ITEM_KINDS.includes(item.kind), `${item.id} has an unknown kind`);
    if (item.kind === "milestone") {
      assert.equal(item.url, undefined, `${item.id} is a milestone and must not have a URL`);
      assert.ok(item.hint, `${item.id} must say what to build`);
    } else {
      assert.match(item.url ?? "", /^https:\/\//, `${item.id} needs an https URL`);
    }
  }
});

/**
 * Nothing is framed any more — the workspace hands every resource to a real
 * tab — so a URL here has one job: be the page a human should land on. A
 * player or embed URL would be a worse version of the same site, without its
 * description, comments, or playlist.
 */
test("every URL is the page a person should land on, not an embed of it", () => {
  for (const item of items) {
    if (!item.url) continue;
    assert.doesNotMatch(item.url, /youtube-nocookie\.com|\/embed\//, `${item.id} points at a player`);
  }
});

test("every module states an outcome and ends in something built", () => {
  for (const track of CURRICULUM) {
    assert.ok(track.outcome.length > 40, `${track.id} needs a real outcome`);
    for (const courseModule of track.modules) {
      assert.ok(courseModule.outcome.length > 40, `${courseModule.id} needs a real outcome`);
      assert.ok(courseModule.items.length > 0, `${courseModule.id} is empty`);
    }
  }

  // Not every module: the reference shelves (galleries, repos to read) are
  // there to be dipped into. But a track that never asks for anything to be
  // built is a reading list wearing a roadmap's clothes — nothing counts these,
  // they are there to say what the module is for.
  for (const track of CURRICULUM) {
    const milestones = track.modules.flatMap((module) =>
      module.items.filter((item) => item.kind === "milestone"));
    assert.ok(milestones.length > 0, `${track.id} has nothing to build`);
  }
});

test("the detailed path stays intact and every unit explains how to use it", () => {
  const resolved = curriculumPath();
  const expected = [
    "js-core",
    "web-fundamentals",
    "frontend-libraries",
    "backend-apis",
    "testing-auth",
    "state-engineering",
    "typescript",
    "relational-data",
    "production",
    "security-scale",
    "project-sources",
    "architecture-in-the-small",
    "distributed-fundamentals",
    "designing-a-system",
    "reading-architectures",
  ];

  assert.equal(resolved.length, CURRICULUM_PATH.length);
  assert.deepEqual(resolved.map(({ module }) => module.id), expected);
  assert.equal(new Set(CURRICULUM_PATH.map(({ moduleId }) => moduleId)).size, CURRICULUM_PATH.length);

  for (const { module } of resolved) {
    assert.ok(module.guide, `${module.id} needs a unit introduction`);
    for (const field of [
      "plainLanguage",
      "prerequisites",
      "applicationRole",
      "jobRelevance",
      "smallExercise",
      "exitCriteria",
    ]) {
      assert.ok(module.guide[field].length > 40, `${module.id}.${field} needs a real explanation`);
    }
    assert.ok(
      module.items.some((item) => item.id === module.guide.minimumItemId && item.kind !== "milestone"),
      `${module.id} minimum resource must be a real resource in the unit`,
    );
  }
});

test("the overview adds eight system questions without replacing the detailed path", () => {
  const resolved = curriculumOverview();

  assert.equal(resolved.length, 8);
  assert.equal(resolved.length, CURRICULUM_OVERVIEW.length);
  assert.deepEqual(
    resolved.map(({ id }) => id),
    ["browser-runtime", "page-state", "http", "server", "data", "auth", "production", "architecture"],
  );
  assert.ok(CURRICULUM_PATH.length > CURRICULUM_OVERVIEW.length);
});

test("every detailed unit has Simplified Chinese teaching copy", () => {
  for (const { module } of curriculumPath()) {
    assert.equal(hasZhCNModuleCopy(module.id), true, module.id);
    const localized = localizeCurriculumModule(module, "zh-CN");
    assert.notEqual(localized.title, module.title, `${module.id}.title`);
    assert.notEqual(localized.outcome, module.outcome, `${module.id}.outcome`);
    assert.notEqual(localized.guide.plainLanguage, module.guide.plainLanguage, `${module.id}.guide`);
    assert.deepEqual(
      localized.items.map(({ id, title, url }) => ({ id, title, url })),
      module.items.map(({ id, title, url }) => ({ id, title, url })),
      `${module.id} must keep official resources`,
    );
    for (let index = 0; index < module.items.length; index += 1) {
      if (module.items[index].hint) {
        assert.notEqual(localized.items[index].hint, module.items[index].hint, `${module.items[index].id}.hint`);
      }
    }

    const traditional = localizeCurriculumModule(module, "zh-TW");
    assert.notEqual(traditional.title, module.title, `${module.id}.zh-TW.title`);
    assert.notEqual(traditional.guide.plainLanguage, module.guide.plainLanguage, `${module.id}.zh-TW.guide`);
  }
});

test("architecture is covered, not implied", () => {
  // The reason this track exists. Pinned because it is the part most easily
  // hollowed out by tidying: drop the two hard books and it quietly becomes a
  // links page again.
  const architecture = CURRICULUM.find((track) => track.id === "architecture");
  assert.ok(architecture);
  const ids = architecture.modules.flatMap((module) => module.items.map((item) => item.id));
  for (const required of ["cosmic-python", "ddia", "system-design-primer"]) {
    assert.ok(ids.includes(required), `${required} must stay in the architecture track`);
  }
});

test("items resolve by id and by title", () => {
  const byId = findItem("ddia");
  assert.equal(byId?.item.title, "Designing Data-Intensive Applications");
  assert.equal(byId?.module.id, "distributed-fundamentals");
  assert.equal(byId?.track.id, "architecture");

  // The mentor is handed titles by the user, not ids.
  assert.equal(findItem("FastAPI Tutorial")?.item.id, "fastapi-tutorial");
  assert.equal(findItem("  ddia  ")?.item.id, "ddia");
  assert.equal(findItem("nothing here"), null);
});

/**
 * The curriculum side keeps no records at all, and this is the file that would
 * notice the first one arriving: a status, a count, or a "done" flag on an
 * item is how a roadmap turns back into a tracker.
 */
test("the curriculum module offers nothing that could score anyone", async () => {
  const source = await readFile(new URL("./study.ts", import.meta.url), "utf8");

  for (const banned of ["StudyRecord", "StudyStatus", "statsFor", "suggestNextItem", "recordMap"]) {
    assert.doesNotMatch(source, new RegExp(`\\b${banned}\\b`), `${banned} is back`);
  }
  for (const item of items) {
    assert.deepEqual(
      Object.keys(item).filter((key) => ["status", "done", "progress"].includes(key)),
      [],
      `${item.id} carries progress`,
    );
  }
});

test("every shelf entry names a real resource", () => {
  // The shelf holds ids, not URLs — that is what keeps it from drifting away
  // from the syllabus. The price is that a renamed id breaks it silently, so
  // it gets checked here rather than discovered as a missing row on the page.
  const known = new Map(allItems().map((item) => [item.id, item]));
  for (const group of LEARNING_SHELF) {
    assert.ok(group.links.length > 0, `${group.id} is empty`);
    for (const link of group.links) {
      const item = known.get(link.id);
      assert.ok(item, `${group.id} names "${link.id}", which is not in the curriculum`);
      assert.ok(item.url, `${group.id} names "${link.id}", which has no URL`);
      if (link.url) assert.match(link.url, /^https:\/\//, `${link.id} override`);
    }
  }
});

test("the shelf keeps the groups the reading list was collected in", () => {
  // Pinned because the tidying instinct is to fold these into the curriculum's
  // own tracks, which would lose the one thing the shelf is for: finding a
  // link again by remembering where you filed it, not what it teaches.
  assert.deepEqual(
    LEARNING_SHELF.map((group) => group.id),
    ["entry", "freecodecamp", "fullstack", "python", "architecture", "projects", "design", "gym"],
  );
});

test("the shelf carries every resource the curriculum can open", () => {
  // A resource in the syllabus but not on the shelf is one the user can only
  // reach by walking the syllabus to it. Milestones are excluded on purpose: they
  // are work, not links, and there is nowhere to send a browser.
  const shelved = new Set(LEARNING_SHELF.flatMap((group) => group.links.map((link) => link.id)));
  const missing = allItems()
    .filter((item) => item.kind !== "milestone" && !shelved.has(item.id))
    .map((item) => item.id);

  assert.deepEqual(missing, []);
});

test("a shelf entry can point at a section of a resource it already lists", () => {
  const gym = learningShelf().find((group) => group.id === "gym");
  const anchored = gym.entries.find((entry) => entry.item.id === "project-based-learning");

  assert.equal(anchored.url, "https://github.com/practical-tutorials/project-based-learning#python");
  // …without the whole-resource entry elsewhere losing its own address.
  const projects = learningShelf().find((group) => group.id === "projects");
  assert.equal(
    projects.entries.find((entry) => entry.item.id === "project-based-learning").url,
    "https://github.com/practical-tutorials/project-based-learning",
  );
});

test("the shelf headings are translated in every locale", async () => {
  // A missing key renders as the key itself, which looks like a bug and reads
  // like one. Cheap to check, and the shelf is where new headings appear.
  const locales = await Promise.all(["en", "zh-CN"].map(async (locale) => [
    locale,
    await readFile(new URL(`../../lib/i18n/messages/${locale}.ts`, import.meta.url), "utf8"),
  ]));
  for (const [locale, messages] of locales) {
    assert.match(messages, /"learn\.shelf\.title"/, locale);
    for (const group of LEARNING_SHELF) {
      assert.match(messages, new RegExp(`"learn\\.shelf\\.${group.id}"`), `${locale} · ${group.id}`);
    }
  }
});
