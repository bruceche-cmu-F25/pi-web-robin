// Browser UX against deterministic evidence fixtures; no paid research or real delivery.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
const preferences = { enabled: false, telegram: false, timezone: "America/Los_Angeles", at: "08:00", interests: "Agents, models, research and global AI industry" };
const edition = { week: "2026-06-15", from: "2026-06-08", through: "2026-06-14", createdAt: "2026-06-15T15:00:00Z", headline: "能力继续增长，真正值得关注的是工程边界。", gaps: ["某些来源无法访问，未纳入本期。"], ignored: ["没有独立证据的榜单排名。"], slots: Array.from({ length: 7 }, (_, i) => ({
  date: `2026-06-${15 + i}`, lane: i % 2 ? "world" : "practical",
  story: i === 6 ? null : { key: `event-${i}`, lane: i % 2 ? "world" : "practical", title: ["Coding Agent 的权限边界，开始比写代码速度更重要", "开源模型改变了谁承担推理成本", "一个值得验证的 API 更新", "评测结果距离真实部署还有多远", "工具链中的新选择", "算力投入正在改变产业结构"][i],
    eventDate: "2026-06-10", status: "announced", what: "这是浏览器测试使用的示例内容，不是真实新闻。新的预览引入了更明确的权限控制，尚未向所有用户开放。", why: "对开发者而言，重要的不只是模型是否聪明，而是能否控制它在真实系统中做什么。这个变化值得观察，但不能据此判断生产稳定性。", action: "暂无需行动；等到公开文档和独立测试可用后再评估。", caveat: "仅宣布，不代表已开放；厂商主张尚未获得独立验证。",
    source: { url: `https://example.com/event-${i}`, title: "Original announcement — browser fixture", publishedOn: "2026-06-10", dateQuote: "June 10, 2026", quote: "This is a deterministic test fixture. The feature was announced as a preview, not generally available.", checkedAt: "2026-06-15T15:00:00Z" } },
})) };
let state = { preferences, today: "2026-06-18", week: "2026-06-15", edition: null, archive: [], run: null, running: false, interrupted: false, read: [], deliveries: [], telegramReady: false };
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1100 }, serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
  let generateCalls = 0, preview;
  const imageRequests = [];
  await context.route("**/api/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/robin/ai-weekly/image") {
      imageRequests.push(request.url());
      if (new URL(request.url()).searchParams.get("day") === "2026-06-17") return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ contentType: "image/png", body: preview });
    }
    if (path !== "/api/robin/ai-weekly") return route.fulfill({ json: {} });
    const body = request.method() === "GET" ? null : request.postDataJSON();
    if (request.method() === "POST") {
      generateCalls++; state.running = true; state.run = { id: "r", week: state.week, stage: "harvest", startedAt: "2026-06-15T15:00:00Z", sessions: [] };
    }
    if (body?.action === "read") state.read = body.read ? [`${body.week}:${body.date}`] : [];
    if (body?.action === "preferences") state.preferences = body.preferences;
    return route.fulfill({ json: state });
  });
  const page = await context.newPage(), errors = [];
  preview = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 630;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e5eee7"; ctx.fillRect(0, 0, 1200, 630);
    ctx.strokeStyle = "#639281"; ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(900, 310, 50 + i * 55, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = "#244c42"; ctx.font = "24px monospace"; ctx.fillText("SOURCE PREVIEW / TEST FIXTURE", 70, 100);
    ctx.font = "56px Georgia"; ctx.fillText("A different view", 70, 280); ctx.fillText("of the AI week.", 70, 350);
    ctx.font = "22px monospace"; ctx.fillText("SYNTHETIC · NOT A NEWS PHOTOGRAPH", 70, 540);
    return canvas.toDataURL("image/png").split(",")[1];
  }), "base64");
  page.on("pageerror", (error) => { errors.push(error.message); console.error("Browser error:", error.message); });
  await page.goto("/dashboard/gmail?feed=ai");
  await page.getByRole("heading", { name: "每周七件事，每天读懂一件。" }).waitFor();
  await page.getByRole("heading", { name: "少看一点，知道重要的。" }).waitFor();
  assert.equal(generateCalls, 0, "merely opening the page is read-only");
  assert.equal(await page.locator('.robin-nav-main a[aria-current="page"]').getAttribute("href"), "/dashboard/gmail");
  assert.equal(await page.locator('.robin-nav-main a[href*="ai-weekly"]').count(), 0, "no separate global tab");
  const sources = page.getByRole("navigation", { name: "新信息来源" });
  assert.ok((await sources.boundingBox()).height <= 34, "desktop source switcher stays compact");
  await sources.getByRole("button", { name: "邮箱", exact: true }).click();
  await page.getByRole("heading", { name: "邮箱", exact: true }).waitFor();
  await sources.getByRole("button", { name: "AI 周报", exact: true }).click();
  await page.getByRole("heading", { name: "每周七件事，每天读懂一件。" }).waitFor();
  await page.screenshot({ path: "/tmp/ai-weekly-empty.png", fullPage: true });
  await page.getByRole("button", { name: /生成本周周报/ }).click();
  await page.getByRole("status").filter({ hasText: "正在研究" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /生成本周周报/ }).isDisabled(), true);
  assert.equal(generateCalls, 1);
  state = { ...state, edition, archive: [{ week: edition.week, headline: edition.headline }], running: false, run: { ...state.run, stage: "done", candidates: 12, verified: 7 } };
  await page.getByRole("button", { name: /刷新/ }).click();
  await page.getByRole("heading", { name: "评测结果距离真实部署还有多远", exact: true }).waitFor();
  const days = page.getByRole("navigation", { name: "阅读日" });
  assert.equal(await days.getByRole("button").count(), 7);
  await page.getByRole("button", { name: /标为已读/ }).click();
  await page.getByRole("button", { name: /改为未读/ }).waitFor();
  await page.getByRole("status").filter({ hasText: "已标记读过" }).waitFor();
  await page.getByRole("link", { name: "查看大图", exact: true }).waitFor();
  assert.ok(imageRequests.every((url) => new URL(url).origin === baseURL), "browser images use the same-origin source cache");
  await days.getByRole("button").nth(0).focus(); await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: edition.slots[0].story.title, exact: true }).waitFor();
  await page.getByRole("button", { name: "查看引用 [1]", exact: true }).last().click();
  assert.equal(await page.locator("#weekly-evidence").getAttribute("open"), "");
  assert.equal(await page.locator("#weekly-evidence summary").evaluate((element) => element === document.activeElement), true, "inline citation opens evidence and moves keyboard focus");
  assert.equal(await page.locator("#weekly-evidence").getByRole("link", { name: "Original announcement — browser fixture ↗" }).getAttribute("rel"), "noopener noreferrer");
  await page.getByRole("main").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: "/tmp/ai-weekly-desktop.png", fullPage: true });
  await page.getByRole("button", { name: /下一篇/ }).click();
  await page.getByRole("heading", { name: edition.slots[1].story.title, exact: true }).waitFor();
  assert.equal(await page.locator("article").getAttribute("data-lane"), "world");
  await page.waitForFunction(() => document.activeElement?.id === "weekly-story-title");
  await page.getByRole("button", { name: /下一篇/ }).click();
  await page.getByText("日期示意 · 暂无可用来源配图，非新闻照片。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "查看大图", exact: true }).count(), 0, "failed image has no broken zoom link");
  await page.getByRole("button", { name: "回到今天", exact: true }).click();
  await page.getByRole("heading", { name: "评测结果距离真实部署还有多远", exact: true }).waitFor();
  await days.getByRole("button").nth(6).click();
  await page.getByRole("heading", { name: "这个阅读日没有足够可靠的新条目。不凑数，也不需要补课。", exact: true }).waitFor();
  await page.getByRole("button", { name: /关注方向与交付/ }).click();
  assert.equal(await page.getByRole("checkbox", { name: "每天向已配置的 Telegram 聊天发送一件" }).isDisabled(), true);
  await page.screenshot({ path: "/tmp/ai-weekly-settings.png", fullPage: true });
  await page.getByRole("textbox", { name: /你关心什么/ }).fill("研究与开发者工具同等重要");
  await page.getByRole("checkbox", { name: "每周自动生成一期" }).check();
  await page.getByRole("button", { name: /保存偏好/ }).click();
  await page.getByRole("status").filter({ hasText: "偏好已保存" }).waitFor();
  assert.equal(state.preferences.enabled, true); assert.equal(state.preferences.telegram, false);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  assert.ok((await sources.boundingBox()).height <= 46, "mobile switcher has no extra vertical padding");
  assert.ok(await sources.getByRole("button").evaluateAll((buttons) => buttons.every((button) => button.getBoundingClientRect().height >= 44)), "phone tap targets stay accessible");
  await days.getByRole("button").nth(3).click();
  await page.getByRole("main").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: "/tmp/ai-weekly-mobile.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "no mobile horizontal overflow");
  await page.setViewportSize({ width: 320, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.ok(await days.getByRole("button").evaluateAll((buttons) => buttons.every((button) => button.getBoundingClientRect().width >= 44)));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.getByRole("main").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: "/tmp/ai-weekly-dark.png", fullPage: true });
  state = { ...state, edition: null, archive: [], interrupted: false, run: { ...state.run, stage: "failed", error: "Source fetch failed" } };
  await page.getByRole("button", { name: /刷新/ }).click();
  await page.getByRole("alert").filter({ hasText: "Source fetch failed" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /重试研究/ }).isEnabled(), true);
  assert.deepEqual(errors, []);
  console.log("AI weekly: empty/running/ready/error, seven days, keyboard, reading, preferences and mobile passed.");
} finally { await browser.close(); }
