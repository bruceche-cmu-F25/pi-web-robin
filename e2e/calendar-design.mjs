// Synthetic calendars and mocked APIs only; color preferences stay in this isolated browser.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { eventColorKey, EVENT_COLOR_KEYS } from "../extension/robin/eventColors.ts";
import { eventsInRange } from "../extension/robin/events.ts";
import { fullstackPlan, practicePlan } from "../extension/robin/learning.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const screenshots = process.env.E2E_SCREENSHOT_DIR ?? "/tmp/calendar-design";
mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1400 }, reducedMotion: "reduce", serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => {
    if (!localStorage.getItem("pi-locale")) localStorage.setItem("pi-locale", "en");
    if (!localStorage.getItem("pi-theme")) localStorage.setItem("pi-theme", "light");
  });
  const today = "2030-05-13";
  const recurring = { title: "Weekly class", colorSeed: "fixture:class", source: "google", calendar: "Classes", createdAt: "2030-01-01T00:00:00Z" };
  let events = [
    { ...recurring, id: "class-1", date: today, start: "10:00", end: "11:30" },
    { ...recurring, id: "class-2", date: "2030-05-15", start: "11:00", end: "12:00" },
    { ...recurring, id: "class-3", date: "2030-05-20", start: "08:00", end: "09:00" },
    { ...recurring, id: "class-band", title: "Class workshop", date: "2030-05-16" },
  ];
  const seen = new Set();
  for (let i = 0; seen.size < 9; i++) {
    const colorSeed = `sample:${i}`, key = eventColorKey({ title: "Sample", colorSeed });
    if (seen.has(key)) continue;
    seen.add(key);
    const index = seen.size - 1, hour = index < 3 ? 9 : index + 9;
    events.push({ id: `color-${key}`, colorSeed, title: `Project review ${key} — long event title with 中文 and architecture details`, date: today, start: `${String(hour).padStart(2, "0")}:00`, end: `${String(hour + 1).padStart(2, "0")}:30`, source: "google", calendar: "Work", location: "Video call" });
  }
  const writes = [], errors = [];
  await context.route("**/api/**", (route) => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== "GET") { writes.push(request.url()); return route.fulfill({ status: 405, json: { error: "Unexpected write" } }); }
    if (url.pathname === "/api/robin/events") return route.fulfill({ json: { today, events: url.searchParams.has("from") ? eventsInRange(events, url.searchParams.get("from"), url.searchParams.get("to")) : events, google: { connected: true } } });
    const fixtures = {
      "/api/robin/todos": { today, todos: [] }, "/api/robin/jobs": { jobs: [], configured: true },
      "/api/robin/links": { links: [] }, "/api/robin/rounds": { rounds: [] },
      "/api/robin/learning": { practice: practicePlan([], "neetcode150", today), fullstack: fullstackPlan([]) },
    };
    return route.fulfill({ json: fixtures[url.pathname] ?? {} });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const calendar = page.locator(".robin-calendar");
  const event = (id) => calendar.locator(`[data-calendar-event="${id}"]`).first();
  const spine = async (id) => {
    const paint = await page.waitForFunction((id) => {
      const el = document.querySelector(`.robin-calendar [data-calendar-event="${id}"]`);
      return el && getComputedStyle(el).borderLeftColor || false;
    }, id);
    return paint.jsonValue();
  };
  const open = async (id = "class-1") => { await event(id).click(); const dialog = page.locator('.calendar-event-dialog[open]'); await dialog.waitFor(); return dialog; };
  await page.goto("/dashboard?calendar=week&date=2030-05-13");
  await event("class-1").waitFor();
  const automatic = await spine("class-1");
  assert.equal(await spine("class-2"), automatic);
  assert.equal(await spine("class-band"), automatic);
  events = [{ id: "earlier", title: "New early appointment", colorSeed: "fixture:early", source: "google", date: today, start: "06:00", end: "07:00" }, ...events];
  await page.reload(); await event("earlier").waitFor();
  assert.equal(await spine("class-1"), automatic, "inserting an earlier series cannot recolor existing events");
  await calendar.getByRole("button", { name: "Next", exact: true }).click();
  await event("class-3").waitFor();
  assert.equal(await spine("class-3"), automatic, "a different server date window cannot redeal the palette");
  await calendar.getByRole("button", { name: "Previous", exact: true }).click();
  await event("class-1").waitFor();
  let dialog = await open();
  assert.equal(await dialog.getByRole("button", { name: "Edit event", exact: true }).count(), 0, "Google stays read-only");
  await dialog.getByRole("button", { name: "Pink", exact: true }).click();
  assert.equal(await dialog.getByRole("button", { name: "Pink", exact: true }).getAttribute("aria-pressed"), "true");
  await page.keyboard.press("Escape");
  assert.equal(await spine("class-1"), "rgb(190, 24, 93)");
  assert.equal(await spine("class-2"), "rgb(190, 24, 93)");
  assert.equal(await spine("class-band"), "rgb(190, 24, 93)");
  await page.reload(); await event("class-1").waitFor();
  await page.waitForFunction(() => { const node = document.querySelector('[data-calendar-event="class-1"]'); return node && getComputedStyle(node).borderLeftColor === "rgb(190, 24, 93)"; });
  await calendar.getByRole("button", { name: "Next", exact: true }).click();
  await event("class-3").waitFor();
  await page.waitForFunction(() => { const node = document.querySelector('[data-calendar-event="class-3"]'); return node && getComputedStyle(node).borderLeftColor === "rgb(190, 24, 93)"; });
  await calendar.getByRole("button", { name: "Previous", exact: true }).click();
  await event("class-1").waitFor();
  // A change in another tab propagates; it never rewrites the whole preferences collection.
  const other = await context.newPage();
  await other.goto("/dashboard?calendar=week&date=2030-05-13");
  await other.locator('[data-calendar-event="class-1"]').click();
  await other.getByRole("dialog").getByRole("button", { name: "Green", exact: true }).click();
  await page.waitForFunction(() => { const node = document.querySelector('[data-calendar-event="class-1"]'); return node && getComputedStyle(node).borderLeftColor === "rgb(21, 128, 61)"; });
  await other.keyboard.press("Escape");
  await other.locator('[data-calendar-event="color-sage"]').click();
  await other.getByRole("dialog").getByRole("button", { name: "Orange", exact: true }).click();
  assert.equal(await spine("class-1"), "rgb(21, 128, 61)");
  await other.getByRole("dialog").getByRole("button", { name: "Automatic", exact: true }).click();
  await other.close();
  assert.equal(await spine("class-1"), "rgb(21, 128, 61)", "another series preference cannot overwrite this one");
  dialog = await open();
  await page.evaluate(() => {
    window.__setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key.startsWith("robin-calendar-series-color:")) throw new DOMException("Full", "QuotaExceededError"); return window.__setItem.call(this, key, value); };
  });
  await dialog.getByRole("button", { name: "Pink", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "Could not read or save" }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Green", exact: true }).getAttribute("aria-pressed"), "true");
  await page.evaluate(() => { Storage.prototype.setItem = window.__setItem; });
  await dialog.getByRole("button", { name: "Automatic", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(await spine("class-1"), automatic);
  await page.evaluate(() => localStorage.setItem("robin-calendar-series-color:v1:fixture%3Aclass", "not-a-color"));
  await page.reload(); await event("class-1").waitFor();
  assert.equal(await spine("class-1"), automatic, "invalid stored values cannot become CSS");

  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle("dark", theme === "dark"); }, theme);
    for (const view of ["week", "day", "month", "agenda"]) {
      await calendar.getByRole("combobox", { name: "Calendar view", exact: true }).selectOption(view);
      await page.waitForTimeout(350);
      assert.ok(await calendar.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
      if (view === "week" || view === "day") {
        const paint = await calendar.locator(".calendar-event-block").evaluateAll((nodes) => {
          const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d"); canvas.width = canvas.height = 1;
          const luminance = (color) => {
            ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
            return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map((n) => n / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
          };
          return nodes.map((el) => {
            const style = getComputedStyle(el), bg = luminance(style.backgroundColor), fg = luminance(style.color);
            return { radius: style.borderTopLeftRadius, contrast: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05), spine: style.borderLeftColor };
          });
        });
        assert.ok(paint.length >= 9);
        assert.ok(paint.every((p) => p.radius === "8px" && p.contrast >= 4.5), JSON.stringify(paint));
        const sampleColors = await Promise.all(EVENT_COLOR_KEYS.map((key) => spine(`color-${key}`)));
        assert.equal(new Set(sampleColors).size, 9);
      }
      await calendar.screenshot({ path: `${screenshots}/${theme}-${view}.png` });
    }
  }
  // Phone day view and the preference picker remain usable at the narrowest supported width.
  await page.evaluate(() => localStorage.setItem("pi-locale", "zh-CN"));
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/dashboard?calendar=day&date=2030-05-13");
  await event("class-1").waitFor();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle("dark", theme === "dark"); }, theme);
    assert.ok(await calendar.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    await calendar.evaluate((el) => {
      const page = el.closest(".robin-dashboard"), header = document.querySelector(".robin-dashboard-header");
      page.scrollTop += el.getBoundingClientRect().top - header.getBoundingClientRect().bottom - 12;
    });
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${screenshots}/zh-${theme}-320.png` });
    dialog = await open();
    assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    const colors = dialog.getByRole("group", { name: "系列颜色", exact: true });
    assert.equal(await colors.getByRole("button").count(), 10);
    assert.ok(await colors.getByRole("button").evaluateAll((nodes) => nodes.every((el) => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })));
    await dialog.screenshot({ path: `${screenshots}/zh-${theme}-picker-320.png` });
    await page.keyboard.press("Escape");
  }
  assert.deepEqual(writes, [], "color preferences never make API writes, including Google events");
  assert.deepEqual(errors, []);
  console.log("Calendar design: stable series across date windows, recurrence, manual/reset/reload/cross-tab colors, failed storage, read-only Google, nine theme colors, contrast, all views and 320px Chinese picker passed.");
} finally { await browser.close(); }
