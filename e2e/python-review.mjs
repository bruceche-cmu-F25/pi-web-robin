// Mocked review-checkbox flow: no personal writes, no agent calls.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/python-review.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => { localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-theme", "glass-dark"); });
  const reviewChecks = {};
  let writes = 0;
  await context.route("**/api/robin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/robin/learning/study") {
      if (route.request().method() === "POST") {
        const { date, checked, expected } = route.request().postDataJSON();
        assert.equal(typeof checked, "boolean", "only a boolean, never answers, is sent");
        if (expected !== (reviewChecks[date]?.revision ?? "")) return route.fulfill({ status: 409, json: { error: "Review changed; reload and try again" } });
        writes++;
        reviewChecks[date] = { checked, revision: `revision-${writes}` };
        return route.fulfill({ json: { progress: reviewChecks[date] } });
      }
      return route.fulfill({ json: { week: { week: "2026-11-02", objective: "复习 Python 核心知识", milestones: [{ id: "learn", title: "本周 Python", done: false }], updatedAt: "" }, sessions: [], practiceDays: 0, todayPracticed: false, attemptsThisWeek: 0, reviewChecks } });
    }
    if (path === "/api/robin/learning") return route.fulfill({ json: { practice: null, fullstack: null } });
    if (path === "/api/robin/canvases") return route.fulfill({ json: { canvases: [] } });
    if (path === "/api/robin/events") return route.fulfill({ json: { events: [], today: "2026-11-04", google: { connected: false } } });
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date(2026, 10, 4, 9, 0) });
  page.setDefaultTimeout(15000);
  await page.goto("/learn");
  const review = page.locator('section[aria-labelledby="python-review-title"]');
  const card = review.locator('#review-2026-11-04');
  const checkbox = card.getByRole("checkbox", { name: /已看过|I read this/ });
  await card.getByText(/Python.*运行时|Python binds names/).waitFor();
  assert.match(await card.locator("pre").first().innerText(), /isinstance/);
  assert.equal(await card.locator("textarea").count(), 0);
  assert.equal(await checkbox.isChecked(), false);
  assert.equal(writes, 0, "opening the card records nothing");
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/python-review-card.png" });
  // Future dates may be read but not checked early.
  await review.locator('li:has(time[datetime="2026-11-05"])').first().getByRole("button").click();
  assert.equal(await review.locator('#review-2026-11-05').getByRole("checkbox").isDisabled(), true);
  await review.locator('li:has(time[datetime="2026-11-04"])').first().getByRole("button").click();
  await checkbox.check();
  await review.getByText(/已复习 1\/19|Reviewed: 1\/19/).waitFor();
  assert.equal(writes, 1);
  await page.getByRole("button", { name: /规划本周|Plan my week/, exact: true }).click();
  await page.getByRole("button", { name: /^(本周|This week)$/ }).click();
  assert.equal(await checkbox.isChecked(), true, "switching views retains the checkbox");
  await page.reload();
  await checkbox.waitFor();
  assert.equal(await checkbox.isChecked(), true, "reload restores the saved check");
  assert.equal(writes, 1);
  await page.clock.fastForward("24:01:00");
  assert.equal(await review.getByRole("button", { name: /待补：11-04|Catch up: 11-04/ }).count(), 0);
  await review.locator('li:has(time[datetime="2026-11-04"])').first().getByRole("button").click();
  reviewChecks["2026-11-04"] = { ...reviewChecks["2026-11-04"], revision: "external-revision" };
  await checkbox.uncheck();
  await card.getByRole("alert").getByRole("button", { name: /刷新记录|Reload record/ }).click();
  assert.equal(await checkbox.isChecked(), true, "a conflict does not silently uncheck the card");
  await checkbox.uncheck();
  await review.getByRole("button", { name: /待补：11-04|Catch up: 11-04/ }).waitFor();
  assert.equal(writes, 2);
  await checkbox.check();
  await review.getByRole("button", { name: /待补：11-04|Catch up: 11-04/ }).waitFor({ state: "hidden" });
  assert.equal(writes, 3);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true);
  assert.deepEqual(errors, []);
  await context.close();
  console.log("Python review: teaching card, explicit check/uncheck, future-date guard, reload, conflict and 390px layout passed");
} finally { await browser.close(); }
