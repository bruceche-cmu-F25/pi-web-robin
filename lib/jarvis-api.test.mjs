import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { JARVIS_OUTREACH_ACTIONS, JARVIS_OUTREACH_API, JARVIS_PREFERENCE_ACTIONS, JARVIS_PREFERENCES_API, JARVIS_RESEARCH_ACTIONS, JARVIS_RESEARCH_API, jarvisActionApi } from "./jarvis-api.ts";

test("every Jarvis command belongs to exactly one narrow adapter", () => {
  const groups = [JARVIS_RESEARCH_ACTIONS, JARVIS_OUTREACH_ACTIONS, JARVIS_PREFERENCE_ACTIONS];
  const actions = groups.flat();
  assert.equal(actions.length, 22);
  assert.equal(new Set(actions).size, actions.length);
  for (const action of JARVIS_RESEARCH_ACTIONS) assert.equal(jarvisActionApi(action), JARVIS_RESEARCH_API);
  for (const action of JARVIS_OUTREACH_ACTIONS) assert.equal(jarvisActionApi(action), JARVIS_OUTREACH_API);
  for (const action of JARVIS_PREFERENCE_ACTIONS) assert.equal(jarvisActionApi(action), JARVIS_PREFERENCES_API);
  assert.throws(() => jarvisActionApi("export-file"), /Unknown Jarvis action/);
});

test("the state route has no command POST and each adapter implements its declared actions", () => {
  const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const state = source("../app/api/robin/jarvis/route.ts");
  assert.doesNotMatch(state, /export const POST/);
  for (const [path, actions] of [["../app/api/robin/jarvis/research/route.ts", JARVIS_RESEARCH_ACTIONS], ["../app/api/robin/jarvis/outreach/route.ts", JARVIS_OUTREACH_ACTIONS], ["../app/api/robin/jarvis/preferences/route.ts", JARVIS_PREFERENCE_ACTIONS]]) {
    const route = source(path);
    for (const action of actions) assert.match(route, new RegExp(`body\\?\\.action (?:===|!==) ["']${action}["']`), `${path} must own ${action}`);
  }
});
