// Existing server. All roadmap/source/progress data is mocked; never writes a real vault or record.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { splitRoadmap } from "../extension/robin/learning-roadmap.ts";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const screenshots = "/tmp/learning-roadmap";
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
  const errors = [], images = [], consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.url().includes("tracking.invalid")) images.push(request.url()); });
  const overview = "技术/AI知识地图/00 - AI知识总图.md", evalPath = "技术/AI知识地图/03 - Eval评测.md", stack = "技术/职业路线图/01 - Full Stack.md";
  const bodies = {
    [overview]: "# AI 知识总图\n\n从模型到产品，先理解层次，再决定学到多深。\n\n[[03 - Eval评测|Eval 评测]] · [[01 - Full Stack|Full Stack]]\n\n## 关系图\n```mermaid\nflowchart LR\n A[模型] --> B[评测]\n B --> C[产品]\n```\n\n## 参数与上下文\n训练更新参数，RAG 改变本次上下文。\n\n![private](https://tracking.invalid/private.png)",
    [evalPath]: "# Eval 评测\n\n明确样本、运行条件与评分规则。\n\n## 为什么评测\n不能把更流畅当成更正确。\n\n## 实践与验收\n比较两个 prompt，记录事实错误与成本。\n\n- [ ] 保留独立样本\n- [ ] 检查失败案例\n",
    [stack]: "# Full Stack\n\n端到端交付基础。\n\n## React\n组件与状态。\n\n### 实践\n实现表单。\n\n### 验收\n- [ ] 处理重复提交\n",
  };
  let progress = [], failSave = false, failRead = false, multiple = false, empty = false, limited = false, writes = 0;
  const modified = "2026-10-24T20:00:00.000Z";
  const notes = Object.keys(bodies).map((path) => ({ path, title: path.split("/").at(-1).replace(/\.md$/, ""), modified, links: path === overview ? [evalPath, stack] : [overview], unresolved: [] }));
  const sections = (path) => splitRoadmap(bodies[path]).map((section) => ({ ...section, fingerprint: createHash("sha256").update(section.content).digest("hex") }));
  await page.route("**/api/robin/**", async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === "/api/robin/obsidian/vault") return route.fulfill({ json: { vaults: empty ? [] : [{ id: "local", name: "我的知识库" }, ...(multiple ? [{ id: "other", name: "另一个库" }] : [])] } });
    if (url.pathname === "/api/robin/learning/roadmap") {
      if (req.method() === "PATCH") {
        writes++;
        if (failSave) return route.fulfill({ status: 409, json: { error: "Study record changed in another window; reload before saving" } });
        const input = req.postDataJSON();
        const record = { ...input, title: sections(input.path).find((section) => section.id === input.section).title, revision: input.revision + 1, updatedAt: modified };
        progress = [...progress.filter((old) => old.path !== input.path || old.section !== input.section), record];
        return route.fulfill({ json: { record } });
      }
      if (failRead) return route.fulfill({ status: 500, json: { error: "Permission denied" } });
      const path = url.searchParams.get("path");
      return route.fulfill({ json: path ? { note: { path, content: bodies[path], modified, url: "obsidian://open" }, sections: sections(path), progress: progress.filter((record) => record.path === path) }
        : { notes, limited, skipped: limited ? 1 : 0, progress } });
    }
    return route.fulfill({ json: { todos: [], jobs: [], rounds: [], events: [], records: [], finals: {}, review: null } });
  });
  const chapters = page.getByRole("combobox", { name: "这篇笔记的章节" });
  const understanding = page.getByRole("combobox", { name: "我的理解程度" });
  const evidence = page.getByRole("textbox", { name: "我的回答、疑惑或实践证据" });
  const save = page.getByRole("button", { name: "保存自评", exact: true });
  await page.goto("/learn/roadmap?view=notes&session=keep");
  await page.getByRole("heading", { name: "AI 知识总图", exact: true }).waitFor();
  assert.ok(page.url().includes("session=keep"));
  assert.equal(writes, 0, "reading doesn't create progress");
  await chapters.selectOption({ label: "关系图" });
  await page.locator(".mermaid-block svg").first().waitFor({ timeout: 30_000 }).catch(async () => {
    assert.ok(await page.locator('svg[id^="mermaid-"]').count(), "diagram renders");
  });
  await page.screenshot({ path: `${screenshots}/whole-picture.png` });
  await chapters.selectOption({ label: "参数与上下文" });
  await page.getByRole("button", { name: "自测与练习", exact: true }).click();
  await page.getByText("这一节没有单独的练习标题", { exact: false }).waitFor();
  await understanding.selectOption("confident");
  assert.ok(await save.isDisabled(), "understanding requires evidence");
  await evidence.fill("还不理解参数与上下文的差别。");
  await understanding.selectOption("gap");
  await save.click();
  await page.getByText("已保存到 Robin", { exact: true }).waitFor();
  assert.equal(writes, 1);
  await page.getByRole("button", { name: "我的薄弱项", exact: true }).click();
  await page.getByRole("button", { name: /参数与上下文.*00 - AI知识总图/ }).waitFor();
  await page.reload();
  await evidence.waitFor();
  assert.equal(await evidence.inputValue(), "还不理解参数与上下文的差别。");
  assert.equal(await understanding.inputValue(), "gap");
  assert.equal(writes, 1);

  await page.getByRole("button", { name: "Eval评测", exact: true }).click();
  await chapters.selectOption({ label: "实践与验收" });
  await page.getByRole("button", { name: "自测与练习", exact: true }).click();
  await page.getByText("比较两个 prompt，记录事实错误与成本。", { exact: true }).waitFor();
  assert.ok(await page.getByRole("checkbox").first().isDisabled());
  await evidence.fill("比较了失败样例。");
  failSave = true;
  await save.click();
  await page.getByRole("alert").filter({ hasText: "Study record changed" }).waitFor();
  assert.equal(await evidence.inputValue(), "比较了失败样例。");
  page.once("dialog", (dialog) => dialog.dismiss());
  await chapters.selectOption({ label: "为什么评测" });
  assert.equal(await evidence.inputValue(), "比较了失败样例。", "cancel navigation preserves draft");
  failSave = false;
  await understanding.selectOption("confident");
  await save.click();
  await page.getByText("已保存到 Robin", { exact: true }).waitFor();
  bodies[evalPath] = bodies[evalPath].replace("事实错误与成本", "事实错误、延迟与成本");
  await page.getByRole("button", { name: "刷新 Obsidian 原文" }).click();
  await page.getByText("这节原文在上次自评后有更新。", { exact: false }).waitFor();
  assert.equal(await understanding.inputValue(), "unassessed");
  assert.equal(await evidence.inputValue(), "比较了失败样例。");
  await page.screenshot({ path: `${screenshots}/study-evidence.png` });

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}`);
    if (width < 760) {
      const outline = page.getByRole("button", { name: "我的知识全景", exact: true });
      await outline.click();
      await page.getByRole("button", { name: "Full Stack", exact: true }).click();
      assert.equal(await outline.getAttribute("aria-expanded"), "false");
      await evidence.waitFor();
    }
    await page.screenshot({ path: `${screenshots}/${width}.png` });
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: `${screenshots}/dark.png` });
  failRead = true;
  await page.getByRole("button", { name: "刷新 Obsidian 原文" }).click();
  await page.getByRole("alert").filter({ hasText: "Permission denied" }).waitFor();
  failRead = false; limited = true;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.getByText("部分索引", { exact: false }).waitFor();
  multiple = true;
  await page.goto("/learn/roadmap?view=notes");
  await page.getByRole("combobox", { name: "Obsidian 仓库" }).waitFor();
  await page.waitForTimeout(200);
  assert.equal(await page.getByRole("combobox", { name: "Obsidian 仓库" }).inputValue(), "", "multiple vaults require choice");
  empty = true;
  await page.getByRole("button", { name: "刷新 Obsidian 原文" }).click();
  await page.getByText("请先在服务器所在电脑的 Obsidian 中打开仓库，再刷新。", { exact: true }).waitFor();
  assert.deepEqual(images, []);
  assert.deepEqual(errors, []);
  const unexpected = consoleErrors.filter((message) => !message.includes("409") && !message.includes("500"));
  assert.deepEqual(unexpected, []);
  console.log(`learning-roadmap: passed; screenshots ${screenshots}`);
} finally { await browser.close(); }
