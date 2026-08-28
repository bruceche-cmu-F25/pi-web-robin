import assert from "node:assert/strict";
import test from "node:test";
import { makeFetchContext } from "./job-providers.ts";
import { DEFAULT_SOURCES, harvestSource } from "./tech-event-sources.ts";

const SF = { latitude: 37.7749, longitude: -122.4194 };

const entry = (over = {}) => ({
  event: {
    api_id: over.id ?? "evt-1",
    name: over.name ?? "Agent Build Night",
    url: over.slug ?? "build-night",
    start_at: Object.hasOwn(over, "start_at") ? over.start_at : "2026-09-01T02:00:00.000Z",
    end_at: over.end_at ?? "2026-09-01T05:00:00.000Z",
    timezone: "America/Los_Angeles",
    location_type: over.location_type ?? "offline",
    geo_address_info: over.geo === null ? null : { city_state: "San Francisco, CA", short_address: "1 Market St" },
    coordinate: over.coordinate === null ? null : (over.coordinate ?? SF),
  },
  calendar: over.calendar ?? { name: "Vercel Events", description_short: "Ship on the web." },
  guest_count: over.guest_count ?? 120,
  ticket_info: over.ticket_info ?? { is_free: true, is_sold_out: false, require_approval: false },
});

/** A stub Luma: one page of HTML carrying the api_id, then paged JSON feeds. */
function stubLuma({ apiId = "discplace-1", name = "San Francisco", pages = [], kind = "place" } = {}) {
  const calls = [];
  const holder = kind === "place" ? "place" : "calendar";
  const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { initialData: { data: { [holder]: { api_id: apiId, name } } } } },
  })}</script></html>`;

  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith("https://luma.com/")) {
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    const cursor = new URL(url).searchParams.get("pagination_cursor");
    const index = cursor ? Number(cursor) : 0;
    const page = pages[index] ?? { entries: [] };
    return new Response(JSON.stringify(page), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { calls, ctx: makeFetchContext(fetchImpl) };
}

const place = { id: "luma-place-sf", kind: "place", slug: "sf", label: "Luma · San Francisco" };

test("the api_id is read off Luma's own page rather than hard-coded", async () => {
  // A stored id is an implementation detail of a site that redesigns itself,
  // and a stale one fails as an empty feed — the failure a weekly unattended
  // job is least likely to notice.
  const { calls, ctx } = stubLuma({ pages: [{ entries: [entry()] }] });
  const harvest = await harvestSource(place, ctx, "2026-08-27T00:00:00.000Z");

  assert.equal(calls[0], "https://luma.com/sf");
  assert.match(calls[1], /discover_place_api_id=discplace-1/);
  assert.equal(harvest.name, "San Francisco");
  assert.equal(harvest.events.length, 1);
});

test("a harvested row keeps the facts the page renders", async () => {
  const { ctx } = stubLuma({ pages: [{ entries: [entry()] }] });
  const [event] = (await harvestSource(place, ctx, "2026-08-27T00:00:00.000Z")).events;

  assert.equal(event.id, "luma:evt-1");
  assert.equal(event.url, "https://luma.com/build-night");
  assert.equal(event.source, "luma-place-sf");
  assert.equal(event.host, "Vercel Events");
  assert.equal(event.city, "San Francisco, CA");
  assert.equal(event.venue, "1 Market St");
  assert.equal(event.free, true);
  assert.equal(event.guests, 120);
  assert.equal(event.online, false);
  assert.ok(event.topics.includes("ai"));
  assert.equal(event.discoveredAt, "2026-08-27T00:00:00.000Z");
});

test("the cursor is followed, and a repeated page costs nothing", async () => {
  const { ctx } = stubLuma({
    pages: [
      { entries: [entry({ id: "evt-1" })], has_more: true, next_cursor: "1" },
      // Luma can hand the same row back across a cursor boundary.
      { entries: [entry({ id: "evt-1" }), entry({ id: "evt-2", slug: "second" })], has_more: false },
    ],
  });
  const harvest = await harvestSource(place, ctx, "2026-08-27T00:00:00.000Z");

  assert.equal(harvest.seen, 3);
  assert.deepEqual(harvest.events.map((event) => event.id), ["luma:evt-1", "luma:evt-2"]);
});

test("paging stops when the feed says there is no more", async () => {
  const { calls, ctx } = stubLuma({ pages: [{ entries: [entry()], has_more: false, next_cursor: "1" }] });
  await harvestSource(place, ctx, "2026-08-27T00:00:00.000Z");
  assert.equal(calls.filter((url) => url.startsWith("https://api.lu.ma/")).length, 1);
});

test("a city feed still carries events you cannot get to", async () => {
  const { ctx } = stubLuma({
    pages: [{
      entries: [
        entry({ id: "evt-la", coordinate: { latitude: 34.0522, longitude: -118.2437 } }),
        entry({ id: "evt-sf" }),
      ],
    }],
  });
  const harvest = await harvestSource(place, ctx, "2026-08-27T00:00:00.000Z");

  assert.equal(harvest.seen, 2);
  assert.deepEqual(harvest.events.map((event) => event.id), ["luma:evt-sf"]);
});

test("an online event is kept even though it has no address", async () => {
  // The region check would refuse every one of them. Trusting the feed's own
  // scoping is right here: a virtual event on the San Francisco page is a Bay
  // Area community's virtual event.
  const { ctx } = stubLuma({
    pages: [{ entries: [entry({ location_type: "virtual", geo: null, coordinate: null })] }],
  });
  const [event] = (await harvestSource(place, ctx, "2026-08-27T00:00:00.000Z")).events;
  assert.equal(event.online, true);
});

test("the classifier runs on the way out, so `kept` means what it says", async () => {
  const { ctx } = stubLuma({
    pages: [{
      entries: [
        entry({ id: "evt-party", name: "Full Moon Meditation", calendar: { name: "Personal" } }),
        entry({ id: "evt-real" }),
      ],
    }],
  });
  const harvest = await harvestSource(place, ctx, "2026-08-27T00:00:00.000Z");
  assert.equal(harvest.seen, 2);
  assert.equal(harvest.events.length, 1);
});

test("a row Luma cannot date or name is dropped rather than half-rendered", async () => {
  const { ctx } = stubLuma({
    pages: [{
      entries: [
        entry({ id: "evt-undated", start_at: null }),
        { event: { api_id: "evt-nameless", url: "x", start_at: "2026-09-01T02:00:00.000Z" } },
        entry({ id: "evt-ok" }),
      ],
    }],
  });
  const harvest = await harvestSource(place, ctx, "2026-08-27T00:00:00.000Z");
  assert.deepEqual(harvest.events.map((event) => event.id), ["luma:evt-ok"]);
});

test("a calendar source reads the calendar feed, not the city one", async () => {
  const { calls, ctx } = stubLuma({
    kind: "calendar",
    apiId: "cal-9",
    name: "The AI Collective",
    pages: [{ entries: [entry()] }],
  });
  await harvestSource(
    { id: "luma-cal-x", kind: "calendar", slug: "genai-collective", label: "x" },
    ctx,
    "2026-08-27T00:00:00.000Z",
  );
  assert.match(calls[1], /calendar\/get-items\?calendar_api_id=cal-9&period=future/);
});

test("a page that is not the kind we asked for fails by name", async () => {
  const { ctx } = stubLuma({ kind: "calendar", pages: [] });
  await assert.rejects(
    harvestSource(place, ctx, "2026-08-27T00:00:00.000Z"),
    /sf is not a place page/,
  );
});

test("a slug is configuration that reaches a URL, so it is checked first", async () => {
  const { ctx } = stubLuma({});
  await assert.rejects(
    harvestSource({ ...place, slug: "../../etc/passwd" }, ctx, "2026-08-27T00:00:00.000Z"),
    /unusable slug/,
  );
});

test("every default source is a slug the guards would accept", () => {
  for (const source of DEFAULT_SOURCES) {
    assert.match(source.slug, /^[A-Za-z0-9._-]{1,80}$/);
    assert.ok(["place", "calendar"].includes(source.kind));
  }
  assert.equal(new Set(DEFAULT_SOURCES.map((source) => source.id)).size, DEFAULT_SOURCES.length);
});
