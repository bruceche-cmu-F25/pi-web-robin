import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { enLocale } from "../../lib/i18n/messages/en.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const boardSource = await read("./EventsBoard.tsx");
const marginSource = await read("./RobinMargin.tsx");
const workspaceSource = await read("./JobHuntWorkspace.tsx");
const layoutSource = await read("../../app/dashboard/layout.tsx");
const pageSource = await read("../../app/dashboard/events/page.tsx");
const listRoute = await read("../../app/api/robin/tech-events/route.ts");
const scanRoute = await read("../../app/api/robin/tech-events/scan/route.ts");
const domain = await read("../../extension/robin/tech-event-domain.ts");
const detailSource = await read("./EventDetail.tsx");

test("the events page lives under the dashboard shell", () => {
  // /dashboard has a layout that wraps children in <RobinShell>, so the page
  // gets the shared navigation by being here rather than by rendering it.
  assert.match(pageSource, /<EventsBoard \/>/);
  assert.match(layoutSource, /<JobHuntWorkspace>\{children\}<\/JobHuntWorkspace>/);
  assert.match(workspaceSource, /const EVENTS = "\/dashboard\/events"/);
  assert.match(workspaceSource, /\[EVENTS, t\("robin\.nav\.events"\)\]/);
  assert.match(workspaceSource, /<Link key=\{path\} href=\{href\(path\)\}/);
  const main = marginSource.slice(
    marginSource.indexOf("const mainItems"),
    marginSource.indexOf("const utilityItems"),
  );
  assert.match(main, /path: "\/dashboard\/jobs"[\s\S]*?covers: \["\/dashboard\/events"\]/);
  assert.doesNotMatch(main, /path: "\/dashboard\/events"/);
});

test("events contribute a discovery dot, not an actionable job count", () => {
  // The shared Job hunt badge counts jobs/OAs; a city feed must not inflate it.
  assert.match(marginSource, /const upcomingEvents = \(techEvents\?\.events \?\? \[\]\)\.some\(\(event\) => !event\.hidden\)/);
  assert.match(marginSource, /status: \{ count: jobsActions \+ roundActions, hasNew: \(jobsNew \|\| upcomingEvents\) && !inJobHunt \}/);
});

test("the weekly cadence is driven by the read, not by a daemon", () => {
  // There is no cron behind this feature. The read checks whether the week is
  // up, starts a scan if it is, and answers with what is already stored — so
  // the page is never blocked on the network. The rule lives in the domain
  // module; tech-event-domain.test.mjs exercises it through techEventBoard().
  assert.match(domain, /if \(options\.autoScan !== false && isScanDue\(scan, now\)\) startTechEventScan\(\)/);
  assert.match(domain, /events: sortTechEvents\(live\)/);
  assert.match(listRoute, /techEventBoard\(\)/);
  assert.match(scanRoute, /const started = startTechEventScan\(\)/);
});

test("every route is behind the shared request guard", () => {
  // The origin check and the content-type check both live in `apiRoute`
  // (lib/api-route.ts), which is what a route is wrapped in rather than what
  // it calls. lib/api-route.test.mjs pins the policy itself; this only pins
  // that these two routes are behind it.
  assert.match(listRoute, /apiRoute\(/);
  assert.match(scanRoute, /isApiRequestAllowed\(req\)|apiRoute\(|guardApiRequest\(/);
});

test("the page may only write the two fields the scanner does not own", () => {
  // Everything else is a fact the host published and the scanner refreshes, so
  // an edit here would be reverted by the next scan without saying so.
  assert.match(listRoute, /saved must be true or false/);
  assert.match(listRoute, /hidden must be true or false/);
  assert.doesNotMatch(listRoute, /body\.(title|url|startAt|score)/);
  // The domain enforces the same thing rather than trusting the route to.
  assert.match(domain, /const \{ saved, hidden, \.\.\.rest \} = events\[index\]!/);
});

test("third-party event links open with noreferrer", () => {
  assert.match(boardSource, /rel="noopener noreferrer"/);
});

test("recommendations are scored against the merged local and Google schedule", () => {
  assert.match(boardSource, /usePolledResource<ScheduleResponse>\("\/api\/robin\/events"/);
  assert.match(boardSource, /rateTechEventForFullStackAi\(event, schedule\)/);
  assert.match(boardSource, /event\.rating\.conflicts\.length <= 1/);
  assert.match(boardSource, /conflictCount/);
});

test("every label the board asks for exists in the locale packs", () => {
  const keys = [...boardSource.matchAll(/\bt\("([a-zA-Z0-9._]+)"/g)].map((match) => match[1]);
  assert.ok(keys.length > 10);
  for (const key of keys) {
    assert.ok(enLocale.messages[key], `missing message: ${key}`);
  }
  // The two template keys are built from a union rather than written out.
  for (const topic of ["all", "ai", "swe", "data", "hardware", "startup"]) {
    assert.ok(enLocale.messages[`robin.events.topic.${topic}`], `missing topic label: ${topic}`);
  }
  for (const signal of ["fullstack-ai", "hands-on", "accessible", "popular", "approval", "sold-out", "schedule-conflict"]) {
    assert.ok(enLocale.messages[`robin.events.signal.${signal}`], `missing signal label: ${signal}`);
  }
  assert.ok(enLocale.messages["robin.nav.events"]);
});

test("an event's introduction is rendered from the parsed tree, never as HTML", () => {
  // Hosts write the description; extension/robin/tech-event-detail.ts reduces
  // it to text, bold, italic and http(s) links, and the page builds elements.
  assert.doesNotMatch(detailSource, /dangerouslySetInnerHTML/);
  for (const match of detailSource.matchAll(/target="_blank"[^>]*/g)) {
    assert.match(match[0], /rel="noopener noreferrer"/);
  }
  const keys = [...detailSource.matchAll(/\bt\("([a-zA-Z0-9._]+)"/g)].map((m) => m[1]);
  for (const key of keys) assert.ok(enLocale.messages[key], `missing message: ${key}`);
});
