// Existing dev server. Mock every dashboard API; never write personal records.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { scheduleWeek, focusEvents } from "../extension/robin/planner.ts";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) {
    const login = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(login.ok(), `Login failed: ${login.status()}`);
  }
  await context.addInitScript(() => { if (!localStorage.getItem("pi-locale")) localStorage.setItem("pi-locale", "en"); });
  const today = "2030-05-13", to = "2030-05-19";
  const todos = [{ id: "assignment", title: "Write the systems assignment", due: "2030-05-16", estimateMinutes: 120, done: false, createdAt: "2030-05-01T10:00:00Z", revision: "v1", loggedMinutes: 0 }];
  const events = [{ id: "class", title: "Class", date: today, start: "10:00", end: "11:00", createdAt: "" },
    { id: "google:class-copy", title: "Class", date: today, start: "10:00", end: "11:00", source: "google", createdAt: "" }];
  const writes = [];
  let incomplete = false, failAccept = true;
  const board = () => ({ todos: todos.filter((t) => !t.done), events, today, to, now: "2030-05-13T15:00:00Z", minuteOfDay: 480, timezone: "America/Los_Angeles", revision: "revision", conflicts: [], google: { connected: true, ...(incomplete ? { error: "Google unavailable" } : {}) } });
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === "/api/robin/planner") {
      if (method === "GET") return route.fulfill({ json: board() });
      const body = route.request().postDataJSON(); writes.push(body);
      if (body.action === "extract") return route.fulfill({ json: { capture: { tasks: [{ title: "Run the experiment", minutes: 180, continuous: true, estimated: true }], events: [{ title: "Interview", date: "2030-05-17" }], questions: ["What time is the interview?"] } } });
      if (body.action === "capture") {
        todos.push(...body.capture.tasks.map((t, i) => ({ ...t, id: `capture:${i}`, estimateMinutes: t.minutes, estimateSource: t.estimated ? "agent" : undefined, done: false, createdAt: "", revision: "v1", loggedMinutes: 0, workPlan: { continuous: t.continuous, blocks: [] } })));
        events.push(...body.capture.events.map((e, i) => ({ ...e, id: `event:${i}`, createdAt: "" })));
        return route.fulfill({ json: { ids: body.capture.tasks.map((_, i) => `capture:${i}`) } });
      }
      if (body.action === "preview") return route.fulfill({ json: { revision: "revision", generatedAt: board().now, options: body.options, selected: body.selected, replace: body.replace, plan: scheduleWeek(todos, events, body.selected, body.options, today, 480, body.replace) } });
      if (body.action === "accept") {
        if (failAccept) return route.fulfill({ status: 409, json: { error: "Calendar changed; generate a new preview" } });
        for (const todo of todos) todo.workPlan = { continuous: false, blocks: body.proposal.plan.blocks.filter((b) => b.todoId === todo.id).map((b, i) => ({ ...b, id: String(i) })) };
        return route.fulfill({ json: { success: true } });
      }
      throw new Error(`Unexpected planner action ${body.action}`);
    }
    if (path === "/api/robin/todos") return route.fulfill({ json: { todos, today } });
    if (path === "/api/robin/events") return route.fulfill({ json: { today, events: [...events, ...focusEvents(todos, today)], google: { connected: true } } });
    const data = { "/api/robin/rounds": { rounds: [] }, "/api/robin/gmail": { connected: false, today, review: null }, "/api/robin/jobs": { jobs: [], minScore: 4, configured: true }, "/api/robin/links": { links: [] } };
    return route.fulfill({ json: data[path] ?? {} });
  });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await mkdir("outputs/weekly-planner", { recursive: true });
  await page.goto("/dashboard?calendar=agenda");
  const panel = page.locator("#dashboard-planner"), dialog = page.getByRole("dialog", { name: "Weekly planner" });
  await panel.getByRole("button", { name: "Plan my week" }).waitFor();
  const calendarBox = await page.locator(".robin-calendar").boundingBox(), plannerBox = await panel.boundingBox();
  assert.ok(plannerBox.y >= calendarBox.y + calendarBox.height, "Planner must follow the calendar");
  await panel.getByRole("button", { name: "Plan my week" }).click();
  await dialog.getByText("Write the systems assignment", { exact: true }).waitFor();
  assert.equal(writes.length, 0);
  assert.equal(await dialog.getByRole("button", { name: "Close planner" }).evaluate((el) => el === document.activeElement), true);
  const taskChoice = dialog.getByRole("checkbox", { name: /Write the systems assignment/ });
  await taskChoice.uncheck();
  assert.equal(await taskChoice.isVisible(), true, "deselecting must not make the row disappear");
  await taskChoice.check();
  await dialog.getByRole("textbox", { name: "What needs to happen this week?" }).fill("Run the experiment and interview Friday");
  await dialog.getByRole("button", { name: "Organize my note" }).click();
  await dialog.getByText("What time is the interview?", { exact: true }).waitFor();
  await dialog.getByText("No start time: shown as an all-day entry, without blocking time. Add the time if known.", { exact: true }).waitFor();
  assert.equal(todos.length, 1, "extraction has no writes");
  await dialog.getByLabel("Start", { exact: true }).first().fill("14:00");
  await dialog.getByLabel("End", { exact: true }).first().fill("15:00");
  const captureTask = dialog.getByLabel("Task title").locator("..").locator("..");
  await captureTask.getByRole("button", { name: "2h", exact: true }).click();
  await dialog.getByRole("button", { name: "Add & preview" }).click();
  await dialog.getByRole("heading", { name: "Proposed week" }).waitFor();
  assert.equal(todos.length, 2);
  assert.equal(todos[1].estimateMinutes, 120);
  assert.equal(todos[1].estimateSource, undefined);
  assert.equal(writes.filter((w) => w.action === "extract").length, 1);
  const timetable = dialog.locator("[data-planner-timeline]");
  assert.equal(await timetable.getAttribute("data-view"), "week");
  assert.equal(await timetable.locator('[data-planner-entry="class"]').count(), 1);
  assert.equal(await timetable.locator('[data-planner-entry="google:class-copy"]').count(), 0, "preview must not duplicate a matching imported appointment");
  const geometry = await timetable.locator('[data-kind="proposed"][data-planner-entry]').evaluateAll((nodes) => nodes.map((node) => ({ height: node.getBoundingClientRect().height, duration: Number(node.dataset.end) - Number(node.dataset.start) })));
  assert.ok(geometry.length > 1);
  for (const block of geometry) assert.ok(Math.abs((block.height + 2) / block.duration - 1.1) < 0.03, "block heights must represent duration");
  const beforeInspect = writes.length;
  await timetable.locator('[data-kind="proposed"][data-planner-entry]').first().click();
  const slot = page.getByRole("dialog", { name: "Write the systems assignment", exact: true });
  await slot.waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await slot.isVisible(), false);
  assert.equal(await dialog.isVisible(), true, "Escape closes only the nested slot detail");
  await timetable.locator('[data-kind="proposed"][data-planner-entry]').first().click();
  await slot.getByRole("button", { name: "Adjust this task" }).click();
  const effort = dialog.getByRole("button", { name: "Adjust estimate for Write the systems assignment", exact: true });
  assert.equal(await effort.getAttribute("aria-expanded"), "true");
  assert.equal(await effort.evaluate((el) => el === document.activeElement), true);
  await timetable.getByRole("button", { name: "Day", exact: true }).click();
  assert.equal(await timetable.getAttribute("data-view"), "day");
  await timetable.getByRole("button", { name: "This week", exact: true }).click();
  assert.equal(writes.length, beforeInspect, "inspecting/view switching cannot write or regenerate a plan");
  await page.screenshot({ path: "outputs/weekly-planner/proposed-desktop.png" });
  await dialog.getByRole("button", { name: "Accept this plan" }).click();
  await dialog.getByText("Calendar changed; generate a new preview", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("heading", { name: "Proposed week" }).count(), 1, "failed acceptance retains preview");
  assert.equal(todos[0].workPlan, undefined);
  failAccept = false;
  await dialog.getByRole("button", { name: /Preview schedule/i }).click();
  await dialog.getByRole("button", { name: "Accept this plan" }).click();
  await dialog.getByText("Plan saved. Your calendar now shows these focus slots.", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Close planner" }).click();
  await panel.getByRole("button", { name: "Did this block" }).first().waitFor();
  assert.equal(await panel.getByRole("button", { name: "Did this block" }).first().isDisabled(), true);
  await page.reload();
  await panel.getByText("Write the systems assignment", { exact: true }).first().waitFor();
  await page.locator(".robin-calendar").getByText(/^1\/\d+ · Write the systems assignment$/).first().waitFor();
  assert.ok(todos.every((t) => !t.done));

  incomplete = true;
  await page.reload();
  await panel.getByRole("button", { name: "Plan my week" }).click();
  await dialog.getByText("Google unavailable", { exact: false }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: /Preview schedule/i }).isDisabled(), true);
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), false);
  incomplete = false;
  await mkdir("outputs/weekly-planner", { recursive: true });
  for (const locale of ["en", "zh-CN"]) {
    await page.evaluate((value) => localStorage.setItem("pi-locale", value), locale);
    for (const [width, height, theme] of [[1440, 1000, "light"], [375, 812, "dark"], [320, 740, "light"], [812, 375, "dark"]]) {
      await page.setViewportSize({ width, height });
      await page.reload();
      await page.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), theme);
      await panel.getByRole("button", { name: locale === "en" ? "Plan my week" : "安排我的一周" }).click();
      const modal = page.locator("dialog[open]");
      await modal.getByRole("button", { name: locale === "en" ? /Preview schedule/i : "预览排期" }).click();
      await modal.getByRole("heading", { name: locale === "en" ? "Proposed week" : "本周排期草案" }).waitFor();
      assert.ok(await modal.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `modal overflow ${locale} ${width}`);
      const close = await modal.getByRole("button", { name: locale === "en" ? "Close planner" : "关闭计划面板" }).boundingBox();
      assert.ok(close && close.y >= 0 && close.y + close.height <= height, `close must remain visible ${locale} ${width}`);
      const footerButton = await modal.locator("footer button").last().boundingBox();
      assert.ok(footerButton && footerButton.y + footerButton.height <= height, `primary action stays visible ${locale} ${width}`);
      const chart = modal.locator("[data-planner-timeline]");
      assert.equal(await chart.getAttribute("data-view"), width < 960 ? "day" : "week");
      assert.ok(await chart.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `timeline overflow ${width}`);
      if (width < 960) {
        const beforeView = writes.length;
        await chart.getByRole("group", { name: locale === "en" ? "Choose a day" : "选择一天" }).getByRole("button").nth(4).click();
        await chart.locator('[data-planner-entry="event:0"]').waitFor();
        assert.equal(writes.length, beforeView);
        await chart.getByRole("group", { name: locale === "en" ? "Choose a day" : "选择一天" }).getByRole("button").first().click();
      }
      await page.screenshot({ path: `outputs/weekly-planner/${locale}-${width}-${theme}.png` });
      await page.keyboard.press("Escape");
    }
  }
  // A recurring all-day entry must not block any time or require checkboxes, including
  // standalone iOS safe areas (desktop emulation otherwise reports zero insets).
  todos.splice(0, todos.length, { id: "due", title: "Assignment due today", due: today, estimateMinutes: 60, done: false, createdAt: "", revision: "v2", loggedMinutes: 0 });
  events.splice(0, events.length, ...Array.from({ length: 7 }, (_, i) => ({ id: `reminder:${i}`, colorSeed: "daily-reminder", title: "Watch algorithm videos", date: `2030-05-${13 + i}`, source: "google", createdAt: "" })));
  events.push({ id: "no-end", title: "Pick up family", date: today, start: "09:00", createdAt: "" });
  await page.setViewportSize({ width: 402, height: 874 });
  await page.evaluate(() => localStorage.setItem("pi-locale", "en"));
  await page.reload();
  await panel.getByRole("button", { name: "Plan my week" }).click();
  await dialog.evaluate((el) => { el.style.setProperty("--planner-safe-top", "62px"); el.style.setProperty("--planner-safe-bottom", "34px"); });
  await dialog.getByRole("button", { name: /Preview schedule/i }).click();
  await dialog.getByRole("button", { name: "Accept this plan" }).waitFor();
  assert.equal(await dialog.getByRole("checkbox", { name: /Reminder only/ }).count(), 0, "all-day entries need no per-event permission");
  assert.equal(await timetable.locator('[data-date="2030-05-13"]').getAttribute("data-unavailable"), "false");
  await timetable.getByRole("button", { name: /Watch algorithm videos/ }).waitFor();
  assert.equal(await timetable.locator('[data-planner-entry="no-end"]').count(), 0, "missing ends must not stretch across the grid");
  await timetable.getByRole("button", { name: /09:00–\?.*Pick up family.*Does not block time/ }).click();
  const marker = page.getByRole("dialog", { name: "Pick up family", exact: true });
  await marker.getByText("No end time: shown as a reminder, without reserving time or causing conflicts.", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), true);
  assert.equal(await timetable.locator('[data-kind="proposed"][data-planner-entry]').first().getAttribute("data-start"), "540", "the missing end cannot delay work at 09:00");
  assert.equal(writes.at(-1).options.reminderEventIds, undefined);
  assert.equal(todos[0].workPlan, undefined, "previewing still reserves nothing");
  const closeSafe = await dialog.getByRole("button", { name: "Close planner" }).boundingBox();
  assert.ok(closeSafe.y >= 62, "close must clear the iOS status bar");
  const acceptSafe = await dialog.getByRole("button", { name: "Accept this plan" }).boundingBox();
  assert.ok(acceptSafe.y + acceptSafe.height <= 874 - 34, "footer must clear the home indicator");
  const beforeBack = writes.length;
  await dialog.getByRole("button", { name: "← Back to tasks" }).click();
  await dialog.getByRole("checkbox", { name: /Assignment due today/ }).waitFor();
  await dialog.getByRole("button", { name: "Timetable", exact: true }).click();
  assert.equal(writes.length, beforeBack);
  await page.screenshot({ path: "outputs/weekly-planner/reminder-safe-area.png" });
  await dialog.getByRole("button", { name: "Close planner" }).click();
  assert.equal(await dialog.isVisible(), false);
  await panel.getByRole("button", { name: "Plan my week" }).click();
  assert.equal(await dialog.getByRole("button", { name: "Accept this plan" }).isVisible(), true, "back/close preserves the draft");
  await dialog.getByRole("button", { name: "Accept this plan" }).click();
  await dialog.getByText("Plan saved.", { exact: false }).waitFor();
  assert.equal(events.length, 8, "the original calendar remains intact");
  // Deadline work uses the evening only when the normal window is full.
  await dialog.getByRole("button", { name: "Close planner" }).click();
  todos.splice(0, todos.length, { id: "deadline", title: "Submit assignment tonight", due: today, estimateMinutes: 120, done: false, createdAt: "", revision: "v3", loggedMinutes: 0 });
  events.splice(0, events.length,
    { id: "workday", title: "Daytime commitments", date: today, start: "09:00", end: "18:00", createdAt: "" },
    { id: "dinner", title: "Dinner", date: today, start: "20:00", end: "20:30", createdAt: "" });
  await page.reload();
  await panel.getByRole("button", { name: "Plan my week" }).click();
  await dialog.getByRole("button", { name: /Preview schedule/i }).click();
  await dialog.getByText("2h moved to evening overflow", { exact: false }).waitFor();
  const evening = timetable.locator('[data-kind="proposed"][data-planner-entry]');
  assert.equal(await evening.count(), 2);
  const slots = await evening.evaluateAll((nodes) => nodes.map((node) => ({ start: Number(node.dataset.start), end: Number(node.dataset.end), label: node.getAttribute("aria-label") })));
  assert.ok(slots.every((b) => b.start >= 1140 && b.end <= 1320 && (b.end <= 1185 || b.start >= 1245) && b.label.includes("Evening overflow")));
  assert.equal(todos[0].workPlan, undefined);
  await dialog.getByRole("button", { name: "← Back to tasks" }).click();
  await dialog.locator("summary").filter({ hasText: "Work preferences" }).click();
  const eveningChoice = dialog.getByRole("checkbox", { name: "Use 19:00–22:00 if deadline work cannot fit" });
  await eveningChoice.uncheck();
  await dialog.getByRole("button", { name: /Preview schedule/i }).click();
  await dialog.getByText("No new slots fit.", { exact: false }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Accept this plan" }).count(), 0);
  await dialog.getByRole("button", { name: "← Back to tasks" }).click();
  await eveningChoice.check();
  await dialog.getByRole("button", { name: /Preview schedule/i }).click();
  await dialog.getByRole("button", { name: "Accept this plan" }).waitFor();
  await evening.last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: "outputs/weekly-planner/evening-overflow.png" });
  await dialog.getByRole("button", { name: "Accept this plan" }).click();
  await dialog.getByText("Plan saved.", { exact: false }).waitFor();
  assert.ok(todos[0].workPlan.blocks.every((b) => b.evening));
  await dialog.getByRole("button", { name: "Close planner" }).click();
  await page.reload();
  await panel.getByRole("button", { name: "Plan my week" }).click();
  assert.ok(await timetable.locator('[data-kind="confirmed"][data-planner-entry]').count() > 0, "accepted evening slots remain on the grid after reload");
  assert.deepEqual(errors, []);
  console.log("Weekly planner: capture, quick effort, preview, conflict, accept, reload, partial calendar, desktop/phone/landscape and both languages passed.");
  await context.close();
} finally { await browser.close(); }
