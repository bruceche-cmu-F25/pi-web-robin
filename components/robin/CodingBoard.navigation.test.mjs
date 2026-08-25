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

test("coding escape links use document navigation so Basic Auth can challenge", async () => {
  const header = await read("WorkspaceHeader.tsx");
  assert.match(header, /<a href="\/dashboard"/);
  assert.match(header, /<a href="\/learn"/);
  assert.match(header, /<a\s+href=\{chatHref\}/);

  // Checked across the whole workspace, not just the file that draws them: a
  // client-side RSC fetch fails silently on a Basic Auth 401, so a next/link
  // added anywhere in here would leave the user on a page whose controls all
  // look dead.
  for (const name of WORKSPACE_FILES) {
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

  // The curriculum has two, and the syllabus is one of them rather than a rail
  // beside a frame. Pinned here because the empty frame is what the layout was
  // changed to get rid of: a middle pane creeping back in would bring it too.
  const study = await read("StudyWorkspace.tsx");
  assert.match(study, /usePaneWidths\(false\)/, "the curriculum has no rail to hide");
  assert.doesNotMatch(study, /edge="left"/, "the curriculum has no rail seam");
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
