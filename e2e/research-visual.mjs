// Research presentation regression. All research APIs are mocked; no model or personal-data writes.
// node --env-file-if-exists=.env.local e2e/research-visual.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const shots = "/tmp/research-visual";
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
const now = new Date().toISOString();
const project = { id: "heat", name: "HEAT", brief: "降低 RAG 幻觉检测的误报，同时保持对真实错误的识别能力。", objective: "1. 阅读两篇关于一致性检测的论文\n2. 对齐主答案与采样答案的检索上下文\n3. 对照基线，比较误报率与召回率", note: "## 方向与假设\n**一致性不等于正确性。** 先检验误报是否来自上下文信息不对称，而不是直接修改检测阈值。\n\n### 相关证据\n从已有论文中区分事实错误与上下文差异。\n\n## 下一项实验\n### 实验设置\n- 固定模型、温度与采样次数\n- 只改变检索上下文是否对齐\n- 同时报告 FPR、召回率与运行成本\n\n### 结果\n> 实验结果尚未得到；这是待验证的假设。\n\n### 结果\n复现实验保留独立记录。\n\n```md\n# 代码不是目录\n```\n\n每周复盘\n--------\n保留下一步要检查的问题。", links: [{ title: "Experiment sheet", url: "https://docs.google.com/spreadsheets/d/test/edit" }], createdAt: now, updatedAt: now, objectiveUpdatedAt: now, papers: 3, read: 1, needsPdf: 0, messages: 1, hasNotes: true };
const papers = ["queued", "reading", "read"].map((status, index) => ({ id: `paper-${index}`, title: ["Too Consistent to Detect: A Study of Self-Consistent Errors", "Evidence-Grounded Reasoning for Hallucination Detection", "Rethinking Correctness, Consistency, and Prompt Multiplicity"][index], url: "https://example.org/paper", pdfUrl: "", authors: ["Example Researcher"], year: "2026", abstract: "This paper separates consistency from correctness.", provider: "Test", revision: 1, status, tags: "", note: "", source: null, messages: [], exports: [], createdAt: now, updatedAt: now, projectIds: ["heat"], hasAnalysis: true, coverage: "abstract", archived: false,
  analysis: { abstractExplanation: "稳定的回答不一定正确。", summary: "## 核心问题\n**一致性并非正确性的证明。** 应同时评估误报和漏报。\n\n## 实验设计\n固定模型与检索条件，然后比较不同检测指标。", connections: {}, sourceKey: "test", coverage: "abstract", objective: "", createdAt: now } }));
const archivedProject = { ...project, id: "archived", name: "Earlier project", archived: true, papers: 0, needsPdf: 0, objective: "", note: "", hasNotes: false };
const unfiled = { ...papers[0], id: "unfiled", title: "A paper to organise", projectIds: [] };
const errors = [], writes = [], ratios = [];

