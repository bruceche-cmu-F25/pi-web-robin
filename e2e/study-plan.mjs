// Mocked study planning and reminder: no personal data writes or model calls.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/study-plan.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  for (const width of [320, 390, 667, 1024, 1280]) {
    const zh = width !== 1280;
    const phone = width <= 760;
    const objective = zh ? "复习 Python 核心知识，每天练一道题" : "Python fundamentals";
    const suggested = zh ? "完成字典题练习" : "Solve dictionary problems";
    const context = await browser.newContext({ baseURL, viewport: { width, height: width === 667 ? 375 : 850 }, isMobile: phone, hasTouch: phone, serviceWorkers: "block", reducedMotion: "reduce" });
    if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
    await context.addInitScript(({ locale, theme }) => { localStorage.setItem("pi-locale", locale); localStorage.setItem("pi-theme", theme); }, { locale: zh ? "zh-CN" : "en", theme: width === 320 ? "glass" : zh ? "glass-dark" : "light" });
    let saved = { week: "2026-11-02", objective, milestones: [{ id: "learn", title: "Practice Python", done: false }], updatedAt: "" };
    const sessions = [{ id: "leetcode", title: "Daily LeetCode", days: [0,1,2,3,4,5,6], start: "10:00", end: "11:00", since: "2026-11-03", until: "2026-12-31", url: "https://leetcode.com/problem-list/xi4ci4ig/", enabled: true }];
    let chatTurns = 0, saves = 0, failLearning = width === 1280;
    await context.route("**/api/robin/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/robin/learning/study") {
        if (route.request().method() === "PATCH") {
          saves++; const body = route.request().postDataJSON(); saved = { ...body.week, week: body.date, updatedAt: `revision-${saves}` };
          return route.fulfill({ json: { week: saved } });
        }
        return route.fulfill({ json: { week: saved, sessions, practiceDays: 0, todayPracticed: false, attemptsThisWeek: 0 } });
      }
      if (path === "/api/robin/learning/study/chat") {
        if (route.request().method() === "DELETE") return route.fulfill({ json: { cleared: true } });
        const body = route.request().postDataJSON();
        assert.equal(body.week, saved.week);
        assert.equal(JSON.parse(body.draft).objective, objective, "Buddy reads the editor draft at send time");
        chatTurns++;
        if (chatTurns === 1) return route.fulfill({ json: { reply: zh ? "你这周有多少时间复习 Python？" : "How much time can you give Python this week?", sessionId: "planner-test-session", usedTools: [] } });
        return route.fulfill({ json: { reply: zh ? "建议先练字典，再复盘卡点。" : "Let's practice dictionaries, then review sticking points.", proposal: { objective: suggested, milestones: [{ title: zh ? "复盘哈希表卡点" : "Solve one hash-map problem", done: false }] }, sessionId: "planner-test-session", usedTools: [] } });
      }
      if (path === "/api/robin/learning") return failLearning ? route.fulfill({ status: 503, json: { error: "transient" } }) : route.fulfill({ json: { practice: { list: "neetcode150", stats: { solved: 0, total: 150 }, daily: { today: "2026-11-03", newProblems: [{ link: "two-sum", problem: "Two Sum" }], reviews: [], newDone: 0, newTarget: 1, reviewDone: 0, reviewTarget: 0, rounds: 0, roundTarget: 1, dueCount: 0 } }, fullstack: null } });
      if (path === "/api/robin/events") return route.fulfill({ json: { events: [], today: "2026-11-03", google: { connected: false } } });
      if (path === "/api/robin/canvases") return route.fulfill({ json: { canvases: [] } });
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message)); await page.clock.install({ time: new Date(2026, 10, 3, 9, 59) });
    page.setDefaultTimeout(15000);
    await page.goto("/learn");
    await page.getByRole("heading", { name: objective }).waitFor();
    if (failLearning) {
      await page.getByRole("alert").filter({ hasText: "Could not sync learning progress" }).waitFor();
      assert.equal(await page.getByRole("heading", { name: "Two Sum" }).count(), 0, "a failed read does not show stale progress");
      failLearning = false;
      await page.locator('#fullstack-open [role="alert"] button').first().click();
    }
    await page.getByRole("heading", { name: "Two Sum" }).waitFor();
    assert.ok(await page.locator('#fullstack-open').evaluate((node) => node.getBoundingClientRect().top < document.querySelector('#learning-week-view').getBoundingClientRect().top), "today's work comes before the weekly recap");
    assert.match(await page.locator('#learning-week-view').innerText(), /(?:手动里程碑|Manual milestones) 0\/1/, "manual milestones are distinct from recorded practice");
    const review = page.locator('section[aria-labelledby="python-review-title"]');
    assert.equal(await review.locator(':scope > ol > li').count(), 5, "Nov 4–8 each have a named review topic");
    assert.equal(await review.locator('time').first().getAttribute('datetime'), '2026-11-04');
    assert.equal(await review.locator('details').evaluate((node) => node.open), false, "other weeks are available on demand");
    await review.locator('summary').click();
    assert.equal(await review.locator('details ol > li').count(), 14, "the remaining days are available without duplicating the current week");
    assert.equal(await review.locator('details time').last().getAttribute('datetime'), '2026-11-22');
    if (phone) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), "daily topics fit a phone without horizontal scrolling");
    const resources = page.getByRole("complementary", { name: zh ? "学习资源" : "Learning resources" });
    assert.equal(await resources.locator(':scope > details').evaluate((node) => node.open), true, "resource rail opens by default at every width");
    const backend = resources.locator('a[href="https://www.freecodecamp.org/learn/back-end-development-and-apis-v9/"]');
    assert.equal(await backend.count(), 1, "the back-end course has a direct entry");
    assert.equal(await backend.getAttribute("target"), "_blank");
    assert.equal(await backend.getAttribute("rel"), "noopener noreferrer");
    assert.equal(await page.getByText(zh ? "探索与资料" : "Explore & resources").evaluate((node) => node.closest('details').open), true, "link shelf opens by default");
    if (width === 1280) { await page.locator('.robin-page').evaluate((node) => node.scrollTo(0, 0)); await page.screenshot({ path: "/tmp/learning-hub-week.png" }); }
    if (width <= 390) assert.ok(await page.getByRole("navigation", { name: zh ? "学习视图" : "Learning views" }).evaluate((nav) => {
      const [first, second] = nav.querySelectorAll("button");
      const box = nav.getBoundingClientRect();
      return first.getBoundingClientRect().top === second.getBoundingClientRect().top && box.right <= innerWidth && first.getBoundingClientRect().height >= 44;
    }), "mobile learning switches stay together on one row");
    assert.equal(await page.getByRole("textbox", { name: "Weekly objective" }).count(), 0, "the week view reads like a plan, not an editor");
    await page.getByRole("button", { name: zh ? "规划本周" : "Plan my week", exact: true }).click();
    await page.getByRole("heading", { name: zh ? "安排这一周" : "Shape your week" }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("view"), "planner");
    await page.goBack(); await page.getByRole("heading", { name: objective }).waitFor();
    await page.goForward(); await page.getByRole("heading", { name: zh ? "安排这一周" : "Shape your week" }).waitFor();
    if (phone) {
      assert.equal(await page.locator('#study-buddy-pane').isVisible(), false, "phone opens on the plan and reminders");
      await page.getByRole("button", { name: "Planner Buddy", exact: true }).click();
    }
    const chat = page.locator('aside[aria-label="Planner Buddy"]');
    const composer = chat.locator('textarea.chat-input-textarea');
    await chat.getByRole("link", { name: zh ? "设置或调整提醒" : "Set or adjust reminders" }).waitFor();
    assert.equal(await chat.getByRole("link", { name: zh ? "打开学习资源" : "Open study resource" }).getAttribute("href"), sessions[0].url);
    if (phone) {
      const chatBox = chat.locator('[class*="buddyChat"]');
      const idleHeight = await chatBox.evaluate((node) => node.getBoundingClientRect().height);
      await composer.focus();
      assert.ok(await chatBox.evaluate((node) => node.getBoundingClientRect().height) < idleHeight, "focused composer leaves room for the phone keyboard");
    }
    await composer.fill(zh ? "还没发出去" : "Unsent thought");
    if (phone) {
      await page.getByRole("button", { name: zh ? "计划与提醒" : "Plan & reminders" }).click();
      await page.getByRole("button", { name: "Planner Buddy", exact: true }).click();
      assert.equal(await composer.inputValue(), zh ? "还没发出去" : "Unsent thought", "mobile pane switching keeps the chat draft");
    }
    await page.getByRole("button", { name: zh ? "本周" : "This week", exact: true }).click();
    await page.getByRole("button", { name: zh ? "规划本周" : "Plan my week", exact: true }).click();
    assert.equal(await composer.inputValue(), zh ? "还没发出去" : "Unsent thought", "switching views keeps the chat composer draft");
    await composer.fill(zh ? "帮我想想这周该学什么" : "Help me plan this week");
    await chat.locator('.chat-send-button').click();
    await chat.getByText(zh ? "你这周有多少时间复习 Python？" : "How much time can you give Python this week?").waitFor();
    assert.equal(await chat.getByRole("button", { name: zh ? "放入计划草稿" : "Use in plan draft" }).count(), 0, "a clarifying question is not an adoptable plan");
    await composer.fill(zh ? "每天半小时，先复习字典" : "30 minutes daily, starting with dictionaries");
    await chat.locator('.chat-send-button').click();
    await chat.getByText(zh ? "建议先练字典，再复盘卡点。" : "Let's practice dictionaries, then review sticking points.").waitFor();
    assert.equal(await page.locator('section[class*="decision"] > label input').inputValue(), objective, "a suggestion cannot overwrite the draft");
    assert.equal(chatTurns, 2); assert.equal(saves, 0);
    await page.screenshot({ path: `/tmp/study-chat-${width}.png` });
    await chat.getByRole("button", { name: zh ? "放入计划草稿" : "Use in plan draft" }).click();
    if (phone) {
      await page.locator('#study-buddy-pane').waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.activeElement?.id === "study-decision-title");
      assert.equal(await page.getByRole("button", { name: zh ? "计划与提醒" : "Plan & reminders" }).getAttribute("aria-pressed"), "true");
    }
    await page.getByRole("button", { name: zh ? "本周" : "This week", exact: true }).click();
    await page.getByRole("button", { name: zh ? "规划本周" : "Plan my week", exact: true }).click();
    assert.equal(await page.locator('section[class*="decision"] > label input').inputValue(), suggested, "switching views preserves an unsaved decision");
    const layout = await page.locator('#learning-planner-view').evaluate((root) => {
      const box = (selector) => root.querySelector(selector).getBoundingClientRect();
      const decision = box('section[class*="decision"]'), buddy = box('aside[class*="buddy"]'), schedule = box('section[class*="schedule"]');
      return { decision: { right: decision.right, top: decision.top, bottom: decision.bottom }, buddy: { left: buddy.left, top: buddy.top, bottom: buddy.bottom }, schedule: { top: schedule.top } };
    });
    if (!phone) {
      assert.ok(layout.buddy.left >= layout.decision.right && layout.schedule.top >= layout.decision.bottom, "Buddy is to the right of the plan, schedule below it");
    } else {
      assert.ok(layout.decision.right > 0 && layout.schedule.top >= layout.decision.bottom && layout.buddy.left === 0, "phone plan shows goal and schedule but hides chat");
      await page.getByRole("button", { name: "Planner Buddy", exact: true }).click();
      assert.equal(await page.locator('#study-buddy-pane').isVisible(), true);
      assert.equal(await page.locator('#study-decision-title').isVisible(), false);
      assert.equal(await page.locator('#study-schedule-title').isVisible(), false);
      await page.screenshot({ path: `/tmp/study-planner-buddy-${width}.png` });
      await page.getByRole("link", { name: zh ? "设置或调整提醒" : "Set or adjust reminders" }).click();
      assert.equal(await page.locator('#study-schedule-title').isVisible(), true, "reminder shortcut reveals the mobile schedule editor");
      await page.waitForFunction(() => document.activeElement?.id === "study-schedule-title");
      await page.screenshot({ path: `/tmp/study-schedule-link-${width}.png` });
    }
    await page.screenshot({ path: `/tmp/study-planner-layout-${width}.png` });
    const geometry = await page.locator('[class*="scheduleFields"] input').evaluateAll((fields) => fields.map((field) => {
      const input = field.getBoundingClientRect(), row = field.closest('[class*="scheduleFields"]').getBoundingClientRect();
      return { left: input.left, right: input.right, rowLeft: row.left, rowRight: row.right };
    }));
    for (const field of geometry) assert.ok(field.left >= field.rowLeft - 2 && field.right <= field.rowRight + 2, "date/time inputs stay inside their session card");
    if (phone) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), "the phone has no horizontal page overflow");
    await page.locator('[class*="scheduleFields"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/study-planner-${width}.png` });
    await page.getByRole("button", { name: zh ? "确认本周计划" : "Confirm weekly plan" }).click();
    assert.equal(saves, 1);
    await page.getByRole("button", { name: zh ? "本周" : "This week", exact: true }).click();
    await page.getByRole("heading", { name: suggested }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: zh ? "规划本周" : "Plan my week", exact: true }).click();
    if (phone) await page.getByRole("button", { name: "Planner Buddy", exact: true }).click();
    await chat.getByText(zh ? "建议先练字典，再复盘卡点。" : "Let's practice dictionaries, then review sticking points.").waitFor();
    assert.equal(chatTurns, 2, "reloading the transcript must not call the agent again");
    await page.clock.fastForward("00:02:00");
    const dialog = page.getByRole("dialog", { name: "Daily LeetCode" });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole("link", { name: zh ? /去学习/ : /Open study link/ }).getAttribute("href"), "https://leetcode.com/problems/two-sum/");
    await dialog.getByRole("button", { name: zh ? "10 分钟后提醒" : "Remind in 10 min" }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.clock.fastForward("00:11:00"); await dialog.waitFor();
    await dialog.getByRole("button", { name: zh ? "今天跳过" : "Skip today" }).click();
    await page.clock.fastForward("00:01:00");
    assert.equal(await dialog.count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Study plan + reminder: 320, 390, 667 landscape, 1024, 1280px passed");
} finally { await browser.close(); }
