// Fixture-only. Real mind-map domain writes go to a disposable directory; AI is mocked.
// No personal APIs, models or source notes are written by this check.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { createMindmap, deleteMindmap, listMindmaps, mindmapExplanationHash, mutateMindmap, readMindmap, readMindmapExplanation } from "../extension/robin/mindmap-domain.ts";
import { flattenMindTree, parseMindmapProposal } from "../extension/robin/mindmap.ts";
const previousDir = process.env.ROBIN_DATA_DIR, dataDir = mkdtempSync(join(tmpdir(), "mindmap-browser-"));
process.env.ROBIN_DATA_DIR = dataDir;
const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
mkdirSync("/tmp/notes-views", { recursive: true });
let page;
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 960 }, reducedMotion: "reduce", serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => { localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-theme", "glass"); });
  const draft = { id: "map-fixture", title: "想法工作台", text: "# 核心思路\n- 自然语言交互\n- 独立使用\n# 核心优势\n- 节省时间\n  - 减少重复工作\n# 主要功能与应用\n- 动态图表\n  - 提供数据生成效果\n  - 导出图片\n- 思维导图\n# 特色功能\n- 分享与协作\n- 本地保存", notionParentId: "", updatedAt: new Date().toISOString() };
  let board = { id: "11111111-1111-4111-8111-111111111111", title: "Canvas fixture", revision: 0, createdAt: draft.updatedAt, updatedAt: draft.updatedAt, scene: { elements: [], files: {}, appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 } } } };
  let failCanvas = false, patchFailure = "", releaseAI, delayed = false, malformed = false, capturedRequest, aiCalls = 0;
  let bulkOperations = [], resourceRequests = 0;
  const explanationReply = "# 分支说明\n\n## 概述\n\n这是该节点及全部子分支的文本总结，包括折叠内容。\n\n| 主题 | 作用 |\n| --- | --- |\n| 子分支 | 为主干补充解释 |\n\n```python\nprint('" + "long code ".repeat(30) + "')\n```\n\n" + Array.from({ length: 24 }, (_, i) => `### 要点 ${i + 1}\n\n这是用于检查连续阅读的完整说明段落，包含分支之间的关系、解释边界与需要进一步确认的信息。`).join("\n\n") + "\n\n最后一段说明。\n\n[安全链接](https://resource.invalid/guide) ![禁用图片](https://resource.invalid/tracker.png) <script>alert(1)</script>";
  const sourceReply = "来源：[Guide](https://resource.invalid/guide_(one))，官网 https://resource.invalid/home。\n\n[不可执行](javascript:alert(1)) [不可跳转内部路径](/api/robin/mindmaps) ![不加载图片](https://resource.invalid/tracker.png)";
  await context.route("**/api/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    try {
      if (path === "/api/robin/mindmaps") {
        const body = request.method() === "GET" ? null : request.postDataJSON();
        if (request.method() === "GET") return route.fulfill({ json: url.searchParams.has("explanation") ? readMindmapExplanation(url.searchParams.get("id"), url.searchParams.get("explanation")) : url.searchParams.has("id") ? { map: readMindmap(url.searchParams.get("id")) } : { maps: listMindmaps() } });
        if (request.method() === "POST") return route.fulfill({ json: { map: createMindmap(body.id, body.root) } });
        if (request.method() === "DELETE") { deleteMindmap(body.id, body.revision); return route.fulfill({ json: { deleted: true } }); }
        if (patchFailure === "before") return route.fulfill({ status: 503, json: { error: "Fixture save unavailable" } });
        const map = mutateMindmap(body);
        if (patchFailure === "after") { patchFailure = ""; return route.abort("failed"); }
        return route.fulfill({ json: { map } });
      }
      if (path === "/api/robin/mindmaps/agent") {
        aiCalls++; const input = request.postDataJSON(); capturedRequest = input;
        const current = readMindmap(input.id);
        assert.equal(input.revision, current.revision); assert.equal(input.provider, "fixture"); assert.equal(input.modelId, "fixture-model");
        if (delayed) await new Promise((resolve) => { releaseAI = resolve; });
        const response = input.message.includes("资源超链接测试") ? { reply: sourceReply, operations: input.mode === "discuss" ? [] : [
          { kind: "add", parent: "root", node: { id: "buddy-source", label: "Reference", url: "https://resource.invalid/reference", children: [] } },
          { kind: "add", parent: "root", node: { id: "buddy-markdown", label: "[Guide](https://resource.invalid/guide_(one))", children: [] } },
          { kind: "add", parent: "root", node: { id: "buddy-plain", label: "Source https://resource.invalid/plain。", children: [] } },
        ] }
          : input.mode === "explain" ? { reply: explanationReply, operations: [] }
          : input.mode === "discuss" ? { reply: "这是一个结构化思考的例子，没有修改导图。", operations: [] }
          : input.message === "批量细化测试" ? { reply: "补充细节，保留已有主干。", operations: bulkOperations }
          : input.message.includes("布局") ? { reply: "保留全部内容，将开发与测试放在左侧并整理布局。", operations: [{ kind: "arrange", id: "phase-build", side: "left" }] }
          : input.message.includes("过期") ? { reply: "过期修改，不应该应用。", operations: [{ kind: "rename", id: "ai-step", label: "过期 AI 内容" }] }
          : { reply: "建议在选中分支下加入一个步骤。", operations: [{ kind: "add", parent: input.selectedIds[0] || "root", node: { id: "ai-step", label: "可以执行的步骤", children: [] } }] };
        const proposal = parseMindmapProposal(malformed ? '{"reply":' : JSON.stringify(response), current.root, input.mode !== "edit", input.mode === "explain" ? 12000 : 6000);
        return route.fulfill({ json: { proposal, revision: input.revision, ...(input.mode === "explain" ? { sourceHash: mindmapExplanationHash(current.root, input.selectedIds[0]) } : {}) } }).catch(() => {});
      }
      if (path === "/api/robin/notes") { assert.equal(request.method(), "GET", "map edits must never mutate the original note"); return route.fulfill({ json: { drafts: [draft] } }); }
      if (path === "/api/robin/canvases") {
        if (request.method() === "PATCH") {
          if (failCanvas) return route.fulfill({ status: 503, json: { error: "Fixture canvas offline" } });
          board = { ...board, ...request.postDataJSON(), revision: board.revision + 1 }; return route.fulfill({ json: { canvas: board } });
        }
        assert.equal(request.method(), "GET"); return route.fulfill({ json: url.searchParams.has("id") ? { canvas: board } : { canvases: [board] } });
      }
      if (path === "/api/robin/canvases/library") return route.fulfill({ json: { revision: 0, libraryItems: [] } });
      if (path === "/api/models") return route.fulfill({ json: { modelList: [{ provider: "fixture", id: "fixture-model", name: "Fixture model" }], defaultModel: { provider: "fixture", modelId: "fixture-model" } } });
      assert.equal(request.method(), "GET", `Unexpected write: ${path}`);
      return route.fulfill({ json: { today: "2026-10-27", vaults: [], archives: [], drafts: [], attachments: [], finals: {}, models: [], records: [], connected: false, review: null, events: [], jobs: [], rounds: [], todos: [], links: [] } });
    } catch (error) { return route.fulfill({ status: error.status || 500, json: { error: error.message } }).catch(() => {}); }
  });
  await context.route("https://resource.invalid/**", (route) => { resourceRequests++; return route.fulfill({ contentType: "text/html", body: "<title>Resource fixture</title><p>Local test resource</p>" }); });
  page = await context.newPage(); const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/notes?draft=map-fixture&session=keep-context");
  const nav = page.locator(".robin-workspace-tabs");
  await page.locator("main textarea").waitFor();
  await page.waitForFunction(() => document.querySelector("main textarea")?.value.startsWith("# 核心思路"));
  assert.equal(await page.locator("main textarea").inputValue(), draft.text);
  await nav.getByRole("button", { name: "思维导图", exact: true }).click();
  await page.getByRole("heading", { name: "从一个想法开始，一起展开。" }).waitFor();
  assert.equal(listMindmaps().length, 0, "opening the view never creates a document");
  await page.locator("summary[aria-label='更多操作']").click();
  await page.getByRole("button", { name: "从 Notes 复制", exact: true }).click();
  await page.locator("summary[aria-label='更多操作']").click();
  const map = page.getByRole("region", { name: "思维导图", exact: true });
  await map.waitFor();
  const id = listMindmaps()[0].id;
  assert.equal(new URL(page.url()).searchParams.get("mindmap"), id);
  assert.equal(new URL(page.url()).searchParams.get("session"), "keep-context");
  const chat = page.getByRole("complementary", { name: "导图助手", exact: true });
  const input = chat.getByRole("textbox", { name: "发给导图助手的消息" });
  const send = chat.getByRole("button", { name: "发送", exact: true });
  const label = map.getByRole("textbox", { name: "选中节点的文字" });
  const saveLabel = map.getByRole("button", { name: "保存文字", exact: true });
  const choose = async (name) => map.getByRole("button", { name, exact: true }).click();
  const editLabel = async (value) => { await map.getByRole("button", { name: "编辑文字", exact: true }).click(); await label.fill(value); };
  const sendText = async (value) => { await input.fill(value); await send.click(); };
  // The assistant floats over a full-width canvas, never becomes a grid column.
  const canvasBox = await map.boundingBox(), buddyBox = await chat.boundingBox();
  assert.ok(buddyBox.x > canvasBox.x + canvasBox.width / 2);
  assert.ok(buddyBox.x + buddyBox.width < canvasBox.x + canvasBox.width);
  assert.ok(await chat.evaluate((el) => parseFloat(getComputedStyle(el).borderRadius) >= 24));
  await page.screenshot({ path: "/tmp/notes-views/canvas-buddy.png" });
  assert.equal(await chat.locator('[aria-label="助手作用范围"]').evaluate(el => el.open), false, "scope controls start collapsed");
  assert.ok((await chat.locator('[aria-live="polite"]').boundingBox()).height > 300, "chat reserves room for replies");
  const modesBox = await chat.getByRole("group", { name: "下一条消息的模式" }).boundingBox();
  assert.ok(Math.abs(modesBox.y - (await send.boundingBox()).y) < 10, "send and mode controls share a compact row");
  await input.fill("保留在浮窗里的草稿");
  await chat.getByRole("button", { name: "收起 Agent Buddy" }).click();
  assert.equal((await map.boundingBox()).width, canvasBox.width);
  await page.getByRole("button", { name: "导图助手", exact: true }).click();
  assert.equal(await input.inputValue(), "保留在浮窗里的草稿");
  await input.fill("");
  const initialTree = readMindmap(id).root;
  const scopePanel = chat.locator('[aria-label="助手作用范围"]');
  const expandScope = async () => { if (!(await scopePanel.evaluate(el => el.open))) await scopePanel.locator("summary").click(); };
  assert.ok((await scopePanel.textContent()).includes(`共 ${flattenMindTree(initialTree).length} 个节点`));
  await expandScope(); await chat.getByRole("button", { name: "更换节点", exact: true }).click();
  assert.equal(await chat.isVisible(), false);
  await page.waitForFunction(() => document.activeElement?.id === "mindmap-node-locator");
  await page.getByRole("button", { name: "导图助手", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.id === "mindmap-buddy");
  const quickPrompts = chat.locator('summary[aria-label="快捷提问"]');
  await quickPrompts.click();
  await chat.getByRole("button", { name: "还有什么被我忽略了？", exact: true }).click();
  assert.equal(await input.inputValue(), "还有什么被我忽略了？");
  assert.equal(aiCalls, 0, "quick prompts prepare input, never auto-send");
  await quickPrompts.click();
  assert.equal(await chat.getByRole("button", { name: "让 Buddy 整理", exact: true }).isDisabled(), true, "quick prompts cannot replace an unsent draft");
  await quickPrompts.press("Escape"); assert.equal(await chat.isVisible(), true, "Escape closes the disclosure before Buddy");
  await input.fill(""); await chat.getByRole("button", { name: "修改导图", exact: true }).click();
  // Opening an editor must not silently lock the floating selection toolbar.
  await choose("核心思路"); await editLabel("工具栏保存测试");
  const locator = map.getByRole("combobox", { name: "选择节点", exact: true });
  assert.equal(await locator.isEnabled(), true, "node locator remains usable while editing");
  await locator.selectOption("root");
  await label.waitFor({ state: "hidden" });
  assert.equal(readMindmap(id).root.children[0].label, "工具栏保存测试");
  assert.equal(await map.locator('[data-topic="root"]').getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await map.getByRole("button", { name: "核心思路", exact: true }).waitFor();
  assert.deepEqual(readMindmap(id).root, initialTree);
  const toolbar = locator.locator("..");
  const beforeToolbar = readMindmap(id).revision;
  await choose("核心思路"); await editLabel("核心思路");
  await map.getByRole("button", { name: "全选", exact: true }).click();
  await label.waitFor({ state: "hidden" });
  assert.equal(readMindmap(id).revision, beforeToolbar, "unchanged drafts need no write");
  assert.equal(await map.locator('[data-topic][aria-pressed="true"]').count(), flattenMindTree(initialTree).length);
  await locator.selectOption("line-0");
  await map.getByRole("button", { name: "添加子节点", exact: true }).last().click();
  await label.fill("全选包含新节点");
  await map.getByRole("button", { name: "全选", exact: true }).click();
  await label.waitFor({ state: "hidden" });
  assert.equal(await map.getByRole("button", { name: "全选包含新节点", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await map.getByRole("button", { name: "全选包含新节点", exact: true }).waitFor({ state: "hidden" });
  await locator.selectOption("line-0"); await editLabel("保存失败保留选区");
  patchFailure = "before"; await locator.selectOption("root");
  await page.getByRole("alert").filter({ hasText: "Fixture save unavailable" }).waitFor();
  assert.equal(await label.inputValue(), "保存失败保留选区");
  assert.equal(await locator.inputValue(), "line-0");
  patchFailure = ""; await page.getByRole("alert").getByRole("button", { name: "重试", exact: true }).click();
  await label.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await map.getByRole("button", { name: "核心思路", exact: true }).waitFor();
  await editLabel("切层级前保存");
  await map.getByRole("combobox", { name: "展开层级", exact: true }).selectOption("1");
  await label.waitFor({ state: "hidden" });
  assert.equal(readMindmap(id).root.children[0].label, "切层级前保存");
  assert.equal(await map.getByRole("combobox", { name: "展开层级", exact: true }).inputValue(), "1");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await map.getByRole("button", { name: "核心思路", exact: true }).waitFor();
  await map.getByRole("combobox", { name: "展开层级", exact: true }).selectOption("all");
  await editLabel("整理与文字一起保存");
  const beforeTidy = readMindmap(id).revision;
  await map.getByRole("button", { name: "一键整理", exact: true }).click();
  await label.waitFor({ state: "hidden" });
  assert.equal(readMindmap(id).revision, beforeTidy + 1, "text and arrangement are one atomic edit");
  assert.equal(readMindmap(id).root.children[0].label, "整理与文字一起保存");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await map.getByRole("button", { name: "核心思路", exact: true }).waitFor();
  assert.deepEqual(readMindmap(id).root, initialTree);
  await editLabel("   ");
  await map.getByRole("button", { name: "全选", exact: true }).click();
  assert.equal(await label.evaluate((el) => el.validity.valid), false);
  await toolbar.getByRole("button", { name: "取消编辑", exact: true }).click();
  await label.waitFor({ state: "hidden" });
  // Resource links are separate native anchors, not nested buttons or drag handles.
  await choose("核心思路");
  await map.getByRole("button", { name: "添加或编辑资源链接", exact: true }).click();
  const resourceInput = map.getByRole("textbox", { name: "资源链接（选填）", exact: true });
  assert.equal(await resourceInput.evaluate((el) => el === document.activeElement), true);
  const beforeLink = readMindmap(id).revision;
  await resourceInput.fill("javascript:alert(1)"); await resourceInput.press("Enter");
  await map.getByRole("alert").filter({ hasText: "请填写 http 或 https" }).waitFor();
  assert.equal(readMindmap(id).revision, beforeLink);
  await locator.selectOption("root");
  assert.equal(await locator.inputValue(), "line-0", "invalid links block selection without losing the draft");
  assert.equal(await resourceInput.inputValue(), "javascript:alert(1)");
  const resourceUrl = "https://resource.invalid/guide#intro";
  await resourceInput.fill(resourceUrl);
  patchFailure = "before"; await saveLabel.click();
  await page.getByRole("alert").filter({ hasText: "Fixture save unavailable" }).waitFor();
  assert.equal(await resourceInput.inputValue(), resourceUrl);
  patchFailure = ""; await page.getByRole("alert").getByRole("button", { name: "重试", exact: true }).click();
  const resourceLink = map.getByRole("link", { name: `打开「核心思路」的资源：${resourceUrl}（新标签页）`, exact: true });
  await resourceLink.waitFor();
  assert.equal(await resourceLink.getAttribute("href"), resourceUrl);
  assert.equal(readMindmap(id).root.children[0].url, resourceUrl);
  await page.reload(); await resourceLink.waitFor();
  const revisionBeforeOpen = readMindmap(id).revision, mapUrlBeforeOpen = page.url();
  for (const activate of [() => resourceLink.click(), () => resourceLink.press("Enter")]) {
    const opened = page.waitForEvent("popup"); await activate();
    const popup = await opened; await popup.waitForLoadState("domcontentloaded");
    assert.equal(popup.url(), resourceUrl); assert.equal(await popup.evaluate(() => window.opener === null), true);
    await popup.close(); assert.equal(page.url(), mapUrlBeforeOpen);
  }
  assert.equal(readMindmap(id).revision, revisionBeforeOpen, "opening links never changes the map");
  await choose("核心思路");
  const linkedTopic = map.getByRole("button", { name: "核心思路", exact: true });
  const linkedBox = await linkedTopic.boundingBox(), anchorBefore = await resourceLink.boundingBox();
  const pagesBeforeDrag = context.pages().length;
  await page.mouse.move(linkedBox.x + linkedBox.width / 2, linkedBox.y + linkedBox.height / 2); await page.mouse.down();
  await page.mouse.move(linkedBox.x + linkedBox.width / 2 + 26, linkedBox.y + linkedBox.height / 2 - 44, { steps: 5 });
  assert.ok(Math.abs((await resourceLink.boundingBox()).x - anchorBefore.x - 26) < 1, "the link follows its dragged topic");
  await page.keyboard.press("Escape"); await page.mouse.up();
  assert.equal(context.pages().length, pagesBeforeDrag, "dragging a linked topic never opens its URL");
  await page.screenshot({ path: "/tmp/notes-views/resource-link.png" });
  await map.getByRole("button", { name: "添加或编辑资源链接", exact: true }).click();
  await resourceInput.fill("https://resource.invalid/unsaved"); await resourceInput.press("Escape");
  assert.equal(readMindmap(id).root.children[0].url, resourceUrl);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await resourceLink.waitFor({ state: "hidden" });
  assert.deepEqual(readMindmap(id).root, initialTree);
  await page.getByRole("button", { name: "重做", exact: true }).click(); await resourceLink.waitFor();
  await choose("核心思路"); await map.getByRole("button", { name: "添加或编辑资源链接", exact: true }).click();
  await resourceInput.fill(""); await saveLabel.click(); await resourceLink.waitFor({ state: "hidden" });
  assert.deepEqual(readMindmap(id).root, initialTree, "removing a link preserves topic text and descendants");
  await choose("核心思路");
  const beforeChild = readMindmap(id).revision;
  await map.getByRole("button", { name: "核心思路", exact: true }).press("Tab");
  await label.fill("键盘添加的子节点");
  assert.equal(readMindmap(id).revision, beforeChild, "a draft node must not be saved before commit");
  await label.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true });
  assert.equal(readMindmap(id).revision, beforeChild, "IME confirmation must not submit");
  await label.press("Enter");
  await map.getByRole("button", { name: "键盘添加的子节点", exact: true }).waitFor();
  await map.getByRole("button", { name: "键盘添加的子节点", exact: true }).press("Enter");
  await label.fill("键盘添加的同级"); await label.press("Enter");
  await map.getByRole("button", { name: "键盘添加的同级", exact: true }).waitFor();
  const siblings = readMindmap(id).root.children[0].children;
  assert.deepEqual(siblings.slice(-2).map((n) => n.label), ["键盘添加的子节点", "键盘添加的同级"]);
  await map.getByRole("button", { name: "键盘添加的同级", exact: true }).press("Tab");
  await label.fill("取消不应该留下节点"); await label.press("Escape");
  assert.equal(readMindmap(id).revision, beforeChild + 2);
  patchFailure = "before";
  await map.getByRole("button", { name: "键盘添加的同级", exact: true }).press("Tab");
  await label.fill("新节点失败重试"); await label.press("Enter");
  await page.getByRole("alert").filter({ hasText: "Fixture save unavailable" }).waitFor();
  assert.equal(await label.inputValue(), "新节点失败重试");
  assert.equal(readMindmap(id).revision, beforeChild + 2);
  patchFailure = "";
  await page.getByRole("alert").getByRole("button", { name: "重试", exact: true }).click();
  await map.getByRole("button", { name: "新节点失败重试", exact: true }).waitFor();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await map.getByRole("button", { name: "新节点失败重试", exact: true }).waitFor({ state: "hidden" });
  await map.getByRole("button", { name: "键盘添加的同级", exact: true }).dblclick();
  assert.equal(await label.inputValue(), "键盘添加的同级");
  await label.press("Escape");
  await map.getByRole("button", { name: "键盘添加的同级", exact: true }).press("Control+z");
  await map.getByRole("button", { name: "键盘添加的同级", exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await map.getByRole("button", { name: "键盘添加的子节点", exact: true }).waitFor({ state: "hidden" });
  assert.deepEqual(readMindmap(id).root, initialTree);
  // Free pan is not bounded by a scroll container; pointer zoom remains anchored.
  const viewport = map.locator("div[tabindex='0'][aria-label]").first();
  const stage = map.locator("div[style*='translate(']").first();
  const transform = () => stage.evaluate((el) => { const m = new DOMMatrix(getComputedStyle(el).transform); return { x: m.e, y: m.f, zoom: m.a }; });
  const vb = await viewport.boundingBox();
  const point = { x: vb.x + 80, y: vb.y + 140 };
  const beforePan = await transform();
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 70, point.y + 45, { steps: 5 }); await page.mouse.up();
  const afterPan = await transform(); assert.ok(afterPan.x - beforePan.x > 65 && afterPan.y - beforePan.y > 40);
  const anchor = { x: 200, y: 180 };
  await page.mouse.move(vb.x + anchor.x, vb.y + anchor.y); await page.keyboard.down("Control"); await page.mouse.wheel(0, -30); await page.keyboard.up("Control");
  await page.waitForTimeout(100);
  const afterZoom = await transform(); assert.ok(afterZoom.zoom > afterPan.zoom);
  assert.ok(Math.abs((anchor.x - afterZoom.x) / afterZoom.zoom - (anchor.x - afterPan.x) / afterPan.zoom) < 1);
  await map.getByRole("button", { name: "适应画布", exact: true }).click();
  // MindNode-style pointer dragging: actual branch/edges follow at the current zoom.
  const branch = map.getByRole("button", { name: "核心思路", exact: true });
  const leaf = map.getByRole("button", { name: "自然语言交互", exact: true });
  const worldPosition = (topic) => topic.evaluate((el) => ({ x: parseFloat(el.parentElement.style.left), y: parseFloat(el.parentElement.style.top) }));
  const beginBranchDrag = async (topic, dx, dy) => {
    const box = await topic.boundingBox(), start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
  };
  const beforeDragRevision = readMindmap(id).revision;
  const branchBefore = await branch.boundingBox(), leafBefore = await leaf.boundingBox();
  const dragCamera = await transform(), oldPath = await stage.locator("svg > path").first().getAttribute("d");
  await beginBranchDrag(branch, 35, -95);
  const branchDuring = await branch.boundingBox(), leafDuring = await leaf.boundingBox();
  assert.ok(Math.abs(branchDuring.x - branchBefore.x - 35) < 1);
  assert.ok(Math.abs(branchDuring.y - branchBefore.y + 95) < 1);
  assert.ok(Math.abs(leafDuring.x - leafBefore.x - 35) < 1 && Math.abs(leafDuring.y - leafBefore.y + 95) < 1);
  assert.notEqual(await stage.locator("svg > path").first().getAttribute("d"), oldPath, "edges follow the live branch");
  assert.deepEqual(await transform(), dragCamera, "dragging must not move the camera");
  await page.mouse.up();
  assert.equal(readMindmap(id).revision, beforeDragRevision, "positioning is view-only");
  assert.deepEqual(await transform(), dragCamera, "release must not trigger click-to-zoom");
  const moved = await worldPosition(branch);
  const layoutKey = `pi-mindmap-layout:${id}`;
  assert.ok(JSON.parse(await page.evaluate((key) => localStorage.getItem(key), layoutKey))["line-0"]);
  await page.reload(); await branch.waitFor();
  assert.deepEqual(await worldPosition(branch), moved, "browser-local positions survive reload");
  await map.getByRole("button", { name: "适应画布", exact: true }).click();
  await beginBranchDrag(branch, 25, 55);
  await page.keyboard.press("Escape"); await page.mouse.up();
  assert.deepEqual(await worldPosition(branch), moved, "Escape rolls the drag back");
  await beginBranchDrag(branch, 25, 55);
  await branch.dispatchEvent("pointercancel", { pointerId: 1 }); await page.mouse.up();
  assert.deepEqual(await worldPosition(branch), moved, "pointer cancellation rolls back");
  await branch.press("Alt+ArrowRight");
  assert.equal((await worldPosition(branch)).x, moved.x + 16, "keyboard alternative moves the same branch");
  await map.getByRole("button", { name: "还原布局", exact: true }).click();
  await map.getByRole("button", { name: "适应画布", exact: true }).click();
  const destination = map.getByRole("button", { name: "特色功能", exact: true });
  const from = await branch.boundingBox(), to = await destination.boundingBox(), beforeReparent = await worldPosition(branch);
  patchFailure = "before";
  await beginBranchDrag(branch, to.x + to.width / 2 - from.x - from.width / 2, to.y + to.height / 2 - from.y - from.height / 2);
  assert.equal(await destination.getAttribute("data-drop"), "true", "valid parent has a visible drop target");
  const reparented = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/robin/mindmaps" && response.request().method() === "PATCH");
  await page.mouse.up(); await reparented;
  await page.getByRole("alert").filter({ hasText: "Fixture save unavailable" }).waitFor();
  assert.deepEqual(readMindmap(id).root, initialTree);
  assert.deepEqual(await worldPosition(branch), beforeReparent, "failed reparent discards the drag preview");
  patchFailure = "";
  const retriedMove = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/robin/mindmaps" && response.request().method() === "PATCH");
  await page.getByRole("alert").getByRole("button", { name: "重试", exact: true }).click(); await retriedMove;
  assert.ok(readMindmap(id).root.children.find((n) => n.label === "特色功能").children.some((n) => n.label === "核心思路"));
  const reverted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/robin/mindmaps" && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await reverted; assert.deepEqual(readMindmap(id).root, initialTree);
  await map.getByRole("button", { name: "适应画布", exact: true }).click();
  // Chromium touch input follows the same pointer path, with no native HTML drag ghost.
  const touchBefore = await worldPosition(branch), touchBox = await branch.boundingBox();
  const touch = await context.newCDPSession(page);
  const tx = touchBox.x + touchBox.width / 2, ty = touchBox.y + touchBox.height / 2;
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tx, y: ty, id: 0 }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: tx + 20, y: ty - 60, id: 0 }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert.ok((await worldPosition(branch)).y < touchBefore.y - 40);
  await touch.detach();
  await map.getByRole("button", { name: "还原布局", exact: true }).click();
  // Crossing the root flips both SVG attachment points and the node's outward controls live.
  const leftBranch = map.getByRole("button", { name: "核心优势", exact: true });
  await leftBranch.click();
  await map.getByRole("button", { name: "适应画布", exact: true }).click();
  const rootTopic = map.getByRole("button", { name: "想法工作台", exact: true });
  const rootBox = await rootTopic.boundingBox();
  const crossingRevision = readMindmap(id).revision;
  const assertCrossing = async (side) => {
    const geometry = await leftBranch.evaluate((el) => {
      const wrap = el.parentElement, plane = wrap.parentElement;
      const topics = [...plane.querySelectorAll("[data-map-node]")];
      const root = topics.find((node) => node.dataset.mapNode === "root");
      const path = plane.querySelectorAll("svg > path")[topics.indexOf(wrap) - 1];
      return { side: Number(wrap.dataset.side), x: parseFloat(wrap.style.left), width: parseFloat(wrap.style.width),
        rootX: parseFloat(root.style.left), rootWidth: parseFloat(root.style.width),
        coordinates: path.getAttribute("d").replace(/[MC,]/g, " ").trim().split(/\s+/).map(Number) };
    });
    assert.equal(geometry.side, side);
    assert.ok(Math.abs(geometry.coordinates[0] - geometry.rootX - (side > 0 ? geometry.rootWidth : 0)) < 0.001);
    assert.ok(Math.abs(geometry.coordinates[6] - geometry.x - (side > 0 ? 0 : geometry.width)) < 0.001);
    const plus = await map.locator('[data-map-node="line-3"]').getByRole("button", { name: "添加子节点", exact: true }).boundingBox();
    const topic = await leftBranch.boundingBox();
    assert.equal(Math.sign(plus.x + plus.width / 2 - topic.x - topic.width / 2), side);
  };
  for (const side of [1, -1]) {
    const box = await leftBranch.boundingBox();
    const x = side > 0 ? rootBox.x + rootBox.width + 95 : rootBox.x - 95;
    const y = rootBox.y + rootBox.height / 2 + 170;
    await beginBranchDrag(leftBranch, x - box.x - box.width / 2, y - box.y - box.height / 2);
    await assertCrossing(side);
    if (side === 1) await page.screenshot({ path: "/tmp/notes-views/branch-crossed-right.png" });
    await page.mouse.up(); await assertCrossing(side);
    assert.equal(readMindmap(id).revision, crossingRevision, "crossing changes neither content nor parentage");
  }
  await map.getByRole("button", { name: "还原布局", exact: true }).click();
  await map.getByRole("button", { name: "适应画布", exact: true }).click();
  await map.getByRole("button", { name: "折叠或展开：核心思路", exact: true }).click();
  assert.equal(await map.getByRole("button", { name: "自然语言交互", exact: true }).count(), 0);
  await map.getByRole("button", { name: "折叠或展开：核心思路", exact: true }).press("Enter");
  await choose("核心思路"); await sendText("把这个分支展开成一个可执行步骤");
  await map.getByRole("button", { name: "可以执行的步骤", exact: true }).waitFor();
  assert.deepEqual(capturedRequest.selectedIds, ["line-0"]);
  assert.equal(readMindmap(id).root.children[0].children.at(-1).id, "ai-step");
  assert.equal(readMindmap(id).messages.length, 2);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await map.getByRole("button", { name: "可以执行的步骤", exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await choose("可以执行的步骤"); await editLabel("人工修改"); await saveLabel.click();
  await map.getByRole("button", { name: "人工修改", exact: true }).waitFor();
  delayed = true; await sendText("过期建议测试");
  while (!releaseAI) await new Promise((resolve) => setTimeout(resolve, 20));
  await editLabel("人工修改 v2"); await saveLabel.click();
  await map.getByRole("button", { name: "人工修改 v2", exact: true }).waitFor();
  releaseAI(); delayed = false; releaseAI = undefined;
  await page.getByRole("alert").filter({ hasText: "AI 思考期间你修改了导图" }).waitFor();
  assert.equal(readMindmap(id).root.children[0].children.at(-1).label, "人工修改 v2");
  assert.equal(await input.inputValue(), "过期建议测试");
  // Discuss mode is enforced by the proposal parser and leaves tree content alone.
  const treeBefore = readMindmap(id).root;
  await chat.getByRole("button", { name: "只讨论", exact: true }).click();
  delayed = true; await sendText("解释一下这张图");
  while (!releaseAI) await new Promise((resolve) => setTimeout(resolve, 20));
  await chat.getByText("本次处理：人工修改 v2", { exact: true }).waitFor();
  assert.equal(await chat.getByRole("button", { name: "修改导图", exact: true }).isDisabled(), true);
  await locator.selectOption("root");
  await chat.getByText("本次处理：人工修改 v2", { exact: true }).waitFor();
  await scopePanel.locator('summary[title="想法工作台"]').waitFor();
  await chat.getByRole("button", { name: "收起 Agent Buddy" }).click();
  const buddyToggle = page.getByRole("button", { name: "导图助手", exact: true });
  assert.ok((await buddyToggle.textContent()).includes("思考中"));
  releaseAI(); delayed = false; releaseAI = undefined;
  await buddyToggle.getByText("有新回复", { exact: true }).waitFor();
  await buddyToggle.click();
  await chat.getByText("这是一个结构化思考的例子，没有修改导图。", { exact: true }).waitFor();
  assert.equal(await chat.locator('[data-pending="true"]').count(), 0);
  assert.deepEqual(readMindmap(id).root, treeBefore);
  // One-click explanations now open a wide, persistent document instead of a small chat reply.
  await locator.selectOption("line-0");
  await map.getByRole("button", { name: "折叠或展开：核心思路", exact: true }).click();
  await input.fill("别覆盖我尚未发送的消息");
  await chat.getByRole("button", { name: "修改导图", exact: true }).click();
  await chat.getByRole("button", { name: "收起 Agent Buddy" }).click();
  const summaryRevision = readMindmap(id).revision, summaryMessages = readMindmap(id).messages;
  const reader = page.getByRole("dialog", { name: "节点说明", exact: true });
  delayed = true; await map.getByRole("button", { name: "解释此分支", exact: true }).click();
  while (!releaseAI) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(await chat.isVisible(), false);
  assert.ok((await reader.boundingBox()).width > 1000, "document is wider than Buddy");
  assert.equal(await reader.getByRole("button", { name: "返回导图", exact: true }).evaluate((el) => document.activeElement === el), true);
  assert.equal(capturedRequest.mode, "explain"); assert.deepEqual(capturedRequest.selectedIds, ["line-0"]);
  await reader.getByText("正在撰写说明…新版保存成功前，旧说明仍会保留。", { exact: true }).waitFor();
  releaseAI(); delayed = false; releaseAI = undefined;
  await reader.getByText("已保存到此导图 · 下次打开仍可阅读", { exact: true }).waitFor();
  await reader.getByRole("heading", { name: "分支说明", exact: true }).waitFor();
  assert.equal(await reader.getByRole("table").count(), 1);
  assert.equal(await reader.locator("img, script").count(), 0);
  assert.deepEqual(readMindmap(id).root, treeBefore);
  assert.deepEqual(readMindmap(id).messages, summaryMessages, "saved explanation is independent of chat history");
  assert.equal(readMindmap(id).revision, summaryRevision + 1);
  const downloaded = page.waitForEvent("download");
  await reader.getByRole("button", { name: "下载文本 · Markdown", exact: true }).click();
  const download = await downloaded, stream = await download.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString("utf8"), readMindmapExplanation(id, "line-0").explanation.markdown);
  await page.screenshot({ path: "/tmp/notes-views/branch-summary.png" });
  // Failure, an uncertain successful save, and exact retry all retain a readable document.
  const savedVersion = readMindmapExplanation(id, "line-0").explanation;
  delayed = true; await reader.getByRole("button", { name: "重新生成说明", exact: true }).click();
  while (!releaseAI) await new Promise((resolve) => setTimeout(resolve, 20));
  await reader.getByRole("heading", { name: "分支说明", exact: true }).waitFor();
  await reader.getByRole("button", { name: "停止", exact: true }).click();
  releaseAI(); delayed = false; releaseAI = undefined;
  await reader.getByRole("alert").filter({ hasText: "已停止生成" }).waitFor();
  assert.deepEqual(readMindmapExplanation(id, "line-0").explanation, savedVersion);
  patchFailure = "before"; await reader.getByRole("button", { name: "重新生成说明", exact: true }).click();
  await reader.getByRole("alert").filter({ hasText: "Fixture save unavailable" }).waitFor();
  assert.deepEqual(readMindmapExplanation(id, "line-0").explanation, savedVersion);
  page.once("dialog", (dialog) => dialog.dismiss()); await reader.getByRole("button", { name: "返回导图", exact: true }).click();
  assert.equal(await reader.isVisible(), true, "closing an unsaved preview requires confirmation");
  const callsBeforeRetry = aiCalls;
  patchFailure = "after"; await reader.getByRole("button", { name: "重试保存", exact: true }).click();
  await reader.getByRole("alert").waitFor();
  const committedRevision = readMindmap(id).revision;
  await reader.getByRole("button", { name: "重试保存", exact: true }).click();
  await reader.getByText("已保存到此导图 · 下次打开仍可阅读", { exact: true }).waitFor();
  assert.equal(readMindmap(id).revision, committedRevision); assert.equal(aiCalls, callsBeforeRetry);
  // Adjacent content changes are detected when reopening, without replacing the saved text.
  await reader.getByRole("button", { name: "返回导图", exact: true }).click();
  await map.getByRole("button", { name: "查看说明", exact: true }).waitFor();
  const oldExplanation = readMindmapExplanation(id, "line-0").explanation.markdown;
  const change = readMindmap(id);
  mutateMindmap({ id, revision: change.revision, requestId: randomUUID(), action: "edit", operations: [{ kind: "add", parent: "line-0", node: { id: "reader-added", label: "说明更新测试", children: [] } }] });
  await map.getByRole("button", { name: "查看说明", exact: true }).click();
  await reader.getByText(/此分支或直接相邻的父级／同级信息已变化/).waitFor();
  assert.equal(readMindmapExplanation(id, "line-0").explanation.markdown, oldExplanation);
  assert.equal(aiCalls, callsBeforeRetry, "opening stale saved text never automatically regenerates");
  delayed = true; await reader.getByRole("button", { name: "重新生成说明", exact: true }).click();
  while (!releaseAI) await new Promise((resolve) => setTimeout(resolve, 20));
  const concurrent = readMindmap(id), previousExplanation = readMindmapExplanation(id, "line-0").explanation;
  mutateMindmap({ id, revision: concurrent.revision, requestId: randomUUID(), action: "edit", operations: [], conversation: { user: "Other tab", reply: "Concurrent conversation" } });
  releaseAI(); delayed = false; releaseAI = undefined;
  await reader.getByRole("alert").filter({ hasText: "changed since the request began" }).waitFor();
  assert.deepEqual(readMindmapExplanation(id, "line-0").explanation, previousExplanation, "late generation cannot overwrite a newer map revision");
  assert.equal(await reader.getByRole("button", { name: "重新生成说明", exact: true }).isDisabled(), true);
  page.once("dialog", (dialog) => dialog.accept()); await reader.getByRole("button", { name: "检查更新", exact: true }).click();
  await reader.getByText(/此分支或直接相邻的父级／同级信息已变化/).waitFor();
  await reader.getByRole("button", { name: "重新生成说明", exact: true }).click();
  await reader.getByText("已保存到此导图 · 下次打开仍可阅读", { exact: true }).waitFor();
  await reader.getByRole("button", { name: "返回导图", exact: true }).click();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.waitForTimeout(100);
  assert.deepEqual(readMindmap(id).root, treeBefore, "content undo skips explanation saves");
  await page.reload(); await map.waitFor();
  const afterReloadCalls = aiCalls;
  await page.getByRole("button", { name: "节点说明", exact: true }).click();
  await reader.getByRole("heading", { name: "分支说明", exact: true }).waitFor();
  assert.equal(aiCalls, afterReloadCalls, "saved documents reopen after reload without a model call");
  // Readable typography, safe overflow and reachable close across desktop, phone and landscape.
  for (const theme of ["glass", "glass-dark"]) {
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    for (const size of [{ width: 1440, height: 960 }, { width: 375, height: 800 }, { width: 320, height: 700 }, { width: 812, height: 375 }]) {
      await page.setViewportSize(size);
      const geometry = await reader.evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth, height: el.getBoundingClientRect().height }));
      assert.ok(geometry.scroll <= geometry.width + 1 && geometry.height <= size.height);
      assert.ok(await reader.locator("article p").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 17));
      assert.ok(await reader.getByRole("heading", { name: "概述", exact: true }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 22));
      await reader.locator("section").evaluate((el) => { el.scrollTop = 0; });
      assert.equal(await reader.locator("header").count(), 1);
      // Allow the native top-layer resize to paint before visual capture (no delayed UI assertions).
      await page.waitForTimeout(150);
      await page.screenshot({ path: `/tmp/notes-views/reader-top-${theme}-${size.width}.png` });
      await reader.getByText("最后一段说明。", { exact: true }).scrollIntoViewIfNeeded();
      const close = await reader.getByRole("button", { name: "返回导图", exact: true }).boundingBox();
      assert.ok(close.height >= 44 && close.y >= 0 && close.y + close.height <= size.height);
      await page.screenshot({ path: `/tmp/notes-views/reader-${theme}-${size.width}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await reader.getByRole("button", { name: "返回导图", exact: true }).press("Escape");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "节点说明");
  assert.equal(await input.inputValue(), "别覆盖我尚未发送的消息");
  assert.equal(await chat.getByRole("button", { name: "修改导图", exact: true }).getAttribute("aria-pressed"), "true");
  await locator.selectOption("root");
  await map.getByRole("button", { name: "解释此分支", exact: true }).click();
  await reader.getByText("已保存到此导图 · 下次打开仍可阅读", { exact: true }).waitFor();
  assert.equal(readMindmap(id).explanations.length, 2, "each node owns its own saved document");
  const callsBeforeSwitch = aiCalls;
  await reader.getByRole("navigation", { name: "已保存的说明", exact: true }).getByRole("button", { name: /^核心思路/ }).click();
  await reader.locator("section strong").filter({ hasText: "核心思路" }).waitFor();
  await reader.getByRole("heading", { name: "分支说明", exact: true }).waitFor();
  assert.equal(aiCalls, callsBeforeSwitch, "switching saved documents does not generate");
  await reader.getByRole("button", { name: "返回导图", exact: true }).click();
  assert.equal(await locator.inputValue(), "root", "reader navigation does not change the canvas selection");
  await locator.selectOption("ai-step");
  malformed = true; await sendText("无效结果");
  await page.getByRole("alert").filter({ hasText: "complete mind map proposal" }).waitFor();
  malformed = false; assert.deepEqual(readMindmap(id).root, treeBefore);
  const beforeStop = readMindmap(id).revision;
  delayed = true; await sendText("取消这个请求");
  while (!releaseAI) await new Promise((resolve) => setTimeout(resolve, 20));
  await chat.getByRole("button", { name: "停止", exact: true }).click();
  releaseAI(); delayed = false; releaseAI = undefined;
  await page.getByRole("status").filter({ hasText: "已停止，不再应用" }).waitFor();
  await page.waitForTimeout(100); assert.equal(readMindmap(id).revision, beforeStop);
  assert.equal(await input.inputValue(), "取消这个请求");
  // A failed write keeps local input; retry safely handles even a lost successful response.
  patchFailure = "before"; await editLabel("失败时保留"); await saveLabel.click();
  await page.getByRole("alert").filter({ hasText: "Fixture save unavailable" }).waitFor();
  assert.equal(await label.inputValue(), "失败时保留");
  patchFailure = ""; await page.getByRole("alert").getByRole("button", { name: "重试", exact: true }).click();
  await map.getByRole("button", { name: "失败时保留", exact: true }).waitFor();
  patchFailure = "after"; await editLabel("回执丢失但已保存"); await saveLabel.click();
  await page.getByRole("alert").getByRole("button", { name: "重试", exact: true }).waitFor();
  const uncertainRevision = readMindmap(id).revision;
  await page.getByRole("alert").getByRole("button", { name: "重试", exact: true }).click();
  await map.getByRole("button", { name: "回执丢失但已保存", exact: true }).waitFor();
  assert.equal(readMindmap(id).revision, uncertainRevision, "a retry must not apply twice");
  // Another client can win during inference; PATCH must preserve it.
  await chat.getByRole("button", { name: "修改导图", exact: true }).click();
  delayed = true; await sendText("过期跨标签建议");
  while (!releaseAI) await new Promise((resolve) => setTimeout(resolve, 20));
  const other = readMindmap(id);
  mutateMindmap({ id, revision: other.revision, requestId: randomUUID(), action: "edit", operations: [{ kind: "rename", id: "ai-step", label: "另一个标签页的编辑" }] });
  releaseAI(); delayed = false; releaseAI = undefined;
  await page.getByRole("alert").filter({ hasText: "changed since the request began" }).waitFor();
  assert.equal(readMindmap(id).root.children[0].children.at(-1).label, "另一个标签页的编辑");
  await page.getByRole("button", { name: "重新加载已保存版本", exact: true }).click();
  await map.getByRole("button", { name: "另一个标签页的编辑", exact: true }).waitFor();
  // Natural-language draft and manual edits survive hiding the whole tab.
  await input.fill("下次继续讨论"); await choose("核心思路"); await editLabel("尚未提交的节点文字");
  await nav.getByRole("button", { name: "Notes", exact: true }).click();
  assert.equal(await page.locator("main textarea").inputValue(), draft.text);
  await nav.getByRole("button", { name: "思维导图", exact: true }).click();
  assert.equal(await label.inputValue(), "尚未提交的节点文字"); assert.equal(await input.inputValue(), "下次继续讨论");
  await map.getByRole("button", { name: "取消编辑", exact: true }).click();
  // Keyboard and non-drag reparenting preserve children.
  await choose("另一个标签页的编辑"); await map.locator("summary[aria-label='更多操作']").click(); await map.getByRole("combobox", { name: "移动到…" }).selectOption("root");
  await map.getByRole("button", { name: "移动", exact: true }).click();
  await page.waitForTimeout(200); assert.equal(readMindmap(id).root.children.at(-1).id, "ai-step");
  // Refresh restores independent content/history and the browser-local chat draft.
  await page.reload(); await map.waitFor(); await map.getByRole("button", { name: "另一个标签页的编辑", exact: true }).waitFor();
  assert.equal(await input.inputValue(), "下次继续讨论");
  assert.equal(await page.getByRole("button", { name: "撤销", exact: true }).isEnabled(), true);
  // A second map and Back/Forward restore document identity, not just tab styling.
  await page.getByRole("button", { name: "新建导图", exact: true }).click();
  await page.getByRole("textbox", { name: "中心主题是什么？" }).fill("第二张导图");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await map.getByRole("button", { name: "第二张导图", exact: true }).waitFor();
  const secondId = new URL(page.url()).searchParams.get("mindmap"); assert.notEqual(secondId, id);
  await page.goBack(); await map.getByRole("button", { name: "想法工作台", exact: true }).waitFor();
  await page.goForward(); await map.getByRole("button", { name: "第二张导图", exact: true }).waitFor();
  await page.getByRole("combobox", { name: "思维导图库" }).selectOption(id);
  await map.getByRole("button", { name: "想法工作台", exact: true }).waitFor();
  // Hide only Next's development badge; it overlaps Fit on small viewports.
  await page.locator("#devtools-indicator").evaluateAll((nodes) => nodes.forEach((node) => node.style.setProperty("display", "none", "important")));
  for (const theme of ["glass", "glass-dark", "light"]) {
    await page.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), theme);
    await map.locator('[data-topic]:not([data-depth="0"]):not([data-depth="1"])').first().waitFor();
    const nodeBorders = await map.locator('[data-topic]:not([data-depth="0"]):not([data-depth="1"])').evaluateAll((nodes) => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      const luminance = (color) => {
        ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
        const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map((n) => { const c = n / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      return nodes.map((node) => {
        const style = getComputedStyle(node), border = luminance(style.borderTopColor), background = luminance(style.backgroundColor);
        return { label: node.getAttribute("aria-label"), sides: ["Top", "Right", "Bottom", "Left"].map((side) => ({ width: parseFloat(style[`border${side}Width`]), style: style[`border${side}Style`], color: style[`border${side}Color`] })),
          contrast: (Math.max(border, background) + 0.05) / (Math.min(border, background) + 0.05), radius: parseFloat(style.borderTopLeftRadius) };
      });
    });
    assert.ok(nodeBorders.length > 0);
    for (const node of nodeBorders) {
      assert.ok(node.sides.every((side) => side.width >= 2 && side.style === "solid" && side.color === node.sides[0].color), `${theme}/${node.label}: complete border`);
      assert.ok(node.radius >= 12 && node.contrast >= 3, `${theme}/${node.label}: visible rounded border (${node.contrast})`);
    }
    for (const width of [1440, 960, 375, 320, 812]) {
      if (width === 1440 && !await chat.isVisible()) await page.getByRole("button", { name: "导图助手", exact: true }).click();
      await page.setViewportSize({ width, height: width === 812 ? 500 : 960 });
      if (width < 960 && await chat.isVisible()) await chat.getByRole("button", { name: "收起 Agent Buddy" }).click();
      await map.getByRole("button", { name: "适应画布", exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${theme}/${width} overflow`);
      const box = await nav.boundingBox(); assert.ok(box.x > 0 && box.width < width);
      if (width < 760) for (const button of await nav.getByRole("button").all()) assert.ok((await button.boundingBox()).height >= 44);
      await page.screenshot({ path: `/tmp/notes-views/${theme}-${width}.png` });
      if (width < 960) {
        const savedChatDraft = await page.locator("#mindmap-instruction").inputValue();
        await page.getByRole("button", { name: "导图助手", exact: true }).click();
        await page.waitForFunction(() => document.activeElement?.id === "mindmap-buddy");
        const panel = await chat.boundingBox();
        assert.ok(panel.x >= 0 && panel.x + panel.width <= width, "Buddy stays inside the phone viewport");
        if (width <= 375) {
          assert.ok((await chat.locator('[aria-live="polite"]').boundingBox()).height >= 120, "scope and composer leave room to read");
          await expandScope();
          assert.ok((await chat.getByRole("button", { name: /^(解释选区|查看说明)$/ }).boundingBox()).height >= 44);
        } else {
          await send.scrollIntoViewIfNeeded();
          const minimize = await chat.getByRole("button", { name: "收起 Agent Buddy" }).boundingBox();
          assert.ok(minimize.y >= panel.y && minimize.y + minimize.height <= panel.y + panel.height, "short-screen minimize remains visible while scrolling");
        }
        await page.screenshot({ path: `/tmp/notes-views/buddy-${theme}-${width}.png` });
        await expandScope(); await chat.getByRole("button", { name: "更换节点", exact: true }).click();
        await page.waitForFunction(() => document.activeElement?.id === "mindmap-node-locator");
        assert.equal(await page.locator("#mindmap-instruction").inputValue(), savedChatDraft, "canvas/Buddy handoff preserves the chat draft");
      }
    }
  }
  // Phone selection and discussion stay usable without dragging tiny nodes.
  await page.setViewportSize({ width: 375, height: 960 });
  await map.getByRole("combobox", { name: "选择节点", exact: true }).selectOption("ai-step");
  await map.getByRole("button", { name: "编辑文字", exact: true }).click();
  assert.equal(await label.inputValue(), "另一个标签页的编辑");
  await map.getByRole("button", { name: "取消编辑", exact: true }).click();
  assert.equal(await map.getByRole("button", { name: "添加或编辑资源链接", exact: true }).locator("svg").isVisible(), true, "phone link action must not be a blank icon-only button");
  await map.getByRole("button", { name: "添加或编辑资源链接", exact: true }).click();
  await resourceInput.fill(resourceUrl);
  const mobileUrlBox = await resourceInput.boundingBox();
  assert.ok(mobileUrlBox.x >= 0 && mobileUrlBox.x + mobileUrlBox.width <= 375 && mobileUrlBox.y + mobileUrlBox.height < 960, "phone URL input stays on screen");
  await page.screenshot({ path: "/tmp/notes-views/resource-editor-mobile.png" });
  await saveLabel.click();
  await map.locator('[data-map-node="ai-step"] a').waitFor();
  assert.equal(readMindmap(id).root.children.find((node) => node.id === "ai-step").url, resourceUrl);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await map.locator('[data-map-node="ai-step"] a').waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "导图助手", exact: true }).click();
  await chat.getByRole("button", { name: "只讨论", exact: true }).click();
  const mobileRevision = readMindmap(id).revision;
  await sendText("在手机上解释这个节点");
  await page.waitForFunction(() => document.querySelector("#mindmap-instruction")?.value === "");
  assert.deepEqual(capturedRequest.selectedIds, ["ai-step"]); assert.equal(readMindmap(id).revision, mobileRevision + 1);
  await page.setViewportSize({ width: 1440, height: 960 });
  // Buddy replies and existing labels must link automatically, without filling the URL field.
  const legacyLabel = "[Legacy](https://resource.invalid/legacy_(one))，另见 https://resource.invalid/legacy-two。";
  const sourceMap = createMindmap(randomUUID(), { id: "root", label: "自动资源链接", children: [{ id: "legacy", label: legacyLabel, children: [] }, { id: "name-only", label: "Starter Story", children: [] }] });
  const requestsBeforeSources = resourceRequests;
  await page.goto(`/notes?view=mindmap&mindmap=${sourceMap.id}`);
  await map.locator('[data-map-node="legacy"] a').first().waitFor();
  assert.deepEqual(await map.locator('[data-map-node="legacy"] a').evaluateAll((links) => links.map((a) => a.href)), ["https://resource.invalid/legacy_(one)", "https://resource.invalid/legacy-two"]);
  assert.equal(await map.locator('[data-map-node="name-only"] a').count(), 0);
  assert.deepEqual(readMindmap(sourceMap.id), sourceMap, "automatic rendering never rewrites old maps");
  await sendText("资源超链接测试：把 source 都写出来并添加到导图");
  await map.locator('[data-map-node="buddy-source"] a').waitFor();
  await map.locator('[data-map-node="buddy-markdown"] a').waitFor();
  await map.locator('[data-map-node="buddy-plain"] a').waitFor();
  assert.equal(await map.locator('[data-map-node="buddy-markdown"] a').textContent(), "Guide↗");
  assert.equal(await map.locator('[data-map-node="buddy-plain"] a').getAttribute("href"), "https://resource.invalid/plain");
  const chatGuide = chat.getByRole("link", { name: /^Guide/ });
  await chatGuide.waitFor();
  assert.equal(await chatGuide.getAttribute("href"), "https://resource.invalid/guide_(one)");
  assert.equal(await chat.locator('a[href="https://resource.invalid/home"]').count(), 1, "Chinese punctuation stays outside bare reply URLs");
  assert.equal(await chat.locator('a[href^="javascript:"], a[href^="/"], img').count(), 0);
  assert.equal(resourceRequests, requestsBeforeSources, "rendering sources must not fetch images or visit sites");
  for (const target of [chatGuide, map.locator('[data-map-node="buddy-markdown"] a')]) {
    const opened = page.waitForEvent("popup"); await target.click(); const popup = await opened;
    await popup.waitForLoadState("domcontentloaded"); assert.equal(popup.url(), "https://resource.invalid/guide_(one)");
    assert.equal(await popup.evaluate(() => window.opener === null), true); await popup.close();
  }
  await page.screenshot({ path: "/tmp/notes-views/buddy-auto-links.png" });
  const sourceSnapshot = readMindmap(sourceMap.id);
  assert.equal(sourceSnapshot.root.children.find((n) => n.id === "legacy").label, legacyLabel);
  assert.equal(sourceSnapshot.root.children.find((n) => n.id === "buddy-source").url, "https://resource.invalid/reference");
  await page.reload(); await map.locator('[data-map-node="buddy-plain"] a').waitFor(); await chatGuide.waitFor();
  assert.deepEqual(readMindmap(sourceMap.id), sourceSnapshot, "reopening keeps both text and explicit source links");
  await chat.getByRole("button", { name: "只讨论", exact: true }).click();
  await sendText("资源超链接测试：只讨论 source");
  await page.waitForFunction(() => document.querySelector("#mindmap-instruction")?.value === "");
  assert.deepEqual(readMindmap(sourceMap.id).root, sourceSnapshot.root, "discussion hyperlinks do not edit the map");
  // Reproduce the real density (244 topics), using generated fixture content only.
  const denseBranch = (id, label, size) => {
    const groups = Array.from({ length: Math.min(7, size - 1) }, (_, i) => ({ id: `${id}-g${i}`, label: `${label} · 步骤 ${i + 1}`, children: [] }));
    for (let i = 0; i < size - 1 - groups.length; i++) groups[i % groups.length].children.push({ id: `${id}-n${i}`, label: `细节 ${i + 1}：验证输入、处理边界、检查结果并记录证据`, children: [] });
    return { id, label, children: groups };
  };
  const dense = createMindmap(randomUUID(), { id: "root", label: "产品从想法到发布", children: [denseBranch("phase-discovery", "发现与验证", 141), denseBranch("phase-plan", "产品规划", 5), denseBranch("phase-build", "开发与测试", 90), denseBranch("phase-release", "发布与上线", 3), denseBranch("phase-iterate", "运营与迭代", 4)] });
  // Generate the same dense tree from six topics, exercising the post-generation overview too.
  const skeleton = createMindmap(randomUUID(), { ...dense.root, children: dense.root.children.map((node) => ({ ...node, children: [] })) });
  bulkOperations = dense.root.children.flatMap((parent) => parent.children.map((node) => ({ kind: "add", parent: parent.id, node })));
  await page.goto(`/notes?view=mindmap&mindmap=${skeleton.id}`);
  await map.getByRole("button", { name: "产品从想法到发布", exact: true }).waitFor();
  await sendText("批量细化测试");
  await page.waitForFunction(() => document.querySelector("#mindmap-instruction")?.value === "");
  assert.deepEqual(readMindmap(skeleton.id).root, dense.root);
  assert.equal(await map.getByRole("combobox", { name: "展开层级" }).inputValue(), "2", "a large AI expansion switches to a two-level overview");
  assert.ok(await map.locator("[data-topic]").count() < 40);
  await page.goto(`/notes?view=mindmap&mindmap=${dense.id}`);
  await map.getByRole("button", { name: "产品从想法到发布", exact: true }).waitFor();
  assert.equal(flattenMindTree(readMindmap(dense.id).root).length, 244);
  assert.equal(await map.getByRole("combobox", { name: "展开层级" }).inputValue(), "2");
  assert.ok(await map.locator("[data-topic]").count() < 40, "large maps open as an outline, not 244 exposed boxes");
  await chat.getByRole("button", { name: "收起 Agent Buddy" }).click();
  await map.getByRole("button", { name: "适应画布", exact: true }).click();
  await map.getByRole("button", { name: "全选", exact: true }).click();
  await map.getByText("已选 244 个", { exact: true }).waitFor();
  assert.equal(await map.locator('[data-topic][aria-pressed="false"]').count(), 0);
  const build = map.getByRole("button", { name: "开发与测试", exact: true });
  const discovery = map.getByRole("button", { name: "发现与验证", exact: true });
  const firstPositions = [await worldPosition(build), await worldPosition(discovery)];
  await beginBranchDrag(build, 40, -45);
  const duringPositions = [await worldPosition(build), await worldPosition(discovery)];
  assert.ok(duringPositions[0].x > firstPositions[0].x);
  assert.ok(Math.abs((duringPositions[0].x - firstPositions[0].x) - (duringPositions[1].x - firstPositions[1].x)) < 0.001);
  await page.mouse.up();
  await map.getByText("已选 244 个", { exact: true }).waitFor();
  const denseKey = `pi-mindmap-layout:${dense.id}`;
  assert.deepEqual(Object.keys(JSON.parse(await page.evaluate((key) => localStorage.getItem(key), denseKey))), ["root"], "all selected descendants move once via root");
  assert.equal(readMindmap(dense.id).revision, 0);
  await viewport.press("Escape"); await viewport.press("Control+a");
  await map.getByText("已选 244 个", { exact: true }).waitFor();
  await page.getByRole("button", { name: "导图助手", exact: true }).click();
  await chat.getByText("引用 244 个选中节点", { exact: true }).waitFor();
  assert.ok(await chat.locator('[aria-label^="取消引用："]').count() <= 4, "references do not flood the Buddy window");
  await chat.getByRole("button", { name: "只讨论", exact: true }).click();
  await sendText("全选后讨论");
  await page.waitForFunction(() => document.querySelector("#mindmap-instruction")?.value === "");
  assert.deepEqual(capturedRequest.selectedIds, ["root"], "all-node scope is compressed without losing references");
  await expandScope(); await chat.getByRole("button", { name: "解释选区", exact: true }).click();
  await reader.getByRole("heading", { name: "分支说明", exact: true }).waitFor();
  await reader.getByText("已保存到此导图 · 下次打开仍可阅读", { exact: true }).waitFor();
  assert.deepEqual(capturedRequest.selectedIds, ["root"]);
  assert.equal(capturedRequest.mode, "explain");
  assert.deepEqual(readMindmap(dense.id).root, dense.root, "Buddy's scope action opens the same saved reader without changing content");
  await reader.getByRole("button", { name: "返回导图", exact: true }).click();
  // Native text selection still works; canvas Ctrl+A must not swallow typing shortcuts.
  await input.fill("只选择输入文字"); await input.press(process.platform === "darwin" ? "Meta+a" : "Control+a");
  assert.equal(await input.evaluate((el) => el.selectionEnd - el.selectionStart), "只选择输入文字".length);
  await chat.getByRole("button", { name: "修改导图", exact: true }).click();
  await sendText("整理布局，把开发与测试放左边");
  await page.waitForFunction(() => document.querySelector("#mindmap-instruction")?.value === "");
  assert.equal(readMindmap(dense.id).root.children[2].branchSide, "left");
  assert.equal(await build.evaluate((el) => el.parentElement.dataset.side), "-1");
  assert.equal(await discovery.evaluate((el) => el.parentElement.dataset.side), "1");
  assert.deepEqual(JSON.parse(await page.evaluate((key) => localStorage.getItem(key), denseKey)), {});
  const contentOnly = (root) => JSON.stringify(root, (key, value) => key === "branchSide" ? undefined : value);
  assert.equal(contentOnly(readMindmap(dense.id).root), contentOnly(dense.root), "layout agent preserves all details and IDs");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-map-node="phase-build"]')?.dataset.side === "1");
  assert.deepEqual(readMindmap(dense.id).root, dense.root);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-map-node="phase-build"]')?.dataset.side === "-1");
  await page.reload(); await build.waitFor();
  assert.equal(await build.evaluate((el) => el.parentElement.dataset.side), "-1", "branch side survives reload");
  // A late layout proposal must not reset newer local free-drag positions.
  await map.getByRole("combobox", { name: "选择节点", exact: true }).selectOption("phase-build");
  delayed = true; await sendText("整理布局，测试过期建议");
  while (!releaseAI) await new Promise((resolve) => setTimeout(resolve, 20));
  await build.press("Alt+ArrowRight");
  const manualOffsets = await page.evaluate((key) => localStorage.getItem(key), denseKey);
  releaseAI(); delayed = false; releaseAI = undefined;
  await page.getByRole("alert").filter({ hasText: "AI 思考期间你修改了导图" }).waitFor();
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), denseKey), manualOffsets);
  // A layout save failure preserves offsets. Its explicit retry resets them only after success.
  patchFailure = "before";
  await map.getByRole("button", { name: "一键整理", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Fixture save unavailable" }).waitFor();
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), denseKey), manualOffsets);
  patchFailure = ""; await page.getByRole("alert").getByRole("button", { name: "重试", exact: true }).click();
  await page.waitForFunction((key) => localStorage.getItem(key) === "{}", denseKey);
  await input.fill("");
  await quickPrompts.click();
  await chat.getByRole("button", { name: "让 Buddy 整理", exact: true }).click();
  assert.match(await input.inputValue(), /保留所有文字/);
  await input.fill("");
  // Distinct branch selection moves together, and can be cancelled without saving.
  await chat.getByRole("button", { name: "收起 Agent Buddy" }).click();
  await map.getByRole("combobox", { name: "展开层级" }).selectOption("1");
  assert.equal(await map.locator("[data-topic]").count(), 6);
  await map.getByRole("button", { name: "适应画布", exact: true }).click();
  await discovery.click(); await build.click({ modifiers: ["Shift"] });
  await map.getByText("已选 2 个", { exact: true }).waitFor();
  const twoBefore = [await worldPosition(build), await worldPosition(discovery)];
  await beginBranchDrag(build, 35, 45);
  const twoDuring = [await worldPosition(build), await worldPosition(discovery)];
  assert.ok(twoDuring[0].x > twoBefore[0].x);
  assert.ok(Math.abs((twoDuring[0].x - twoBefore[0].x) - (twoDuring[1].x - twoBefore[1].x)) < 0.001);
  await page.keyboard.press("Escape"); await page.mouse.up();
  assert.deepEqual([await worldPosition(build), await worldPosition(discovery)], twoBefore);
  await beginBranchDrag(build, -90, -120);
  assert.equal(await map.locator('[data-drop="true"]').count(), 0);
  await page.mouse.up();
  assert.deepEqual(Object.keys(JSON.parse(await page.evaluate((key) => localStorage.getItem(key), denseKey))).sort(), ["phase-build", "phase-discovery"]);
  await map.getByRole("button", { name: "还原布局", exact: true }).click();
  await map.getByRole("combobox", { name: "展开层级" }).selectOption("all");
  assert.equal(await map.locator("[data-topic]").count(), 244);
  await map.getByRole("combobox", { name: "展开层级" }).selectOption("2");
  await map.getByRole("button", { name: "取消选择", exact: true }).click();
  await page.getByRole("button", { name: "导图助手", exact: true }).click();
  for (const theme of ["glass", "glass-dark", "light"]) {
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    await page.screenshot({ path: `/tmp/notes-views/dense-${theme}.png` });
  }
  // Focus is a reading view over original IDs, with independent camera/folds/positions.
  const focusMap = createMindmap(randomUUID(), { id: "root", label: "聚焦回归导图", children: [denseBranch("focus-a", "聚焦目标", 12), denseBranch("focus-b", "无关分支", 3)] });
  await page.goto(`/notes?view=mindmap&mindmap=${focusMap.id}`);
  await map.locator('[data-topic="focus-a"]').waitFor();
  await map.getByRole("combobox", { name: "展开层级" }).selectOption("1");
  await map.getByRole("combobox", { name: "选择节点", exact: true }).selectOption("focus-a");
  await map.getByRole("button", { name: "缩小", exact: true }).click();
  const wholeCamera = await transform(), wholeCount = await map.locator("[data-topic]").count();
  await map.getByRole("button", { name: "聚焦此分支", exact: true }).click();
  const crumbs = map.getByRole("navigation", { name: "分支聚焦路径" });
  await crumbs.waitFor();
  assert.equal(await map.getAttribute("data-focus"), "focus-a");
  assert.equal(await map.locator("[data-topic]").count(), 12, "focus reveals all descendants even when the whole view is folded");
  assert.equal(await map.locator('[data-topic="focus-b"]').count(), 0);
  assert.equal(await map.getByRole("button", { name: "一键整理", exact: true }).count(), 0, "no misleading whole-map arrangement in branch view");
  await chat.getByText("当前上下文：聚焦分支", { exact: true }).waitFor();
  await chat.getByRole("button", { name: "只讨论", exact: true }).click();
  await sendText("解释当前聚焦分支");
  await page.waitForFunction(() => document.querySelector("#mindmap-instruction")?.value === "");
  assert.deepEqual(capturedRequest.selectedIds, ["focus-a"], "empty selection defaults to focused branch, not whole map");
  await viewport.press("Control+a");
  await map.getByText("已选 12 个", { exact: true }).waitFor();
  await viewport.press("Escape");
  await map.getByRole("combobox", { name: "选择节点", exact: true }).selectOption("focus-a-g0");
  const branchCamera = await transform();
  await map.getByRole("button", { name: "聚焦此分支", exact: true }).click();
  assert.equal(await map.locator("[data-topic]").count(), 2);
  await crumbs.getByRole("button", { name: "聚焦目标", exact: true }).click();
  assert.equal(await map.getAttribute("data-focus"), "focus-a");
  assert.deepEqual(await transform(), branchCamera, "ancestor breadcrumb restores camera");
  await crumbs.getByRole("button", { name: "返回整图", exact: true }).click();
  assert.deepEqual(await transform(), wholeCamera, "return restores the whole-map camera exactly");
  assert.equal(await map.locator("[data-topic]").count(), wholeCount);
  assert.equal(await map.getByRole("combobox", { name: "展开层级" }).inputValue(), "1");
  assert.deepEqual(readMindmap(focusMap.id).root, focusMap.root, "focus/navigation/discussion never replace content");
  await map.getByRole("button", { name: "聚焦此分支", exact: true }).click();
  await map.getByRole("combobox", { name: "选择节点", exact: true }).selectOption("focus-a");
  await map.locator('[data-topic="focus-a"]').press("Alt+ArrowRight");
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), `pi-mindmap-layout:${focusMap.id}`), null, "focus dragging cannot overwrite whole-map positions");
  await editLabel("");
  await crumbs.getByRole("button", { name: "返回整图", exact: true }).click();
  assert.equal(await label.count(), 1, "invalid draft blocks leaving focus");
  await label.fill("聚焦目标已编辑"); patchFailure = "before";
  await crumbs.getByRole("button", { name: "返回整图", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Fixture save unavailable" }).waitFor();
  assert.equal(await map.getAttribute("data-focus"), "focus-a");
  assert.equal(await label.inputValue(), "聚焦目标已编辑");
  patchFailure = ""; await page.getByRole("alert").getByRole("button", { name: "重试", exact: true }).click();
  await label.waitFor({ state: "hidden" });
  assert.equal(readMindmap(focusMap.id).root.children[0].label, "聚焦目标已编辑");
  assert.deepEqual(readMindmap(focusMap.id).root.children[1], focusMap.root.children[1]);
  await crumbs.getByRole("button", { name: "返回整图", exact: true }).click();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await map.locator('[data-topic="focus-a"]').filter({ hasText: "聚焦目标" }).waitFor();
  assert.deepEqual(readMindmap(focusMap.id).root, focusMap.root, "focus edit uses original document undo");
  await map.getByRole("button", { name: "聚焦此分支", exact: true }).click();
  await chat.getByRole("button", { name: "收起 Agent Buddy" }).click();
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 812 });
    await page.waitForTimeout(80);
    const focusedRootBox = await map.locator('[data-topic="focus-a"]').boundingBox();
    assert.ok(focusedRootBox.x >= 0 && focusedRootBox.x + focusedRootBox.width <= width, "resize keeps the focused root on screen");
    const backBox = await crumbs.getByRole("button", { name: "返回整图", exact: true }).boundingBox();
    assert.ok(backBox.x >= 0 && backBox.x + backBox.width <= width && backBox.height >= 44);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `/tmp/notes-views/focus-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ path: "/tmp/notes-views/focus-desktop.png" });
  // Removing the focused branch via an original-document undo must safely return to the whole map.
  await crumbs.getByRole("button", { name: "返回整图", exact: true }).click();
  await map.getByRole("combobox", { name: "选择节点", exact: true }).selectOption("root");
  await map.getByRole("button", { name: "添加子节点", exact: true }).last().click();
  await label.fill("临时聚焦分支"); await saveLabel.click();
  await map.getByRole("button", { name: "聚焦此分支", exact: true }).click();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await crumbs.waitFor({ state: "hidden" });
  assert.equal(await map.getAttribute("data-focus"), null);
  assert.deepEqual(readMindmap(focusMap.id).root, focusMap.root);
  // The raised hard limit: real 1,000-topic fixture, full rendering, drag, save and reopen.
  const thousand = createMindmap(randomUUID(), { id: "root", label: "千节点保存回归", children: Array.from({ length: 8 }, (_, i) => denseBranch(`thousand-${i}`, `阶段 ${i + 1}`, i === 7 ? 124 : 125)) });
  await page.goto(`/notes?view=mindmap&mindmap=${thousand.id}`);
  await map.getByRole("button", { name: "千节点保存回归", exact: true }).waitFor();
  await chat.getByRole("button", { name: "收起 Agent Buddy" }).click();
  await map.getByRole("combobox", { name: "展开层级" }).selectOption("all");
  assert.equal(await map.locator("[data-topic]").count(), 1000);
  await map.getByRole("button", { name: "适应画布", exact: true }).click();
  await map.getByRole("button", { name: "全选", exact: true }).click();
  await map.getByText("已选 1000 个", { exact: true }).waitFor();
  const thousandRoot = map.getByRole("button", { name: "千节点保存回归", exact: true });
  const thousandBefore = await worldPosition(thousandRoot);
  await beginBranchDrag(thousandRoot, 30, 25);
  assert.ok((await worldPosition(thousandRoot)).x > thousandBefore.x);
  await page.mouse.up();
  assert.equal(readMindmap(thousand.id).revision, 0, "dragging all 1,000 nodes is view-only");
  const lastId = flattenMindTree(thousand.root).at(-1).id;
  await map.getByRole("combobox", { name: "选择节点", exact: true }).selectOption(lastId);
  await editLabel("第1000个节点已保存"); await saveLabel.click();
  await map.getByRole("button", { name: "第1000个节点已保存", exact: true }).waitFor();
  assert.equal(flattenMindTree(readMindmap(thousand.id).root).length, 1000);
  await page.reload(); await thousandRoot.waitFor();
  await map.getByRole("combobox", { name: "展开层级" }).selectOption("all");
  assert.equal(await map.locator("[data-topic]").count(), 1000);
  assert.equal(await map.getByRole("button", { name: "第1000个节点已保存", exact: true }).count(), 1);
  assert.equal(flattenMindTree(readMindmap(thousand.id).root).at(-1).label, "第1000个节点已保存");
  await nav.getByRole("button", { name: "Canvas", exact: true }).click();
  await page.getByRole("button", { name: "Canvas fixture Canvas", exact: true }).click();
  const canvasTitle = page.getByRole("textbox", { name: "画布标题" }); await canvasTitle.waitFor();
  failCanvas = true; await canvasTitle.fill("Canvas unsaved");
  await nav.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Fixture canvas offline" }).waitFor();
  assert.equal(await nav.getByRole("button", { name: "Canvas", exact: true }).getAttribute("aria-pressed"), "true");
  failCanvas = false; await nav.getByRole("button", { name: "Notes", exact: true }).click();
  await page.locator("main textarea").waitFor(); assert.equal(board.title, "Canvas unsaved");
  await page.goto(`/notes?canvas=${board.id}`); await canvasTitle.waitFor();
  assert.equal(await nav.getByRole("button", { name: "Canvas", exact: true }).getAttribute("aria-pressed"), "true");
  for (const path of ["/dashboard/gmail", "/dashboard/events"]) {
    await page.goto(path); await nav.waitFor();
    for (const theme of ["glass", "glass-dark"]) {
      await page.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), theme);
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 960 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const boxes = await nav.locator("button, a").evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { top: r.top, height: r.height }; }));
        assert.ok(boxes.every((r) => r.top === boxes[0].top));
        if (width === 320) assert.ok(boxes.every((r) => r.height >= 44));
        await page.screenshot({ path: `/tmp/notes-views/${path.split("/").at(-1)}-${theme}-${width}.png` });
      }
    }
  }
  assert.ok(aiCalls >= 5); assert.deepEqual(errors, []);
  console.log("PASS: branch focus/breadcrumbs, camera/fold restoration, scoped Buddy and select-all, focused edit/retry/undo, deleted-focus fallback, mobile resize, live branch/edge dragging, touch, cancel, local layout restore, reparent retry, inline/IME/keyboard editing, pending-node retry, floating Buddy, pointer camera, independent maps, scoped AI, stale/manual/cross-tab protection, undo/redo, drafts/history, Canvas guard and responsive themes");
} catch (error) { await page?.screenshot({ path: "/tmp/notes-views/failure.png" }).catch(() => {}); throw error; }
finally { await browser.close(); if (previousDir === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previousDir; rmSync(dataDir, { recursive: true, force: true }); }