// Resolve browser colors (including color-mix) and alpha-composite actual ancestor grounds.
async function contrast(locator, minimum = 4.5) {
  await locator.waitFor({ state: "visible" });
  const result = await locator.evaluate(node => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const color = css => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].map((v, i) => i === 3 ? v / 255 : v); };
    const over = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
    const parents = []; for (let p = node; p; p = p.parentElement) parents.push(p);
    let bg = [255, 255, 255];
    for (const parent of parents.reverse()) bg = over(color(getComputedStyle(parent).backgroundColor), bg);
    const fg = over(color(getComputedStyle(node).color), bg);
    const lum = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
    const l = [lum(fg), lum(bg)].sort((a, b) => b - a);
    return { ratio: (l[0] + .05) / (l[1] + .05), label: (node.textContent || node.getAttribute("aria-label") || node.id).slice(0, 60) };
  });
  assert.ok(result.ratio >= minimum, `${result.label}: contrast ${result.ratio.toFixed(2)} < ${minimum}`);
  ratios.push(result.ratio);
}
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/research/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.slice("/api/research/".length);
    // Navigation saves only a mocked active-project preference, never research content.
    if (path === "projects" && req.method() === "PUT") return route.fulfill({ json: { ok: true } });
    if (req.method() !== "GET") { writes.push(path); return route.fulfill({ status: 405, json: { error: "Visual tests cannot write" } }); }
    const reply = json => route.fulfill({ json });
    if (path === "projects") return reply({ projects: [project, archivedProject], activeId: "heat" });
    if (path === "objective") { const current = url.searchParams.get("project") === "archived" ? archivedProject : project; return reply({ objective: current.objective, note: current.note, revision: "test", captureState: { captures: [], vaults: [], vaultId: "" } }); }
    if (path === "papers") return reply(url.searchParams.has("id") ? { paper: [...papers, unfiled].find(p => p.id === url.searchParams.get("id")) } : { papers: url.searchParams.get("project") === "archived" ? [] : url.searchParams.get("project") === "heat" ? papers : [...papers, unfiled] });
    if (path === "sessions") return reply({ sessions: [], run: null });
    if (path === "agent") {
      const projectId = url.searchParams.get("project") || "general", paperId = url.searchParams.get("paper") || undefined;
      const conversation = { id: paperId ? `paper:${projectId}:${paperId}` : `discussion:${projectId}`, projectId, paperId, title: "研究讨论", kind: paperId ? "paper" : "discussion", default: true, revision: 0, createdAt: now, updatedAt: now, messageCount: 1 };
      return reply({ conversation, sessions: [conversation], run: null, messages: [{ id: "answer", role: "assistant", text: "## 先验证最重要的假设\n**只改变一个因素：对齐检索上下文。** 同时观察误报率和召回率，避免仅通过降低检测灵敏度得到更低的误报。", at: now }] });
    }
    return route.fulfill({ status: 404, json: { error: "Unmocked endpoint" } });
  });
  const view = name => page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  const noOverflow = async () => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no page-level horizontal overflow");
    for (const node of [page.locator("main"), page.locator("main").locator("..")]) {
      assert.ok(await node.evaluate(el => el.scrollWidth <= el.clientWidth + 1), "no horizontal overflow hidden by the workspace scrollport");
    }
  };
  // Clear filing: archived projects remain reachable, without appearing among active projects.
  await page.goto("/research");
  const filing = page.getByRole("navigation", { name: "研究课题" });
  await filing.locator('details > summary').click();
  await filing.getByRole("button", { name: /^Earlier project/ }).click();
  await filing.getByRole('region', { name: 'Earlier project', exact: true }).getByRole('link', { name: '工作台', exact: true }).click();
  await page.getByRole("heading", { name: "Earlier project", exact: true }).waitFor();
  assert.equal(await filing.locator('[class*="projectTree"]').getByRole('region', { name: 'Earlier project', exact: true }).count(), 0);
  await filing.getByRole('region', { name: '研究首页', exact: true }).getByRole('link', { name: '工作台', exact: true }).click();
  await page.getByRole("button", { name: /1 篇论文待整理/ }).click();
  const library = page.locator("#research-home-papers");
  await library.getByRole("button", { name: /A paper to organise/ }).waitFor();
  assert.equal(await library.getByRole("button", { name: /Too Consistent/ }).count(), 0);
  await library.getByRole("combobox", { name: "显示哪些论文" }).selectOption("archived");
  assert.equal(await library.locator('[class*="paperRow"]').count(), 0);
  await library.getByRole("combobox", { name: "显示哪些论文" }).selectOption("all");
  await library.getByRole("group", { name: "你的阅读状态" }).getByRole("button", { name: "在读", exact: true }).click();
  assert.equal(await library.locator('[class*="paperRow"]').count(), 1);
  await library.getByRole("button", { name: /Evidence-Grounded/ }).waitFor();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => localStorage.setItem("pi-theme", theme), theme);
    await page.goto("/research");
    await page.getByRole("heading", { name: "研究工作台" }).waitFor();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme && document.documentElement.classList.contains("dark") === (theme === "dark"), theme);
    await contrast(page.getByRole("heading", { name: "研究工作台" }), 3);
    await contrast(page.locator('[class*="projectOverviewFocus"] > span'));
    await contrast(page.locator('[class*="projectOverviewBrief"] > span').last());
    await page.screenshot({ path: `${shots}/${theme}-home.png` });
    await page.goto("/research?project=heat");
    await page.getByRole("heading", { name: "HEAT", exact: true }).waitFor();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme && document.documentElement.classList.contains("dark") === (theme === "dark"), theme);
    assert.equal(await page.locator('[class*="switcher"] svg, [class*="workspaceNav"] svg, [class*="linkChip"] img').count(), 0, "text-only navigation and references, no decorative logos");
    const grid = page.locator('.robin-page .pi-grid-surface');
    const checkGrid = async () => assert.equal(await grid.evaluate(el => getComputedStyle(el).backgroundImage), await page.locator('html').evaluate(el => getComputedStyle(el).backgroundImage), "reuse the shared engineering-paper grid in every theme and viewport");
    await checkGrid();
    assert.match(await grid.evaluate(el => getComputedStyle(el).backgroundImage), /radial-gradient/);
    for (const surface of await page.locator('[class*="workspacePanel"], #research-view-overview').all()) {
      assert.ok(await surface.evaluate(el => {
        const style = getComputedStyle(el);
        const expected = document.createElement('span'); expected.style.backgroundColor = 'var(--bg-panel)'; el.append(expected);
        const opaquePanel = style.backgroundColor === getComputedStyle(expected).backgroundColor; expected.remove();
        return opaquePanel && style.backgroundImage === 'none';
      }), "reading surfaces mask the grid without nested decorative cards");
    }
    const sessions = filing.getByRole("region", { name: "HEAT", exact: true });
    await sessions.waitFor();
    assert.equal(await page.locator("main").getByRole("region", { name: "HEAT", exact: true }).count(), 0, "conversation navigation belongs in the left rail");
    const railBox = await sessions.boundingBox(), mainBox = await page.locator("main").boundingBox();
    assert.ok(railBox.x + railBox.width <= mainBox.x, "sessions sit beside, not above, the conversation");
    await page.getByRole("link", { name: /Experiment sheet/ }).waitFor({ state: "visible" });
    const outline = page.getByRole("navigation", { name: "笔记目录", exact: true });
    await outline.getByRole("button", { name: "相关证据", exact: true }).waitFor();
    await outline.getByRole("button", { name: "收起 方向与假设", exact: true }).click();
    assert.equal(await outline.getByRole("button", { name: "相关证据", exact: true }).isVisible(), false);
    await outline.getByRole("button", { name: "展开 方向与假设", exact: true }).click();
    assert.equal(await outline.getByRole("button", { name: "相关证据", exact: true }).isVisible(), true);
    assert.equal(await outline.getByRole("button", { name: "代码不是目录", exact: true }).count(), 0);
    await outline.getByRole("button", { name: "每周复盘", exact: true }).waitFor();
    await outline.getByRole("button", { name: "结果", exact: true }).nth(1).focus();
    await outline.getByRole("button", { name: "结果", exact: true }).nth(1).press("Enter");
    const selectedHeading = page.locator('#research-notebook [class*="noteView"]').getByRole("heading", { name: "结果", exact: true }).nth(1);
    assert.ok(await selectedHeading.evaluate(el => document.activeElement === el), "duplicate titles navigate to the right occurrence");
    assert.equal(await outline.getByRole("button", { name: "结果", exact: true }).nth(1).getAttribute("aria-current"), "location");
    await page.locator(".robin-page").evaluate(el => el.scrollTo(0, 0));
    await contrast(page.locator("#research-focus"));
    for (const heading of [page.locator('#research-focus-label'), page.locator('#research-notebook-title'), page.locator('#research-queue-title')]) await contrast(heading);
    await contrast(page.locator('[class*="brief"]').first());
    await contrast(page.locator('[class*="focusState"]').first());
    await contrast(page.locator("#research-notebook .markdown-body p").first());
    await contrast(page.locator("#research-notebook").getByRole("button", { name: "编辑", exact: true }));
    await contrast(page.getByRole("navigation", { name: "研究工作区" }).getByRole("button", { name: "工作台", exact: true }));
    for (const node of [page.locator("#research-focus").locator(".."), page.locator("#research-notebook")]) {
      assert.equal(await node.evaluate(el => getComputedStyle(el).backgroundImage), "none", "no decorative texture behind research text");
    }
    const focusBox = await page.locator("#research-focus").locator("..").boundingBox();
    const noteBox = await page.locator("#research-notebook").boundingBox();
    const queue = page.getByRole("region", { name: "接着读" });
    const queueBox = await queue.boundingBox();
    assert.ok(noteBox.y >= focusBox.y + focusBox.height, "notes follow the current goal");
    assert.equal(noteBox.x, focusBox.x, "goal and notebook share an aligned working column");
    assert.ok(focusBox.width >= queueBox.width * 1.5, "the goal and notes dominate the desktop working area");
    const type = await page.locator('main').evaluate(el => {
      const size = selector => parseFloat(getComputedStyle(el.querySelector(selector)).fontSize);
      return { goal: size('#research-focus-label'), note: size('#research-notebook-title'), queue: size('#research-queue-title'), field: size('#research-focus'), paper: size('[class*="queueList"] strong') };
    });
    assert.ok(type.goal >= type.queue * 1.3 && type.note >= type.queue * 1.3, 'primary sections have a clear type hierarchy over supporting reading');
    assert.ok(type.field > type.paper, 'the weekly objective—not a queued paper—is the first reading emphasis');
    for (const heading of ['#research-focus-label', '#research-notebook-title']) await contrast(page.locator(heading), 7);
    await contrast(page.locator('#research-notebook > [class*="marginHint"]'));
    const edit = page.locator('#research-notebook').getByRole('button', { name: '编辑', exact: true });
    assert.equal(await edit.evaluate(el => getComputedStyle(el).borderTopStyle), 'solid', 'editing has a visible button affordance');
    assert.ok(queueBox.x >= focusBox.x + focusBox.width, "reading queue sits to the side");
    assert.match(await queue.locator("li").first().textContent(), /Evidence-Grounded/, "in-progress reading comes first");
    await contrast(queue.locator('[class*="readingStatus"]').first());
    await contrast(queue.locator("strong").first());
    await page.locator("#research-focus").focus();
    assert.equal(await page.locator("#research-focus").evaluate(el => getComputedStyle(el).outlineStyle), "solid");
    await page.locator("#research-focus").blur();
    await page.screenshot({ path: `${shots}/${theme}-overview.png` });
    await page.locator("#research-notebook").evaluate(el => el.scrollIntoView({ block: "start", behavior: "instant" }));
    await page.screenshot({ path: `${shots}/${theme}-notebook-tree.png` });
    await view("文献库");
    await contrast(page.locator('[class*="paperTitle"]').first());
    await contrast(page.locator('#research-view-papers [class*="readingStatus"]').first());
    await contrast(page.locator('[class*="paperMeta"] > span:last-child').first());
    await contrast(page.getByRole("button", { name: "搜索", exact: true }));
    await page.screenshot({ path: `${shots}/${theme}-papers.png` });
    await page.locator('#research-view-papers').getByRole("button", { name: /Too Consistent/ }).click();
    await contrast(page.getByRole("dialog").locator(".markdown-body p").first());
    await contrast(page.getByRole("dialog").getByRole("button", { name: "返回论文列表", exact: true }));
    await page.screenshot({ path: `${shots}/${theme}-reader.png` });
    await page.getByRole("dialog").getByRole("button", { name: "返回论文列表", exact: true }).click();
    await view("研究助手");
    await contrast(page.locator('[class*="conversationColumn"] .markdown-body p').first());
    await sessions.locator('a[aria-current="page"]').waitFor();
    assert.ok((await sessions.locator('a[aria-current="page"]').boundingBox()).height <= 32, 'compact desktop session row');
    await page.screenshot({ path: `${shots}/${theme}-assistant.png` });
    for (const width of [320, 390, 812, 1440]) {
      await page.setViewportSize({ width, height: width === 812 ? 375 : 900 });
      await page.waitForTimeout(700);
      await checkGrid();
      for (const name of ["工作台", "文献库", "研究助手"]) { await view(name); await noOverflow(); }
      if (width === 390) {
        await view("工作台");
        await page.screenshot({ path: `${shots}/${theme}-phone.png` });
        await page.locator('#research-view-overview').evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
        await page.screenshot({ path: `${shots}/${theme}-phone-overview.png` });
        await page.locator("#research-notebook").evaluate(el => el.scrollIntoView({ block: "start", behavior: "instant" }));
        await page.screenshot({ path: `${shots}/${theme}-phone-tree.png` });
        await noOverflow();
        const treeButtons = page.getByRole("navigation", { name: "笔记目录", exact: true }).getByRole("button");
        for (const button of await treeButtons.all()) assert.ok((await button.boundingBox()).height >= 44);
        const controls = page.getByRole("navigation", { name: "研究工作区" }).getByRole("button");
        for (const button of await controls.all()) assert.ok((await button.boundingBox()).height >= 44);
      }
    }
  }
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  console.log(`Research visual checks passed: light/dark, 320–1440px; sampled text contrast >= ${Math.min(...ratios).toFixed(2)}:1. Screenshots: ${shots}`);
} finally { await browser.close(); }
