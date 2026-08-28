import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";
import { extractIconHref, fetchPageMetadata, fetchPageTitle, looksLikeInterstitial, nameFromUrl } from "./fetch-title.ts";

const routes = {
  "/plain": { type: "text/html", body: "<html><head><title>Hacker News</title></head><body>x</body></html>" },
  "/entities": { type: "text/html; charset=utf-8", body: "<title>Tom &amp; Jerry &#8212; &quot;fun&quot;</title>" },
  "/whitespace": { type: "text/html", body: "<title>\n  spaced   out\n</title>" },
  "/attributes": { type: "text/html", body: '<title data-x="1">With attrs</title>' },
  "/empty": { type: "text/html", body: "<title>   </title>" },
  "/none": { type: "text/html", body: "<html><body>no title here</body></html>" },
  "/json": { type: "application/json", body: '{"title":"not html"}' },
  "/sso": { type: "text/html", body: "<title>Web Login Service - Stale Request</title>" },
  "/notfound": { status: 404, type: "text/html", body: "<title>Nope</title>" },
};

const server = createServer((req, res) => {
  if (req.url === "/huge") {
    // Title far past the read cap, after a lot of filler.
    res.writeHead(200, { "Content-Type": "text/html" });
    res.write("<!-- ".padEnd(200_000, "x"));
    res.end("--><title>Too Late</title>");
    return;
  }
  const route = routes[req.url ?? ""];
  if (!route) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(route.status ?? 200, { "Content-Type": route.type });
  res.end(route.body);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const serverBase = `http://127.0.0.1:${server.address().port}`;
const base = "https://example.com";
const localFetch = (url, init) => {
  const request = { ...init };
  delete request.dispatcher;
  return fetch(`${serverBase}${new URL(url).pathname}`, request);
};
const pageTitle = (url) => fetchPageTitle(url, localFetch);

after(() => server.close());

test("reads a plain title", async () => {
  assert.equal(await pageTitle(`${base}/plain`), "Hacker News");
});

test("decodes named and numeric entities", async () => {
  assert.equal(await pageTitle(`${base}/entities`), 'Tom & Jerry — "fun"');
});

test("collapses whitespace and tolerates attributes", async () => {
  assert.equal(await pageTitle(`${base}/whitespace`), "spaced out");
  assert.equal(await pageTitle(`${base}/attributes`), "With attrs");
});

test("returns null when there is no usable title", async () => {
  assert.equal(await pageTitle(`${base}/empty`), null);
  assert.equal(await pageTitle(`${base}/none`), null);
});

test("refuses non-HTML and error responses", async () => {
  assert.equal(await pageTitle(`${base}/json`), null);
  assert.equal(await pageTitle(`${base}/notfound`), null);
});

test("stops reading before a title buried past the byte cap", async () => {
  assert.equal(await pageTitle(`${base}/huge`), null);
});

test("a private host resolves to null rather than throwing", async () => {
  assert.equal(await fetchPageTitle("http://127.0.0.1:1/"), null);
});

test("private metadata targets are refused before fetch and redirects are checked manually", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), redirect: init?.redirect });
    return new Response(null, {
      status: 302,
      headers: { Location: "http://169.254.169.254/latest/meta-data/" },
    });
  });

  assert.deepEqual(await fetchPageMetadata("http://127.0.0.1/private"), { title: null, iconUrl: null });
  assert.equal(calls.length, 0, "a directly private address never reaches fetch");

  assert.deepEqual(await fetchPageMetadata("https://example.com/start"), { title: null, iconUrl: null });
  assert.deepEqual(calls, [{ url: "https://example.com/start", redirect: "manual" }]);
});

test("interstitial titles are recognised, real ones are not", () => {
  const junk = [
    "Web Login Service - Stale Request",
    "Sign in - Google Accounts",
    "Just a moment...",
    "Attention Required! | Cloudflare",
    "403 Forbidden",
    "404 Not Found",
    "Access Denied",
    "Shibboleth Authentication Request",
    "Redirecting…",
    "Error",
    "Home",
  ];
  for (const title of junk) assert.ok(looksLikeInterstitial(title), title);

  const real = [
    "Two Sum - LeetCode",
    "Getting Started: Layouts and Pages | Next.js",
    "Hacker News",
    "How to design a login form — Smashing Magazine",
    "Single Sign-On at Scale — Okta Blog",
    "Error Handling in Rust",
  ];
  for (const title of real) assert.ok(!looksLikeInterstitial(title), title);
});

test("nameFromUrl reads the most meaningful path segment", () => {
  assert.equal(nameFromUrl("https://leetcode.com/problems/two-sum/"), "leetcode.com · two sum");
  assert.equal(nameFromUrl("https://www.example.com/docs/getting_started"), "example.com · getting started");
  assert.equal(nameFromUrl("https://nextjs.org/docs/app/building-your-application/routing"), "nextjs.org · routing");
});

test("nameFromUrl skips ids, hashes, and filler segments", () => {
  assert.equal(nameFromUrl("https://canvas.cmu.edu/courses/12345"), "canvas.cmu.edu · courses");
  // A single letter is not a name; falling back to the host is the better answer.
  assert.equal(nameFromUrl("https://example.com/a/9f8e7d6c5b4a3210"), "example.com");
  assert.equal(nameFromUrl("https://example.com/guide/index.html"), "example.com · guide");
  assert.equal(nameFromUrl("https://example.com/"), "example.com");
  assert.equal(nameFromUrl("https://example.com"), "example.com");
});

test("a page behind a login wall yields no title at all", async () => {
  assert.equal(await pageTitle(`${base}/sso`), null);
});

test("extractIconHref prefers the largest raster icon", () => {
  const html = `
    <link rel="icon" sizes="16x16" href="/small.ico">
    <link rel="apple-touch-icon" sizes="180x180" href="/large.png">
  `;
  assert.equal(extractIconHref(html, "https://x.com/page"), "https://x.com/large.png");
});

test("extractIconHref resolves relative hrefs against the final URL", () => {
  const html = '<link rel="shortcut icon" href="assets/f.png">';
  assert.equal(extractIconHref(html, "https://x.com/docs/"), "https://x.com/docs/assets/f.png");
});

test("extractIconHref ranks SVG below raster so it is not the default pick", () => {
  const html = '<link rel="icon" href="/i.svg"><link rel="icon" href="/i.png">';
  assert.equal(extractIconHref(html, "https://x.com/"), "https://x.com/i.png");
});

test("extractIconHref falls back to the conventional path", () => {
  assert.equal(extractIconHref("<html><head></head>", "https://x.com/a/b"), "https://x.com/favicon.ico");
  // Non-icon link tags must not be mistaken for one.
  const other = '<link rel="stylesheet" href="/a.css"><link rel="canonical" href="/c">';
  assert.equal(extractIconHref(other, "https://x.com/"), "https://x.com/favicon.ico");
});
