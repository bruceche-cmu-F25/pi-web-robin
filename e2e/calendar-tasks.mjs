// Isolated browser, synthetic tasks, all dashboard APIs intercepted. No personal writes.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { fullstackPlan, practicePlan } from "../extension/robin/learning.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const screenshots = process.env.E2E_SCREENSHOT_DIR ?? "/tmp/calendar-tasks";
mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 1200 }, serviceWorkers: "block", reducedMotion: "reduce" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => {
    localStorage.setItem("pi-locale", localStorage.getItem("pi-locale") || "en");
    localStorage.setItem("pi-theme", localStorage.getItem("pi-theme") || "light");
  });
  const today = "2030-05-13";
  const initial = [
    { id: "range", title: "Multi-day project · 跨天项目整理", startDate: "2030-05-10", due: "2030-05-16", color: "iris" },
    ...Array.from({ length: 7 }, (_, i) => ({ id: `task-${i}`, title: `${i} · Prepare the architecture review and explain deployment trade-offs / 整理设计与测试结果`, due: today, url: `https://example.com/task/${i}` })),
    { id: "tomorrow", title: "Tomorrow's independent task", due: "2030-05-14" },
  ].map((todo) => ({ ...todo, done: false, revision: `${todo.id}-1` }));
  let todos = structuredClone(initial), hold = false, release, fail = false, failReads = false;
  const writes = [], errors = [];
  const fixtures = {
    "/api/robin/events": { today, events: [{ id: "event", title: "Morning review", date: today, start: "09:00", end: "10:00" }], google: { connected: false } },
    "/api/robin/jobs": { jobs: [], configured: true }, "/api/robin/links": { links: [] }, "/api/robin/rounds": { rounds: [] },
    "/api/robin/learning": { practice: practicePlan([], "neetcode150", today), fullstack: fullstackPlan([]) },
  };
  await context.route("**/api/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === "GET") return route.fulfill(path === "/api/robin/todos"
      ? failReads ? { status: 503, json: { error: "Read failed" } } : { json: { today, todos } }
      : { json: fixtures[path] ?? {} });
    assert.equal(path, "/api/robin/todos"); assert.equal(request.method(), "PATCH");
    const body = request.postDataJSON(); writes.push(body);
    if (hold) { hold = false; await new Promise((resolve) => { release = resolve; }); }
    if (fail) { fail = false; return route.fulfill({ status: 500, json: { error: "Save failed" } }); }
    const current = todos.find((todo) => todo.id === body.id);
    if (body.done !== true) assert.equal(body.revision, current.revision);
    const saved = { ...current, ...body, revision: `${body.id}-${writes.length + 1}` };
    todos = todos.map((todo) => todo.id === saved.id ? saved : todo);
    return route.fulfill({ json: { todo: saved, today } });
  });
  const page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));
  const calendar = page.locator(".robin-calendar");
  const dayButton = () => calendar.locator('[data-calendar-task-summary="2030-05-13"]');
  const dialog = () => page.getByRole("dialog", { name: /Tasks · 2030-05-13/ });
  const until = async (fn) => { for (let i = 0; i < 200; i++) { if (fn()) return; await page.waitForTimeout(30); } assert.ok(fn()); };
  await page.goto(`/dashboard?calendar=week&date=${today}`);
  await dayButton().waitFor();
  assert.equal(await dayButton().textContent(), `${initial[1].title}+7`, "show a task due that day before an ongoing range");
  assert.equal(await calendar.locator("[data-calendar-task], [data-calendar-todo]").count(), 0, "week view previews a title, not another grid of cards or grips");
  const band = calendar.locator("[data-calendar-tasks]");
  assert.equal((await band.boundingBox()).height, 60);
  assert.equal(await calendar.locator('[data-calendar-task-summary="2030-05-14"]').textContent(), "Tomorrow's independent task+1");
  assert.equal(await calendar.locator('[data-calendar-task-summary="2030-05-15"]').textContent(), initial[0].title, "a lone range shows its title without a redundant count");
  assert.equal(await calendar.locator("[data-calendar-task-empty]").count(), 3);
  const aligned = async () => assert.ok(await calendar.locator('[data-calendar-minute]').evaluateAll((nodes) =>
    nodes.every((node) => Math.abs(node.getBoundingClientRect().top - nodes[0].getBoundingClientRect().top) < 1)), "all seven time columns begin on the same horizontal line");
  await aligned();
  todos.push(...Array.from({ length: 92 }, (_, i) => ({ id: `extra-${i}`, title: `Extra task ${i}`, due: today, done: false })));
  await page.reload(); await dayButton().waitFor();
  assert.equal(await dayButton().textContent(), `${initial[1].title}+99`);
  assert.equal((await band.boundingBox()).height, 60, "100 tasks take the same height as eight");
  await aligned();
  await page.screenshot({ path: `${screenshots}/week-100-tasks.png` });
  todos = structuredClone(initial);
  await page.reload(); await dayButton().waitFor();
  const toggle = calendar.locator("[data-calendar-task-toggle]");
  await toggle.click(); assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await calendar.locator("[data-calendar-task-summary]:visible").count(), 0);
  await toggle.click(); assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  await dayButton().focus(); await page.keyboard.press("Enter"); await dialog().waitFor();
  assert.equal(await dialog().locator("[data-task-detail]").count(), 8);
  assert.equal(await dialog().getByRole("link").first().getAttribute("href"), "https://example.com/task/0");
  assert.ok(await dialog().getByText("Due today", { exact: true }).count());
  assert.ok(await dialog().evaluate((node) => node.matches(":modal")), "native modal makes the calendar behind it inert");
  await dialog().getByRole("checkbox").first().focus();
  await page.keyboard.press("Tab"); assert.ok(await dialog().evaluate((node) => node.contains(document.activeElement)));
  await page.keyboard.press("Shift+Tab"); assert.ok(await dialog().evaluate((node) => node.contains(document.activeElement)));
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-calendar-task-summary") === "2030-05-13");
  assert.equal(writes.length, 0, "opening, reading and collapsing are read-only");

  // Failed completion remains visible; double activation is fenced before React commits.
  await dayButton().click();
  let row = dialog().locator('[data-task-detail="task-6"]');
  await row.scrollIntoViewIfNeeded();
  hold = true; fail = true;
  await row.getByRole("checkbox").evaluate((node) => { node.click(); node.click(); });
  await until(() => release); assert.equal(writes.length, 1);
  assert.equal(await row.getByRole("checkbox").isDisabled(), true);
  assert.equal(await row.getByRole("checkbox").isChecked(), false);
  assert.ok(await row.getByRole("status").isVisible());
  release(); release = undefined;
  await dialog().getByRole("alert").filter({ hasText: "Save failed" }).waitFor();
  assert.equal(await row.getByRole("checkbox").isChecked(), false);
  assert.equal(await row.getByRole("checkbox").isDisabled(), false);
  // Confirmed receipt removes only the completed task even if the refresh fails.
  failReads = true;
  await row.getByRole("checkbox").click();
  await row.waitFor({ state: "detached" });
  assert.equal(todos.find((todo) => todo.id === "task-6").done, true);
  assert.equal(await dialog().locator("[data-task-detail]").count(), 7);
  await dialog().getByRole("alert").filter({ hasText: "Read failed" }).waitFor();
  failReads = false;
  await page.keyboard.press("Escape"); assert.equal(await dayButton().textContent(), `${initial[1].title}+6`);

  // The full-list date action uses the existing revision-checked date editor.
  await dayButton().click();
  await dialog().locator('[data-task-detail="range"]').getByRole("button", { name: /Move Multi-day project/ }).click();
  const editor = page.getByRole("dialog", { name: "Edit task deadline" });
  await editor.waitFor();
  assert.equal(await page.locator("dialog[open]").count(), 1, "close the list before opening the existing date editor");
  assert.equal(await editor.getByLabel("Start date").inputValue(), "2030-05-10");
  assert.equal(await editor.getByLabel("Deadline (optional)").inputValue(), "2030-05-16");
  await page.keyboard.press("Escape");

  // Explicitly cover phone WEEK as well as day: title previews stay a single 60px row.
  for (const locale of ["en", "zh-CN"]) for (const theme of ["light", "dark"]) for (const width of [1600, 1024, 375, 320]) for (const view of ["week", "day"]) {
    todos = structuredClone(initial);
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(({ locale, theme }) => { localStorage.setItem("pi-locale", locale); localStorage.setItem("pi-theme", theme); }, { locale, theme });
    await page.goto(`/dashboard?calendar=${view}&date=${today}`);
    await (view === "week" || width < 960 ? dayButton() : calendar.locator('[data-calendar-task="task-0"]')).waitFor();
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${screenshots}/${locale}-${theme}-${width}-${view}.png` });
    if (view === "week" || width < 960) {
      assert.equal((await band.boundingBox()).height, 60);
      assert.equal(await band.getByRole("checkbox").count(), 0);
      assert.equal(await calendar.locator("[popover], [data-calendar-task]").count(), 0);
      const box = await dayButton().boundingBox(); assert.ok(box.width >= 44 && box.height >= 44);
      await aligned();
      await dayButton().click();
    } else await calendar.getByRole("button", { name: locale === "en" ? /Show 5 more/ : /另外 5 项/ }).click();
    const list = page.locator("dialog[open]"); await list.waitFor();
    assert.equal(await list.locator("[data-task-detail]").count(), 8);
    assert.ok(await list.evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
    const bounds = await list.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= 1101);
    await page.screenshot({ path: `${screenshots}/${locale}-${theme}-${width}-${view}-list.png` });
    await page.keyboard.press("Escape");
  }
  // A past deadline has a text status; completing the last task keeps an empty
  // list open and returns focus to a live calendar control when its trigger is gone.
  todos = [{ id: "older", title: "逾期待办全文测试", due: "2030-05-12", done: false, color: "plum", revision: "older-1" }];
  await page.goto("/dashboard?calendar=day&date=2030-05-12");
  const older = calendar.locator('[data-calendar-task-summary="2030-05-12"]');
  await older.waitFor();
  await older.click();
  const lastList = page.locator("dialog[open]");
  await lastList.getByText("已逾期", { exact: true }).waitFor();
  await lastList.getByRole("checkbox").click();
  await lastList.getByText("这一天没有未完成的待办。", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.classList.contains("robin-calendar-add"));
  assert.deepEqual(errors, []);
  console.log("PASS: bounded 60px week title previews (including 100 tasks), aligned time columns, ranges, day previews, collapse, full list, links, focus, completion guards/failure/receipt, date editor, overdue/empty state, bilingual responsive week/day themes");
} finally { await browser.close(); }
