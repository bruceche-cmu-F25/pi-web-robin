// Existing dev server; application APIs mocked after login. No prompts or data writes.
// node --env-file-if-exists=.env.local --experimental-strip-types e2e/rounded-surfaces.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fullstackPlan, practicePlan } from "../extension/robin/learning.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const artifacts = process.env.E2E_SCREENSHOT_DIR ?? "/tmp/pi-rounded-surfaces";
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(locale => {
    localStorage.setItem("pi-locale", locale);
    localStorage.setItem("pi-theme", "light");
    window.EventSource = class {
      readyState = 1;
      constructor() { setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "connected", isStreaming: false }) }), 10); }
      close() { this.readyState = 2; }
    };
  }, process.env.E2E_LOCALE ?? "zh-CN");
  const today = "2030-05-12", cwd = "/tmp/surface-fixture", id = "surface-fixture";
  const timestamp = `${today}T12:00:00Z`;
  const info = { id, cwd, projectKey: cwd, projectRoot: cwd, path: `${cwd}/main.jsonl`, name: "界面设计讨论", created: timestamp, modified: timestamp, messageCount: 2, firstMessage: "保留阅读的精确感，让界面更柔和。" };
  const messages = [
    { role: "user", content: info.firstMessage },
    { role: "assistant", content: [{ type: "text", text: "## 有层次的圆角\n\n卡片承载内容，控件表达操作，网格保留精度。正文保持连续，不给每段回复再套一个框。\n\n```css\n.surface {\n  border-radius: var(--card-radius);\n}\n```\n\n字体、颜色和信息密度保持不变。" }], timestamp: Date.now(), model: "fixture", provider: "fixture", stopReason: "stop" },
  ];
  const fixtures = {
    "/api/home": { home: "/tmp", generalProject: { root: cwd, key: cwd } },
    "/api/sessions": { sessions: [info], runningSessionIds: [], sessionListVersion: 1 },
    "/api/sessions/ui-state": { version: 1, revision: 0, sessions: {}, projects: { [cwd]: { root: cwd } }, projectOrder: [cwd] },
    "/api/agent/running": { runningSessionIds: [], awaitingInputSessionIds: [], sessionListVersion: 1 },
    "/api/models": { models: {}, modelList: [] },
    "/api/worktrees": { isGit: false, worktrees: [], projectRoot: cwd, projectKey: cwd },
    [`/api/sessions/${id}`]: { info, sessionId: id, leafId: "answer", tree: [], context: { messages, entryIds: ["question", "answer"], hasMore: false, oldestEntryId: "question", thinkingLevel: "off" }, totalActiveMs: 0 },
    [`/api/sessions/${id}/state`]: { running: false, state: { isStreaming: false, isPromptRunning: false } },
    [`/api/agent/${id}`]: { running: false, state: { isStreaming: false, isPromptRunning: false } },
    "/api/robin/todos": { today, todos: [
      { id: "one", title: "梳理项目的组件层级与交互边界", due: today, done: false },
      { id: "two", title: "完成本周阅读记录，整理关键问题与下一步实验", due: today, done: false },
      { id: "three", title: "检查桌面与手机上的阅读体验", due: "2030-05-13", done: false },
    ] },
    "/api/robin/events": { today, google: { connected: false }, events: [{ id: "meeting", title: "设计讨论", date: today, start: "10:00", end: "11:00", source: "local" }] },
    "/api/robin/links": { links: [{ id: "docs", title: "项目文档", url: "https://example.com", group: "日常入口", iconCheckedAt: today }] },
    "/api/robin/rounds": { rounds: [] },
    "/api/robin/gmail": { connected: false, today, review: null },
    "/api/robin/jobs": { jobs: [], scan: null, configured: false, minScore: 4 },
    "/api/robin/learning": { practice: practicePlan([], "neetcode150", today), fullstack: fullstackPlan([]) },
  };
  const commands = [];
  await context.route("**/api/**", route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path === "/api/cwd/validate") return route.fulfill({ json: { cwd, projectKey: cwd, projectRoot: cwd } });
    if (path.startsWith("/api/agent/") && req.method() === "POST") {
      const body = req.postDataJSON();
      if (!["get_state", "get_tools", "get_commands"].includes(body.type)) commands.push(body.type);
      return route.fulfill({ json: { success: true, data: { tools: [], commands: [], isStreaming: false } } });
    }
    return route.fulfill({ json: fixtures[path] ?? {} });
  });
  const page = await context.newPage();
  const errors = [], measurements = [];
  page.on("pageerror", error => errors.push(error.message));
  const radius = locator => locator.evaluate(el => getComputedStyle(el).borderTopLeftRadius);
  const capture = async name => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${artifacts}/${name}.png`, animations: "disabled" });
  };
  for (const width of [1440, 375, 320, 812]) {
    await page.setViewportSize({ width, height: width === 812 ? 375 : 1000 });
    for (const theme of ["light", "dark"]) {
      await page.goto("/dashboard?calendar=agenda");
      await page.locator("#dashboard-todos input[type=checkbox]").first().waitFor();
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle("dark", theme === "dark"); }, theme);
      assert.equal(await radius(page.locator(".robin-calendar")), "16px");
      assert.equal(await radius(page.locator(".robin-assistant-bar")), "16px");
      assert.equal(await radius(page.locator(".robin-dashboard-shortcuts a").first()), "8px");
      if (width >= 960) assert.equal(await radius(page.locator("#dashboard-todos").locator("..")), "16px");
      const size = await page.locator(".robin-dashboard").evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      assert.ok(size.scroll <= size.client + 1, `Dashboard overflow ${width}/${theme}`);
      await capture(`dashboard-${width}-${theme}`);
      if (width === 320 && theme === "light") {
        const geometry = await page.locator('.robin-assistant-form input').evaluate(el => {
          const rounded = el.getBoundingClientRect().width;
          const reset = document.createElement('style');
          reset.textContent = '* { border-radius: 0 !important; }';
          document.head.append(reset);
          const square = el.getBoundingClientRect().width;
          reset.remove();
          return { subject: '320px search field', rounded, square };
        });
        assert.equal(geometry.rounded, geometry.square, 'Shape must not change search layout');
        measurements.push(geometry);
      }
      if (width === 1440 && theme === "light") measurements.push(await page.locator("#dashboard-todos").locator("..").evaluate(el => {
        const box = el.getBoundingClientRect(), css = getComputedStyle(el);
        return { subject: "dashboard rail", width: box.width, height: box.height, padding: css.padding, gap: css.gap, radius: css.borderRadius, border: css.borderWidth, shadow: css.boxShadow, overflow: css.overflow };
      }));
      await page.locator(".robin-calendar-add").click();
      await page.locator(".calendar-event-dialog[open]").waitFor();
      assert.equal(await radius(page.locator(".calendar-event-dialog")), "24px");
      assert.equal(await radius(page.locator('.calendar-event-dialog input[type="date"]').first()), "8px");
      await page.keyboard.press("Escape");
      await page.goto(`/?session=${id}`);
      await page.locator(".markdown-code-block").waitFor();
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle("dark", theme === "dark"); }, theme);
      assert.equal(await radius(page.locator(".markdown-code-block")), "8px");
      const composer = page.locator(".chat-input-textarea");
      assert.equal(await radius(composer.locator("..")), "16px");
      await composer.fill("这段草稿不会发送。");
      await composer.focus();
      assert.ok(await composer.evaluate(el => el === document.activeElement));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await capture(`chat-${width}-${theme}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/learn");
  await page.locator("#my-roadmap-title").waitFor();
  assert.equal(await radius(page.locator(".pi-card").first()), "16px", "Shared cards inherit across workspaces");
  await capture("learn-desktop");
  assert.deepEqual(commands, [], "Visual checks never prompt, stop or mutate an agent");
  assert.deepEqual(errors, []);
  await writeFile(`${artifacts}/measurements.json`, JSON.stringify(measurements, null, 2));
  console.log(`PASS: radius tiers, dialogs, drafts, light/dark and 320–1440px; artifacts: ${artifacts}`);
} finally { await browser.close(); }
