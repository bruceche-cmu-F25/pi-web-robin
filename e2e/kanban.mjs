// Existing dev server; all Robin APIs mocked so this never changes personal tasks.
// node --env-file-if-exists=.env.local e2e/kanban.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
let testPage;
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  if (process.env.PI_WEB_PASSWORD) {
    const login = await context.request.post("/api/web-auth", {
      headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD },
    });
    assert.ok(login.ok(), `Login failed (${login.status()})`);
  }
  await context.addInitScript(() => { if (!localStorage.getItem("pi-locale")) localStorage.setItem("pi-locale", "en"); localStorage.setItem("pi-theme", "light"); });
  const page = await context.newPage();
  testPage = page;
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.error("Browser error:", error.message); });
  let todos = [
    { id: "legacy", title: "Write the project brief", done: false, due: "2030-05-12", plannedOn: "2030-05-12", createdAt: "2030-05-01T00:00:00Z" },
    { id: "doing", title: "Design the first iteration", done: false, status: "doing", plannedOn: "2030-05-12", createdAt: "2030-05-01T00:00:00Z" },
    { id: "done", title: "Gather references", done: true, createdAt: "2030-05-01T00:00:00Z", completedAt: "2030-05-12T18:00:00Z" },
    { id: "pool", title: "Send the short follow-up", done: false, due: "2030-05-15", createdAt: "2030-05-01T00:00:00Z" },
    { id: "overdue", title: "Confirm the old assignment", done: false, due: "2030-05-01", createdAt: "2030-05-01T00:00:00Z" },
    { id: "abandon", title: "Expired event registration", done: false, due: "2030-05-02", createdAt: "2030-05-01T00:00:00Z" },
  ];
  const editable = (todo) => ({ ...todo, revision: createHash("sha256").update(JSON.stringify([todo])).digest("hex") });
  let lastWrite;
  let failNext = false;
  let revision = 0;
  let calendarError;
  await page.route("**/api/robin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/robin/kanban") {
      if (route.request().method() === "GET") return route.fulfill({ json: {
        today: "2030-05-12", timezone: "America/Los_Angeles", google: { connected: true, error: calendarError },
        capacity: [{ date: "2030-05-12", freeMinutes: 240, remainingMinutes: 60, plannedCount: 2, plannedMinutes: 60, remainingTasks: 1, allDayCount: 1, unknownEnds: 0, unknownEstimates: 2, overbooked: false }],
      } });
      const body = route.request().postDataJSON();
      if (body.action === "generate") return route.fulfill({ json: { revision: String(revision), suggestion: {
        items: [{ id: "pool", plannedOn: "2030-05-12", estimateMinutes: 30, reason: "A short concrete task before its deadline" }],
      } } });
      if (body.revision !== String(revision)) return route.fulfill({ status: 400, json: { error: "Tasks or calendar changed; regenerate the plan before accepting" } });
      for (const item of body.suggestion.items) Object.assign(todos.find((todo) => todo.id === item.id), { plannedOn: item.plannedOn, estimateMinutes: item.estimateMinutes, estimateSource: "agent" });
      revision++;
      return route.fulfill({ json: { success: true } });
    }
    if (path !== "/api/robin/todos") {
      return route.fulfill({ json: { review: null, jobs: [], records: [], events: [], rounds: [], finals: {} } });
    }
    const method = route.request().method();
    if (method !== "GET" && failNext) {
      failNext = false;
      return route.fulfill({ status: 500, json: { error: "Test save failed" } });
    }
    const body = method === "GET" ? {} : route.request().postDataJSON();
    const { revision: expected, ...fields } = body;
    if (method !== "GET") lastWrite = body;
    const existing = todos.find((todo) => todo.id === fields.id);
    if (expected && existing && expected !== editable(existing).revision) return route.fulfill({ status: 409, json: { error: "Task changed; reload the latest version before saving" } });
    if (method === "POST") {
      todos.push({ ...fields, id: "added", done: fields.status === "done", createdAt: "2030-05-12T00:00:00Z" });
    } else if (method === "PATCH") {
      if (fields.next) for (const todo of todos) delete todo.next;
      todos = todos.map((todo) => {
        if (todo.id !== fields.id) return todo;
        if (fields.review === "abandon") return { ...todo, archivedAt: "2030-05-12T18:00:00Z", plannedOn: undefined, next: undefined };
        if (fields.review === "continue" || fields.review === "restore") return { ...todo, archivedAt: undefined, reviewAfter: "2030-05-19", plannedOn: undefined };
        return { ...todo, ...fields, ...(fields.status ? { done: fields.status === "done", ...(fields.status === "done" ? { next: undefined, completedAt: "2030-05-12T18:00:00Z" } : { completedAt: undefined }) } : {}) };
      });
    } else if (method === "DELETE") {
      todos = todos.filter((todo) => todo.id !== route.request().postDataJSON().id);
    }
    if (method !== "GET") {
      for (const todo of todos) {
        for (const key of ["startDate", "due", "plannedOn", "url"]) if (todo[key] === "") delete todo[key];
        if (todo.estimateMinutes === null) delete todo.estimateMinutes;
      }
      revision++;
    }
    const changed = todos.find((todo) => todo.id === (method === "POST" ? "added" : fields.id));
    return route.fulfill({ json: { todos: todos.map(editable), ...(changed ? { todo: editable(changed) } : {}), today: "2030-05-12" } });
  });
  await page.goto("/dashboard/kanban?session=kanban-test");
  const card = (id) => page.locator(`[data-todo-id="${id}"]`);
  const column = (status) => page.locator(`[data-column="${status}"]`);
  const settled = () => page.locator('[aria-busy="false"]').waitFor();
  await card("legacy").waitFor();
  assert.equal(await page.locator('a[aria-current="page"]').count(), 0, "Kanban is no longer a navigation tab");
  assert.equal(await column("todo").locator("article").count(), 1);
  assert.equal(await column("done").locator("article").count(), 1);
  assert.equal(await card("pool").count(), 0, "Today is not the entire backlog");
  assert.equal(await card("overdue").count(), 0, "Overdue clutter lives in review");

  const paint = (locator) => locator.evaluate((el) => {
    const css = getComputedStyle(el);
    return { background: css.backgroundColor, color: css.color, border: css.border, outline: css.outlineStyle, shadow: css.boxShadow, transition: css.transitionDuration };
  });
  // Both themes use color, never a new edge or a shifting hit target.
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; document.documentElement.classList.toggle("dark", value === "dark"); }, theme);
    await page.getByRole("heading", { name: "Kanban", exact: true }).hover();
    const before = await paint(card("legacy"));
    const bounds = await card("legacy").boundingBox();
    await card("legacy").hover({ position: { x: 20, y: 20 } });
    const hovered = await paint(card("legacy"));
    assert.notEqual(hovered.background, before.background, `${theme}: card hover changes its surface`);
    assert.equal(hovered.border, before.border, `${theme}: hover does not change borders`);
    assert.equal(hovered.outline, "none");
    assert.equal(hovered.shadow, before.shadow, "No simulated border via box-shadow");
    assert.deepEqual(await card("legacy").boundingBox(), bounds, "Hover targets do not move");
    const selected = page.getByRole("navigation", { name: "Focus views" }).getByRole("button", { name: /Today/ });
    assert.equal((await paint(selected)).border.startsWith("0px"), true, "Selected view has no underline border");
    assert.notEqual((await paint(selected)).background, "rgba(0, 0, 0, 0)");
    await page.keyboard.press("Tab");
    await card("legacy").locator("select").focus();
    assert.equal(await card("legacy").locator("select").evaluate((el) => el.matches(":focus-visible")), true);
    const focus = await paint(card("legacy").locator("select"));
    assert.equal(focus.outline, "none");
    assert.notEqual(focus.background, "rgba(0, 0, 0, 0)", "Keyboard focus has a contrasting surface");
    if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/kanban-focus-${theme}.png` });
    await page.getByRole("heading", { name: "Kanban", exact: true }).click();
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; document.documentElement.classList.remove("dark"); });
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  const beforeDrop = await paint(column("done"));
  await card("legacy").dispatchEvent("dragstart", { dataTransfer: transfer });
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-todo-id="legacy"]')).opacity) < 1);
  await column("done").dispatchEvent("dragover", { dataTransfer: transfer });
  await page.waitForFunction((background) => getComputedStyle(document.querySelector('[data-column="done"]')).backgroundColor !== background, beforeDrop.background);
  const drop = await paint(column("done"));
  assert.notEqual(drop.background, beforeDrop.background, "Drop target is a color wash");
  assert.equal(drop.outline, "none");
  assert.equal(drop.border, beforeDrop.border);
  await card("legacy").dispatchEvent("dragend", { dataTransfer: transfer });
  await transfer.dispose();
  assert.equal((await paint(card("legacy"))).transition, "0s", "Reduced motion disables transitions");
  await page.evaluate(() => {
    window.__kanbanArrivals = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.matches("[data-todo-id]")) window.__kanbanArrivals.push({ id: this.dataset.todoId, duration: options.duration });
      return animate.call(this, frames, options);
    };
  });

  assert.ok((await column("todo").boundingBox()).y < 330, "Tasks, not instructions, occupy the first screen");
  assert.ok((await card("legacy").boundingBox()).height < 180, "Cards omit empty properties and repeated prose");
  await page.getByRole("button", { name: "List layout", exact: true }).click();
  assert.ok((await card("legacy").boundingBox()).height < 100, "List layout makes the pool scannable");
  assert.equal(await card("legacy").locator("select").inputValue(), "todo");
  await page.getByRole("button", { name: "Board layout", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  assert.equal((await paint(card("legacy"))).transition.includes("0.18s"), true, "Normal motion enables short color transitions");
  await card("legacy").locator("select").selectOption("doing");
  await column("doing").locator('[data-todo-id="legacy"]').waitFor();
  await settled();
  assert.equal(todos.find((todo) => todo.id === "legacy").done, false);
  assert.deepEqual(await page.evaluate(() => window.__kanbanArrivals), [{ id: "legacy", duration: 480 }], "Successful move gets one arrival wash");
  assert.equal(await card("legacy").locator("select").evaluate((el) => el === document.activeElement), true);
  // Real desktop drag; pointer lands below the column header, away from its add button.
  await card("legacy").dragTo(column("done"), { targetPosition: { x: 30, y: 100 } });
  await column("done").locator('[data-todo-id="legacy"]').waitFor();
  await settled();
  assert.equal(todos.find((todo) => todo.id === "legacy").done, true);

  const arrivals = await page.evaluate(() => window.__kanbanArrivals.length);
  failNext = true;
  await card("legacy").locator("select").selectOption("todo");
  await page.getByRole("alert").filter({ hasText: "Test save failed" }).waitFor();
  assert.equal(await column("done").locator('[data-todo-id="legacy"]').count(), 1);
  assert.equal(await page.evaluate(() => window.__kanbanArrivals.length), arrivals, "Failed writes never animate success");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await card("legacy").locator("select").selectOption("todo");
  await column("todo").locator('[data-todo-id="legacy"]').waitFor();
  await settled();

  assert.equal(await page.evaluate(() => window.__kanbanArrivals.length), arrivals, "Reduced motion also skips arrival animations");
  const add = page.getByRole("button", { name: /New task/ });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await add.click();
  const dialog = page.getByRole("dialog");
  assert.match(await dialog.evaluate((el) => getComputedStyle(el).animationName), /drawerReveal/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await dialog.evaluate((el) => getComputedStyle(el).animationName), "none");
  await dialog.getByLabel("Task", { exact: true }).fill("Ship the Kanban tab");
  const drawerBounds = await dialog.boundingBox();
  assert.ok(drawerBounds.x + drawerBounds.width >= 1439 && drawerBounds.height >= 899, "Editor is a full-height side drawer");
  await dialog.getByRole("combobox", { name: "Status", exact: true }).selectOption("doing");
  await dialog.getByLabel("Link (optional)", { exact: true }).fill("https://example.com/task");
  failNext = true;
  await dialog.getByRole("button", { name: /Save/ }).click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(await dialog.getByLabel("Task", { exact: true }).inputValue(), "Ship the Kanban tab");
  await dialog.getByRole("button", { name: /Save/ }).click();
  await dialog.waitFor({ state: "hidden" });
  await card("added").waitFor();
  assert.equal(await card("added").getByRole("link").getAttribute("href"), "https://example.com/task");
  await page.getByLabel("Find a task").fill("Ship");
  assert.equal(await page.locator("article").count(), 1);
  await page.getByLabel("Find a task").fill("");
  await card("added").getByRole("button", { name: /^Edit / }).click();
  await dialog.getByLabel("Task", { exact: true }).fill("Ship and verify");
  await dialog.getByRole("button", { name: /Save/ }).click();
  await dialog.waitFor({ state: "hidden" });
  await settled();
  assert.equal(todos.find((todo) => todo.id === "added").title, "Ship and verify");
  assert.deepEqual(Object.keys(lastWrite).sort(), ["id", "revision", "title"], "Title-only edits never submit stale workflow or dates");
  await card("added").getByRole("button", { name: /^Edit / }).click();
  await dialog.getByLabel("Task", { exact: true }).fill("Draft survives a reload");
  page.once("dialog", (confirmation) => confirmation.dismiss());
  await page.keyboard.press("Escape");
  assert.equal(await dialog.getByLabel("Task", { exact: true }).inputValue(), "Draft survives a reload", "Cancelling discard keeps the editor");
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.reload();
  await card("added").getByRole("button", { name: /^Edit / }).click();
  assert.equal(await dialog.getByLabel("Task", { exact: true }).inputValue(), "Draft survives a reload", "Reloaded tab restores the draft with its original revision");
  Object.assign(todos.find((todo) => todo.id === "added"), { done: true, status: "done", due: "2030-05-16" });
  revision++;
  await dialog.getByRole("button", { name: /Save/ }).click();
  await dialog.getByRole("alert").filter({ hasText: "changed elsewhere" }).waitFor();
  assert.equal(todos.find((todo) => todo.id === "added").done, true, "Stale editor cannot reopen an externally completed task");
  assert.equal(await dialog.getByLabel("Task", { exact: true }).inputValue(), "Draft survives a reload");
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: /Load latest version/ }).click();
  await page.waitForFunction(() => document.querySelector('[name="due"]').value === "2030-05-16");
  assert.equal(await dialog.getByRole("combobox", { name: "Status", exact: true }).inputValue(), "done");
  assert.equal(await dialog.getByLabel("Task", { exact: true }).inputValue(), "Ship and verify");
  await dialog.getByRole("combobox", { name: "Status", exact: true }).selectOption("doing");
  await dialog.getByRole("button", { name: /Save/ }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(Object.keys(lastWrite).sort(), ["id", "revision", "status"]);
  assert.equal(todos.find((todo) => todo.id === "added").due, "2030-05-16", "Fresh save preserves the concurrently changed deadline");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("robin-kanban-draft:added")), null);
  await card("added").getByRole("button", { name: /^Edit / }).click();
  await dialog.getByLabel("Task", { exact: true }).fill("Discard this draft");
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => sessionStorage.getItem("robin-kanban-draft:added")), null, "Explicit discard removes the draft");
  await page.reload();
  await card("added").waitFor();
  assert.equal(await card("added").locator("select").inputValue(), "doing");

  // Review, reversible abandonment, deliberate focus, and preview-before-write planning.
  const views = page.getByRole("navigation", { name: "Focus views" });
  await views.getByRole("button", { name: /Needs review/ }).click();
  await card("overdue").getByRole("button", { name: /Still relevant/ }).click();
  await card("overdue").waitFor({ state: "hidden" });
  assert.equal(todos.find((todo) => todo.id === "overdue").due, "2030-05-01");
  await card("abandon").getByRole("button", { name: /Abandon/ }).click();
  await card("abandon").waitFor({ state: "hidden" });
  assert.equal(todos.find((todo) => todo.id === "abandon").done, false);
  await views.getByRole("button", { name: /Abandoned/ }).click();
  await card("abandon").getByRole("button", { name: /Restore/ }).click();
  await card("abandon").waitFor({ state: "hidden" });
  await views.getByRole("button", { name: /Task pool/ }).click();
  await card("pool").getByRole("button", { name: /Plan for today/ }).click();
  await settled();
  await views.getByRole("button", { name: /Today/ }).click();
  await card("pool").waitFor();
  await card("pool").getByRole("button", { name: /Remove from plan/ }).click();
  await card("pool").waitFor({ state: "hidden" });
  assert.equal(todos.find((todo) => todo.id === "pool").due, "2030-05-15");
  assert.equal(await page.getByRole("region", { name: "Board layout", exact: true }).evaluate((el) => el === document.activeElement), true, "Unplanning returns focus to the board when its card disappears");
  const openPlanner = () => page.getByRole("button", { name: /^(Plan work|Review plan)/ }).click();
  const closePlanner = () => page.getByRole("button", { name: "Back to board", exact: true }).click();
  await openPlanner();
  assert.equal(await page.getByLabel("Available from", { exact: true }).isVisible(), false, "Preferences are progressively disclosed");
  await page.getByText("Work preferences", { exact: false }).click();
  await page.getByLabel("Available from", { exact: true }).waitFor();
  await page.getByText("Work preferences", { exact: false }).click();
  const generate = page.getByRole("button", { name: /Ask Agent for a plan/ });
  await generate.click();
  await page.getByRole("heading", { name: "Proposed focus plan" }).waitFor();
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/kanban-plan-preview.png` });
  assert.equal(todos.find((todo) => todo.id === "pool").plannedOn, undefined);
  // A concurrent task change invalidates the proposal without partial writes.
  revision++;
  await page.getByRole("button", { name: /Accept selected work dates/ }).click();
  await page.getByRole("alert").filter({ hasText: "regenerate" }).waitFor();
  assert.equal(todos.find((todo) => todo.id === "pool").plannedOn, undefined);
  await generate.click();
  await page.getByRole("button", { name: /Accept selected work dates/ }).click();
  await card("pool").waitFor();
  assert.equal(todos.find((todo) => todo.id === "pool").done, false);
  assert.equal(todos.find((todo) => todo.id === "pool").due, "2030-05-15");
  assert.equal(todos.find((todo) => todo.id === "pool").estimateSource, "agent");
  await closePlanner();
  assert.equal(await page.getByRole("button", { name: /^Plan work/ }).evaluate((el) => el === document.activeElement), true, "Planner restores trigger focus");

  for (const width of [1440, 1024, 960, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No overflow at ${width}`);
    const first = await column("todo").boundingBox();
    const second = await column("doing").boundingBox();
    if (width < 760) {
      assert.ok(first && !second, "Phone shows one workflow column at a time");
      await page.getByRole("navigation", { name: "Workflow columns" }).getByRole("button", { name: /In progress/ }).click();
      assert.equal(await column("doing").isVisible(), true);
      assert.equal(await column("todo").isVisible(), false);
      await page.getByRole("navigation", { name: "Workflow columns" }).getByRole("button", { name: /To do/ }).click();
    } else assert.ok(second.x > first.x, `Responsive columns at ${width}`);
    if (width === 960 && process.env.E2E_SCREENSHOT_DIR) {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/kanban-tablet.png` });
    }
    if (width === 375) {
      await openPlanner();
      const planner = page.getByRole("dialog", { name: "Calendar-aware planning" });
      assert.equal(await planner.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, "Planner controls fit on phones");
      if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/kanban-plan-mobile.png` });
      await closePlanner();
    }
    // All top-nav destinations must remain reachable, not clipped by the shell.
    if (width >= 960) {
      const last = page.locator('.robin-nav-utility a').last();
      const bounds = await last.boundingBox();
      assert.ok(bounds.x + bounds.width <= width + 1, `Settings navigation fits at ${width}`);
      const fits = await page.evaluate(() => {
        const main = document.querySelector('.robin-nav-main');
        const utility = document.querySelector('.robin-nav-utility').getBoundingClientRect();
        return main.getBoundingClientRect().right <= utility.left + 1
          && [...main.querySelectorAll('a')].every((link) => link.scrollWidth <= link.clientWidth + 1);
      });
      assert.ok(fits, `Labels are not squeezed or overlapping at ${width}`);
      const podcasts = page.locator('.robin-nav-main a').last();
      await podcasts.focus();
      const podcastBox = await podcasts.boundingBox();
      const mainBox = await page.locator('.robin-nav-main').boundingBox();
      assert.ok(podcastBox.x + podcastBox.width <= mainBox.x + mainBox.width + 1, "Keyboard reaches overflow tabs");
      await page.locator('a[aria-current="page"]').focus();
    }
  }
  await page.getByRole("navigation", { name: "Workflow columns" }).getByRole("button", { name: /In progress/ }).click();
  await card("added").locator("select").selectOption("done");
  await column("done").locator('[data-todo-id="added"]').waitFor();
  await settled();
  await card("added").getByRole("button", { name: /^Edit / }).click();
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  if (process.env.E2E_SCREENSHOT_DIR) {
    await page.locator("main").evaluate((el) => el.scrollTop = 0);
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/kanban-mobile.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator("main").evaluate((el) => el.scrollTop = 0);
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/kanban-light.png` });
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.documentElement.classList.add("dark"); });
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/kanban-dark.png` });
  }
  await card("added").getByRole("button", { name: /^Edit / }).click();
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: /Delete task/ }).click();
  await card("added").waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 812, height: 375 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Landscape does not overflow");
  // Long backlogs scroll inside their column, keeping view and status controls reachable.
  todos.push(...Array.from({ length: 60 }, (_, index) => ({ id: `backlog-${index}`, title: `Backlog task ${index}: research and finish a concrete next step`, done: false, createdAt: "2030-05-01T00:00:00Z" })));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await views.getByRole("button", { name: /Task pool/ }).click();
  await card("backlog-59").waitFor({ state: "attached" });
  await card("backlog-59").getByRole("button", { name: /^Edit / }).focus();
  assert.ok((await page.getByRole("heading", { name: "Kanban", exact: true }).boundingBox()).y >= 0, "Backlog scrolling retains the page header");
  await page.getByRole("button", { name: "List layout", exact: true }).click();
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/kanban-list.png` });
  await page.getByLabel("Find a task").fill("Backlog task 59");
  await page.reload();
  assert.equal(await page.getByLabel("Find a task").inputValue(), "Backlog task 59");
  assert.equal(await page.getByRole("button", { name: "List layout", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(new URL(page.url()).searchParams.get("view"), "pool");
  assert.equal(new URL(page.url()).searchParams.get("session"), "kanban-test", "View updates preserve unrelated URL state");
  await views.getByRole("button", { name: /Today/ }).click();
  await page.getByLabel("Find a task").fill("Backlog task 59");
  assert.equal(await card("backlog-59").count(), 0);
  await page.getByRole("button", { name: /Search all tasks/ }).click();
  await card("backlog-59").waitFor();
  await page.reload();
  await card("backlog-59").waitFor();
  assert.equal(new URL(page.url()).searchParams.get("scope"), "all");
  await page.goBack();
  await page.getByRole("button", { name: /Search all tasks/ }).waitFor();
  assert.equal(await card("backlog-59").count(), 0, "Back restores the previous search scope");
  await views.getByRole("button", { name: /Task pool/ }).click();
  await card("backlog-59").getByRole("button", { name: /Choose as next task/ }).click();
  await settled();
  assert.equal(await column("todo").locator("article").first().getAttribute("data-todo-id"), "backlog-59", "Next task outranks dated tasks");
  await card("legacy").getByRole("button", { name: /Choose as next task/ }).click();
  await settled();
  assert.deepEqual(todos.filter((todo) => todo.next).map((todo) => todo.id), ["legacy"]);
  await card("backlog-59").getByRole("button", { name: /Choose as next task/ }).click();
  await settled();
  await views.getByRole("button", { name: /Today/ }).click();
  await card("backlog-59").waitFor();
  assert.equal(todos.find((todo) => todo.id === "backlog-59").plannedOn, undefined, "Choosing next never invents a planned date");
  await card("backlog-59").locator("select").selectOption("done");
  await settled();
  assert.equal(todos.some((todo) => todo.next), false, "Completion clears next selection");
  todos.push({ id: "carry", title: "Continue yesterday’s work", status: "doing", done: false, due: "2030-05-10", plannedOn: "2030-05-11", createdAt: "2030-05-01T00:00:00Z" });
  await page.reload();
  await card("carry").getByRole("button", { name: "Needs rescheduling" }).click();
  await card("carry").getByRole("button", { name: /Still relevant/ }).click();
  await card("carry").waitFor({ state: "hidden" });
  await views.getByRole("button", { name: /Today/ }).click();
  await card("carry").waitFor();
  assert.equal(todos.find((todo) => todo.id === "carry").due, "2030-05-10", "Continuing never moves the historical deadline");
  assert.equal(await card("carry").locator("select").inputValue(), "doing");
  todos.push({ id: "archived-search", title: "Archived research", done: false, archivedAt: "2030-05-01T00:00:00Z", createdAt: "2030-05-01T00:00:00Z" });
  await page.reload();
  await page.getByLabel("Find a task").fill("Archived research");
  await page.getByRole("button", { name: /Search all tasks/ }).click();
  await card("archived-search").getByRole("button", { name: /^Edit / }).click();
  await dialog.getByLabel("Task", { exact: true }).fill("Archived research — annotated");
  await dialog.getByRole("button", { name: /Save/ }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(todos.find((todo) => todo.id === "archived-search").archivedAt, "2030-05-01T00:00:00Z", "Editing a global search result does not restore an archived task");
  assert.deepEqual(Object.keys(lastWrite).sort(), ["id", "revision", "title"]);
  await views.getByRole("button", { name: /Today/ }).click();
  await page.getByRole("button", { name: "Board layout", exact: true }).click();
  calendarError = "Test calendar unavailable";
  await page.reload();
  await openPlanner();
  await page.getByRole("alert").filter({ hasText: calendarError }).waitFor();
  assert.equal(await generate.isDisabled(), true, "Calendar errors remain visible and prevent generation inside the drawer");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  calendarError = undefined;
  todos.push({ id: "chinese", title: "准备投资人会议：梳理产品进展、用户反馈及下一阶段需要验证的假设", done: false, plannedOn: "2030-05-12", createdAt: "2030-05-12T00:00:00Z" });
  await page.evaluate(() => localStorage.setItem("pi-locale", "zh-CN"));
  await page.reload();
  await page.getByRole("heading", { name: "看板", exact: true }).waitFor();
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/kanban-zh.png` });
  await page.setViewportSize({ width: 375, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Chinese controls fit on phones");
  await card("chinese").getByRole("button", { name: /^编辑/ }).click();
  assert.equal(await page.getByRole("dialog").evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, "Chinese editor fits on phones");
  await page.keyboard.press("Escape");
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/kanban-zh-mobile.png` });
  assert.deepEqual(errors, []);
  console.log("PASS: Kanban focus, review, reversible archive, plan preview/acceptance, stale rejection, drag, CRUD and responsive layout");
} catch (error) {
  console.error("Kanban failure at", testPage?.url(), error);
  if (testPage) {
    try {
      console.error(await testPage.locator("body").ariaSnapshot({ timeout: 5000 }));
      await testPage.screenshot({ path: "/tmp/kanban-failure.png", timeout: 5000 });
    } catch { /* Do not mask the original failure with a diagnostic timeout. */ }
  }
  throw error;
} finally {
  await browser.close();
}
