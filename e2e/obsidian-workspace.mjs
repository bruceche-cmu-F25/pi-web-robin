// Existing dev server; all vault data is mocked. No personal notes are read or changed.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const screenshots = "/tmp/obsidian-workspace";
mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 1000 }, reducedMotion: "reduce" });
  if (process.env.PI_WEB_PASSWORD) {
    const login = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(login.ok());
  }
  await context.addInitScript(() => { localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-theme", "light"); });
  const page = await context.newPage(), errors = [], externalImages = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.url().includes("tracking.invalid")) externalImages.push(request.url()); });
  let failIndex = false, failNote = false, revision = 0, empty = false, multi = false, large = false, writes = 0;
  const modified = "2026-09-20T10:00:00.000Z";
  const entries = [
    { path: "Home.md", title: "Home", links: ["知识/React.md", "知识/闭包.md", "项目/Robin.md"], unresolved: ["未创建的想法"], excerpt: "把读过的、想过的和正在做的事情连接起来。知识不是收集得越多越好，而是让旧想法遇见新问题。" },
    { path: "知识/React.md", title: "React", links: ["知识/闭包.md", "Home.md"], unresolved: [], excerpt: "界面是状态的映射。理解组件、状态与单向数据流，以及它们在真实产品中的边界。" },
    { path: "知识/闭包.md", title: "闭包", links: ["知识/React.md"], unresolved: [], excerpt: "函数与它创建时的词法环境。把回调中的状态变化，放回它发生的时间线上理解。" },
    { path: "项目/Robin.md", title: "Robin", links: ["知识/React.md", "阅读/Local-first.md"], unresolved: [], excerpt: "让工具围绕人，而不是让人围绕工具。一个本地优先的个人工作台。" },
    { path: "阅读/Local-first.md", title: "Local-first", links: ["Home.md"], unresolved: [], excerpt: "你的数据，你的文件。断网也能使用的软件，以及围绕所有权做出的架构取舍。" },
    ...["状态管理", "设计边界", "信息架构", "React Hooks", "渐进增强", "知识连接", "离线优先", "学习方法", "系统设计", "注意力", "Markdown", "图论"].map((title, i) => ({ path: `${["知识", "项目", "阅读"][i % 3]}/${title}.md`, title, links: [i % 2 ? "项目/Robin.md" : "知识/React.md", "Home.md"], unresolved: [], excerpt: `关于${title}的阅读记录。从一个具体问题出发，把理解连接到正在做的项目中。` })),
    { path: "收件箱/一个新想法.md", title: "一个新想法", links: [], unresolved: [], excerpt: "还没找到合适的连接。先留下这个问题，等下一次阅读时回来看。" },
  ].map((entry) => ({ ...entry, modified }));
  const content = {
    "Home.md": "# 我的知识地图\n\n把读过的、想过的和正在做的事情连接起来。\n\n## 最近在学\n\n- [[知识/React|React]]：界面是状态的映射\n- [[知识/闭包|闭包]]：函数记住它诞生时的环境\n\n## 正在做\n\n[[项目/Robin|Robin]] — 一个本地优先的个人工作台。\n\n> 知识不是收集得越多越好，而是让旧想法遇见新问题。\n\n[[未创建的想法]]\n\n![private](https://tracking.invalid/image.png)",
    "知识/React.md": "# React\n\n组件、状态与单向数据流。\n\n[[闭包]] · [[Home]]\n\n```js\nconst view = render(state);\n```",
    "知识/闭包.md": "# 闭包\n\n函数与它创建时的词法环境。\n\n[[React]]",
  };
  await page.route("**/api/robin/**", async (route) => {
    if (route.request().method() !== "GET") writes++;
    const url = new URL(route.request().url());
    if (url.pathname === "/api/robin/obsidian/vault") {
      if (!url.searchParams.has("vaultId")) return route.fulfill({ json: { vaults: empty ? [] : [{ id: "local", name: "我的知识库", path: "/fixture/vault" }, ...(multi ? [{ id: "second", name: "另一个仓库", path: "/fixture/other" }] : [])] } });
      const path = url.searchParams.get("path");
      if (path) {
        if (failNote) return route.fulfill({ status: 404, json: { error: "Note no longer exists; refresh the vault" } });
        return route.fulfill({ json: { note: { path, content: `${content[path] ?? `# ${path.split("/").at(-1).replace(/\.md$/, "")}\n\n你的数据，你的文件。`}${revision ? "\n\n外部修改已读取" : ""}`, modified, url: `obsidian://open?path=${encodeURIComponent(`/fixture/${path}`)}` } } });
      }
      if (failIndex) return route.fulfill({ status: 500, json: { error: "Permission denied" } });
      const notes = large ? Array.from({ length: 1000 }, (_, i) => ({ path: `${i % 6}/Note-${i}.md`, title: `Note-${i}`, links: [`${((i + 1) % 1000) % 6}/Note-${(i + 1) % 1000}.md`], unresolved: [], modified })) : entries;
      return route.fulfill({ json: { notes, limited: false, skipped: 0 } });
    }
    return route.fulfill({ json: { todos: [], events: [], jobs: [], rounds: [], records: [], finals: {}, review: null } });
  });
  const modes = page.getByRole("navigation", { name: "笔记工作区视图" });
  const mode = (name) => modes.getByRole("button", { name, exact: true });
  const inspector = page.getByRole("complementary", { name: "笔记预览" });
  const graph = page.getByRole("group", { name: "关系图", exact: true });
  const canvas = page.getByLabel("可交互笔记关系图", { exact: true });
  const ready = () => page.waitForFunction(() => document.querySelector('[role="group"][data-ready]')?.getAttribute("data-ready") === "true");
  const center = async () => { const b = await canvas.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const locate = async (path) => { await page.getByRole("combobox", { name: "定位", exact: true }).selectOption(path); await page.waitForTimeout(100); };
  await page.goto("/obsidian?session=retained");
  await page.getByRole("button", { name: "Home · Home.md", exact: true }).click();
  await inspector.getByRole("heading", { name: "我的知识地图" }).waitFor();
  assert.equal(await mode("笔记库").getAttribute("aria-pressed"), "true");
  assert.ok(page.url().includes("session=retained"));
  assert.equal(await page.getByRole("link", { name: "Obsidian", exact: true }).getAttribute("aria-current"), "page");
  await page.screenshot({ path: `${screenshots}/atlas-library.png` });
  await page.getByRole("button", { name: "完整阅读", exact: true }).click();
  await page.locator("article").getByRole("button", { name: "React", exact: true }).click();
  await page.locator("article").getByRole("heading", { name: "React", exact: true }).waitFor();
  await page.locator("article").getByRole("button", { name: "闭包", exact: true }).click();
  await page.locator("article").getByRole("heading", { name: "闭包", exact: true }).waitFor();
  await mode("关系图").click(); await ready();
  await locate("Home.md");
  await inspector.getByRole("heading", { name: "我的知识地图" }).waitFor();
  await page.screenshot({ path: `${screenshots}/atlas-canvas.png` });
  const original = await canvas.getAttribute("data-camera");
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await page.waitForFunction((previous) => document.querySelector("canvas[data-camera]")?.getAttribute("data-camera") !== previous, original);
  assert.notEqual(await canvas.getAttribute("data-camera"), original);
  let p = await center();
  await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, 70); await page.waitForTimeout(100);
  const beforePan = await canvas.getAttribute("data-camera");
  const b = await canvas.boundingBox();
  await page.mouse.move(b.x + 8, b.y + 8); await page.mouse.down(); await page.mouse.move(b.x + 70, b.y + 50, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(100);
  assert.notEqual(await canvas.getAttribute("data-camera"), beforePan);
  await locate("Home.md"); p = await center();
  await page.mouse.move(p.x, p.y); await page.waitForTimeout(100);
  assert.equal(await canvas.getAttribute("data-hovered"), "Home.md");
  const beforeDrag = await canvas.getAttribute("data-camera");
  await page.mouse.down(); await page.mouse.move(p.x + 70, p.y + 45, { steps: 8 }); await page.mouse.up();
  await page.mouse.move(p.x + 71, p.y + 46); await page.waitForTimeout(100);
  assert.equal(await canvas.getAttribute("data-hovered"), "Home.md");
  assert.equal(await canvas.getAttribute("data-camera"), beforeDrag, "node drag does not pan camera");
  await mode("笔记库").click(); await mode("关系图").click(); await page.waitForTimeout(150);
  assert.equal(await canvas.getAttribute("data-camera"), beforeDrag, "view switches preserve the camera");
  await page.getByRole("combobox", { name: "关系图范围" }).selectOption("1"); await ready();
  assert.ok((await graph.innerText()).includes("17 个节点"));
  await page.getByRole("combobox", { name: "关系图范围" }).selectOption("0"); await ready();
  await page.getByRole("button", { name: "专注画布", exact: true }).click(); await page.waitForTimeout(100);
  assert.equal(await inspector.isVisible(), false);
  await page.keyboard.press("Escape"); await page.waitForTimeout(100);
  assert.equal(await inspector.isVisible(), true);
  await locate("知识/React.md"); p = await center();
  await page.mouse.dblclick(p.x, p.y);
  await page.locator("article").getByRole("heading", { name: "React", exact: true }).waitFor();
  await mode("关系图").click(); await ready();
  await canvas.focus(); const beforeKey = await canvas.getAttribute("data-camera"); await canvas.press("+");
  await page.waitForFunction((previous) => document.querySelector("canvas[data-camera]")?.getAttribute("data-camera") !== previous, beforeKey);
  assert.notEqual(await canvas.getAttribute("data-camera"), beforeKey);
  await canvas.press("Enter"); await page.locator("article").getByRole("heading", { name: "React", exact: true }).waitFor();
  await mode("笔记库").click();
  await page.getByRole("button", { name: "尚未连接 1", exact: true }).click();
  await page.getByRole("button", { name: "一个新想法 · 收件箱/一个新想法.md", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Home · Home.md", exact: true }).count(), 0);
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await page.getByRole("searchbox").fill("Local-first");
  await page.getByRole("button", { name: "Local-first · 阅读/Local-first.md", exact: true }).click();
  await inspector.getByRole("heading", { name: "Local-first", exact: true }).waitFor();
  await page.getByRole("searchbox").fill("");
  await page.getByRole("combobox", { name: "笔记排序" }).selectOption("links");
  assert.equal(await page.locator('button[aria-label$=" · Home.md"]').count(), 1);
  revision++;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await inspector.getByText("外部修改已读取", { exact: true }).waitFor();
  await page.reload(); await inspector.getByRole("heading", { name: "Local-first", exact: true }).waitFor();
  failNote = true; await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Note no longer exists" }).waitFor();
  failNote = false; await page.getByRole("button", { name: "重试", exact: true }).click();
  await inspector.getByRole("heading", { name: "Local-first", exact: true }).waitFor();
  failIndex = true; await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Permission denied" }).waitFor();
  failIndex = false; await page.getByRole("button", { name: "刷新", exact: true }).click();
  await inspector.getByRole("heading", { name: "Local-first", exact: true }).waitFor();
  for (const width of [1024, 760, 390, 375]) {
    await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `No horizontal overflow at ${width}`);
    await page.screenshot({ path: `${screenshots}/atlas-${width}.png` });
  }
  await mode("关系图").click(); await ready();
  assert.equal(await canvas.isVisible(), true);
  await page.screenshot({ path: `${screenshots}/atlas-mobile-canvas.png` });
  // Real Chromium touch events exercise the two-pointer gesture path, not synthetic mouse zoom.
  const cdp = await context.newCDPSession(page);
  const mobileBox = await canvas.boundingBox();
  const x = mobileBox.x + mobileBox.width / 2, y = mobileBox.y + Math.min(150, mobileBox.height / 2);
  const cameraBeforePinch = await canvas.getAttribute("data-camera");
  const selectionBeforePinch = page.url();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x - 35, y, id: 1 }, { x: x + 35, y, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 65, y, id: 1 }, { x: x + 65, y, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(100);
  assert.notEqual(await canvas.getAttribute("data-camera"), cameraBeforePinch);
  assert.equal(page.url(), selectionBeforePinch, "pinch does not select a node");
  await page.getByRole("button", { name: "专注画布", exact: true }).click();
  await locate("Home.md");
  await inspector.getByRole("heading", { name: "我的知识地图" }).waitFor();
  assert.equal(await inspector.isVisible(), true, "selecting in focus mode reveals the mobile preview, not a blank pane");
  await mode("关系图").click(); await ready();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; }); await page.waitForTimeout(100);
  await page.screenshot({ path: `${screenshots}/atlas-dark-canvas.png` });
  // Also cover animated layout, rather than only the reduced-motion path used above.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  large = true; await page.goto("/obsidian?view=graph"); await ready();
  await page.getByText("1000 个节点 · 1000 条连线", { exact: true }).waitFor();
  await page.screenshot({ path: `${screenshots}/atlas-1000.png` });
  await page.getByRole("button", { name: "重新布局", exact: true }).click(); await ready();
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  large = false; empty = true; await page.goto("/obsidian");
  await page.getByText("请先在服务器所在电脑的 Obsidian 中打开仓库，再刷新。", { exact: true }).waitFor();
  empty = false; multi = true; await page.goto("/obsidian");
  const picker = page.getByRole("combobox", { name: "Obsidian 仓库" });
  await page.waitForFunction(() => document.querySelector("select")?.options.length === 3);
  assert.equal(await picker.inputValue(), ""); await picker.selectOption("second");
  await page.getByRole("button", { name: "Home · Home.md", exact: true }).waitFor();
  assert.equal(writes, 0); assert.deepEqual(externalImages, []); assert.deepEqual(errors, []);
  console.log("Obsidian atlas: cards, preview, filters, wiki navigation, Canvas zoom/pan/drag/hover, preserved camera, keyboard, pinch, 1,000 nodes, reload, failures, mobile and privacy passed.");
} finally { await browser.close(); }
