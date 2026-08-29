import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");

/** Every file that makes up the coding workspace, shell and both tracks. */
const WORKSPACE_FILES = [
  "CodingBoard.tsx",
  "WorkspaceHeader.tsx",
  "PracticeWorkspace.tsx",
  "StudyWorkspace.tsx",
];

test("the workspace gets its way out from the shared bar, not its own links", async () => {
  // Same bar as the dashboard and the hub, mounted by the route's layout.
  const layout = await read("../../app/coding/layout.tsx");
  assert.match(layout, /<RobinShell>\{children\}<\/RobinShell>/);

  // The header keeps the track switch and the per-track controls; the
  // destinations moved to the bar, and a second copy of them here is how the
  // two drift apart.
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

test("every seam a track has is resizable", async () => {
  // The dividers are the only thing holding the pane widths together: a track
  // that forgot one would silently go back to a fixed layout, and the width
  // the user set on the other track would appear to be ignored.
  for (const name of ["PracticeWorkspace.tsx", "StudyWorkspace.tsx"]) {
    const source = await read(name);
    assert.match(source, /<PaneDivider\s+edge="right"[\s\S]*?\{\.\.\.panes\.panel\}/, `${name} panel seam`);
    // The old fixed widths would win over the dragged one if they came back.
    assert.doesNotMatch(source, /width: 360, minWidth: 320/, `${name} must not pin the panel width`);
  }

  // Problems keep three panes: the rail, the editor, the coach.
  const practice = await read("PracticeWorkspace.tsx");
  assert.match(practice, /usePaneWidths\(railOpen\)/, "the practice rail is hideable");
  assert.match(practice, /<PaneDivider\s+edge="left"[\s\S]*?\{\.\.\.panes\.rail\}/, "practice rail seam");
  // On a phone the rail is a pane of a stack and takes a null width, so the
  // assertion is on the branch that still exists for a desktop: given a width,
  // the rail is pinned to it and the divider is what changes it.
  assert.match(
    await read("RoadmapRail.tsx"),
    /: \{ width, minWidth: width, maxWidth: width \}\}/,
    "RoadmapRail.tsx",
  );

  // Curriculum also has three panes now: the fixed path, syllabus, and mentor.
  // The center remains a syllabus rather than the empty resource frame that the
  // previous redesign removed.
  const study = await read("StudyWorkspace.tsx");
  assert.match(study, /usePaneWidths\(true\)/, "the curriculum path stays visible");
  assert.match(study, /<PaneDivider\s+edge="left"[\s\S]*?\{\.\.\.panes\.rail\}/, "curriculum path seam");
  assert.doesNotMatch(study, /<iframe|ResourceFrame/, "the curriculum frames nothing");
});

test("both tracks render the shared chrome rather than their own header", async () => {
  // The track switch is how the curriculum is reachable at all. A workspace
  // that drew its own header would drop it, stranding the user on whichever
  // track happened to load.
  for (const name of ["PracticeWorkspace.tsx", "StudyWorkspace.tsx"]) {
    assert.match(await read(name), /<WorkspaceHeader \{\.\.\.chrome\}>/, `${name} must use WorkspaceHeader`);
  }
});
