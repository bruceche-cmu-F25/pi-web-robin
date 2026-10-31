// Browser + real domain in a temporary directory; all Robin APIs are intercepted.
// No personal records, live model turns, vendor calls, or emails.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { initializeValidation, readValidationBoard, readValidationProject, executeValidationCommand, discussValidation, exportValidation } from "../extension/robin/validation-domain.ts";
import { emptyValidationCriteria } from "../extension/robin/validation-shape.ts";

const previous = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), "validation-browser-"));
process.env.ROBIN_DATA_DIR = dir;
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const output = "/tmp/market-validation-e2e";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
const candidate = (id, name) => ({ id, name, situation: "A recent repeated task", problem: "Unvalidated task cost", alternatives: "Manual work; cost unknown", signals: "Performs the task", exclusions: "Does not perform the task", unknowns: "Frequency, cost, counterexamples" });
const proposal = { candidates: [candidate("one", "Small-company operators"), candidate("two", "Independent consumers")], offer: "One task prototype — unvalidated", criteria: Object.fromEntries(Object.keys(emptyValidationCriteria()).map(key => [key, `Proposed ${key}, for user review`])) };
let writes = 0;
let failRead = false;
let failSave = false;
let holdDiscussion = false;
let releaseDiscussion;
let modelCalls = 0;
let sourceHidden = false;
const errors = [];
let page;
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  if (process.env.PI_WEB_PASSWORD) {
    const login = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(login.ok(), `Login failed: ${login.status()}`);
  }
  await context.addInitScript(() => { if (!localStorage.getItem("pi-locale")) localStorage.setItem("pi-locale", "zh-CN"); if (!localStorage.getItem("pi-theme")) localStorage.setItem("pi-theme", "light"); });
  page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", dialog => dialog.accept());
  await page.route("**/api/robin/**", async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    try {
      if (path === "/api/robin/validation" || path === "/api/robin/validation/discuss") {
        if (req.method() === "GET") {
          if (failRead) return route.fulfill({ status: 503, json: { error: "Synthetic read failure" } });
          const id = url.searchParams.get("id");
          return route.fulfill({ json: url.searchParams.has("export") ? exportValidation() : id ? { project: readValidationProject(id) } : readValidationBoard() });
        }
        writes++;
        const body = req.postDataJSON();
        if (failSave) { failSave = false; return route.fulfill({ status: 503, json: { error: "Synthetic write failure" } }); }
        if (body.action === "initialize") return route.fulfill({ json: initializeValidation() });
        if (path.endsWith("/discuss")) {
          const project = await discussValidation(body, async () => {
            modelCalls++;
            if (holdDiscussion) await new Promise(resolve => { releaseDiscussion = resolve; });
            return { reply: JSON.stringify({ reply: "What happened the last time someone faced this problem?", plan: proposal }), usedTools: [] };
          });
          return route.fulfill({ json: { project } });
        }
        return route.fulfill({ json: { project: executeValidationCommand(body) } });
      }
      if (path === "/api/robin/products") return route.fulfill({ json: { ideas: sourceHidden ? [] : [{ id: "example", name: "Food-photo app", note: "Synthetic brief for testing only", links: [], step: "spot" }], captures: [] } });
      if (req.method() !== "GET") throw new Error(`Unexpected write outside validation: ${path}`);
      return route.fulfill({ json: { resources: [], contacts: [], review: null, jobs: [], records: [], events: [], rounds: [], finals: {} } });
    } catch (error) {
      await route.fulfill({ status: error.status ?? 500, json: { error: error.message } }).catch(() => {});
    }
  });
  await page.goto("/product/validation?idea=example");
  await page.getByRole("heading", { name: "市场验证", exact: true }).waitFor();
  await page.getByRole("button", { name: "创建空白验证工作区", exact: true }).waitFor();
  assert.equal(writes, 0, "Page load initialized storage");
  await page.getByRole("button", { name: "创建空白验证工作区", exact: true }).click();
  await page.getByLabel("产品名称", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("从已有想法开始（可选）").inputValue(), "example");
  assert.equal(await page.getByLabel("产品名称", { exact: true }).inputValue(), "Food-photo app");
  assert.equal(await page.getByLabel("你想做什么？哪些问题还不确定？", { exact: true }).inputValue(), "Synthetic brief for testing only");
  assert.equal(writes, 1, "Deep link only pre-fills a draft; initialize is still explicit");
  assert.equal(modelCalls, 0);
  assert.equal(readValidationBoard().projects.length, 0);
  await page.getByLabel("产品名称", { exact: true }).fill("Unsaved source draft");
  sourceHidden = true;
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/robin/products"),
    page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))),
  ]);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByLabel("产品名称", { exact: true }).inputValue(), "Unsaved source draft", "Source disappearance must not unmount the draft");
  sourceHidden = false;
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.has("idea"), false);
  await page.goto("/product/validation?idea=missing");
  await page.getByRole("alert").filter({ hasText: "无法读取工作区" }).waitFor();
  assert.equal(writes, 1, "Missing source does not initialize or create a replacement");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "开始验证", exact: true }).click();
  await page.getByLabel("从已有想法开始（可选）").selectOption("example");
  assert.equal(await page.getByLabel("产品名称", { exact: true }).inputValue(), "Food-photo app");
  await page.getByRole("button", { name: "创建工作区", exact: true }).click();
  await page.getByRole("heading", { name: "Food-photo app", exact: true }).waitFor();
  const id = new URL(page.url()).searchParams.get("project");
  assert.ok(id);
  assert.equal(readValidationProject(id).ideaId, "example");

  await page.getByRole("button", { name: "提出候选人群", exact: true }).click();
  await page.getByText("What happened the last time someone faced this problem?", { exact: true }).waitFor();
  assert.equal(modelCalls, 1);
  assert.equal(readValidationProject(id).status, "draft");
  assert.equal(readValidationProject(id).plans[0].selectedCandidateId, null);
  await page.getByRole("button", { name: "编辑草案", exact: true }).click();
  await page.getByRole("radio").first().check();
  await page.getByLabel("为什么做这次修订？", { exact: true }).fill("Chosen ICP after comparison");
  failSave = true;
  await page.getByRole("button", { name: "保存为新的草案版本", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Synthetic write failure" }).waitFor();
  assert.equal(await page.getByLabel("为什么做这次修订？", { exact: true }).inputValue(), "Chosen ICP after comparison");
  await page.getByRole("button", { name: "保存为新的草案版本", exact: true }).click();
  await page.getByRole("button", { name: "编辑草案", exact: true }).waitFor();
  assert.equal(readValidationProject(id).plans.length, 2);
  await page.getByLabel("为什么这份标准适合本轮验证？", { exact: true }).fill("These criteria could change my decision");
  failRead = true;
  await page.getByRole("button", { name: "批准这份标准", exact: true }).click();
  await page.getByText("标准已批准", { exact: true }).waitFor();
  assert.equal(readValidationProject(id).status, "approved");
  failRead = false;

  await page.locator("summary").filter({ hasText: /^保存观察$/ }).click();
  await page.getByLabel("来源网址或文档／访谈标识", { exact: true }).fill("Synthetic interview notes");
  await page.getByLabel("原文片段或实际观察", { exact: true }).fill("I only needed this once last month.");
  await page.getByLabel("你的解释（可选）", { exact: true }).fill("Counterexample to repeated demand");
  await page.getByLabel("观察日期", { exact: true }).fill("2026-10-20");
  await page.getByLabel("与假设的关系", { exact: true }).selectOption("challenges");
  await page.getByRole("button", { name: "保存观察", exact: true }).click();
  await page.getByText("I only needed this once last month.", { exact: true }).first().waitFor();
  await page.getByRole("checkbox", { name: "将这条观察作为判断依据" }).check();
  await page.locator("summary").filter({ hasText: /^你的结论$/ }).click();
  await page.getByLabel("结果", { exact: true }).selectOption("fail");
  await page.getByLabel("学到了什么？下一步如何决定？", { exact: true }).fill("Change the frequency hypothesis; do not move to B.");
  await page.getByRole("button", { name: "记录结论", exact: true }).click();
  await page.getByText("已记录结论", { exact: true }).waitFor();
  assert.equal(readValidationProject(id).decisions[0].outcome, "fail");
  assert.equal(readValidationProject(id).stage, "A");

  // Revise explicitly, then stop a model run; late output cannot overwrite the draft.
  await page.getByRole("button", { name: "建立修订草案", exact: true }).click();
  await page.getByLabel("为什么做这次修订？", { exact: true }).fill("Try a different hypothesis");
  await page.getByRole("button", { name: "保存为新的草案版本", exact: true }).click();
  await page.getByRole("button", { name: "编辑草案", exact: true }).waitFor();
  const count = readValidationProject(id).plans.length;
  holdDiscussion = true;
  await page.getByLabel("你的回答或问题", { exact: true }).fill("Refine the alternatives");
  await page.getByRole("button", { name: "与 AI 讨论", exact: true }).click();
  await page.getByRole("button", { name: "停止讨论", exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector("main")?.textContent?.includes("正在准备提案"));
  // Wait until the server-side claim exists before testing cross-tab stop semantics.
  for (let i = 0; i < 100 && !releaseDiscussion; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(releaseDiscussion);
  await page.getByRole("button", { name: "停止讨论", exact: true }).click();
  await page.getByText("讨论已停止", { exact: true }).waitFor();
  releaseDiscussion();
  assert.equal(readValidationProject(id).plans.length, count);

  // A stale edit remains visible, not overwritten by the refresh after the 409.
  await page.getByRole("button", { name: "编辑草案", exact: true }).click();
  await page.getByLabel("为什么做这次修订？", { exact: true }).fill("Keep my draft");
  const current = readValidationProject(id);
  executeValidationCommand({ action: "savePlan", operationId: crypto.randomUUID(), projectId: id, expectedRevision: current.revision, plan: { ...proposal, selectedCandidateId: "two" }, reason: "Other tab changed the plan" });
  await page.getByRole("button", { name: "保存为新的草案版本", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "project changed" }).waitFor();
  assert.equal(await page.getByLabel("为什么做这次修订？", { exact: true }).inputValue(), "Keep my draft");
  await page.getByRole("button", { name: "放弃未保存修改", exact: true }).click();

  // Changing the current plan must not remount and erase an unsaved observation.
  const evidenceSummary = page.locator("summary").filter({ hasText: /^保存观察$/ });
  if (!await evidenceSummary.evaluate(element => element.parentElement.open)) await evidenceSummary.click();
  await page.getByLabel("来源网址或文档／访谈标识", { exact: true }).fill("Unsaved source");
  await page.getByLabel("原文片段或实际观察", { exact: true }).fill("Keep this observation on conflict");
  await page.getByLabel("观察日期", { exact: true }).fill("2026-10-20");
  const beforeEvidenceConflict = readValidationProject(id);
  executeValidationCommand({ action: "savePlan", operationId: crypto.randomUUID(), projectId: id, expectedRevision: beforeEvidenceConflict.revision, plan: { ...proposal, selectedCandidateId: "two" }, reason: "Another tab revised during evidence entry" });
  await page.getByRole("button", { name: "保存观察", exact: true }).click();
  await page.getByText("已有新版本。你的未保存草案已保留，请刷新并比较后再保存。", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("原文片段或实际观察", { exact: true }).inputValue(), "Keep this observation on conflict");
  assert.equal(readValidationProject(id).evidence.length, 1);
  await page.getByRole("button", { name: "放弃未保存修改", exact: true }).click();
  await page.getByRole("button", { name: "刷新", exact: true }).click();

  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    for (const width of [320, 375, 812, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator("main").evaluate(element => element.scrollTo(0, 0));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${theme}/${width} overflow`);
      await page.screenshot({ path: `${output}/${theme}-${width}.png`, fullPage: true });
    }
  }
  await page.evaluate(() => localStorage.setItem("pi-locale", "en"));
  await page.reload();
  await page.getByRole("heading", { name: "Market validation", exact: true }).waitFor();
  assert.equal(modelCalls, 2, "Reload triggered a model turn");
  assert.equal(readValidationProject(id).plans.length, count + 2);
  assert.deepEqual(errors, []);
  console.log(`PASS: framing, approval, counterevidence, decision, cancellation, stale edits, receipts, mobile and themes. Screenshots: ${output}`);
} catch (error) {
  if (page) {
    await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
    writeFileSync(`${output}/failure.txt`, await page.locator("main").innerText().catch(() => "No main"));
  }
  throw error;
} finally {
  releaseDiscussion?.();
  if (page) await page.close().catch(() => {});
  await browser.close();
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
  rmSync(dir, { recursive: true, force: true });
}
