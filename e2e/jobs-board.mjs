// Run against the existing dev server. Every dashboard API is mocked; no job data is written.
// node --env-file-if-exists=.env.local --experimental-strip-types e2e/jobs-board.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { DEFAULT_JOB_PROFILE } from "../extension/robin/jobs.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
const job = (id, extra = {}) => ({
  id, company: id, title: "Software Engineer", location: "Remote", source: "greenhouse",
  status: "new", url: `https://example.com/jobs/${id}`, discoveredAt: "2026-10-10T12:00:00Z",
  reason: "Backend experience is relevant. Confirm the work authorization and start date requirements before applying.", ...extra,
});
try {
  for (const locale of ["en", "zh-CN"]) {
    const zh = locale === "zh-CN";
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
    if (process.env.PI_WEB_PASSWORD) {
      const login = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
      assert.ok(login.ok(), `Login failed (${login.status()})`);
    }
    await context.addInitScript((locale) => localStorage.setItem("pi-locale", locale), locale);
    let jobs = [
      job("Best", { score: 4.7 }),
      job("Mirror", { company: "Best", score: 2, location: "San Francisco", source: "lever" }),
      job("Recent", { score: 3.9, discoveredAt: "2026-10-14T12:00:00Z" }),
      job("Unknown"), job("Low", { score: 2 }),
      job("Low-mirror", { company: "Low", score: 1 }),
      job("Saved", { status: "shortlist", score: 4 }),
      job("Applied-old", { status: "applied", score: 5, appliedAt: "2026-10-10T12:00:00Z" }),
      job("Applied-new", { status: "applied", score: 3, appliedAt: "2026-10-14T12:00:00Z" }),
    ];
    const writes = [];
    let applicationStage = "attention";
    let applicationUrl = "https://example.com/fixture";
    let extraApplicationCount = 0;
    const dismissedApplications = new Set();
    const applicationWrites = [];
    await context.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() !== "GET") {
        const body = request.postDataJSON();
        if (path === "/api/robin/jobs/applications") {
          assert.equal(request.method(), "POST");
          assert.equal(body.action, "dismiss", "list cleanup must never trigger browser automation");
          applicationWrites.push(body);
          dismissedApplications.add(body.id);
          return route.fulfill({ json: { ok: true } });
        }
        assert.equal(path, "/api/robin/jobs");
        writes.push(body);
        jobs = jobs.map((job) => body.ids?.includes(job.id) ? { ...job, status: body.status } : job);
        return route.fulfill({ json: { ok: true } });
      }
      const fixtures = {
        "/api/robin/jobs": { jobs, scan: null, minScore: 3.75, configured: true },
        "/api/robin/jobs/profile": { profile: { ...DEFAULT_JOB_PROFILE, minScore: 3.75 }, providers: [], presets: [], starterCompanies: [] },
        "/api/robin/jobs/score": { scoring: null, pending: 1, model: null },
        "/api/robin/jobs/sweep": { sweep: null },
        "/api/robin/jobs/applications": {
          settings: { enabled: false, timeZone: "America/Los_Angeles", at: "09:00", dailyLimit: 10, autoSubmit: true, resumeName: "approved.pdf", resumeHash: "a".repeat(64), configured: true, preferencesChanged: false },
          running: false, day: "2026-10-25", today: 2, todaySubmitted: 0, legacy: 0, counts: { preparing: 0, review: 0, attention: 1, unavailable: 1, submitted: 0 }, total: 2,
          rows: [{ id: "application-fixture", company: "Example", title: "Engineer", status: "new", application: {
            attemptId: "test", workflowVersion: 2, phase: "Only unresolved personal questions remain", stage: applicationStage, startedAt: "2026-10-25T17:00:00Z", updatedAt: "2026-10-25T17:00:00Z", days: ["2026-10-25"], url: applicationUrl,
            resumeHash: "a".repeat(64), preferencesHash: "test", resumeVerified: true,
            fields: [{ label: "Will you relocate to New York City?", value: "", required: true, check: "empty" }], blockers: ["Confirm willingness to relocate to New York City"],
          } }, { id: 'closed-fixture', company: 'Unavailable example', title: 'Engineer', status: 'new', application: {
            attemptId: 'closed', workflowVersion: 2, phase: 'Posting unavailable at last check', stage: 'unavailable', startedAt: '2026-10-25T17:00:00Z', updatedAt: '2026-10-25T17:00:00Z', days: ['2026-10-25'], url: 'https://example.com/closed',
            resumeVerified: false, fields: [], blockers: ['Posting missing'],
          } }],
        },
        "/api/robin/rounds": { rounds: [] },
        "/api/robin/links": { links: [] },
      };
      const board = fixtures["/api/robin/jobs/applications"];
      board.rows.push(...Array.from({ length: extraApplicationCount }, (_, i) => ({
        ...board.rows[0], id: `extra-application-${i}`, company: `Extra application ${i}`,
      })));
      board.rows = board.rows.filter(row => !dismissedApplications.has(row.id));
      board.total = board.rows.length;
      board.counts = Object.fromEntries(board.rows.map(row => [row.application.stage, 1]));
      return route.fulfill({ json: fixtures[path] ?? {} });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/dashboard/jobs");
    const stage = (name) => page.getByRole("group", { name: zh ? "投递状态" : "Application status" }).getByRole("button", { name });
    const rows = page.locator('a[href^="https://example.com/jobs/"]').filter({ has: page.locator("b") });
    const firstCompany = () => rows.first().locator("b").textContent();
    const search = page.getByRole("searchbox");
    const sort = page.getByRole("combobox", { name: zh ? "排序" : "Sort by" });
    await page.getByRole("heading", { name: zh ? "优先看" : "Look here first", exact: true }).waitFor();
    assert.equal(await firstCompany(), "Best");
    assert.equal(await rows.count(), 3);
    const applications = page.getByRole("region", { name: zh ? "申请自动化" : "Application automation" });
    assert.ok(await applications.getByText(zh ? /今日尝试职位.*2\/10.*回执确认提交.*0/ : /Roles attempted today.*2\/10.*Receipt-confirmed submissions.*0/).isVisible());
    await applications.getByText(/Example — Engineer/).click();
    await applications.getByText("Confirm willingness to relocate to New York City", { exact: true }).waitFor();
    assert.equal(await applications.getByRole("button", { name: zh ? "检查提交回执" : "Check submission receipt" }).count(), 1);
    assert.equal(await applications.getByRole("button", { name: /^Submit$/ }).count(), 0);
    const applicationLink = () => applications.getByRole("link", { name: zh ? "打开申请网页" : "Open application page" }).filter({ visible: true });
    assert.equal(await applicationLink().getAttribute("href"), applicationUrl);
    assert.equal(await applicationLink().getAttribute("target"), "_blank");
    assert.equal(await applicationLink().getAttribute("rel"), "noopener noreferrer");
    await applications.getByText(/Example — Engineer/).click();
    assert.match(await applications.getByRole('status').textContent(), zh ? /职位不可访问 1/ : /Posting unavailable 1/);
    await applications.getByRole('combobox').selectOption('unavailable');
    assert.equal(await applications.getByText(/Example — Engineer/).count(), 0);
    assert.equal(await applications.getByText(/Unavailable example — Engineer/).count(), 1);
    await applications.getByText(/Unavailable example — Engineer/).click();
    assert.equal(await applicationLink().getAttribute("href"), "https://example.com/closed");
    await applications.getByText(/Unavailable example — Engineer/).click();
    await applications.getByRole('combobox').selectOption('all');
    assert.match(await stage(zh ? /待筛选/ : /To review/).textContent(), /4$/);
    assert.equal(await page.getByRole("heading", { level: 3 }).count(), 3, "priority sections, not calendar days");

    await sort.selectOption("recent");
    await rows.first().filter({ hasText: "Recent" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: zh ? "优先看" : "Look here first", exact: true }).count(), 0);
    await sort.selectOption("priority");
    await search.fill("francisco");
    await rows.first().filter({ hasText: "Best" }).waitFor();
    assert.equal(await rows.count(), 1);
    assert.ok(await page.getByRole("link", { name: "Lever", exact: true }).isVisible());
    await search.fill("low");
    await rows.first().filter({ hasText: "Low" }).waitFor();
    assert.equal(await rows.count(), 1, "search includes folded low scores");
    await page.getByRole("button", { name: zh ? "全部丢弃（1）" : "Drop all 1", exact: true }).click();
    await page.getByRole("button", { name: zh ? "撤销" : "Undo", exact: true }).waitFor();
    assert.deepEqual(writes.at(-1).ids.sort(), ["Low", "Low-mirror"]);
    await page.getByRole("button", { name: zh ? "撤销" : "Undo", exact: true }).click();
    await rows.first().filter({ hasText: "Low" }).waitFor();
    await search.fill("no-such-company");
    await page.getByRole("button", { name: zh ? "清空搜索" : "Clear search", exact: true }).click();
    await rows.first().filter({ hasText: "Best" }).waitFor();
    await stage(zh ? /^已投/ : /^Applied/).click();
    await rows.first().filter({ hasText: "Applied-new" }).waitFor();
    assert.equal(await sort.count(), 0);
    await stage(zh ? /待筛选/ : /To review/).click();
    await rows.first().filter({ hasText: "Best" }).waitFor();
    await search.fill("Best");
    await page.getByRole("heading", { name: zh ? "优先看" : "Look here first", exact: true }).click();
    await page.keyboard.press("j");
    await page.keyboard.press("s");
    await page.getByRole("button", { name: zh ? "撤销" : "Undo", exact: true }).waitFor();
    assert.deepEqual(writes.at(-1).ids.sort(), ["Best", "Mirror"], "keyboard action retains even low-score duplicate sources");
    await page.getByRole("button", { name: zh ? "撤销" : "Undo", exact: true }).click();
    await rows.first().filter({ hasText: "Best" }).waitFor();
    await search.fill("");

    for (const width of [1440, 375, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle("dark", theme === "dark"); }, theme);
        await page.locator(".robin-dashboard").evaluate((el) => { el.scrollTop = 0; });
        const size = await page.locator(".robin-dashboard").evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
        assert.ok(size.scroll <= size.client + 1, `${locale}/${width}/${theme}: overflow ${JSON.stringify(size)}`);
        if (width < 960) {
          const searchBox = await search.boundingBox();
          const filterBox = await page.getByRole("button", { name: zh ? /编辑筛选/ : /edit filter/i }).boundingBox();
          assert.ok(searchBox.y < filterBox.y, "mobile puts jobs before configuration");
        }
        if (process.env.E2E_SCREENSHOT_DIR) {
          await mkdir(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
          await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/jobs-${locale}-${width}-${theme}.png` });
        }
      }
    }
    // Pagination must reset on a new search rather than leave an empty second page.
    jobs.push(...Array.from({ length: 55 }, (_, i) => job(`Extra-${i}`, { score: 4.1 })));
    await page.reload();
    await rows.first().waitFor();
    assert.equal(await rows.count(), 50);
    await page.getByRole("button", { name: zh ? /再显示/ : /Show \d+ more/ }).click();
    assert.equal(await rows.count(), 58);
    await search.fill("Unknown");
    await rows.first().filter({ hasText: "Unknown" }).waitFor();
    assert.equal(await rows.count(), 1);
    // Direct links survive failures and submission, without invoking browser automation.
    for (const state of ["error", "submitted"]) {
      applicationStage = state;
      await page.reload();
      await applications.getByText(/Example — Engineer/).click();
      assert.equal(await applicationLink().getAttribute("href"), applicationUrl);
      if (state === "error") {
        const errorLabel = applications.locator("summary > span").filter({ hasText: zh ? "技术失败" : "Automation error" });
        assert.equal(await errorLabel.evaluate(el => el.style.color), "var(--danger)");
        assert.equal(await applications.getByText("Confirm willingness to relocate to New York City", { exact: true }).evaluate(el => el.parentElement.style.color), "var(--danger)");
        const errorCount = applications.getByRole("status").getByText(zh ? "技术失败 1" : "Automation error 1", { exact: true });
        assert.equal(await errorCount.evaluate(el => el.style.color), "var(--danger)");
      }
      const remove = applications.getByRole("button", { name: zh ? "移除记录" : "Remove record" });
      const before = applicationWrites.length;
      page.once("dialog", dialog => dialog.dismiss());
      await remove.click();
      assert.equal(applicationWrites.length, before, "cancel keeps the record");
      page.once("dialog", async dialog => {
        assert.match(dialog.message(), /Example — Engineer/);
        await dialog.accept();
      });
      await remove.click();
      await applications.getByText(/Example — Engineer/).waitFor({ state: "detached" });
      assert.deepEqual(applicationWrites.at(-1), { action: "dismiss", id: "application-fixture" });
      await page.reload();
      await applications.getByText(/Unavailable example — Engineer/).waitFor();
      assert.equal(await applications.getByText(/Example — Engineer/).count(), 0);
      assert.ok(await applications.getByText(zh ? /今日尝试职位.*2\/10/ : /Roles attempted today.*2\/10/).isVisible());
      dismissedApplications.clear();
    }
    applicationUrl = "javascript:alert(1)";
    await page.reload();
    await applications.getByText(/Example — Engineer/).click();
    assert.equal(await applicationLink().count(), 0, "non-web URLs must not become links");
    // Long automation lists collapse independently of job pagination and never write data.
    const writesBeforeDisclosure = applicationWrites.length;
    const applicationSummaries = applications.locator(':scope > details > summary').filter({ hasText: ' — Engineer' });
    const disclosure = applications.getByRole('button', { name: zh ? /展开全部.*条记录|收起列表/ : /Show all .* records|Collapse list/ });
    for (const count of [5, 6, 12]) {
      extraApplicationCount = count - 2;
      await page.reload();
      await applicationSummaries.first().waitFor();
      assert.equal(await applicationSummaries.count(), 5);
      assert.equal(await disclosure.count(), count > 5 ? 1 : 0);
      if (count === 5) continue;
      assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
      assert.match(await disclosure.textContent(), new RegExp(String(count)));
      await disclosure.focus();
      await page.keyboard.press('Enter');
      assert.equal(await applicationSummaries.count(), count);
      assert.equal(await disclosure.getAttribute('aria-expanded'), 'true');
      await page.keyboard.press('Space');
      assert.equal(await applicationSummaries.count(), 5);
      assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
      assert.ok(await disclosure.evaluate(el => el === document.activeElement));
      await disclosure.click();
      await applications.getByRole('combobox').selectOption('unavailable');
      assert.equal(await applicationSummaries.count(), 1);
      assert.equal(await disclosure.count(), 0);
      await applications.getByRole('combobox').selectOption('review');
      assert.equal(await applicationSummaries.count(), 0);
      assert.equal(await disclosure.count(), 0);
      await applications.getByRole('combobox').selectOption('all');
      assert.equal(await applicationSummaries.count(), 5, 'changing filters resets to the compact list');
      assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
    }
    assert.equal(applicationWrites.length, writesBeforeDisclosure);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${locale}: priority, search, sources, undo, applied log, pagination and responsive themes passed`);
  }
} finally {
  await browser.close();
}
