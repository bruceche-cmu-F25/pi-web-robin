// Fixture-only Todo writes: failed GETs must not undo acknowledged changes.
// node --env-file-if-exists=.env.local --experimental-strip-types e2e/todo-receipts.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { addDays, localDate } from "../extension/robin/dates.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome", headless: true });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" });
    if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
    await context.addInitScript(() => localStorage.setItem("pi-locale", "en"));
    const today = localDate(), writes = [], errors = [];
    let todos = [{ id: "fixture", title: "Receipt fixture", done: false, revision: "v1" }];
    let failReads = false, failWrite = false, holdWrite = false, release;
    await context.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path === "/api/robin/todos") {
        if (request.method() === "GET") return route.fulfill(failReads
          ? { status: 503, json: { error: "Fixture read offline" } }
          : { json: { todos, today } });
        const body = request.postDataJSON(); writes.push({ method: request.method(), body });
        if (failWrite) return route.fulfill({ status: 409, json: { error: "Fixture write refused" } });
        if (holdWrite) { holdWrite = false; await new Promise(resolve => { release = resolve; }); }
        if (request.method() === "DELETE") {
          todos = todos.filter(todo => todo.id !== body.id);
          return route.fulfill({ json: { success: true } });
        }
        const saved = request.method() === "POST"
          ? { id: "created", title: body.title.trim(), done: false, revision: "new" }
          : { ...todos.find(todo => todo.id === body.id), ...body, revision: `v${writes.length}`, completedAt: body.done ? new Date().toISOString() : undefined };
        todos = [...todos.filter(todo => todo.id !== saved.id), saved];
        return route.fulfill({ json: { todo: saved, today } });
      }
      assert.equal(request.method(), "GET", `Unexpected mutation ${path}`);
      if (path === "/api/robin/planner") return route.fulfill({ json: { today, to: addDays(today, 6), todos: [], events: [], conflicts: [], google: { connected: false }, minuteOfDay: 600, timezone: "UTC", now: new Date().toISOString(), revision: "plan-fixture" } });
      return route.fulfill({ json: { today, todos: [], events: [], links: [], jobs: [], rounds: [], records: [], review: null, google: { connected: false } } });
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/dashboard?view=todos&tasks=all");
    await page.addStyleTag({ content: "nextjs-portal { display:none !important; }" });
    const panel = page.locator("#dashboard-todos");
    const complete = panel.getByRole("checkbox", { name: "Complete Receipt fixture", exact: true });
    await complete.waitFor();
    failWrite = true;
    await complete.click();
    await panel.getByRole("alert").filter({ hasText: "Fixture write refused" }).waitFor();
    assert.equal(await complete.isChecked(), false);
    assert.equal(todos[0].done, false);
    failWrite = false; holdWrite = true;
    await complete.click();
    await page.waitForFunction(() => document.querySelector('#dashboard-todos input[type="checkbox"]')?.disabled);
    assert.equal(await complete.isChecked(), false, "pending is not confirmed completion");
    for (let i = 0; !release && i < 100; i++) await page.waitForTimeout(20);
    assert.ok(release); failReads = true; release();
    await panel.getByRole("alert").filter({ hasText: "Fixture read offline" }).waitFor();
    await complete.waitFor({ state: "detached" });
    assert.equal(todos[0].done, true);
    await panel.getByRole("button", { name: "Completed", exact: true }).click();
    const reopen = panel.getByRole("checkbox", { name: "Reopen Receipt fixture", exact: true });
    await reopen.waitFor(); assert.equal(await reopen.isChecked(), true);
    await reopen.click(); await reopen.waitFor({ state: "detached" });
    await panel.getByRole("button", { name: "All open", exact: true }).click();
    await complete.waitFor(); assert.equal(await complete.isChecked(), false);
    const actions = panel.locator(".robin-todo-actions > summary");
    if (await actions.count()) await actions.click();
    page.once("dialog", dialog => dialog.accept());
    await panel.getByRole("button", { name: "Delete Receipt fixture", exact: true }).click();
    await complete.waitFor({ state: "detached" });
    assert.equal(todos.length, 0);
    await panel.locator("header .robin-panel-add").click();
    const form = panel.locator("#robin-todo-form");
    await form.getByRole("textbox", { name: "Task", exact: true }).fill("  New receipt fixture  ");
    await form.getByRole("button", { name: /save/i }).click();
    await form.waitFor({ state: "detached" });
    await panel.getByRole("checkbox", { name: "Complete New receipt fixture", exact: true }).waitFor();
    assert.deepEqual(writes.map(write => write.method), ["PATCH", "PATCH", "PATCH", "DELETE", "POST"]);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: pending/rejected completion, confirmed completion/reopen/delete/create with failed reads.`);
    await context.close();
  }
} finally { await browser.close(); }
