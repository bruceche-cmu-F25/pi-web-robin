// Existing dev server; all course/progress/vault calls are mocked. Never writes personal records.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { COURSE_LESSONS, COURSE_STAGES, COURSE_SOURCES, COURSE_NAMESPACE, COURSE_PATH } from "../extension/robin/learning-course.ts";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const screenshots = "/tmp/learning-course";
mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  if (process.env.PI_WEB_PASSWORD) {
    const response = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(response.ok());
  }
  await context.addInitScript(() => { localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-theme", "light"); });
  const page = await context.newPage();
  const errors = [], consoleErrors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("Failed to load resource")) consoleErrors.push(message.text()); });
  const lessons = structuredClone(COURSE_LESSONS).map((lesson) => ({ ...lesson, fingerprint: createHash("sha256").update(JSON.stringify([lesson, lesson.sources.map((id) => COURSE_SOURCES[id])])).digest("hex") }));
  let progress = [], writes = 0, vaultReads = 0, catalogReads = 0, conflict = false, unavailable = false, vaultCount = 0, partial = false, sourceUnavailable = false;
  let saveGate = null;
  await page.route("**/api/robin/**", async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === "/api/robin/learning/course") {
      if (req.method() === "PATCH") {
        writes++;
        if (saveGate) await saveGate;
        if (conflict) return route.fulfill({ status: 409, json: { error: "Study record changed in another window; reload before saving" } });
        const input = req.postDataJSON(), lesson = lessons.find((lesson) => lesson.id === input.lessonId);
        const record = { vaultId: COURSE_NAMESPACE, path: COURSE_PATH, section: input.lessonId, title: lesson.title, fingerprint: input.fingerprint, status: input.status, evidence: input.evidence, revision: input.revision + 1, updatedAt: new Date().toISOString() };
        progress = [...progress.filter((old) => old.section !== record.section), record];
        return route.fulfill({ json: { record } });
      }
      if (unavailable) return route.fulfill({ status: 500, json: { error: "Progress storage unavailable" } });
      return route.fulfill({ json: { stages: COURSE_STAGES, sources: COURSE_SOURCES, lessons, progress } });
    }
    if (url.pathname === "/api/robin/obsidian/vault") {
      vaultReads++;
      return route.fulfill({ json: { vaults: Array.from({ length: vaultCount }, (_, i) => ({ id: `vault-${i}`, name: `知识库 ${i}` })) } });
    }
    if (url.pathname === "/api/robin/learning/roadmap") {
      catalogReads++;
      if (sourceUnavailable) return route.fulfill({ status: 500, json: { error: "Source unavailable" } });
      return route.fulfill({ json: { notes: [{ title: "00 - AI知识总图", path: "技术/AI知识地图/00 - AI知识总图.md", links: [], unresolved: [], modified: "2026-01-01" }], limited: partial, skipped: partial ? 1 : 0, progress: [] } });
    }
    return route.fulfill({ json: { todos: [], jobs: [], rounds: [], events: [], records: [], finals: {}, review: null } });
  });
  const outline = page.getByRole("complementary", { name: "课程目录" });
  const pick = async (id) => {
    const lesson = lessons.find((lesson) => lesson.id === id);
    await outline.getByRole("button").filter({ hasText: lesson.title }).click();
    await page.getByRole("heading", { name: lesson.title, exact: true }).waitFor();
  };
  const answer = page.getByRole("textbox", { name: "我的练习作答／实践证据" });
  const status = page.getByRole("combobox", { name: "我的理解程度" });
  const save = page.getByRole("button", { name: "保存自评", exact: true });
  await page.goto("/learn/roadmap?view=course&session=keep");
  await page.getByRole("heading", { name: lessons[0].title, exact: true }).waitFor();
  assert.ok(page.url().includes("session=keep"));
  assert.equal(writes, 0);
  assert.equal(vaultReads, 0, "teaching is not gated on or silently scanning personal notes");
  await page.screenshot({ path: `${screenshots}/course-overview.png` });
  const check = page.getByRole("region", { name: "停一下，检查是否理解" });
  await check.getByRole("radio").nth(0).check();
  await check.getByRole("button", { name: "检查答案" }).click();
  await check.getByText("还差一点。看反馈后，再想一次。", { exact: true }).waitFor();
  await check.getByRole("radio").nth(1).check();
  await check.getByRole("button", { name: "检查答案" }).click();
  await check.getByText("选对了。再试着用自己的话解释原因。", { exact: true }).waitFor();
  assert.equal(writes, 0, "choice feedback doesn't claim or save mastery");
  const solution = page.locator("details").filter({ has: page.locator("summary", { hasText: "对照参考答案" }) });
  assert.equal(await solution.getAttribute("open"), null);
  await page.getByText("提示 1", { exact: true }).click();
  await page.getByText(lessons[0].exercise.hints[0], { exact: true }).waitFor();
  await status.selectOption("confident");
  assert.ok(await save.isDisabled());
  await answer.fill("A 是提交幂等，B 是无证据生成，C 是 KV 与并发，D 是工作流复核成本。");
  await solution.locator("summary").click();
  assert.ok(await solution.getByText(/A 属于软件可靠性/).isVisible());
  await status.selectOption("gap");
  await save.click();
  await page.getByText("已保存到 Robin", { exact: true }).waitFor();
  assert.equal(writes, 1);
  await page.getByRole("region", { name: lessons[0].exercise.title }).screenshot({ path: `${screenshots}/guided-practice.png` });
  await page.reload();
  await answer.waitFor();
  assert.match(await answer.inputValue(), /工作流复核成本/);
  assert.equal(await status.inputValue(), "gap");
  await outline.getByRole("button", { name: "我的薄弱项", exact: true }).click();
  assert.equal(await outline.locator("li").count(), 1);
  await outline.getByRole("button", { name: "全部课程", exact: true }).click();
  await answer.fill("不要丢掉这个草稿");
  page.once("dialog", (dialog) => dialog.dismiss());
  await outline.getByRole("button").filter({ hasText: lessons[1].title }).click();
  assert.equal(await answer.inputValue(), "不要丢掉这个草稿");
  conflict = true;
  await save.click();
  await page.getByRole("alert").filter({ hasText: "Study record changed" }).waitFor();
  assert.equal(await answer.inputValue(), "不要丢掉这个草稿");
  conflict = false;
  await status.selectOption("confident"); await save.click();
  await page.getByText("已保存到 Robin", { exact: true }).waitFor();
  lessons[0].fingerprint = "changed-lesson";
  await page.getByRole("button", { name: "重新读取课程与记录" }).click();
  await page.getByText("这一课内容已更新。", { exact: false }).waitFor();
  assert.equal(await status.inputValue(), "unassessed");
  assert.equal(await answer.inputValue(), "不要丢掉这个草稿");
  await page.getByText("自评记录：0 课有把握 · 0 课需补练", { exact: true }).waitFor();
  const writesBeforeReading = writes;
  // Every selectable lesson must contain its actual teaching and its own exercise, not a placeholder.
  for (const lesson of lessons.slice(1)) {
    await pick(lesson.id);
    assert.ok(await page.getByRole("heading", { name: lesson.explanation[0].title, exact: false }).isVisible());
    assert.ok(await page.getByRole("heading", { name: lesson.exercise.title, exact: true }).count());
    assert.equal(await page.getByRole("radio").count(), 3);
    assert.equal(await answer.inputValue(), "");
  }
  assert.equal(writes, writesBeforeReading);
  await pick("evaluation");
  await page.getByRole("heading", { name: "一个分类例子，把分母说清楚", exact: false }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${screenshots}/eval-lesson.png` });
  await pick("whole-picture");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no document overflow at ${width}`);
    assert.ok(await page.locator("article").evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `no lesson overflow at ${width}`);
    if (width <= 820) {
      await outline.getByRole("button", { name: "课程目录", exact: true }).click();
      await outline.getByRole("searchbox").fill("SQL");
      assert.equal(await outline.locator("li").count(), 1);
      await outline.getByRole("searchbox").fill("");
      await outline.getByRole("button", { name: "课程目录", exact: true }).click();
    }
    await page.locator("main").last().evaluate((el) => el.closest('[class*="page"]')?.scrollTo(0, 0));
    await page.screenshot({ path: `${screenshots}/${width}.png` });
  }
  // Lazy references: no vault is fine; multiple vaults must not be read before a choice.
  const sourceSummary = page.locator("summary", { hasText: "Obsidian 原始笔记" });
  await sourceSummary.click();
  await sourceSummary.locator("..").getByText(/Obsidian/).last().waitFor();
  assert.equal(catalogReads, 0);
  vaultCount = 2;
  await page.reload(); await sourceSummary.click();
  const vaultSelect = page.getByRole("combobox").filter({ has: page.locator('option[value="vault-0"]') });
  await vaultSelect.waitFor(); assert.equal(catalogReads, 0);
  partial = true;
  await vaultSelect.selectOption("vault-0");
  const sourceLink = page.getByRole("link", { name: "00 - AI知识总图 ↗", exact: true });
  await sourceLink.waitFor(); assert.equal(catalogReads, 1);
  assert.match(await sourceLink.getAttribute("href"), /vault=vault-0/);
  assert.equal(await sourceLink.getAttribute("target"), "_blank");
  await vaultSelect.selectOption("");
  assert.equal(await sourceLink.count(), 0, "clearing the vault choice clears source links");
  sourceUnavailable = true;
  await vaultSelect.selectOption("vault-1");
  await page.getByRole("alert").filter({ hasText: "Source unavailable" }).waitFor();
  assert.equal(await sourceLink.count(), 0, "switching vaults doesn't retain stale source links");
  // A broken progress store is visible, not silently replaced with empty saved work.
  unavailable = true;
  await page.getByRole("button", { name: "重新读取课程与记录" }).click();
  await page.getByRole("alert").filter({ hasText: "Progress storage unavailable" }).waitFor();
  unavailable = false;
  await page.getByRole("button", { name: "重新读取课程与记录" }).click();
  await answer.waitFor();
  await page.goto("/learn/roadmap?lesson=missing");
  await page.getByRole("alert").filter({ hasText: "这节课程不存在" }).waitFor();
  await pick("inference-infra");
  assert.ok(page.url().includes("lesson=inference-infra"));
  let release;
  saveGate = new Promise((resolve) => { release = resolve; });
  await answer.fill("KV cache depends on context length and concurrency.");
  await save.click();
  await page.getByRole("button", { name: "正在保存…", exact: true }).waitFor();
  await outline.getByRole("button").filter({ hasText: lessons[0].title }).click();
  assert.ok(page.url().includes("lesson=inference-infra"), "navigation is blocked while a save is pending");
  assert.ok(await answer.isDisabled());
  release(); saveGate = null;
  await page.getByText("已保存到 Robin", { exact: true }).waitFor();
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.getByRole("heading", { name: lessons.find((lesson) => lesson.id === "inference-infra").title, exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${screenshots}/dark-lesson.png` });
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  console.log(JSON.stringify({ ok: true, lessons: lessons.length, writes, vaultReads, catalogReads, screenshots }));
} finally { await browser.close(); }
