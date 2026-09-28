import assert from "node:assert/strict";
import test from "node:test";
import { isDetailFresh, mirrorToBlocks, parseLumaEventPage } from "./tech-event-detail.ts";

const page = (data) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: { pageProps: { initialData: { data } } },
})}</script></html>`;

const doc = (...content) => ({ type: "doc", content });
const p = (...content) => ({ type: "paragraph", content });
const text = (value, marks) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });

test("descriptions keep bold, italic and http links, and nothing else", () => {
  const blocks = mirrorToBlocks(doc(
    p(text("Hosted by "), text("LatchBio", [{ type: "bold" }]), text(" — "), text("rsvp", [{ type: "link", attrs: { href: "https://example.com/x" } }])),
    p(text("bad", [{ type: "link", attrs: { href: "javascript:alert(1)" } }])),
    { type: "bullet_list", content: [{ type: "list_item", content: [p(text("one"))] }, { type: "list_item", content: [p(text("two"))] }] },
    p(),
    { type: "heading", attrs: { level: 1 }, content: [text("Agenda")] },
  ));
  assert.deepEqual(blocks[0], { kind: "p", inlines: [
    { text: "Hosted by " }, { text: "LatchBio", bold: true }, { text: " — " }, { text: "rsvp", href: "https://example.com/x" },
  ] });
  assert.deepEqual(blocks[1], { kind: "p", inlines: [{ text: "bad" }] }, "a javascript: link loses its href");
  assert.equal(blocks[2].kind, "ul");
  assert.equal(blocks[2].items.length, 2);
  assert.equal(blocks.length, 4, "empty paragraphs are dropped");
  assert.equal(blocks[3].kind, "h");
});

test("an unknown node keeps its text rather than vanishing", () => {
  const blocks = mirrorToBlocks(doc({ type: "callout", content: [text("Bring a laptop")] }));
  assert.deepEqual(blocks, [{ kind: "p", inlines: [{ text: "Bring a laptop" }] }]);
});

test("a page parses into hosts, guests, address and a safe calendar link", () => {
  const detail = parseLumaEventPage(page({
    event: {
      geo_address_info: { full_address: "185 Berry St, San Francisco, CA 94107", sublocality: "Mission Bay", place_coordinate: { latitude: 37.77, longitude: -122.39 } },
    },
    calendar: { name: "SF Systems Club", slug: "sf-systems", avatar_url: "https://images.lumacdn.com/c.png", description_short: "Systems people." },
    hosts: [{ name: "Ada", twitter_handle: "ada", linkedin_handle: "/in/ada", website: "https://ada.dev", avatar_url: "https://evil.example/a.png" }],
    featured_guests: [{ first_name: "Grace", last_name: "H", avatar_url: "https://images.lumacdn.com/g.jpg" }],
    guest_count: 360,
    ticket_info: { spots_remaining: 0, is_near_capacity: true },
    description_mirror: doc(p(text("Hello"))),
  }), "luma:evt-1", "2026-09-24T00:00:00.000Z");

  assert.equal(detail.calendar.url, "https://luma.com/sf-systems");
  assert.equal(detail.neighborhood, "Mission Bay");
  assert.deepEqual(detail.coordinate, { latitude: 37.77, longitude: -122.39 });
  assert.deepEqual(detail.hosts[0].links.map((link) => link.url), [
    "https://x.com/ada", "https://www.linkedin.com/in/ada", "https://ada.dev/",
  ]);
  assert.equal(detail.hosts[0].avatarUrl, undefined, "avatars only come from Luma's CDN");
  assert.equal(detail.featuredGuests[0].name, "Grace H");
  assert.equal(detail.guestCount, 360);
  assert.equal(detail.nearCapacity, true);
});

test("a page without an event throws, so the last good copy is kept", () => {
  assert.throws(() => parseLumaEventPage("<html></html>", "x"), /no event/);
});

test("a cached copy is fresh for a day", () => {
  const detail = { fetchedAt: "2026-09-24T00:00:00.000Z" };
  assert.equal(isDetailFresh(detail, Date.parse("2026-09-24T12:00:00Z")), true);
  assert.equal(isDetailFresh(detail, Date.parse("2026-09-25T01:00:00Z")), false);
});
