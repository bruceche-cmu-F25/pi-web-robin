import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { runTechEventScan } from "./tech-event-scan.ts";

// Classification, the region filter and the merge are tested against
// ./tech-events.ts, and the feed reading against ./tech-event-sources.ts. What
// is left here is what only this module does: running several sources and
// reporting what each of them did.

// runTechEventScan persists through ./store.ts, which resolves its directory
// per call from ROBIN_DATA_DIR. Without this the suite writes into the
// developer's own ~/.pi/robin.
const dataDir = mkdtempSync(join(tmpdir(), "robin-events-test-"));
process.env.ROBIN_DATA_DIR = dataDir;
after(() => rmSync(dataDir, { recursive: true, force: true }));

const source = (id, slug = id) => ({ id, kind: "place", slug, label: `Feed ${id}` });

/** Answers for one slug; every other request throws. */
function stubFeeds(byHost) {
  return async (url) => {
    for (const [needle, respond] of Object.entries(byHost)) {
      if (url.includes(needle)) return respond(url);
    }
    throw new Error(`unexpected request: ${url}`);
  };
}

const page = (apiId) => new Response(
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { initialData: { data: { place: { api_id: apiId, name: `Name ${apiId}` } } } } },
  })}</script>`,
  { status: 200 },
);

const feed = (entries) => new Response(JSON.stringify({ entries, has_more: false }), { status: 200 });

const listing = (id, name) => ({
  event: {
    api_id: id,
    name,
    url: id,
    start_at: "2099-09-01T02:00:00.000Z",
    timezone: "America/Los_Angeles",
    location_type: "offline",
    geo_address_info: { city_state: "San Francisco, CA" },
    coordinate: { latitude: 37.7749, longitude: -122.4194 },
  },
  calendar: { name: "SF AI" },
});

test("one feed being down does not cost you the others", async () => {
  // These endpoints are undocumented, so a Luma redesign is a question of
  // when. One broken feed must not take the page down with it.
  const result = await runTechEventScan({
    persist: false,
    stored: [],
    sources: [source("up"), source("down")],
    fetchImpl: stubFeeds({
      "luma.com/up": () => page("place-up"),
      "luma.com/down": () => { throw new Error("connect ECONNREFUSED"); },
      "place-up": () => feed([listing("evt-1", "Agent Build Night")]),
    }),
  });

  assert.equal(result.sources.length, 2);
  const down = result.sources.find((entry) => entry.id === "down");
  assert.match(down.error, /ECONNREFUSED/);
  assert.equal(down.kept, 0);
  assert.equal(result.sources.find((entry) => entry.id === "up").kept, 1);
  assert.equal(result.events.length, 1);
});

test("a source reports its own name once the feed has told us", async () => {
  const result = await runTechEventScan({
    persist: false,
    stored: [],
    sources: [source("sf")],
    fetchImpl: stubFeeds({
      "luma.com/sf": () => page("place-sf"),
      "place-sf": () => feed([listing("evt-1", "LLM Inference Night")]),
    }),
  });
  assert.equal(result.sources[0].name, "Name place-sf");
});

test("the same event on two feeds is one row", async () => {
  const result = await runTechEventScan({
    persist: false,
    stored: [],
    sources: [source("a"), source("b")],
    fetchImpl: stubFeeds({
      "luma.com/a": () => page("place-a"),
      "luma.com/b": () => page("place-b"),
      "place-a": () => feed([listing("evt-shared", "Agent Build Night")]),
      "place-b": () => feed([listing("evt-shared", "Agent Build Night")]),
    }),
  });

  // Both feeds legitimately saw it, so `kept` counts it twice; the list does
  // not. A city page and the host's own calendar overlap constantly.
  assert.equal(result.kept, 2);
  assert.equal(result.events.length, 1);
  assert.equal(result.added, 1);
});

test("a scan with no sources finishes clean and says so through its source list", async () => {
  // Zero sources finishes in milliseconds and reports 0/0/0, which on screen
  // is indistinguishable from "nothing new this week". An empty `sources`
  // array is what tells them apart.
  const result = await runTechEventScan({
    persist: false,
    stored: [],
    sources: [],
    fetchImpl: async () => { throw new Error("no source should have been fetched"); },
  });
  assert.deepEqual(result.sources, []);
  assert.equal(result.seen, 0);
});

test("a scan persists the merged list and its own state", async () => {
  const { readTechEventScanState, readTechEvents } = await import("./store.ts");
  await runTechEventScan({
    sources: [source("sf")],
    fetchImpl: stubFeeds({
      "luma.com/sf": () => page("place-sf"),
      "place-sf": () => feed([listing("evt-1", "Agent Build Night")]),
    }),
  });

  assert.deepEqual(readTechEvents().map((event) => event.id), ["luma:evt-1"]);
  const state = readTechEventScanState();
  assert.equal(state.added, 1);
  assert.ok(state.finishedAt);
});
