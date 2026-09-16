import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const tabBarSource = await readFile(new URL("./TabBar.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("uses a compact tab picker on mobile", () => {
  assert.match(appShellSource, /<TabBar[\s\S]*?mobile=\{isMobile\}/);
  assert.match(tabBarSource, /if \(mobile\)[\s\S]*?aria-expanded=\{mobileListOpen\}[\s\S]*?aria-controls=\{mobileListId\}/);
  assert.match(tabBarSource, /position: "absolute", top: 44, left: 0/);
});

test("keeps mobile tab actions touch sized and keyboard dismissible", () => {
  assert.match(tabBarSource, /if \(event\.key !== "Escape"\) return;[\s\S]*?mobileTriggerRef\.current\?\.focus\(\)/);
  assert.match(tabBarSource, /width: 44, minWidth: 44, height: 44/);
  assert.match(appShellSource, /isMobile \? 44 : TOP_BAR_ICON_BUTTON_SIZE/);
});
