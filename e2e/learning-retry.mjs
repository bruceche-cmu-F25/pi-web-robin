// Existing dev server. All application APIs are intercepted; progress writes affect fixtures only.
// node --env-file-if-exists=.env.local e2e/learning-retry.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { FULLSTACK_STEPS, fullstackPlan, practicePlan } from "../extension/robin/learning.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  for (const [locale, width, path] of [["en", 1440, "/learn"], ["zh-CN", 390, "/learn"], ["en", 1440, "/dashboard?calendar=agenda"]]) {
    if (process.env.E2E_PATH && path !== process.env.E2E_PATH) continue;
    const zh = locale === "zh-CN";
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
    if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
    await context.addInitScript(locale => localStorage.setItem("pi-locale", locale), locale);
    let completed = [], readFail = true, writeFail = true, failReadAfterWrite = false, reads = 0;
    const writes = [], unexpected = [], errors = [];
    const today = "2026-10-27";
    await context.route("**/api/**", async route => {
      const request = route.request(), endpoint = new URL(request.url()).pathname;
      if (endpoint === "/api/robin/learning") {
        if (request.method() === "PATCH") {
          const body = request.postDataJSON(); writes.push(body);
          await new Promise(resolve => setTimeout(resolve, 200));
          if (writeFail) return route.fulfill({ status: 503, json: { error: "Fixture write failed" } });
          completed = completed.filter(id => id !== body.step);
          if (body.completed) completed.push(body.step);
          if (failReadAfterWrite) readFail = true;
          return route.fulfill({ json: { fullstack: fullstackPlan(completed) } });
        }
        assert.equal(request.method(), "GET"); reads++;
        await new Promise(resolve => setTimeout(resolve, 100));
        return route.fulfill(readFail ? { status: 503, json: { error: "Fixture read failed" } } : { json: { practice: practicePlan([], "neetcode150", today), fullstack: fullstackPlan(completed) } });
      }
      if (request.method() !== "GET") { unexpected.push(`${request.method()} ${endpoint}`); return route.fulfill({ status: 405, json: { error: "Unexpected write blocked" } }); }
      if (endpoint === "/api/robin/planner") return route.fulfill({ json: { today, to: today, timezone: "America/Los_Angeles", minuteOfDay: 600, todos: [], events: [], conflicts: [], google: { connected: false } } });
      return route.fulfill({ json: { today, todos: [], events: [], google: { connected: false }, jobs: [], links: [], rounds: [], records: [], finals: {}, connected: false, review: null } });
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", error => { errors.push(error.message); console.error("Fixture page error:", error.stack); });
    await page.goto(path);
    const panel = page.locator("#fullstack-open");
    const reload = () => panel.getByRole("button", { name: zh ? "重新加载进度" : "Reload progress" });
    const retry = () => panel.getByRole("button", { name: zh ? "重试保存" : "Retry save" });
    const complete = () => panel.getByRole("button", { name: zh ? "完成这一项" : "Mark complete" });
    const writeError = () => panel.getByRole("alert").filter({ hasText: "Fixture write failed" });
    const readError = () => panel.getByRole("alert").filter({ hasText: "Fixture read failed" });
    const saved = () => panel.getByRole("status").filter({ hasText: zh ? /^已保存/ : /^Saved:/ });
    await readError().waitFor(); assert.equal(writes.length, 0);
    readFail = false;
    const beforeReload = reads;
    await reload().evaluate(button => { button.click(); button.click(); });
    await complete().waitFor(); assert.equal(reads, beforeReload + 1); assert.equal(writes.length, 0);
    const first = FULLSTACK_STEPS[0], second = FULLSTACK_STEPS[1];
    await complete().evaluate(button => { button.click(); button.click(); });
    await writeError().waitFor(); assert.deepEqual(writes, [{ step: first.id, completed: true }]);
    assert.match(await writeError().textContent(), new RegExp(first.title));

    // Simulate another device confirming the step while this failed request's
    // retry remains visible. Retry must still address the original id.
    completed = [first.id];
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await panel.getByRole("heading", { name: second.title, exact: true }).waitFor();
    assert.equal(await retry().isVisible(), true);
    writeFail = false; failReadAfterWrite = true;
    await retry().evaluate(button => { button.click(); button.click(); });
    await saved().waitFor(); await readError().waitFor();
    assert.deepEqual(writes, [{ step: first.id, completed: true }, { step: first.id, completed: true }]);
    assert.equal(await retry().count(), 0, "acknowledged PATCH followed by failed GET is not a failed save");
    assert.equal(await complete().isDisabled(), true);
    readFail = false; failReadAfterWrite = false;
    await reload().click(); await readError().waitFor({ state: "hidden" });
    assert.equal(writes.length, 2, "reloading a failed GET must never send another PATCH");

    writeFail = true;
    await panel.getByRole("button", { name: zh ? "撤销完成" : "Undo completion", exact: true }).click();
    await writeError().waitFor(); assert.deepEqual(writes.at(-1), { step: first.id, completed: false });
    completed = [first.id, second.id];
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await panel.getByRole("heading", { name: FULLSTACK_STEPS[2].title, exact: true }).waitFor();
    writeFail = false;
    await retry().click(); await writeError().waitFor({ state: "hidden" }); await saved().waitFor();
    await panel.getByRole("heading", { name: first.title, exact: true }).waitFor();
    assert.deepEqual(writes.at(-1), { step: first.id, completed: false });
    assert.deepEqual(completed, [second.id]);

    if (path === "/learn") {
      const target = FULLSTACK_STEPS.filter(step => step.part === 0)[2];
      await panel.locator('button[aria-controls="fullstack-part-steps"]').first().click();
      writeFail = true;
      await panel.getByRole("checkbox", { name: `${zh ? "完成这一项" : "Mark complete"}: ${target.title}`, exact: true }).click();
      await writeError().waitFor();
      writeFail = false; await retry().click(); await saved().waitFor();
      assert.deepEqual(writes.at(-1), { step: target.id, completed: true });
      await page.waitForFunction(label => [...document.querySelectorAll('#fullstack-open input[type="checkbox"]')].some(input => input.getAttribute("aria-label") === label && input.checked), `${zh ? "完成这一项" : "Mark complete"}: ${target.title}`);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    console.log(`${path} ${locale} ${width}px: read/write retry separation, exact completion/undo target, polling drift, single-flight and acknowledged-write/read-failure passed`);
    await context.close();
  }
} finally { await browser.close(); }
