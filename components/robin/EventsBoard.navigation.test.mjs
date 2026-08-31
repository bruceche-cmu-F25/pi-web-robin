import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { enLocale } from "../../lib/i18n/messages/en.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const boardSource = await read("./EventsBoard.tsx");
const marginSource = await read("./RobinMargin.tsx");
const pageSource = await read("../../app/dashboard/events/page.tsx");
const listRoute = await read("../../app/api/robin/tech-events/route.ts");
const scanRoute = await read("../../app/api/robin/tech-events/scan/route.ts");

test("the events page lives under the dashboard shell", () => {
  // /dashboard has a layout that wraps children in <RobinShell>, so the page
  // gets the shared navigation by being here rather than by rendering it.
  assert.match(pageSource, /<EventsBoard \/>/);
  assert.match(marginSource, /path: "\/dashboard\/events"/);
  const main = marginSource.slice(
    marginSource.indexOf("const mainItems"),
    marginSource.indexOf("const utilityItems"),
  );
  assert.match(main, /path: "\/dashboard\/events"/);
});

test("the nav badge counts what you decided to go to", () => {
  // A city feed always has something on, so a count of "upcoming" would sit at
  // a permanent 40 and stop meaning anything.
  assert.match(marginSource, /const savedEvents = eventItems\.filter\(\(event\) => event\.saved\)\.length/);
  assert.match(marginSource, /status: \{ count: savedEvents/);
});

test("the weekly cadence is driven by the read, not by a daemon", () => {
  // There is no cron behind this feature. The GET checks whether the week is
  // up, starts a scan if it is, and answers with what is already stored — so
  // the page is never blocked on the network.
  assert.match(listRoute, /if \(isScanDue\(scan, now\)\) startTechEventScan\(\)/);
  assert.match(listRoute, /events: sortTechEvents\(live\)/);
  assert.match(scanRoute, /const started = startTechEventScan\(\)/);
});

test("every route is behind the shared request guard", () => {
  for (const source of [listRoute, scanRoute]) {
    assert.match(source, /isApiRequestAllowed\(req\)/);
  }
  // A write needs the content-type check too, or a cross-site form post
  // reaches it.
  assert.match(listRoute, /hasJsonContentType\(req\)/);
});

test("the page may only write the two fields the scanner does not own", () => {
  // Everything else is a fact the host published and the scanner refreshes, so
  // an edit here would be reverted by the next scan without saying so.
  assert.match(listRoute, /saved must be true or false/);
  assert.match(listRoute, /hidden must be true or false/);
  assert.doesNotMatch(listRoute, /body\.(title|url|startAt|score)/);
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
