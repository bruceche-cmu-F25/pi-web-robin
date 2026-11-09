// Deterministic browser checks. All application APIs mocked; no research, personal writes or YouTube scans.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
const screenshots = "/tmp/incoming-and-events";
mkdirSync(screenshots, { recursive: true });
let page;
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", reducedMotion: "reduce" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
  const weekly = { today: "2026-10-27", week: "2026-10-26", preferences: { enabled: false, telegram: false, timezone: "America/Los_Angeles", at: "08:00", interests: "test interests" }, edition: null, archive: [], read: [], running: false, run: null, deliveries: [], telegramReady: false };
  const podcast = { latest: [], details: {}, summaries: {}, lastPublished: {}, failures: [], scanning: false, summarizing: [], scannedAt: null };
  const event = { id: "fixture", title: "Full-stack AI agent workshop — browser fixture", url: "https://example.com/event", source: "luma", host: "Fixture host", startAt: "2026-10-27T18:00:00-07:00", endAt: "2026-10-27T20:00:00-07:00", timezone: "America/Los_Angeles", city: "San Francisco", online: false, free: true, topics: ["ai", "swe"], score: 5, matched: ["ai", "agent"], discoveredAt: "2026-10-26T00:00:00Z" };
  let weeklyReads = 0, podcastReads = 0, summaryPosts = 0, eventWrites = 0;
  let releaseSummary, releaseSave, failPodcastRead = false, failSchedule = false, failEventRead = false;
  await context.route("**/api/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/robin/ai-weekly") { assert.equal(request.method(), "GET"); weeklyReads++; return route.fulfill({ json: weekly }); }
    if (path === "/api/robin/podcasts") {
      if (request.method() === "POST") {
        assert.equal(request.postDataJSON().action, "summarize");
        summaryPosts++;
        await new Promise((resolve) => { releaseSummary = resolve; });
        return route.fulfill({ status: 502, json: { error: "Fixture transcript unavailable" } });
      }
      podcastReads++;
      return route.fulfill(failPodcastRead ? { status: 503, json: { error: "Fixture refresh unavailable" } } : { json: podcast });
    }
    if (path === "/api/robin/tech-events") {
      if (request.method() === "PATCH") {
        eventWrites++;
        await new Promise((resolve) => { releaseSave = resolve; });
        Object.assign(event, request.postDataJSON());
        failEventRead = true;
        return route.fulfill({ json: { event } });
      }
      if (failEventRead) return route.fulfill({ status: 503, json: { error: "Fixture events read offline" } });
      return route.fulfill({ json: { today: "2026-10-27", events: [event], scanning: false, scan: null } });
    }
    if (path === "/api/robin/events") return route.fulfill(failSchedule ? { status: 503, json: { error: "Fixture calendar offline" } } : { json: { events: [], google: { connected: false } } });
    assert.equal(request.method(), "GET", `Unexpected write: ${path}`);
    return route.fulfill({ json: { today: "2026-10-27", connected: false, review: null, records: [], events: [], jobs: [], rounds: [], finals: {}, links: [], todos: [] } });
  });
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  await page.goto("/dashboard/gmail?session=fixture-context&feed=ai");
  const sources = page.getByRole("navigation", { name: "新信息来源" });
  const select = async (name, id) => {
    await sources.getByRole("button", { name, exact: true }).click();
    await page.locator(`#incoming-${id}`).waitFor({ state: "visible" });
  };
  await page.getByRole("heading", { name: "每周七件事，每天读懂一件。" }).waitFor();
  assert.ok(await sources.evaluate((nav) => {
    const child = nav.parentElement.querySelector("#incoming-ai .robin-dashboard");
    return getComputedStyle(nav).overflowX === "visible" && child && getComputedStyle(child).backgroundColor === "rgba(0, 0, 0, 0)";
  }), "the incoming tabs are not clipped and the content shares their ground");
  assert.equal(podcastReads, 0, "unvisited podcast panel does not fetch");
  assert.equal(await page.locator('.robin-nav-entry[href^="/podcasts"]').count(), 0);
  await page.getByRole("button", { name: /关注方向与交付/ }).click();
  const interests = page.getByRole("textbox", { name: /你关心什么/ });
  await interests.fill("保留尚未保存的偏好");
  await select("播客", "podcasts");
  await page.getByRole("heading", { name: "值得花两小时听的" }).waitFor();
  await page.waitForFunction(() => !document.querySelector('#incoming-podcasts [role="status"]')?.textContent.includes("加载中"));
  assert.ok(podcastReads > 0);
  const before = weeklyReads;
  await page.clock.fastForward(31_000);
  await page.waitForTimeout(100);
  assert.equal(weeklyReads, before, "hidden weekly panel does not poll");
  await select("AI 周报", "ai");
  assert.equal(await interests.inputValue(), "保留尚未保存的偏好");
  const podcastBefore = podcastReads;
  await page.clock.fastForward(121_000);
  await page.waitForTimeout(100);
  assert.equal(podcastReads, podcastBefore, "hidden podcast panel does not poll");
  assert.equal(new URL(page.url()).searchParams.get("session"), "fixture-context");
  await select("播客", "podcasts");
  const summarize = page.getByRole("button", { name: /AI 总结/ }).first();
  await summarize.evaluate((button) => { button.click(); button.click(); });
  await page.getByRole("button", { name: /正在读字幕…/ }).first().waitFor();
  assert.equal(summaryPosts, 1, "same-frame repeat clicks submit once");
  await select("邮箱", "email");
  releaseSummary();
  await select("播客", "podcasts");
  await page.getByRole("alert").filter({ hasText: "Fixture transcript unavailable" }).first().waitFor();
  assert.equal(await summarize.isEnabled(), true, "failed summary can be retried");
  failPodcastRead = true;
  await select("邮箱", "email");
  await select("播客", "podcasts");
  await page.getByRole("alert").filter({ hasText: "Fixture refresh unavailable" }).waitFor();
  failPodcastRead = false;
  for (const width of [320, 375, 812, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Incoming overflow at ${width}`);
    if (width <= 375) {
      assert.ok(await sources.getByRole("button").evaluateAll((buttons) => {
        const nav = buttons[0].parentElement.getBoundingClientRect();
        const top = buttons[0].getBoundingClientRect().top;
        return buttons.length === 4 && buttons.every((button) => {
          const box = button.getBoundingClientRect();
          return box.height >= 44 && Math.abs(box.top - top) < 1 && box.left >= nav.left && box.right <= nav.right && box.bottom <= nav.bottom && button.scrollWidth <= button.clientWidth;
        });
      }), "four mobile selectors fit legibly on one unclipped row");
    }
  }
  await page.screenshot({ path: `${screenshots}/podcasts-desktop.png` });
  await page.goto("/podcasts?session=old-bookmark");
  await page.waitForURL((url) => url.pathname === "/dashboard/gmail" && url.searchParams.get("feed") === "podcasts");
  assert.equal(new URL(page.url()).searchParams.get("session"), "old-bookmark");
  await page.goto("/dashboard/events");
  await page.getByRole("searchbox").waitFor();
  assert.ok(await page.getByRole("navigation", { name: "求职视图" }).evaluate((nav) => {
    const child = nav.nextElementSibling;
    return getComputedStyle(nav).overflowX === "visible" && child && getComputedStyle(child).backgroundColor === "rgba(0, 0, 0, 0)";
  }), "job tabs and content share an unclipped surface");
  const save = page.getByRole("button", { name: `收藏: ${event.title}`, exact: true }).first();
  await save.evaluate((button) => { button.click(); button.click(); });
  await page.locator('article[aria-busy="true"]').first().waitFor();
  assert.equal(eventWrites, 1);
  releaseSave();
  await page.getByRole("button", { name: `取消收藏: ${event.title}`, exact: true }).first().waitFor();
  await page.getByRole("alert").filter({ hasText: "Fixture events read offline" }).waitFor();
  assert.equal(await page.getByRole("button", { name: `取消收藏: ${event.title}`, exact: true }).first().isEnabled(), true);
  failEventRead = false;
  await page.getByRole("searchbox").fill("no-matches-fixture");
  assert.equal(await page.locator('[class*="eventList"] article').count(), 0);
  await page.getByRole("searchbox").fill("");
  const ribbon = page.locator('nav[class*="ribbon"] button:not(:disabled)').first();
  await page.evaluate(() => { const original = Element.prototype.scrollIntoView; Element.prototype.scrollIntoView = function (options) { window.lastScrollBehavior = options?.behavior; original.call(this, options); }; });
  await ribbon.focus(); await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "all-upcoming-events");
  assert.equal(await page.evaluate(() => window.lastScrollBehavior), "instant");
  for (const width of [320, 375, 812, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Events overflow at ${width}`);
  }
  failSchedule = true;
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "Fixture calendar offline" }).waitFor();
  assert.equal(await page.locator('[class*="recommendations"] article').count(), 0, "calendar failure must not claim conflict-free recommendations");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => document.documentElement.dataset.theme = "dark");
  await page.screenshot({ path: `${screenshots}/events-mobile-dark.png` });
  assert.deepEqual(errors, []);
  console.log("PASS: Incoming source state/poll suspension, old bookmarks, duplicate guards, visible errors, Events filters/focus/calendar failure, 320–1440px layouts.");
} catch (error) {
  console.error("Fixture page:", await page?.locator("body").innerText());
  await page?.screenshot({ path: `${screenshots}/failure.png` }).catch(() => {});
  throw error;
} finally { await browser.close(); }
