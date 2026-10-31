// Existing dev server; every application API is mocked after login. No personal writes.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/interaction-feedback.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { fullstackPlan, practicePlan } from "../extension/robin/learning.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
const artifacts = process.env.E2E_SCREENSHOT_DIR ?? "/tmp/pi-interaction-feedback";
await mkdir(artifacts, { recursive: true });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => localStorage.setItem("pi-locale", "en"));
  const today = "2030-05-12";
  const todos = Array.from({ length: 80 }, (_, i) => ({ id: `task-${i}`, title: `Interaction test task ${i}`, done: false }));
  const fixtures = {
    "/api/robin/todos": { today, todos },
    "/api/robin/events": { today, events: [], google: { connected: false } },
    "/api/robin/jobs": { jobs: [] }, "/api/robin/links": { links: [] },
    "/api/robin/rounds": { rounds: [] }, "/api/robin/gmail": { connected: false, today, review: null },
    "/api/robin/learning": { practice: practicePlan([], "neetcode150", today), fullstack: fullstackPlan([]) },
  };
  const writes = [];
  let release, gate, fail = false;
  const hold = () => { gate = new Promise(resolve => { release = resolve; }); };
  await context.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      assert.equal(path, "/api/robin/todos", `Unexpected write: ${path}`);
      const body = request.postDataJSON();
      writes.push({ method: request.method(), body });
      if (gate) await gate;
      if (fail) return route.fulfill({ status: 503, json: { error: "Fixture save failed" } });
      if (request.method() === "PATCH") Object.assign(todos.find(todo => todo.id === body.id), body, { completedAt: `${today}T12:00:00Z` });
      else if (request.method() === "POST") todos.push({ id: "added", ...body, done: false });
      else assert.fail(`Unexpected method: ${request.method()}`);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: fixtures[path] ?? {} });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/dashboard?calendar=agenda");
  const panel = page.locator("#dashboard-todos");
  const checkbox = panel.getByRole("checkbox", { name: /Interaction test task 0$/ });
  await checkbox.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  hold(); fail = true;
  const latency = await checkbox.evaluate(input => new Promise(resolve => {
    const start = performance.now();
    const observer = new MutationObserver(() => {
      if (input.disabled) { observer.disconnect(); resolve(performance.now() - start); }
    });
    observer.observe(input, { attributes: true, attributeFilter: ["disabled"] });
    input.click(); input.click();
  }));
  await panel.getByRole("status").filter({ hasText: "Saving…" }).waitFor();
  await page.waitForFunction(() => document.querySelector('#dashboard-todos input[aria-busy="true"]')?.disabled);
  assert.equal(writes.length, 1, "Double activation submits once");
  assert.equal(await checkbox.isChecked(), false, "Pending is not reported as confirmed completion");
  assert.equal(await panel.getByRole("checkbox", { name: /Interaction test task 1$/ }).isDisabled(), false, "Other tasks stay usable");
  assert.equal(await panel.evaluate(el => el.getAnimations({ subtree: true }).length), 0, "No per-frame animation while a write waits");
  await page.screenshot({ path: `${artifacts}/pending-desktop.png` });
  release(); gate = null;
  await panel.getByRole("alert").filter({ hasText: "Fixture save failed" }).waitFor();
  await page.waitForFunction(() => !document.querySelector('#dashboard-todos input[type="checkbox"]').disabled);
  assert.equal(await checkbox.isChecked(), false);
  assert.equal(await panel.getByRole("status").filter({ hasText: "Saving…" }).count(), 0);

  hold(); fail = false;
  await checkbox.click();
  await panel.getByRole("status").filter({ hasText: "Saving…" }).waitFor();
  release(); gate = null;
  await panel.locator(".robin-completed-todos").waitFor();
  await panel.locator(".robin-completed-todos > summary").click();
  assert.equal(await checkbox.isChecked(), true);
  assert.equal(writes.length, 2, "Failure permits explicit retry");
  await checkbox.click();
  await page.waitForFunction(() => !document.querySelector("#dashboard-todos .robin-completed-todos"));
  assert.equal(await checkbox.isChecked(), false, "Reopening still works");

  // Form submissions also have a synchronous guard; pending row work never locks the form.
  await panel.locator("header button").click();
  await panel.locator("form input").first().fill("New task fixture");
  hold(); const beforeAdd = writes.length;
  await panel.locator("#robin-todo-form").evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await panel.locator('#robin-todo-form button[type="submit"]:disabled').filter({ hasText: "Saving…" }).waitFor();
  assert.equal(writes.length, beforeAdd + 1);
  release(); gate = null;
  await panel.getByRole("checkbox", { name: /New task fixture/ }).waitFor();

  // Actual shared CSS, including final phone overrides; fixtures carry no app actions.
  await page.evaluate(() => {
    const host = document.createElement("div"); host.id = "interaction-css-fixture";
    host.style.cssText = "position:fixed;z-index:9999;top:0;right:0;background:var(--bg-panel)";
    host.innerHTML = '<button class="ui-action pi-bracket" style="padding:12px">Press fixture</button><button class="ui-action" disabled>Disabled fixture</button>';
    for (const name of ["robin-navigation-container", "robin-navigation-scrim", "sidebar-container", "right-panel-container", "right-panel-overlay-backdrop"]) {
      const el = document.createElement("div"); el.dataset.motionFixture = name; el.className = name;
      el.style.cssText = "position:relative;width:1px;height:1px;min-width:0;pointer-events:none"; host.append(el);
    }
    document.body.append(host);
  });
  const press = page.getByRole("button", { name: "Press fixture" });
  await press.hover(); await page.waitForTimeout(180);
  const beforeBox = await press.boundingBox();
  await page.mouse.down();
  const active = await press.evaluate(el => {
    const css = getComputedStyle(el);
    const swatch = document.createElement("div"); swatch.style.backgroundColor = "var(--bg-selected)"; el.append(swatch);
    const selected = getComputedStyle(swatch).backgroundColor; swatch.remove();
    return { background: css.backgroundColor, selected, duration: css.transitionDuration, transform: css.transform };
  });
  assert.equal(active.background, active.selected);
  assert.equal(active.duration, "0s"); assert.equal(active.transform, "none");
  assert.deepEqual(await press.boundingBox(), beforeBox, "Press feedback does not change geometry");
  await page.mouse.up();
  await page.mouse.move(0, 0); await page.keyboard.press("Tab");
  await press.focus();
  assert.equal(await press.evaluate(el => getComputedStyle(el, "::before").transform), "none", "Keyboard focus does not spread brackets");

  for (const width of [1440, 812, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const styles = await page.locator("[data-motion-fixture]").evaluateAll(nodes => nodes.map(el => ({ name: el.dataset.motionFixture, duration: getComputedStyle(el).transitionDuration })));
    for (const style of styles) assert.equal(style.duration, "0s", `${width}px: ${style.name} respects reduced motion`);
    await press.hover();
    assert.equal(await press.evaluate(el => getComputedStyle(el, "::before").transform), "none");
  }
  await page.locator("#interaction-css-fixture").evaluate(el => el.remove());
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => document.documentElement.dataset.theme = "dark");
  hold();
  await checkbox.click();
  await panel.getByRole("status").filter({ hasText: "Saving…" }).waitFor();
  const sizes = await panel.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
  assert.ok(sizes.scroll <= sizes.width + 1, "Pending state fits phone width");
  await page.screenshot({ path: `${artifacts}/pending-mobile-dark.png` });
  release(); gate = null;
  await panel.locator(".robin-completed-todos").waitFor();
  assert.deepEqual(errors, []);
  console.log(`PASS: slow writes, double activation, failure/retry/reopen, add guard, press geometry, keyboard focus, reduced motion at 320–1440px; 80 rows, 4x CPU, pending feedback ${latency.toFixed(1)}ms. Screenshots: ${artifacts}`);
} finally { await browser.close(); }
