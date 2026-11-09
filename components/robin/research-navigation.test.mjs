import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import { researchHref, researchView } from "./research-client.ts";

const read = name => readFile(new URL(name, import.meta.url), "utf8");

test("research URLs preserve explicit view and paper/conversation scope", () => {
  const href = researchHref("project / 中文", "paper-1", "thread-2", "papers");
  const params = new URL(href, "https://test.invalid").searchParams;
  assert.equal(params.get("project"), "project / 中文");
  assert.equal(params.get("paper"), "paper-1");
  assert.equal(params.get("conversation"), "thread-2");
  assert.equal(researchView(params), "papers");
  assert.equal(researchHref("general"), "/research");
  for (const [search, expected] of [["", "overview"], ["view=bad", "overview"], ["conversation=old", "assistant"], ["view=overview&conversation=old", "overview"]]) {
    assert.equal(researchView(new URLSearchParams(search)), expected);
  }
});

test("retired reference pages, capability map and standalone prototypes are no longer served", async () => {
  const paths = [
    ...["heat", "brief", "report", "code", "run", "urrag"].map(name => `app/research/${name}/page.tsx`),
    "app/learn/map/page.tsx", "app/dashboard/kanban/page.tsx", "app/api/robin/kanban/route.ts",
    "public/design/rounded-surfaces.html",
    "public/prototypes/global-sidebar.html", "public/prototypes/learning-atlas.html",
  ];
  for (const path of paths) await assert.rejects(access(new URL(`../../${path}`, import.meta.url)), { code: "ENOENT" });
  for (const name of ["ResearchWorkspace", "ResearchHome", "ResearchDesk", "LearningHub", "LearningCourse", "LearningRoadmap"]) {
    const source = await read(`./${name}.tsx`);
    assert.doesNotMatch(source, /\/learn\/map|\/research\/(heat|brief|report|code|run|urrag)|ResearchReferenceLink|ReferenceReadings/);
  }
});

test("research resources use the live project links and share one rail across all views", async () => {
  const resources = await read("./ResearchDesk.tsx");
  assert.match(resources, /project\.links\.map/);
  assert.match(resources, /<WorkspaceRail/);
  assert.match(resources, /<ReadingQueue/);
  for (const name of ["ResearchWorkspace", "ResearchHome"]) {
    const source = await read(`./${name}.tsx`);
    assert.equal((source.match(/<ResearchResources\b/g) ?? []).length, 1);
    assert.match(source, /hidden=\{view !== "assistant"\}/);
  }
});

test("global navigation owns tools and CRM without retired Kanban entries", async () => {
  const margin = await read("./RobinMargin.tsx");
  assert.match(margin, /covers: \["\/recordings", "\/tools"\]/);
  assert.doesNotMatch(margin, /kanban/i);
  assert.doesNotMatch(await read("./DashboardDirectory.tsx"), /kanban/i);
  assert.match(margin, /icon: ProductIcon,[\s\S]*?covers: \["\/outreach"\]/);
  const toolbox = await read("./ToolboxWorkspace.tsx");
  assert.doesNotMatch(toolbox, /dashboard-tools/);
  assert.match(toolbox, /href="\/dashboard"/);
});
