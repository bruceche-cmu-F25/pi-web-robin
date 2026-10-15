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
    await context.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() !== "GET") {
        assert.equal(path, "/api/robin/jobs");
        const body = request.postDataJSON();
        writes.push(body);
        jobs = jobs.map((job) => body.ids?.includes(job.id) ? { ...job, status: body.status } : job);
        return route.fulfill({ json: { ok: true } });
      }
      const fixtures = {
        "/api/robin/jobs": { jobs, scan: null, minScore: 3.75, configured: true },
        "/api/robin/jobs/profile": { profile: { ...DEFAULT_JOB_PROFILE, minScore: 3.75 }, providers: [], presets: [], starterCompanies: [] },
        "/api/robin/jobs/score": { scoring: null, pending: 1, model: null },
        "/api/robin/jobs/sweep": { sweep: null },
        "/api/robin/rounds": { rounds: [] },
        "/api/robin/links": { links: [] },
      };
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
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${locale}: priority, search, sources, undo, applied log, pagination and responsive themes passed`);
  }
} finally {
  await browser.close();
}
