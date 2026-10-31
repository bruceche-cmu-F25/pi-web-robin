// Run against the existing dev server. All application APIs are mocked; writes are blocked.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { COURSE_LESSONS, COURSE_STAGES, COURSE_SOURCES } from "../extension/robin/learning-course.ts";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const screenshots = "/tmp/ui-followup-fixes";
mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) {
    const login = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(login.ok());
  }
  await context.addInitScript(() => { localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-theme", "glass"); });
  const writes = [], errors = [];
  await context.route("**/api/**", route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() !== "GET") { writes.push(path); return route.fulfill({ status: 409, json: { error: "Audit blocks writes" } }); }
    const fixtures = {
      "/api/robin/learning/course": { stages: COURSE_STAGES, sources: COURSE_SOURCES, lessons: COURSE_LESSONS.map(x => ({ ...x, fingerprint: "fixture" })), progress: [] },
      "/api/robin/practice": { records: [], currentSlug: null, list: "neetcode150", today: "2026-10-29" },
      "/api/robin/recordings": { recordings: [], config: { engine: "local", model: "small", ready: false, reason: "missing-model" } },
      "/api/robin/jarvis": { leads: [], run: null },
      "/api/robin/products": { ideas: [], captures: [] },
      "/api/robin/google": { configured: false, connected: false },
    };
    return route.fulfill({ json: fixtures[path] ?? { todos: [], events: [], jobs: [], rounds: [], records: [], review: null } });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  for (const [name, url] of [["tools", "/tools"], ["recordings", "/recordings"], ["course", "/learn/roadmap?view=course"], ["coding", "/coding"], ["outreach", "/outreach/research"]]) {
    await page.goto(url);
    if (name === "course") await page.getByRole("heading", { name: COURSE_LESSONS[0].title, exact: true }).waitFor();
    if (name === "coding") await page.getByRole("button", { name: "NC 150", exact: true }).waitFor();
    if (name === "outreach") await page.getByRole("button", { name: /当前名单/ }).waitFor();
    if (name === "tools") await page.getByRole("heading", { name: "本地工具箱", exact: true }).waitFor();
    if (name === "recordings") {
      await page.getByRole("heading", { name: "录音转写", exact: true }).waitFor();
      await page.getByRole("textbox", { name: "标题", exact: true }).fill("Fixture recording draft");
    }
    await page.evaluate(() => document.fonts.ready);
    for (const theme of ["glass", "glass-dark", "light", "dark"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const glass = theme.startsWith("glass");
      for (const [width, height] of [[1440, 1000], [390, 844], [320, 812], [844, 390]]) {
        await page.setViewportSize({ width, height });
        if (name === "course" && width <= 820) {
          const toggle = page.getByRole("button", { name: "课程目录", exact: true });
          if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}/${theme}/${width}: no root overflow`);
        if (name === "tools" || name === "recordings") {
          const bg = await page.locator(".robin-workspace-ground").evaluate(el => getComputedStyle(el).backgroundColor);
          assert.equal(bg === "rgba(0, 0, 0, 0)", glass, `${name}: only Glass ground is transparent`);
          const panel = name === "tools" ? page.locator('main > header') : page.locator('[class*="__card"]').first();
          const material = await panel.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, filter: getComputedStyle(el).backdropFilter }));
          assert.notEqual(material.bg, "rgba(0, 0, 0, 0)", "content remains opaque");
          assert.equal(material.filter, "none", "no filter on content");
          if (name === "recordings") assert.equal(await page.getByRole("textbox", { name: "标题", exact: true }).inputValue(), "Fixture recording draft");
        }
        if (name === "course" || name === "coding") {
          const tabs = page.locator(".robin-workspace-view-switch");
          const style = await tabs.evaluate(el => ({ radius: getComputedStyle(el).borderRadius, filter: getComputedStyle(el).backdropFilter }));
          assert.equal(style.radius, glass ? "28px" : "0px");
          assert.equal(style.filter === "none", !glass);
          for (const button of await tabs.getByRole("button").all()) {
            if (glass || width <= 640) assert.ok((await button.boundingBox()).height >= 44, `${name}/${theme}/${width}: touch target`);
            if (glass) assert.equal(await button.evaluate(el => getComputedStyle(el).borderRadius), "23px");
          }
          if (name === "course") {
            const outline = page.getByRole("complementary", { name: "课程目录" });
            assert.equal(await outline.evaluate(el => getComputedStyle(el).borderRadius), glass ? "24px" : "0px");
            const lesson = page.locator('article');
            assert.equal(await lesson.evaluate(el => getComputedStyle(el).backdropFilter), "none");
            assert.notEqual(await lesson.evaluate(el => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
          }
        }
        if (name === "outreach" && width <= 960) {
          // Include controls in disclosures, not just the initial collapsed screen.
          await page.locator('main details, .robin-page details').evaluateAll(nodes => nodes.forEach(el => { el.open = true; }));
          const short = await page.locator('.robin-page button, .robin-page summary').evaluateAll(nodes => nodes.filter(el => el.checkVisibility() && el.getBoundingClientRect().height < 44).map(el => el.textContent));
          assert.deepEqual(short, [], "mobile outreach controls are at least 44px");
        }
        if (glass && (width === 1440 || width === 390)) await page.screenshot({ path: `${screenshots}/${name}-${theme}-${width}.png` });
      }
    }
    if (name === "course" || name === "coding") {
      await page.evaluate(() => { document.documentElement.dataset.theme = "glass"; });
      await page.emulateMedia({ forcedColors: "active" });
      const selected = page.locator('.robin-workspace-view-switch > [aria-pressed="true"]');
      assert.equal(await selected.evaluate(el => getComputedStyle(el).borderStyle), "solid");
      await page.keyboard.press("Tab");
      await selected.focus();
      assert.equal(await selected.evaluate(el => getComputedStyle(el).outlineStyle), "solid");
      await page.emulateMedia({ forcedColors: "none" });
      const cdp = await context.newCDPSession(page);
      for (const [name, value] of [["prefers-reduced-transparency", "reduce"], ["prefers-contrast", "more"]]) {
        await cdp.send("Emulation.setEmulatedMedia", { features: [{ name, value }] });
        for (const surface of await page.locator(".robin-workspace-tabs, .robin-workspace-rail").all()) {
          assert.equal(await surface.evaluate(el => getComputedStyle(el).backdropFilter), "none", name);
          assert.notEqual(await surface.evaluate(el => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
        }
      }
      await cdp.send("Emulation.setEmulatedMedia", { features: [] });
      await cdp.detach();
    }
  }
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  console.log("UI follow-up: five pages, Glass + normal themes, phone/desktop/landscape, opaque reading surfaces, navigation, forced colors and touch targets passed; zero API writes.");
} finally { await browser.close(); }
