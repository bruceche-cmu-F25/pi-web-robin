import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");

/** Every file that makes up the coding workspace. */
const WORKSPACE_FILES = [
  "CodingBoard.tsx",
  "WorkspaceHeader.tsx",
  "PracticeWorkspace.tsx",
];

test("the workspace gets its way out from the shared bar, not its own links", async () => {
  // Same bar as the dashboard and the hub, mounted by the route's layout.
  const layout = await read("../../app/coding/layout.tsx");
  assert.match(layout, /<RobinShell>\{children\}<\/RobinShell>/);

  // The header keeps the workspace's own controls; the destinations moved to
  // the bar, and a second copy of them here is how the two drift apart.
  const header = await read("WorkspaceHeader.tsx");
  assert.doesNotMatch(header, /<a href="\/dashboard"/);
  assert.doesNotMatch(header, /<a href="\/learn"/);
  assert.doesNotMatch(header, /chatHref/);

  // The bar knows the workspace belongs to the hub, so an open problem still
  // shows you where you are.
  assert.match(await read("RobinMargin.tsx"), /covers: \["\/coding"\]/);

  // Checked across the whole workspace, not just the file that draws them: a
  // client-side RSC fetch fails silently on a Basic Auth 401, so a next/link
  // added anywhere in here would leave the user on a page whose controls all
  // look dead.
  for (const name of [...WORKSPACE_FILES, "RobinMargin.tsx"]) {
    assert.doesNotMatch(await read(name), /from ["']next\/link["']/, `${name} must not use next/link`);
  }
});

test("every seam the workspace has is resizable", async () => {
  // The dividers are the only thing holding the pane widths together: a seam
  // that lost one would silently go back to a fixed layout.
  for (const name of ["PracticeWorkspace.tsx", "FsoWorkspace.tsx"]) {
    const source = await read(name);
    assert.match(source, /<PaneDivider\s+edge="right"[\s\S]*?\{\.\.\.panes\.panel\}/, `${name} panel seam`);
    // The old fixed widths would win over the dragged one if they came back.
    assert.doesNotMatch(source, /width: 360, minWidth: 320/, `${name} must not pin the panel width`);
  }

  // Practice now has a full-width roadmap above a two-pane desk. Only the
  // editor/coach seam remains; hidden panes must keep their documents alive.
  const practice = await read("PracticeWorkspace.tsx");
  assert.match(practice, /usePaneWidths\(false\)/, "the roadmap takes no desk width");
  assert.doesNotMatch(practice, /<RoadmapRail|edge="left"/);
  assert.match(practice, /<PracticeRoadmap/);
  assert.match(practice, /id="practice-desk"/);
  assert.match(practice, /<PracticeRecordBar key=\{selected.link\}/);
  assert.match(practice, /<NeetCodeFrame problem=\{selected\}/);

  // Full Stack Open keeps its contents rail and Mentor around the framed chapter.
  const fso = await read("FsoWorkspace.tsx");
  assert.match(fso, /usePaneWidths\(true\)/);
  assert.match(fso, /<PaneDivider edge="left"[\s\S]*?\{\.\.\.panes\.rail\}/, "contents rail seam");
  assert.match(fso, /<iframe/, "chapters open in the workspace");
});

test("the practice workspace renders the shared header rather than its own", async () => {
  assert.match(await read("PracticeWorkspace.tsx"), /<WorkspaceHeader compact>/);
});
