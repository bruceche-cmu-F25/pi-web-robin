// All API reads are fixtures and every write is blocked. Reuse the running dev server.
// node --env-file-if-exists=.env.local e2e/board-navigation.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { DEFAULT_JOB_PROFILE } from "../extension/robin/jobs.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
const jobs = Array.from({ length: 121 }, (_, i) => ({ id: `job-${i}`, company: `Company ${String(i).padStart(3, "0")}`, title: "Demo Engineer", location: "Remote", source: "greenhouse", status: i === 120 ? "shortlist" : "new", score: i < 110 ? 4.5 : 2, url: `https://example.org/jobs/${i}`, discoveredAt: "2026-10-27T12:00:00Z", reason: "Fixture role" }));
const events = Array.from({ length: 40 }, (_, i) => ({ id: `event-${i}`, title: `Demo AI workshop ${String(i).padStart(2, "0")}`, url: `https://example.org/events/${i}`, host: "Fixture host", source: "luma", startAt: "2026-10-27T18:00:00-07:00", endAt: "2026-10-27T20:00:00-07:00", timezone: "America/Los_Angeles", city: "San Francisco", online: false, free: true, topics: ["ai"], score: 5, matched: ["ai"], saved: true, hidden: i % 2 === 1, discoveredAt: "2026-10-26T00:00:00Z" }));
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
    if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
    await context.addInitScript(() => { localStorage.setItem("pi-locale", "en"); localStorage.setItem("pi-theme", "light"); });
    const writes = [], errors = [];
    let delay = 0, visibleJobs = jobs;
    await context.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (request.method() !== "GET") { writes.push(`${request.method()} ${path}`); return route.fulfill({ status: 405, json: { error: "Business writes blocked" } }); }
      if (delay && ["/api/robin/jobs", "/api/robin/tech-events"].includes(path)) await new Promise(resolve => setTimeout(resolve, delay));
      const fixtures = {
        "/api/robin/jobs": { jobs: visibleJobs, scan: null, minScore: 3.75, configured: true },
        "/api/robin/jobs/profile": { profile: DEFAULT_JOB_PROFILE, providers: [], presets: [], starterCompanies: [] },
        "/api/robin/jobs/score": { scoring: null, pending: 0, model: null },
        "/api/robin/jobs/sweep": { sweep: null },
        "/api/robin/jobs/applications": { settings: { enabled: false, configured: false, timeZone: "America/Los_Angeles", at: "09:00", dailyLimit: 5 }, rows: [], counts: {}, running: false, today: 0, todaySubmitted: 0, total: 0, legacy: 0 },
        "/api/robin/rounds": { rounds: [] },
        "/api/robin/links": { links: [] },
        "/api/robin/events": { events: [], google: { connected: false } },
        "/api/robin/tech-events": { events, today: "2026-10-27", scanning: false, scan: null },
      };
      if (path.startsWith("/api/robin/tech-events/")) return route.fulfill({ json: { event: events.find(item => item.id === path.split("/").at(-1)), detail: null, today: "2026-10-27" } });
      return route.fulfill({ json: fixtures[path] ?? { todos: [], jobs: [], events: [], links: [], rounds: [], records: [], finals: {} } });
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", error => errors.push(error.message));
    const pane = () => page.locator(".robin-page");
    const rows = () => page.locator('a[href^="https://example.org/jobs/"]').filter({ has: page.locator("b") });
    const count = async n => { await page.waitForFunction(n => [...document.querySelectorAll('a[href^="https://example.org/jobs/"]')].filter(a => a.querySelector("b")).length === n, n); };
    const checkTop = async top => page.waitForFunction(top => Math.abs((document.querySelector(".robin-page")?.scrollTop ?? -999) - top) < 3, top);
    const scroll = async top => pane().evaluate((el, top) => { el.scrollTop = top; el.dispatchEvent(new Event("scroll")); return el.scrollTop; }, top);
    const jobsHref = "/dashboard/jobs?session=keep&status=all&q=Demo&sort=recent&shown=100&below=1";
    await page.goto(jobsHref); await count(100);
    const hunt = page.getByRole("navigation", { name: "Job hunt views" });
    const jobTab = hunt.getByRole("link", { name: "Jobs & interviews", exact: true });
    const eventTab = hunt.getByRole("link", { name: "Events", exact: true });
    assert.equal(await page.locator('.robin-nav-entry[href^="/dashboard/events"]').count(), 0, "events no longer consume a global navigation slot");
    await page.evaluate(() => { window.huntDocument = "retained"; });
    await eventTab.focus(); await page.keyboard.press("Enter");
    await page.waitForURL(url => url.pathname === "/dashboard/events");
    await page.locator("#all-upcoming-events").waitFor();
    assert.equal(await eventTab.getAttribute("aria-current"), "page");
    assert.equal(await page.locator('.robin-nav-entry[href^="/dashboard/jobs"]').getAttribute("aria-current"), "page");
    assert.equal(new URL(page.url()).searchParams.get("session"), "keep");
    assert.equal(await page.getByRole("searchbox").inputValue(), "", "job search does not leak into events");
    await page.getByRole("searchbox").fill("workshop");
    await page.locator('[class*="featuredBody"]').first().waitFor();
    for (const selector of ['[class*="stats"]', '[class*="featured"][data-rank]', 'nav[class*="ribbon"]']) {
      assert.equal(await page.locator(selector).first().evaluate(el => getComputedStyle(el).borderTopLeftRadius), "16px");
    }
    await jobTab.click(); await count(100);
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, jobsHref, "tab restores the prior job filters");
    await eventTab.click(); await page.waitForURL(url => url.pathname === "/dashboard/events");
    await page.locator("#all-upcoming-events").waitFor();
    assert.equal(await page.getByRole("searchbox").inputValue(), "workshop", "tab restores the prior event filters");
    await page.goBack(); await count(100);
    assert.equal(await page.evaluate(() => window.huntDocument), "retained", "tabs and Back preserve the browser document");
    assert.equal(await jobTab.getAttribute("aria-current"), "page");
    if (width < 960) assert.ok((await eventTab.boundingBox()).height >= 44);
    assert.equal(await page.getByRole("searchbox").inputValue(), "Demo");
    assert.equal(await page.getByRole("combobox", { name: "Sort by" }).inputValue(), "recent");
    const historyLength = await page.evaluate(() => history.length);
    await page.getByRole("searchbox").fill("Demo E");
    assert.equal(await page.evaluate(() => history.length), historyLength, "typing replaces history rather than one entry per letter");
    await count(50);
    await page.getByRole("button", { name: /Show .*more/ }).click(); await count(100);
    const selectedJobsHref = new URL(page.url()).pathname + new URL(page.url()).search;
    const jobTop = await scroll(2800); assert.ok(jobTop > 1000);
    delay = 350;
    await page.reload(); await count(100); await checkTop(jobTop);
    await page.goto("/dashboard/events"); await page.locator("#all-upcoming-events").waitFor();
    await page.goBack(); await count(100); await checkTop(jobTop);
    assert.equal(new URL(page.url()).searchParams.get("session"), "keep");
    const stages = page.getByRole("group", { name: "Application status" });
    await stages.getByRole("button", { name: /Shortlist/ }).click(); await count(1);
    await page.goBack(); await count(100);
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, selectedJobsHref);
    assert.equal(await page.getByRole("searchbox").inputValue(), "Demo E");
    await page.goForward(); await count(1);
    assert.equal(new URL(page.url()).searchParams.get("status"), "shortlist");
    await page.goBack(); await count(100);

    const eventsHref = "/dashboard/events?session=keep&q=Demo&topic=ai&day=2026-10-27&saved=1&hidden=1";
    await page.goto(eventsHref);
    const eventLink = () => page.locator('h4 a[href^="/dashboard/events/"]').nth(16);
    await eventLink().waitFor();
    await eventLink().scrollIntoViewIfNeeded();
    const eventTop = await pane().evaluate(el => el.scrollTop); assert.ok(eventTop > 1000);
    assert.equal(new URL(await eventLink().getAttribute("href"), baseURL).searchParams.get("returnTo"), eventsHref);
    await eventLink().click();
    const back = page.getByRole("link", { name: "← All events", exact: true });
    await back.waitFor(); assert.equal(await back.getAttribute("href"), eventsHref);
    assert.equal(await eventTab.getAttribute("aria-current"), "page");
    assert.equal(await eventTab.getAttribute("href"), eventsHref);
    assert.equal(await page.locator('.robin-nav-entry[href^="/dashboard/jobs"]').getAttribute("aria-current"), "page");
    await page.reload(); await back.waitFor(); assert.equal(await back.getAttribute("href"), eventsHref);
    await back.click(); await eventLink().waitFor(); await checkTop(eventTop);
    assert.equal(await page.getByRole("searchbox").inputValue(), "Demo");
    await eventLink().click(); await back.waitFor();
    await page.goBack(); await eventLink().waitFor(); await checkTop(eventTop);
    await page.reload(); await eventLink().waitFor(); await checkTop(eventTop);
    const clear = page.getByRole("button", { name: "Clear filters", exact: true });
    await clear.scrollIntoViewIfNeeded(); const controlsTop = await pane().evaluate(el => el.scrollTop);
    await clear.click();
    await page.waitForFunction(() => location.search === "?session=keep");
    await checkTop(controlsTop);
    assert.equal(await page.getByRole("searchbox").inputValue(), "");
    await page.goBack(); await eventLink().waitFor();
    assert.equal(new URL(page.url()).searchParams.get("topic"), "ai");
    assert.equal(new URL(page.url()).searchParams.get("saved"), "1");
    assert.equal(new URL(page.url()).searchParams.get("hidden"), "1");
    assert.equal(new URL(page.url()).searchParams.get("day"), "2026-10-27");
    await page.goto("/dashboard/events/event-0?returnTo=https%3A%2F%2Fevil.example");
    await back.waitFor(); assert.equal(await back.getAttribute("href"), "/dashboard/events");
    // A shorter result may make the saved offset unreachable. Once the user
    // scrolls, later data must not drag them back to that old offset.
    await page.goto(selectedJobsHref); await count(100); await scroll(6000);
    visibleJobs = jobs.slice(0, 3);
    await page.reload(); await count(3);
    await pane().dispatchEvent("wheel", { deltaY: -100 }); await scroll(0);
    visibleJobs = jobs;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await count(100); await checkTop(0);
    assert.ok(await page.evaluate(() => JSON.parse(sessionStorage.getItem("pi-board-scroll-v1")).length <= 40));
    await page.addInitScript(() => Object.defineProperty(window, "sessionStorage", { get() { throw new Error("Storage unavailable"); } }));
    await page.goto("/dashboard/jobs?status=bogus&shown=-1&sort=bogus"); await count(50);
    assert.equal(await rows().count(), 50, "invalid URL and unavailable storage still allow browsing");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    console.log(`${width}px: URL state, history, pagination, delayed reload/back scroll, detail return links, clear filters and storage fallback passed`);
    await context.close();
  }
} finally { await browser.close(); }
