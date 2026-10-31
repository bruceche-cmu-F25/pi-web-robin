// Fixture-only. Real mind-map domain writes go to a disposable directory; AI is mocked.
// No personal APIs, models or source notes are written by this check.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { createMindmap, deleteMindmap, listMindmaps, mutateMindmap, readMindmap } from "../extension/robin/mindmap-domain.ts";
import { parseMindmapProposal } from "../extension/robin/mindmap.ts";
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
  await context.route("**/api/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    try {
      if (path === "/api/robin/mindmaps") {
        const body = request.method() === "GET" ? null : request.postDataJSON();
        if (request.method() === "GET") return route.fulfill({ json: url.searchParams.has("id") ? { map: readMindmap(url.searchParams.get("id")) } : { maps: listMindmaps() } });
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
        const response = input.mode === "discuss" ? { reply: "这是一个结构化思考的例子，没有修改导图。", operations: [] }
          : input.message.includes("过期") ? { reply: "过期修改，不应该应用。", operations: [{ kind: "rename", id: "ai-step", label: "过期 AI 内容" }] }
          : { reply: "建议在选中分支下加入一个步骤。", operations: [{ kind: "add", parent: input.selectedIds[0] || "root", node: { id: "ai-step", label: "可以执行的步骤", children: [] } }] };
        const proposal = parseMindmapProposal(malformed ? '{"reply":' : JSON.stringify(response), current.root, input.mode === "discuss");
        return route.fulfill({ json: { proposal, revision: input.revision } }).catch(() => {});
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
  await page.getByRole("button", { name: "从 Notes 复制", exact: true }).click();
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
  const sendText = async (value) => { await input.fill(value); await send.click(); };
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
  await choose("可以执行的步骤"); await label.fill("人工修改"); await saveLabel.click();
  await map.getByRole("button", { name: "人工修改", exact: true }).waitFor();
  delayed = true; await sendText("过期建议测试");
  while (!releaseAI) await new Promise((resolve) => setTimeout(resolve, 20));
  await label.fill("人工修改 v2"); await saveLabel.click();
  await map.getByRole("button", { name: "人工修改 v2", exact: true }).waitFor();
  releaseAI(); delayed = false; releaseAI = undefined;
  await page.getByRole("alert").filter({ hasText: "AI 思考期间你修改了导图" }).waitFor();
  assert.equal(readMindmap(id).root.children[0].children.at(-1).label, "人工修改 v2");
  assert.equal(await input.inputValue(), "过期建议测试");
  // Discuss mode is enforced by the proposal parser and leaves tree content alone.
  const treeBefore = readMindmap(id).root;
  await chat.getByRole("button", { name: "只讨论", exact: true }).click();
  await sendText("解释一下这张图");
  await chat.getByText("这是一个结构化思考的例子，没有修改导图。", { exact: true }).waitFor();
  assert.deepEqual(readMindmap(id).root, treeBefore);
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
  patchFailure = "before"; await label.fill("失败时保留"); await saveLabel.click();
  await page.getByRole("alert").filter({ hasText: "Fixture save unavailable" }).waitFor();
  assert.equal(await label.inputValue(), "失败时保留");
  patchFailure = ""; await page.getByRole("alert").getByRole("button", { name: "重试", exact: true }).click();
  await map.getByRole("button", { name: "失败时保留", exact: true }).waitFor();
  patchFailure = "after"; await label.fill("回执丢失但已保存"); await saveLabel.click();
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
  await input.fill("下次继续讨论"); await choose("核心思路"); await label.fill("尚未提交的节点文字");
  await nav.getByRole("button", { name: "Notes", exact: true }).click();
  assert.equal(await page.locator("main textarea").inputValue(), draft.text);
  await nav.getByRole("button", { name: "思维导图", exact: true }).click();
  assert.equal(await label.inputValue(), "尚未提交的节点文字"); assert.equal(await input.inputValue(), "下次继续讨论");
  await map.getByRole("button", { name: "取消编辑", exact: true }).click();
  // Keyboard and non-drag reparenting preserve children.
  await choose("另一个标签页的编辑"); await map.getByRole("combobox", { name: "移动到…" }).selectOption("root");
  await map.getByRole("button", { name: "移动", exact: true }).click();
  await page.waitForTimeout(200); assert.equal(readMindmap(id).root.children.at(-1).id, "ai-step");
  // Refresh restores independent content/history and the browser-local chat draft.
  await page.reload(); await map.waitFor(); await map.getByRole("button", { name: "另一个标签页的编辑", exact: true }).waitFor();
  assert.equal(await input.inputValue(), "下次继续讨论");
  assert.equal(await page.getByRole("button", { name: "撤销", exact: true }).isEnabled(), true);
  // A second map and Back/Forward restore document identity, not just tab styling.
  page.once("dialog", (dialog) => dialog.accept("第二张导图")); await page.getByRole("button", { name: "新建导图", exact: true }).click();
  await map.getByRole("button", { name: "第二张导图", exact: true }).waitFor();
  const secondId = new URL(page.url()).searchParams.get("mindmap"); assert.notEqual(secondId, id);
  await page.goBack(); await map.getByRole("button", { name: "想法工作台", exact: true }).waitFor();
  await page.goForward(); await map.getByRole("button", { name: "第二张导图", exact: true }).waitFor();
  await page.getByRole("combobox", { name: "思维导图库" }).selectOption(id);
  await map.getByRole("button", { name: "想法工作台", exact: true }).waitFor();
  for (const theme of ["glass", "glass-dark", "light"]) {
    await page.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), theme);
    for (const width of [1440, 960, 375, 320, 812]) {
      await page.setViewportSize({ width, height: width === 812 ? 500 : 960 });
      await map.getByRole("button", { name: "适应画布", exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${theme}/${width} overflow`);
      const box = await nav.boundingBox(); assert.ok(box.x > 0 && box.width < width);
      if (width < 760) for (const button of await nav.getByRole("button").all()) assert.ok((await button.boundingBox()).height >= 44);
      await page.screenshot({ path: `/tmp/notes-views/${theme}-${width}.png` });
    }
  }
  // Phone selection and discussion stay usable without dragging tiny nodes.
  await page.setViewportSize({ width: 375, height: 960 });
  await map.getByRole("combobox", { name: "选择节点", exact: true }).selectOption("ai-step");
  assert.equal(await label.inputValue(), "另一个标签页的编辑");
  await chat.getByRole("button", { name: "只讨论", exact: true }).click();
  const mobileRevision = readMindmap(id).revision;
  await sendText("在手机上解释这个节点");
  await page.waitForFunction(() => document.querySelector("#mindmap-instruction")?.value === "");
  assert.deepEqual(capturedRequest.selectedIds, ["ai-step"]); assert.equal(readMindmap(id).revision, mobileRevision + 1);
  await page.setViewportSize({ width: 1440, height: 960 });
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
  console.log("PASS: independent maps, scoped AI proposals, discussion, stale/manual/cross-tab protection, undo/redo, idempotent retry, drafts/history, Canvas guard and responsive tabs");
} catch (error) { await page?.screenshot({ path: "/tmp/notes-views/failure.png" }).catch(() => {}); throw error; }
finally { await browser.close(); if (previousDir === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previousDir; rmSync(dataDir, { recursive: true, force: true }); }
