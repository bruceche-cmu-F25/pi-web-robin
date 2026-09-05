import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { dashboardCommandPath } = await jiti.import("./AssistantBar.tsx");
const assistantSource = await readFile(new URL("./AssistantBar.tsx", import.meta.url), "utf8");
const paletteSource = await readFile(new URL("./AssistantPalette.tsx", import.meta.url), "utf8");
const shellSource = await readFile(new URL("./RobinShell.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("../AppShell.tsx", import.meta.url), "utf8");

test("dashboard commands resolve to their workspace routes", () => {
  assert.equal(dashboardCommandPath("daily"), "/dashboard");
  assert.equal(dashboardCommandPath("JOB"), "/dashboard/jobs");
  assert.equal(dashboardCommandPath(" gmail "), "/dashboard/gmail");
  assert.equal(dashboardCommandPath("events"), "/dashboard/events");
  assert.equal(dashboardCommandPath("learn"), "/learn");
  assert.equal(dashboardCommandPath("research"), "/research");
  assert.equal(dashboardCommandPath("product"), "/product");
  assert.equal(dashboardCommandPath("chat"), "/");
  assert.equal(dashboardCommandPath("finish daily report"), null);
  assert.match(assistantSource, /href=\{commandHref\}/);
  assert.match(assistantSource, /router\.push\(commandHref/);
  assert.match(assistantSource, /commandHref \? "robin\.assistant\.open"/);
});

test("Cmd/Ctrl+K opens the assistant palette on chat and Robin pages", () => {
  assert.match(paletteSource, /event\.key\.toLowerCase\(\) !== "k"/);
  assert.match(paletteSource, /!event\.metaKey && !event\.ctrlKey/);
  assert.match(paletteSource, /dialog\.showModal\(\)/);
  assert.match(shellSource, /<AssistantPalette \/>/);
  assert.match(appShellSource, /<AssistantPalette/);
});
