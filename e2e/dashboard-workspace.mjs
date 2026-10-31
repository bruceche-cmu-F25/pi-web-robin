// Existing dev server. All business reads/writes and agent turns are synthetic.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/dashboard-workspace.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { addDays, localDate } from "../extension/robin/dates.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const output = process.env.E2E_SCREENSHOT_DIR ?? "/tmp/robin-dashboard-workspace";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome", headless: true });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", reducedMotion: "reduce" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => { if (!localStorage.getItem("pi-locale")) localStorage.setItem("pi-locale", "zh-CN"); });
  const today = localDate(), tomorrow = addDays(today, 1);
  let todos = [
    { id: "bank", title: "去银行存钱", due: tomorrow, done: false, revision: "bank-v1", url: "https://example.com/bank", createdAt: new Date().toISOString() },
    ...Array.from({ length: 35 }, (_, i) => ({ id: `task-${i}`, title: `任务 ${i + 1} · ${"完整标题要能够读到，不强迫用户猜测内容。".repeat(2)}`, due: today, done: false, revision: `v${i}`, createdAt: new Date().toISOString() })),
    { id: "done", title: "已完成的旧记录", done: true, completedAt: "2020-01-01T10:00:00Z", revision: "done-v1" },
    { id: "wish", title: "以后想读的书", done: false, revision: "wish-v1" },
  ];
  const events = [{ id: "appointment", title: "银行咨询预约", date: tomorrow, start: "10:00", end: "10:30", source: "local", createdAt: new Date().toISOString() },
    { id: "google", title: "Google 只读日程", date: tomorrow, start: "12:00", end: "13:00", source: "google", calendar: "Work", createdAt: new Date().toISOString() }];
  const links = [{ id: "daily", title: "常用网站", url: "https://example.com", group: "日常入口", iconCheckedAt: today },
    { id: "saved", title: "银行指南", url: "https://example.com/guide", group: "参考资料", iconCheckedAt: today }];
  const writes = [], errors = [], reads = [];
  let failPatch = false, failCalendar = false;
  await context.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (req.method() !== "GET") {
      writes.push({ path, method: req.method(), body: req.postDataJSON() });
      if (path === "/api/robin/todos" && req.method() === "PATCH") {
        if (failPatch) return route.fulfill({ status: 409, json: { error: "Fixture conflict; draft is intact" } });
        const patch = req.postDataJSON(), index = todos.findIndex(t => t.id === patch.id);
        assert.equal(patch.revision, todos[index].revision);
        todos[index] = { ...todos[index], ...patch, revision: `${todos[index].revision}-saved` };
        return route.fulfill({ json: { todo: todos[index], today } });
      }
      if (path === "/api/robin/assistant") {
        todos.push({ id: "captured", title: "周三去银行存钱", due: tomorrow, done: false, revision: "captured-v1" });
        return route.fulfill({ json: { reply: "已记下待办：周三去银行存钱。", usedTools: ["todo_add"], sessionId: "fixture-session" } });
      }
      throw new Error(`Unexpected mutation: ${req.method()} ${path}`);
    }
    reads.push(path);
    const fixture = {
      "/api/robin/todos": { today, todos },
      "/api/robin/events": { today, events, google: { connected: true } },
      "/api/robin/links": { links },
      "/api/robin/rounds": { rounds: [] },
      "/api/robin/gmail": { today, connected: true, review: null },
      "/api/robin/jobs": { jobs: [], configured: true },
      "/api/robin/assistant": { running: false, sessionId: null },
      "/api/robin/planner": { today, to: addDays(today, 6), todos, events, google: { connected: true }, conflicts: [], minuteOfDay: 600, timezone: "UTC", now: new Date().toISOString(), revision: "plan-v1" },
    }[path] ?? {};
    if (path === "/api/robin/events" && failCalendar) return route.fulfill({ status: 503, json: { error: "Fixture calendar unavailable" } });
    return route.fulfill({ json: fixture });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const hideDev = () => page.addStyleTag({ content: "nextjs-portal { display:none !important; }" });
  const nav = () => page.getByRole("navigation", { name: "首页", exact: true });
  const select = name => nav().getByRole("button", { name: name === "日常" ? "首页" : name, exact: true }).click();
  const palette = () => page.locator(".robin-command-dialog[open]");
  const launchSearch = () => page.getByRole("button", { name: "找一找", exact: true }).click();
  const closePalette = () => palette().getByRole("button", { name: "关闭", exact: true }).click();
  const quickAdd = () => page.getByRole('dialog', { name: '新建', exact: true });
  const openQuickAdd = () => page.getByRole('button', { name: '新建', exact: true }).click();
  const launchCapture = async () => { await openQuickAdd(); await quickAdd().getByRole('button', { name: '交代一件事', exact: true }).click(); };
  await page.goto(`/dashboard?session=fixture-workspace&date=${tomorrow}`); await hideDev();
  await page.locator('.robin-dashboard-header h1 time').waitFor();
  await nav().waitFor();
  assert.equal(await page.getByRole('heading', { name: '日历', exact: true }).count(), 0, 'Today does not repeat the Calendar destination heading');
  assert.equal(await nav().getByRole("button").count(), 4);
  assert.equal(await page.locator(".robin-mobile-nav-trigger:visible").count(), 0);
  assert.equal(await page.locator("[data-calendar-minute]:visible").count(), 0);
  assert.equal(await page.locator("#dashboard-todos:visible").count(), 0);
  assert.equal(reads.includes("/api/robin/planner"), false, "Daily does not load planning tools");
  assert.equal(await page.locator('#dashboard-jobs').count(), 0, "The job inventory stays unmounted; navigation badges retain their own reads");
  assert.deepEqual(writes, []);
  await page.screenshot({ path: `${output}/daily-390.png` });
  await openQuickAdd();
  assert.equal(await quickAdd().getByRole('link').count(), 2);
  await page.keyboard.press('Escape');
  assert.equal(await quickAdd().count(), 0);
  assert.equal(await page.getByRole('button', { name: '新建', exact: true }).evaluate(el => el === document.activeElement), true);
  assert.deepEqual(writes, [], 'Opening or cancelling quick add does not write or call the assistant');

  await select("日历");
  await page.locator('.robin-calendar select').waitFor();
  await page.locator('[data-single] [data-calendar-minute]:visible').waitFor();
  assert.equal(await page.locator('.robin-calendar [data-calendar-toolbar] select').inputValue(), "day");
  assert.equal(await page.locator("[data-calendar-minute]:visible").count(), 1);
  await select("日常");
  await page.goto(`/dashboard?view=daily&dailyDate=${tomorrow}&session=fixture-workspace`);
  await page.getByRole("link", { name: /银行咨询预约/ }).click();
  let detail = page.locator(".calendar-event-dialog[open]");
  await detail.waitFor();
  assert.ok((await detail.innerText()).includes("银行咨询预约"));
  await detail.getByRole("button", { name: "关闭", exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get("event"), null);

  await select("待办");
  await page.getByRole("button", { name: "查看待办：去银行存钱", exact: true }).click();
  const taskDialog = () => page.getByRole("dialog", { name: "待办详情", exact: true });
  await taskDialog().waitFor();
  await taskDialog().getByLabel("任务", { exact: true }).fill("去银行存钱并核对余额");
  failPatch = true;
  await taskDialog().getByRole("button", { name: "保存", exact: true }).click();
  await taskDialog().getByRole("alert").waitFor();
  assert.equal(await taskDialog().getByLabel("任务", { exact: true }).inputValue(), "去银行存钱并核对余额");
  assert.equal(todos[0].title, "去银行存钱");
  failPatch = false;
  await taskDialog().getByRole("button", { name: "保存", exact: true }).click();
  await taskDialog().getByRole("status").waitFor();
  assert.equal(todos[0].title, "去银行存钱并核对余额");
  await taskDialog().getByRole("button", { name: "关闭", exact: true }).first().click();
  await page.getByRole("button", { name: "已完成", exact: true }).click();
  assert.ok((await page.locator('#dashboard-todos').innerText()).includes("已完成的旧记录"));
  await page.getByRole("button", { name: "全部未完成", exact: true }).click();
  const scroll = page.locator('.robin-page');
  await scroll.evaluate(el => { el.scrollTop = 620; }); await page.waitForTimeout(100);
  const before = await scroll.evaluate(el => el.scrollTop);
  await select("日历"); await select("待办");
  await page.waitForTimeout(150);
  assert.ok(Math.abs(await scroll.evaluate(el => el.scrollTop) - before) < 3, "Switching tabs restores the task list position");
  await page.goBack(); await page.waitForTimeout(100);
  assert.equal(await nav().getByRole("button", { name: "日历", exact: true }).getAttribute("aria-current"), "page");
  await page.goForward();
  await openQuickAdd();
  await quickAdd().getByRole('link', { name: '自己添加待办', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get('session'), 'fixture-workspace');
  await page.locator('#robin-todo-form').getByLabel("任务", { exact: true }).fill("尚未提交的手动记录");
  assert.equal(await page.locator('#robin-todo-form input[type="date"]').first().isVisible(), false);
  await page.locator('#robin-todo-form summary').click();
  await page.locator('#robin-todo-form input[type="date"]').first().fill(today);
  await page.locator('#robin-todo-form input[type="date"]').last().fill(tomorrow);
  await select("日历"); await select("待办");
  assert.equal(await page.locator('#robin-todo-form').getByLabel("任务", { exact: true }).inputValue(), "尚未提交的手动记录", "Tab switching preserves the unsubmitted form");
  await page.locator('#dashboard-todos > header').getByRole('button', { name: '取消', exact: true }).click();
  await select('日历');
  await openQuickAdd();
  await quickAdd().getByRole('link', { name: '自己添加日程', exact: true }).click();
  await page.locator('#robin-calendar-form').waitFor();
  assert.equal(await page.locator('#robin-calendar-form').getByRole('checkbox').isChecked(), true, "Manual quick capture does not invent a time");
  await page.locator('#robin-calendar-form').getByRole('button', { name: '取消', exact: true }).click();

  await launchSearch();
  await palette().locator("input").fill("银行");
  await palette().locator(".robin-search-row").nth(2).waitFor();
  assert.ok((await palette().innerText()).includes("过去 30 天"));
  const writesBeforeSearch = writes.length;
  await palette().getByRole("link", { name: /去银行存钱并核对余额/ }).click();
  await taskDialog().waitFor();
  assert.equal(await palette().count(), 0);
  assert.equal(new URL(page.url()).searchParams.get("session"), "fixture-workspace");
  assert.equal(writes.length, writesBeforeSearch, "Opening search results is read-only");
  await taskDialog().getByRole("button", { name: "关闭", exact: true }).first().click();
  await launchSearch();
  await palette().locator("input").fill("银行咨询预约");
  await palette().getByRole("link", { name: /银行咨询预约/ }).click();
  await page.locator(".calendar-event-dialog[open]").waitFor();
  await page.locator(".calendar-event-dialog[open]").getByRole("button", { name: "关闭", exact: true }).click();
  await launchSearch(); await palette().locator('input').fill('Google 只读日程');
  await palette().getByRole('link', { name: /Google 只读日程/ }).click();
  await page.locator('.calendar-event-dialog[open]').waitFor();
  assert.equal(await page.locator('.calendar-event-dialog[open]').getByRole('button', { name: /编辑|删除/ }).count(), 0, 'Google remains read-only in record search');
  await page.locator('.calendar-event-dialog[open]').getByRole('button', { name: '关闭', exact: true }).click();

  // Closing capture keeps its draft; reopening does not submit it.
  await launchCapture();
  await palette().locator("input").fill("周三去银行存钱");
  await closePalette();
  await launchCapture();
  assert.equal(await palette().locator("input").inputValue(), "周三去银行存钱");
  await palette().locator('button[type="submit"]').click();
  await palette().getByText("已记下待办：周三去银行存钱。", { exact: true }).waitFor();
  await closePalette();
  assert.equal(writes.filter(w => w.path === "/api/robin/assistant").length, 1);

  await select("日常");
  await page.getByRole("link", { name: /帮我安排一下/ }).click();
  await page.getByRole("dialog", { name: "本周计划", exact: true }).waitFor();
  assert.equal(writes.filter(w => w.path === "/api/robin/planner").length, 0, "Opening the planner never accepts or extracts");
  await page.getByRole("dialog", { name: "本周计划", exact: true }).getByRole("button", { name: /关闭/ }).first().click();
  await select("日常");
  await page.getByRole("link", { name: /全部收藏链接/ }).click();
  await page.locator('#dashboard-links').waitFor({ state: 'visible' });
  assert.ok(await page.locator('[data-disclosure="dashboard-links"]').getAttribute("open") !== null);
  await page.locator('[data-disclosure="dashboard-links"] > summary').click();
  await page.reload(); await hideDev();
  // Explicit bookmarked hash wins over a collapsed preference.
  await page.locator('#dashboard-links').waitFor({ state: 'visible' });
  await select("日常");
  failCalendar = true;
  await launchSearch(); await palette().locator("input").fill("银行");
  await palette().getByText(/日程搜索不完整/).waitFor();
  assert.ok(await palette().getByRole('link', { name: /去银行存钱并核对余额/ }).count());
  await closePalette(); failCalendar = false;

  for (const width of [320, 390, 812, 1440]) {
    await page.setViewportSize({ width, height: width === 812 ? 390 : 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle("dark", theme === "dark"); }, theme);
      await page.waitForTimeout(120);
      assert.ok(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${width}: no horizontal content overflow`);
      if (width < 960) {
        const box = await nav().boundingBox();
        assert.ok(box.y + box.height <= (width === 812 ? 390 : 900), "Bottom navigation stays inside the viewport");
        for (const button of await nav().getByRole('button').all()) assert.ok((await button.boundingBox()).height >= 44);
        await openQuickAdd();
        const sheet = await quickAdd().boundingBox();
        assert.ok(sheet.x >= 0 && sheet.x + sheet.width <= width + 1);
        assert.ok(sheet.y >= 0 && sheet.y + sheet.height <= (width === 812 ? 390 : 900) + 1);
        assert.equal(await quickAdd().evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
        await page.screenshot({ path: `${output}/quick-add-${width}-${theme}.png` });
        await quickAdd().getByRole('button', { name: '关闭', exact: true }).click();
      } else {
        assert.equal(await page.locator('.robin-calendar:visible').count(), 1);
        assert.equal(await page.locator('#dashboard-todos:visible').count(), 1);
      }
      await page.screenshot({ path: `${output}/workspace-${width}-${theme}.png` });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.setAttribute('data-keyboard-open', ''));
  assert.equal(await nav().isVisible(), false, 'Keyboard mode removes bottom controls instead of covering inputs');
  await page.evaluate(() => { document.documentElement.removeAttribute('data-keyboard-open'); localStorage.setItem('pi-locale', 'en'); });
  await page.goto('/dashboard?view=daily'); await hideDev();
  await page.locator('.robin-dashboard-header h1 time').waitFor();
  assert.equal(await page.getByRole('navigation', { name: 'Home', exact: true }).getByRole('button').count(), 4);
  await page.locator('.robin-page').evaluate(node => node.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(150);
  assert.equal(await page.getByRole('navigation', { name: 'Home', exact: true }).count(), 1, 'English survives hydration');
  await page.screenshot({ path: `${output}/daily-english-390.png` });
  assert.deepEqual(writes.map(w => `${w.method} ${w.path}`), ['PATCH /api/robin/todos', 'PATCH /api/robin/todos', 'POST /api/robin/assistant']);
  assert.deepEqual(errors, []);
  await context.close();
  console.log(`PASS: four mobile destinations, desktop comparison, date agenda, records, failed-save drafts, search, capture, planning opt-in, navigation restoration and 320–1440px; screenshots ${output}`);
} finally { await browser.close(); }
