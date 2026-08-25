import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hookSource = await readFile(new URL("./useWorkspaceShortcuts.ts", import.meta.url), "utf8");
const shellSource = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
const dashboardPageSource = await readFile(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");

test("Cmd+D opens Daily and Cmd+R opens Chat", () => {
  assert.match(hookSource, /!event\.metaKey/);
  assert.match(hookSource, /key === "d" \? "\/dashboard" : "\/"/);
  assert.match(hookSource, /event\.preventDefault\(\)/);
});

test("workspace shortcuts preserve the active chat target on both surfaces", () => {
  assert.match(shellSource, /useWorkspaceShortcuts\(\{[\s\S]*sessionId: selectedSession\?\.id[\s\S]*cwd: selectedSession\?\.cwd/);
  assert.match(dashboardPageSource, /<WorkspaceShortcutListener \/>/);
  assert.match(hookSource, /\?session=.*encodeURIComponent\(sessionId\)/);
  assert.match(hookSource, /\?cwd=.*encodeURIComponent\(cwd\)/);
});
