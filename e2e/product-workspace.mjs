// Existing dev server; every Robin API is mocked. No personal ideas or CRM rows are written.
// node --env-file-if-exists=.env.local --experimental-strip-types e2e/product-workspace.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { PRODUCT_ASSESSMENT_CRITERIA } from "../extension/robin/product-assessment.ts";
const SOURCE = "https://www.starterstory.com/data/ios-app-ideas";
const catalog = [
  { id: "stories-pushup-quest", title: "Every push-up becomes an attack in a camera-counted RPG.", productHost: "pushup.quest", revenue: "$800/mo", monthlyUsd: 800, url: "https://www.starterstory.com/stories/pushup-quest" },
  { id: "audiopen", title: "AI voice note transcriber", productHost: "audiopen.ai", revenue: "$15K/mo", monthlyUsd: 15000, url: "https://www.starterstory.com/businesses/audiopen" },
  { id: "reflect", title: "AI-powered note-taking app", productHost: "reflect.app", revenue: "$30K/mo", monthlyUsd: 30000, url: "https://www.starterstory.com/businesses/reflect-634777" },
].map((item) => ({ ...item, source: SOURCE, revenueBasis: "unspecified", match: "待研究的 App", angle: "对照原产品测试一个步骤", transfer: "在新人群测试相同机制", mvp: "单任务原型", charge: "核查付费墙", experiment: "测量完成耗时" }));

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const screenshots = process.env.E2E_SCREENSHOT_DIR ?? "/tmp/product-workspace";
mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
let page;
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  if (process.env.PI_WEB_PASSWORD) {
    const login = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(login.ok(), `Login failed: ${login.status()}`);
  }
  await context.addInitScript(() => { if (!localStorage.getItem("pi-locale")) localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-theme", "light"); });
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const ideas = [
    { id: "one", name: "设计师交付助手", note: "保留我的笔记", step: "research", links: [], createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" },
    { id: "two", name: "课程脚本助手", note: "另一条笔记", step: "spot", links: [], createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" },
  ];
  let writes = 0;
  let failNext = false;
  let failRead = false;
  let revision = 0;
  const assessments = {};
  let assessmentRequests = 0;
  let failOpportunityRead = false;
  let holdAssessment = false;
  await page.route("**/api/robin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method !== "GET") writes++;
    if (path === "/api/robin/product-opportunities/assess") assessmentRequests++;
    if (method !== "GET" && failNext) { failNext = false; return route.fulfill({ status: 500, json: { error: "保存失败，请重试" } }); }
    if (path === "/api/robin/products") {
      if (method === "GET" && failRead) return route.fulfill({ status: 503, json: { error: "读取失败" } });
      if (method === "POST") {
        const input = route.request().postDataJSON();
        const idea = { ...input, id: `new-${writes}`, links: [], step: "spot", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        ideas.push(idea); return route.fulfill({ json: { idea } });
      }
      return route.fulfill({ json: { ideas, captures: [] } });
    }
    if (path.startsWith("/api/robin/products/")) {
      const idea = ideas.find((entry) => entry.id === path.split("/").at(-1));
      if (method === "PATCH") {
        const input = route.request().postDataJSON();
        if (input.launchNode) {
          const { nodeId, expectedUpdatedAt, ...values } = input.launchNode;
          if ((idea.launchPlan?.[nodeId]?.updatedAt ?? null) !== expectedUpdatedAt) return route.fulfill({ status: 409, json: { error: "此分支已在别处更改" } });
          idea.launchPlan ??= {};
          idea.launchPlan[nodeId] = { ...values, updatedAt: `revision-${++revision}` };
        } else Object.assign(idea, input);
      }
      return route.fulfill({ json: { idea } });
    }
    if (path === "/api/robin/product-opportunities/assess") {
      if (holdAssessment) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return route.abort().catch(() => {});
      }
      const input = route.request().postDataJSON();
      assert.equal(input.locale, "zh");
      const assessment = { verdict: "test", reason: "只验证计数可靠性这个切口；完整游戏的持续内容成本不适合直接照搬。", wedge: "测量不同光照下的漏计率，不开发完整 RPG。", firstTest: "拟定小实验：5 位用户对照测试计数，漏计率下降至少 10% 再继续。", stopRule: "若不同设备仍频繁漏计，停止扩大开发。", unknowns: [], confidence: "medium", locale: "zh", assessedAt: new Date().toISOString(), basis: "mock", criteria: Object.fromEntries(PRODUCT_ASSESSMENT_CRITERIA.map(({ id }) => [id, { status: "supported", reason: "这是模拟测试依据，不是真实产品调研。", sourceIds: [1] }])), sources: [{ title: "模拟公开产品页面", url: "https://pushup.quest", quote: "Synthetic evidence for browser tests only." }] };
      assessments[input.id] = assessment;
      return route.fulfill({ json: { assessment } });
    }
    if (path === "/api/robin/product-opportunities") {
      if (method === "GET" && failOpportunityRead) return route.fulfill({ status: 503, json: { error: "目录刷新失败" } });
      if (method === "POST") {
        const input = route.request().postDataJSON();
        if (input.refresh) return route.fulfill({ json: { started: true } });
        const item = catalog.find((entry) => entry.id === input.id);
        const id = `starter-story-${item.id}`;
        let idea = ideas.find((entry) => entry.id === id);
        if (!idea) {
          idea = { id, name: item.title, note: `未验证假设\n${SOURCE}\n${item.url}`, links: [], step: "spot", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          ideas.push(idea);
        }
        return route.fulfill({ json: { idea } });
      }
      return route.fulfill({ json: { opportunities: catalog, assessments, scanning: false, scheduled: false, savedIds: catalog.filter((item) => ideas.some((idea) => idea.id === `starter-story-${item.id}`)).map((item) => item.id), source: SOURCE } });
    }
    return route.fulfill({ json: { resources: [], contacts: [], review: null, jobs: [], records: [], events: [], rounds: [], finals: {} } });
  });
  await page.goto("/product");
  await page.getByRole("heading", { name: "产品工作室", exact: true }).waitFor();
  const nav = page.getByRole("navigation", { name: "产品工作区", exact: true });
  const map = page.locator("#product-view-map");
  const detail = page.locator("#product-map-detail");
  const research = page.locator("#product-view-discover");
  const pick = (name) => page.getByRole("group", { name: "产品上线思维导图" }).getByRole("button", { name: new RegExp(name) });
  const showMap = async () => { await nav.getByRole("button", { name: /产品全景图/ }).click(); await map.waitFor(); };
  assert.equal(await nav.getByRole("link", { name: /CRM/ }).getAttribute("href"), "/product/jarvis");
  assert.equal(await research.isVisible(), true);
  assert.equal(await page.locator("#product-view-ideas").isVisible(), false);
  assert.equal(writes, 0);
  assert.equal(await research.getByRole("list", { name: "如何使用机会研究" }).isVisible(), true);
  assert.ok((await nav.boundingBox()).height < 80);
  assert.equal(await research.getByRole("link", { name: /打开 iOS App 点子库/ }).getAttribute("href"), SOURCE);
  assert.equal(await research.locator("li").filter({ has: page.getByRole("link") }).count(), 3);
  assert.equal(await research.getByText("Papermark", { exact: true }).count(), 0, "Interview examples do not supply discovery candidates");
  assert.equal(await research.getByText(/\$800\/mo/).isVisible(), true, "Small apps are not screened out");
  const firstListing = research.locator("li").filter({ has: page.getByRole("link") }).first();
  const hypotheses = () => firstListing.locator("summary").filter({ hasText: "待验证假设" });
  await hypotheses().click();
  assert.equal(await firstListing.getByText(/不是已发现的产品缺陷/).isVisible(), true);
  assert.equal(await firstListing.getByText("迁移场景", { exact: true }).isVisible(), true);
  await hypotheses().click();
  assert.equal(writes, 0);
  await page.locator("main").evaluate((el) => { el.scrollTop = 0; });
  await page.screenshot({ path: `${screenshots}/discover-light.png`, animations: "disabled" });

  // Container-driven reflow also handles the assistant, not just phone viewports.
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.getByRole("button", { name: /研究助手/ }).click();
  await page.getByRole("button", { name: /关闭/ }).waitFor();
  assert.equal(await page.locator("main").evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
  await page.getByRole("button", { name: /关闭/ }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(writes, 0, "Opening the assistant does not run research or write a project");

  // Reference browsing is read-only, not project filtering or fake progress.
  await showMap();
  for (const name of ["需求与切入点", "验证与 MVP 边界", "产品与技术栈", "收费与合规", "获客与销售", "上线与交付", "维护与留存", "成本与止损"]) {
    await pick(name).click();
    assert.equal(await pick(name).getAttribute("aria-pressed"), "true");
  }
  assert.equal(writes, 0);
  assert.equal(await detail.getByRole("button", { name: "保存这个分支" }).count(), 0);
  const calculator = detail.getByRole("spinbutton");
  await calculator.nth(0).fill("100"); await calculator.nth(1).fill("20"); await calculator.nth(2).fill("5");
  await detail.getByText("约需 7 位付费客户覆盖固定月成本。").waitFor();
  await calculator.nth(2).fill("20");
  await detail.getByText(/没有有效的盈亏平衡点/).waitFor();

  await map.getByLabel("应用到").selectOption("one");
  await pick("需求与切入点").click();
  const note = () => detail.getByLabel("方案、证据、链接与预算");
  await note().fill("我的客户证据，保留草稿");
  await pick("维护与留存").click();
  await note().fill("备份恢复演练，另一分支");
  await pick("需求与切入点").click();
  assert.equal(await note().inputValue(), "我的客户证据，保留草稿");
  await nav.getByRole("button", { name: /机会研究/ }).click();
  await showMap();
  assert.equal(await note().inputValue(), "我的客户证据，保留草稿");
  await map.getByLabel("应用到").selectOption("two");
  assert.equal(await note().inputValue(), "");
  await map.getByLabel("应用到").selectOption("one");
  assert.equal(await note().inputValue(), "我的客户证据，保留草稿");
  failNext = true;
  await detail.getByRole("button", { name: "保存这个分支" }).click();
  await detail.getByRole("alert").filter({ hasText: "保存失败" }).waitFor();
  assert.equal(await note().inputValue(), "我的客户证据，保留草稿");
  await detail.getByLabel("分支状态").selectOption("done");
  await detail.getByRole("button", { name: "保存这个分支" }).click();
  await map.getByText(/1 \/ 8 个分支已由你确认/).waitFor();
  assert.equal(ideas[0].step, "research");
  assert.equal(ideas[0].note, "保留我的笔记");
  assert.equal(ideas[0].launchPlan.market.note, "我的客户证据，保留草稿");
  await pick("维护与留存").click();
  assert.equal(await note().inputValue(), "备份恢复演练，另一分支");
  await detail.getByRole("button", { name: "保存这个分支" }).click();
  await page.waitForFunction(() => document.querySelector("#product-map-detail button")?.disabled === true);
  // Same-branch conflicts preserve the draft; an explicit discard loads the newer edit.
  await pick("需求与切入点").click();
  await note().fill("我的旧版本修改");
  ideas[0].launchPlan.market = { status: "doing", note: "另一窗口的最新证据", updatedAt: `revision-${++revision}` };
  await detail.getByRole("button", { name: "保存这个分支" }).click();
  await detail.getByRole("alert").filter({ hasText: "已在别处更改" }).waitFor();
  assert.equal(await note().inputValue(), "我的旧版本修改");
  page.once("dialog", (dialog) => dialog.accept());
  await detail.getByRole("button", { name: "放弃草稿 / 载入最新" }).click();
  await page.waitForFunction(() => document.querySelector('#product-map-detail textarea')?.value === "另一窗口的最新证据");
  // A PATCH acknowledgement still wins when the subsequent GET fails.
  await note().fill("保存回执应保留");
  failRead = true;
  await detail.getByRole("button", { name: "保存这个分支" }).click();
  await page.getByRole("alert").filter({ hasText: "读取失败" }).waitFor();
  assert.equal(await note().inputValue(), "保存回执应保留");
  failRead = false;
  const downloadPromise = page.waitForEvent("download");
  await map.getByRole("button", { name: "导出已保存计划 ↓" }).click();
  assert.equal((await downloadPromise).suggestedFilename(), "product-launch-plan.md");
  await pick("收费与合规").focus();
  await page.keyboard.press("Enter");
  assert.equal(await pick("收费与合规").getAttribute("aria-pressed"), "true");
  await page.waitForFunction(() => {
    const top = document.getElementById("product-map-question").getBoundingClientRect().top;
    return top >= 0 && top < window.innerHeight;
  });
  await page.screenshot({ path: `${screenshots}/map-guide-light.png`, animations: "disabled" });
  await detail.getByRole("link", { name: "↑ 返回全景图" }).click();
  await page.screenshot({ path: `${screenshots}/map-light.png`, animations: "disabled" });

  // Assessments are explicit, durable and independent of ideas; failed reads/writes retain the result.
  await nav.getByRole("button", { name: /机会研究/ }).click();
  assert.equal(assessmentRequests, 0);
  failOpportunityRead = true;
  await firstListing.getByRole("button", { name: /判断值不值得做/ }).click();
  await firstListing.getByText("值得小额验证", { exact: true }).waitFor();
  await research.getByRole("alert").filter({ hasText: "目录刷新失败" }).waitFor();
  assert.equal(ideas.length, 2, "Assessment does not adopt or edit ideas");
  assert.equal(assessmentRequests, 1);
  failOpportunityRead = false;
  await page.reload();
  await firstListing.getByText("值得小额验证", { exact: true }).waitFor();
  assert.equal(assessmentRequests, 1, "Reload reads the saved assessment, not a new paid turn");
  await firstListing.locator("summary").filter({ hasText: "查看六项依据" }).click();
  for (const criterion of PRODUCT_ASSESSMENT_CRITERIA) assert.equal(await firstListing.getByText(criterion.zh, { exact: false }).isVisible(), true);
  await firstListing.locator("summary").filter({ hasText: "模拟公开产品页面" }).click();
  await firstListing.getByText("Synthetic evidence for browser tests only.", { exact: true }).waitFor();
  await firstListing.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${screenshots}/assessment-expanded.png`, animations: "disabled" });
  await firstListing.locator("summary").filter({ hasText: "查看六项依据" }).click();
  failNext = true;
  await firstListing.getByRole("button", { name: /重新评估/ }).click();
  await firstListing.getByRole("alert").filter({ hasText: "保存失败" }).waitFor();
  assert.equal(await firstListing.getByText("值得小额验证", { exact: true }).isVisible(), true);
  holdAssessment = true;
  await firstListing.getByRole("button", { name: /重新评估/ }).click();
  await firstListing.getByRole("button", { name: /停止评估/ }).click();
  await firstListing.getByRole("alert").filter({ hasText: "已停止评估" }).waitFor();
  assert.equal(await firstListing.getByText("值得小额验证", { exact: true }).isVisible(), true);
  holdAssessment = false;
  assessments[catalog[0].id].stale = true;
  await page.reload();
  await firstListing.getByText(/这是旧评估/).waitFor();
  assessments[catalog[0].id].stale = false;

  // A directory candidate becomes an idea only on explicit adoption.
  await research.getByRole("button", { name: /保存为想法/ }).first().click();
  await page.locator("#product-view-ideas").waitFor();
  const created = ideas.find((entry) => entry.id === "starter-story-stories-pushup-quest");
  assert.ok(created.note.includes("未验证"));
  assert.ok(created.note.includes(SOURCE));
  assert.equal(await page.getByRole("list", { name: "想法", exact: true }).getByRole("textbox", { name: "名称", exact: true }).inputValue(), created.name);
  await page.reload();
  await page.getByRole("list", { name: "想法", exact: true }).getByRole("textbox", { name: "名称", exact: true }).waitFor();

  // Capture remains independent, including drafts while switching views.
  const capture = page.locator('section[aria-labelledby="product-capture-title"]');
  const captureInput = capture.locator("input:not([type=file])");
  await captureInput.fill("保留 capture 草稿");
  await showMap();
  await nav.getByRole("button", { name: /我的想法/ }).click();
  assert.equal(await captureInput.inputValue(), "保留 capture 草稿");
  await page.screenshot({ path: `${screenshots}/ideas-light.png` });

  // Responsive + dark theme, including with the assistant reducing available width.
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const viewName of ["机会研究", "产品全景图", "我的想法"]) {
      await nav.getByRole("button", { name: new RegExp(viewName) }).click();
      const overflow = await page.locator("main").evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      assert.equal(overflow, false, `${viewName} overflows at ${width}px`);
    }
    await showMap();
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.documentElement.classList.add("dark"); });
    await page.screenshot({ path: `${screenshots}/map-dark-${width}.png`, animations: "disabled" });
    if (width === 375) {
      await pick("收费与合规").click();
      await page.waitForFunction(() => {
        const top = document.getElementById("product-map-question").getBoundingClientRect().top;
        return top >= 0 && top < window.innerHeight;
      });
      await detail.getByRole("link", { name: "↑ 返回全景图" }).click();
      await nav.getByRole("button", { name: /机会研究/ }).click();
      await firstListing.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${screenshots}/directory-mobile.png`, animations: "disabled" });
      await hypotheses().click();
      await page.screenshot({ path: `${screenshots}/hypothesis-mobile.png`, animations: "disabled" });
    }
  }
  // A failed refresh must be visible without fabricated empty data.
  failRead = true;
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "读取失败" }).waitFor();
  const beforeEnglishBrowse = writes;
  await page.evaluate(() => localStorage.setItem("pi-locale", "en"));
  await page.reload();
  await page.getByRole("heading", { name: "Find your opening in existing apps." }).waitFor();
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await research.getByRole("heading", { name: "iOS App directory" }).waitFor();
    const overflowing = await page.locator("#product-view-discover").evaluate((root) => Array.from(root.querySelectorAll("button, summary, article")).some((el) => el.scrollWidth > el.clientWidth + 1));
    assert.equal(overflowing, false, `English content fits at ${width}px`);
  }
  await page.locator("main").evaluate((el) => { el.scrollTop = 0; });
  await page.screenshot({ path: `${screenshots}/discover-en.png`, animations: "disabled" });
  assert.equal(writes, beforeEnglishBrowse, "Changing language and reading never writes ideas");
  assert.deepEqual(errors, []);
  console.log(`Product workspace passed; screenshots: ${screenshots}`);
} catch (error) {
  if (page) {
    await page.screenshot({ path: `${screenshots}/failure.png` }).catch(() => {});
    console.error((await page.locator("body").innerText()).slice(-12000));
  }
  throw error;
} finally { await browser.close(); }
