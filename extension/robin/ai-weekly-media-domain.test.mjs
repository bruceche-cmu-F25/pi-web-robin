import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchWeeklyImage, weeklyImageUrl } from "./ai-weekly-media-domain.ts";

const pageUrl = "https://example.com/article";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
const page = (meta) => new Response(`<html><head>${meta}</head><body>Article</body></html>`, { headers: { "Content-Type": "text/html" } });
const image = (body = png, type = "image/png") => new Response(body, { headers: { "Content-Type": type } });

test("source-owned previews use real metadata, support attribute order/entities/relative URLs, and refuse scripts/private URLs", () => {
  assert.equal(weeklyImageUrl('<meta content="/picture.png?a=1&amp;b=2" property="og:image">', pageUrl), "https://example.com/picture.png?a=1&b=2");
  assert.equal(weeklyImageUrl("<meta name=twitter:image content='/social.png'>", pageUrl), "https://example.com/social.png");
  assert.equal(weeklyImageUrl('<script><meta property="og:image" content="/fake.png"></script>', pageUrl), null);
  assert.equal(weeklyImageUrl('<!-- <meta property="og:image" content="/fake.png"> -->', pageUrl), null);
  for (const url of ["https://127.0.0.1/a.png", "https://localhost/a.png", "https://user:pass@example.com/a.png", "data:image/png;base64,abc", "file:///tmp/image"]) {
    assert.equal(weeklyImageUrl(`<meta property="og:image" content="${url}">`, pageUrl), null);
  }
});

test("image downloads are bounded and raster signatures must match the content type", async () => {
  const urls = [];
  const valid = await fetchWeeklyImage(pageUrl, async (url) => {
    urls.push(url);
    return urls.length === 1 ? page('<meta property="og:image" content="/image.png">') : image();
  });
  assert.equal(valid.contentType, "image/png"); assert.deepEqual(Buffer.from(valid.body), png);
  assert.deepEqual(urls, [pageUrl, "https://example.com/image.png"]);
  for (const [body, type] of [["<svg onload='bad()'/>", "image/svg+xml"], ["<html>not a PNG</html>", "image/png"], [png, "image/jpeg"], [Buffer.alloc(3 * 1024 * 1024 + 1), "image/png"]]) {
    let calls = 0;
    assert.equal(await fetchWeeklyImage(pageUrl, async () => ++calls === 1 ? page('<meta property="og:image" content="/image">') : image(body, type)), null);
  }
});

test("missing/blocked sources and redirected private hosts never break the briefing or open private connections", async () => {
  let calls = 0;
  assert.equal(await fetchWeeklyImage(pageUrl, async () => { calls++; return page('<meta property="og:image" content="https://localhost/private">'); }), null);
  assert.equal(calls, 1);
  calls = 0;
  assert.equal(await fetchWeeklyImage(pageUrl, async () => {
    calls++;
    if (calls === 1) return page('<meta property="og:image" content="/redirect">');
    return new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest/meta-data" } });
  }), null);
  assert.equal(calls, 2, "private redirect is rejected before fetch");
  assert.equal(await fetchWeeklyImage(pageUrl, async () => new Response(null, { status: 403 })), null);
  assert.equal(await fetchWeeklyImage(pageUrl, async () => page("")), null);
  assert.equal(await fetchWeeklyImage("file:///tmp/secret", async () => assert.fail("no local fetch")), null);
});
