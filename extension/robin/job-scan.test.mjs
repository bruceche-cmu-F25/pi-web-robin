import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { DEFAULT_JOB_PROFILE } from "./jobs.ts";
import { runJobScan } from "./job-scan.ts";

// Admission, dedupe, retention and persistence are shared with the directory
// sweep and are tested once, against ./job-intake.ts. What is left here is
// what only this module does: turning a profile into sources, and reporting
// what each of them did.

// runJobScan persists through ./store.ts, which resolves its directory per
// call from ROBIN_DATA_DIR. Without this the suite writes into the developer's
// own ~/.pi/robin — clobbering their scan state and pruning their job list
// every time they run `npm test`.
const dataDir = mkdtempSync(join(tmpdir(), "robin-jobs-test-"));
process.env.ROBIN_DATA_DIR = dataDir;
after(() => rmSync(dataDir, { recursive: true, force: true }));

const profile = (over = {}) => ({ ...DEFAULT_JOB_PROFILE, ...over });

test("a profile with no sources scans nothing and says so through its source list", async () => {
  // The failure mode this guards: zero sources finishes in milliseconds and
  // reports 0/0/0, which on screen is indistinguishable from "nothing new
  // today". An empty `sources` array is what lets the UI tell them apart.
  const result = await runJobScan({
    profile: profile({ companies: [], boards: [] }),
    fetchImpl: async () => { throw new Error("no source should have been fetched"); },
  });
  assert.deepEqual(result.sources, []);
  assert.equal(result.scanned, 0);
});

test("a company on a board nobody recognises fails alone, by name", async () => {
  const result = await runJobScan({
    profile: profile({
      companies: [{ id: "c1", name: "Acme", url: "https://careers.acme.example", enabled: true }],
      boards: [],
    }),
    fetchImpl: async () => { throw new Error("no request should have been made"); },
  });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].name, "Acme");
  assert.match(result.sources[0].error, /No provider recognises/);
  assert.equal(result.scanned, 0);
});

test("one board being down does not cost you the others", async () => {
  const result = await runJobScan({
    profile: profile({
      companies: [
        { id: "up", name: "Up", url: "https://job-boards.greenhouse.io/up", enabled: true },
        { id: "down", name: "Down", url: "https://job-boards.greenhouse.io/down", enabled: true },
        // Disabled companies are not sources at all, not failed ones.
        { id: "off", name: "Off", url: "https://job-boards.greenhouse.io/off", enabled: false },
      ],
      boards: [],
      titles: [],
      sinceDays: 0,
    }),
    fetchImpl: async (url) => {
      if (String(url).includes("/down/")) return { ok: false, status: 503, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ jobs: [{ id: 7, title: "AI Engineer", absolute_url: "https://x/7", location: { name: "Remote" } }] }),
      };
    },
  });

  const byName = Object.fromEntries(result.sources.map((source) => [source.name, source]));
  assert.equal(Object.keys(byName).length, 2, "a disabled company is not a source");
  assert.equal(byName.Up.count, 1);
  assert.equal(byName.Down.count, 0);
  assert.match(byName.Down.error, /503/);
  assert.equal(result.scanned, 1);
});

test("the shipped defaults come with sources, so the first scan is not a no-op", () => {
  assert.ok(DEFAULT_JOB_PROFILE.boards.length > 0);
});

test("the big employers are read once a week, not on every scan", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ jobs: [], hits: 0 }), { headers: { "Content-Type": "application/json" } });
  };
  const weeklyProfile = profile({
    companies: [
      { id: "amazon", name: "Amazon", url: "https://www.amazon.jobs/en/search", enabled: true },
      { id: "up", name: "Up", url: "https://job-boards.greenhouse.io/up", enabled: true },
    ],
    boards: [],
  });
  const day = 86_400_000;
  // Later than any scan the tests above ran with the real clock.
  const start = Date.now() + 30 * day;
  const scan = async (at) => {
    urls.length = 0;
    const result = await runJobScan({ profile: weeklyProfile, fetchImpl, now: at });
    return { names: result.sources.map((source) => source.name), amazon: urls.some((url) => url.includes("amazon.jobs")) };
  };

  assert.deepEqual(await scan(start), { names: ["Amazon", "Up"], amazon: true });
  assert.deepEqual(await scan(start + day), { names: ["Up"], amazon: false });
  assert.deepEqual(await scan(start + 6 * day), { names: ["Up"], amazon: false });
  // The same hour a week later, give or take the scheduler's drift.
  assert.deepEqual(await scan(start + 7 * day - 3_600_000), { names: ["Amazon", "Up"], amazon: true });
});
