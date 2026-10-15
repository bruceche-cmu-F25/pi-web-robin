// Existing dev server; mocked APIs only. Never changes personal todos/calendar.
// node --env-file-if-exists=.env.local e2e/work-queue.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1900, height: 1100 }, serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) {
    const response = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(response.ok(), `Login failed: ${response.status()}`);
  }
  await context.addInitScript(() => { if (!localStorage.getItem("pi-locale")) localStorage.setItem("pi-locale", "en"); });
  const today = "2030-05-12";
  const todos = [
    { id: "a", title: "Write the project application", next: true, estimateMinutes: 60 },
    { id: "b", title: "Reply to the recruiter", estimateMinutes: 20 },
    { id: "c", title: "Review one architecture decision" },
  ].map((todo) => ({ done: false, createdAt: "", due: today, revision: "v1", ...todo }));
  const writes = [];
  let failWrite = false;
  let failCalendar = false;
  await context.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method !== "GET") {
      const body = route.request().postDataJSON();
      writes.push({ path, body });
      if (failWrite) return route.fulfill({ status: 409, json: { error: "Task changed elsewhere" } });
      assert.equal(path, "/api/robin/todos", "Only existing todo writes are allowed");
      const todo = todos.find((item) => item.id === body.id);
      assert.equal(body.revision, todo.revision);
      Object.assign(todo, body, { revision: `${todo.revision}x` });
      return route.fulfill({ json: { todo, today } });
    }
    if (path === "/api/robin/todos") return route.fulfill({ json: { todos, today } });
    if (path === "/api/robin/events") return route.fulfill({ json: { today, events: [{ id: "meeting", title: "Team meeting", date: today, start: "11:00", end: "12:00" }], google: { connected: true, ...(failCalendar ? { error: "Offline" } : {}) } } });
    const data = {
      "/api/robin/rounds": { rounds: [] }, "/api/robin/gmail": { connected: false, today, review: null },
      "/api/robin/jobs": { jobs: [], minScore: 4, configured: true }, "/api/robin/links": { links: [] },
    };
    return route.fulfill({ json: data[path] ?? {} });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date(`${today}T10:00:00`));
  await page.goto("/dashboard?calendar=agenda");
  const panel = page.locator("#dashboard-work-queue");
  const waitText = async (text) => panel.getByText(text, { exact: true }).waitFor();
  await panel.getByRole("button", { name: "Use this queue" }).click();
  await waitText("Suggested now");
  assert.equal(writes.length, 0, "Confirming a queue does not change deadlines or create events");
  assert.equal(await panel.locator("h3").innerText(), "Reply to the recruiter");
  await panel.getByRole("textbox", { name: "Next small step" }).fill("Open the recruiter email and draft two sentences");
  await panel.getByRole("button", { name: "Start 5 min" }).click();
  await waitText("One small start");
  assert.equal(todos[1].status, "doing");
  await page.reload();
  await waitText("One small start");
  assert.equal(await panel.getByRole("textbox", { name: "Next small step" }).inputValue(), "Open the recruiter email and draft two sentences");
  await page.clock.setFixedTime(new Date(`${today}T10:06:00`));
  await panel.getByRole("button", { name: "Another 5 min" }).waitFor();
  assert.equal(todos[1].done, false, "Timer expiry is not task completion");
  failWrite = true;
  await panel.getByRole("button", { name: "Mark complete" }).click();
  await waitText("Task changed elsewhere");
  assert.equal(todos[1].done, false);
  failWrite = false;
  await panel.getByRole("button", { name: "Mark complete" }).click();
  await waitText("1/3 completed");
  assert.equal(todos[1].done, true);

  // A manual start works even when the entire task is too large for the gap.
  await panel.getByRole("button", { name: "Start 5 min" }).click();
  await waitText("One small start");
  await panel.getByRole("button", { name: "Later · 30 min" }).click();
  await panel.getByRole("button", { name: "Start five minutes on Write the project application", exact: true }).click();
  await waitText("One small start");
  await panel.getByRole("button", { name: "Later · 30 min" }).click();
  await waitText("Deferred twice? Make the next step smaller, or take this out of today. The original todo stays.");
  await panel.getByRole("button", { name: "Remove Write the project application from today's queue" }).click();
  assert.equal(todos[0].done, false);
  assert.equal(todos[0].due, today);
  assert.equal(writes.some((write) => "due" in write.body || "plannedOn" in write.body), false);
  await panel.getByRole("button", { name: "Done editing" }).click();
  await panel.getByRole("button", { name: "Rest · 30 min" }).click();
  await waitText("On a break · suggestions paused for 30 minutes");
  await page.reload();
  await waitText("On a break · suggestions paused for 30 minutes");
  await panel.getByRole("button", { name: "I'm ready" }).click();

  // Partial Google reads suppress automatic recommendations, but don't hide the queue.
  failCalendar = true;
  await page.reload();
  await waitText("Calendar could not be fully loaded. Free-time recommendations are paused; your queue is kept.");
  assert.equal(await panel.locator("h3").count(), 0);
  assert.equal(await panel.locator("ol li").count(), 2);

  // Calendar recovery restores a recommendation without altering the chosen queue.
  failCalendar = false;
  // Layout holds at phone and desktop widths, in both languages and themes.
  for (const locale of ["en", "zh-CN"]) {
    await page.evaluate((value) => localStorage.setItem("pi-locale", value), locale);
    await page.reload();
    await panel.locator("h3").waitFor();
    await panel.getByRole("heading", { name: locale === "en" ? "Today's work queue" : "今日工作队列" }).waitFor();
    for (const width of [375, 900, 1900]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.waitForTimeout(200);
      const sizes = await panel.evaluate((node) => ({ scroll: node.scrollWidth, width: node.clientWidth }));
      assert.ok(sizes.scroll <= sizes.width + 1, `Panel overflow: ${locale}/${width}`);
      assert.equal(await panel.locator('ol li').filter({ hasText: 'Review one architecture decision' }).count(), 0, 'The featured task is not repeated in the remaining queue');
      assert.equal(await panel.locator('details').getAttribute('open'), null, 'Explanatory copy stays collapsed, not in the action path');
      const actions = await panel.locator('[data-running] button, h3 ~ div button').count();
      assert.ok(actions >= 4, 'Start, complete, defer and rest remain directly available');
      if (width === 375) {
        const start = await panel.getByRole('button', { name: locale === 'en' ? 'Start 5 min' : '开始 5 分钟' }).boundingBox();
        const complete = await panel.getByRole('button', { name: locale === 'en' ? 'Mark complete' : '标记完成' }).boundingBox();
        assert.ok(start.height >= 44 && complete.height >= 44, 'Primary actions keep thumb-sized targets');
        assert.ok(Math.abs(start.y - complete.y) < 1 && start.x + start.width <= complete.x, 'Primary actions share one clean row');
      }
      const calendarBox = await page.locator(".robin-calendar").boundingBox();
      const queueBox = await panel.boundingBox();
      assert.ok(queueBox.y >= calendarBox.y + calendarBox.height - 1, "Queue must stay below calendar");
      if (process.env.E2E_SCREENSHOT_DIR) {
        await mkdir(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
        await panel.scrollIntoViewIfNeeded();
        for (const theme of ["light", "dark"]) {
          await page.evaluate((value) => { document.documentElement.dataset.theme = value; document.documentElement.classList.toggle("dark", value === "dark"); }, theme);
          await panel.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/queue-${locale}-${width}-${theme}.png` });
        }
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log("Work queue: confirmation, fitting, timer, reload, write failure, completion, deferral, rest, calendar failure and responsive layout passed.");
  await context.close();
} finally { await browser.close(); }
