import assert from "node:assert/strict";
import { test } from "node:test";
import { familyOf, linkSections } from "./link-families.ts";

const link = (group, id = group) => ({ id, title: id, url: `https://example.com/${id}`, group, createdAt: "" });

test("group names are filed by what they are about, in either language", () => {
  assert.equal(familyOf("求职平台"), "jobs");
  assert.equal(familyOf("Job hunt"), "jobs");
  assert.equal(familyOf("岗位清单"), "jobs");
  assert.equal(familyOf("刷题与学习"), "learning");
  assert.equal(familyOf("AI 与机器学习"), "learning");
  assert.equal(familyOf("Reading"), "learning");
  // Research reads as ideas before it reads as study.
  assert.equal(familyOf("灵感与研究"), "ideas");
  assert.equal(familyOf("费用管理"), "money");
  assert.equal(familyOf("NightyNight 项目"), "projects");
  assert.equal(familyOf("日常入口"), "daily");
  assert.equal(familyOf("Bookmarks"), undefined);
});

test("a latin keyword has to be a whole word", () => {
  assert.equal(familyOf("Gmail"), undefined);
  assert.equal(familyOf("Mailing"), undefined);
  assert.equal(familyOf("AI tools"), "learning");
});

test("related groups become one section, in the order they first appear", () => {
  const sections = linkSections([
    link("日常入口"),
    link("学习"),
    link("求职平台"),
    link("Job hunt"),
    link("刷题与学习"),
    link("岗位清单"),
  ]);

  assert.deepEqual(sections.map((section) => [section.family, section.groups.map((g) => g.group)]), [
    [undefined, ["日常入口"]],
    ["learning", ["学习", "刷题与学习"]],
    ["jobs", ["求职平台", "Job hunt", "岗位清单"]],
  ]);
  assert.equal(sections[2].links, 3);
  assert.equal(sections[1].color, "sage");
});

test("a family holding one group is left as a plain group", () => {
  const [section] = linkSections([link("费用管理"), link("费用管理", "b")]);
  assert.equal(section.family, undefined);
  assert.equal(section.color, undefined);
  assert.equal(section.groups.length, 1);
  assert.equal(section.links, 2);
});
