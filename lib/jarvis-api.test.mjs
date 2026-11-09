import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { hookHarness } from "../scripts/react-hook-harness.mjs";
import { jsonResponse } from "./json-response.ts";
import { JARVIS_OUTREACH_ACTIONS, JARVIS_OUTREACH_API, JARVIS_PREFERENCE_ACTIONS, JARVIS_PREFERENCES_API, JARVIS_RESEARCH_ACTIONS, JARVIS_RESEARCH_API, jarvisActionApi } from "./jarvis-api.ts";

test("CRM GET negotiates gzip without changing readback or touching outreach", async () => {
  const modes = [];
  const state = { leads: [{ id: "fixture", notes: "完整证据与草稿 ".repeat(500) }], outbox: { paused: true } };
  const { exports } = hookHarness(new URL("../app/api/robin/jarvis/route.ts", import.meta.url), {
    "next/server": { NextResponse: Response },
    "@/lib/api-route": { apiRoute: handler => handler },
    "@/lib/json-response": { jsonResponse },
    "@/extension/robin/jarvis-domain": { DEFAULT_JARVIS_FOLLOW_UP: "follow up", updateJarvisLead: () => assert.fail("read must not edit a contact") },
    "@/lib/jarvis-discovery": { readJarvisView: options => { modes.push(options); return state; } },
    "@/lib/jarvis-outbox": { startJarvisOutbox() {} },
    "@/lib/jarvis-daily": { startJarvisDaily() {} },
  }, { URL });
  const expected = { ...state, followUpTemplate: "follow up" };
  for (const encoding of ["identity", "gzip", "gzip;q=0"]) {
    const response = await exports.GET(new Request("http://localhost/api/robin/jarvis", { headers: { "Accept-Encoding": encoding } }));
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.match(response.headers.get("Vary"), /Accept-Encoding/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.headers.get("Content-Encoding"), encoding === "gzip" ? "gzip" : null);
    const decoded = encoding === "gzip" ? gunzipSync(bytes) : bytes;
    assert.deepEqual(JSON.parse(decoded), expected);
    if (encoding === "gzip") assert.ok(bytes.length < decoded.length / 2);
  }
  const compact = await exports.GET(new Request("http://localhost/api/robin/jarvis?view=compact"));
  await compact.arrayBuffer();
  assert.deepEqual(modes.map(mode => mode.deferTemplates), [false, false, false, true]);
  assert.equal(state.followUpTemplate, undefined, "defaults do not mutate stored state");
});

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
