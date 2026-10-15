// Reuse the dev server. All session/model/vault writes are mocked; no AI tokens or personal data are used.
// node --env-file-if-exists=.env.local e2e/knowledge-capture.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
const screenshots = "/tmp/knowledge-capture"; mkdirSync(screenshots, { recursive: true });
let debugPage;
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) {
    const login = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(login.ok());
  }
  const live = await context.request.get("/api/sessions/knowledge-browser-fixture/knowledge?history=1");
  assert.ok(live.ok(), `Knowledge API failed (${live.status()})`);
  assert.ok(Array.isArray((await live.json()).captures));
  await context.addInitScript(() => { localStorage.setItem("pi-locale", "zh-CN"); if (!localStorage.getItem("pi-theme")) localStorage.setItem("pi-theme", "light"); });
  const id = "knowledge-browser-fixture";
  const cwd = "/tmp/robin-fixture";
  const timestamp = new Date().toISOString();
  const info = { id, path: `${cwd}/session.jsonl`, cwd, projectRoot: cwd, projectKey: cwd, name: "知识库架构讨论", created: timestamp, modified: timestamp, messageCount: 2, firstMessage: "知识正文放哪里？" };
  const messages = [{ role: "user", content: "知识正文放哪里？" }, { role: "assistant", content: [{ type: "text", text: "建议使用 Markdown，任务状态保留在 Robin。" }], provider: "test", model: "test-model" }];
  const rootEntry = { type: "message", id: "user", parentId: null, timestamp, message: messages[0] };
  const leafEntry = { type: "message", id: "answer", parentId: "user", timestamp, message: messages[1] };
  const detail = { info, sessionId: id, leafId: "answer", tree: [{ entry: rootEntry, children: [{ entry: leafEntry, children: [] }] }], context: { messages, entryIds: ["user", "answer"], oldestEntryId: "user", hasMore: false, thinkingLevel: "off", model: { provider: "test", modelId: "test-model" } }, toolNames: [], totalActiveMs: 0 };
  const source = { sessionId: id, leafId: "answer", scope: "all", sessionName: info.name, project: "robin-fixture", url: `${baseURL}/?session=${id}`, capturedAt: timestamp, fingerprint: "source-hash", messages: messages.map((message, index) => ({ id: index ? "answer" : "user", role: message.role, text: index ? message.content[0].text : message.content })), totalMessages: 2, chars: 40 };
  const proposal = { id: "proposal", source: { ...source, messages: undefined, entryIds: ["user", "answer"] }, project: "Robin", vaultId: "vault", vaultPath: "/fixture/Obsidian Vault", hubPath: "Knowledge/Robin/Project.md", hubMarkdown: "# Robin", createdAt: timestamp, notes: [
    { id: "n1", title: "知识正文归 Markdown", kind: "decision", action: "create", path: "Knowledge/Robin/Decision.md", markdown: "# 知识正文归 Markdown\n\n这是待确认的架构选择。\n\n[[Knowledge/Robin/Project|Robin]]", url: "obsidian://open?path=decision" },
    { id: "n2", title: "Notes 的职责", kind: "architecture", action: "append", path: "Notes/Architecture.md", before: "这是我原来的架构说明。", markdown: "## Notes 的职责\n\n只追加这个补充，不替换原文。", url: "obsidian://open?path=architecture" },
  ] };
  let generated = false, prepares = 0, saves = 0, failOnce = true, slowPrepare = false;
  const page = await context.newPage(); debugPage = page;
  const errors = []; page.on("pageerror", (error) => { errors.push(error.message); console.error(error.message); });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
    if (path.endsWith("/knowledge")) {
      if (method === "GET") {
        if (url.searchParams.has("proposalId")) return route.fulfill({ json: { proposal } });
        const captures = generated ? [{ id: proposal.id, project: proposal.project, createdAt: timestamp, saved: proposal.notes.filter((note) => note.saved).length, total: 2 }] : [];
        if (url.searchParams.has("history")) return route.fulfill({ json: { captures, savedCount: captures.reduce((sum, capture) => sum + capture.saved, 0) } });
        return route.fulfill({ json: { source: { ...source, scope: url.searchParams.get("scope") ?? "all" }, vaults: [{ id: "vault", name: "Obsidian Vault", path: "/fixture/Obsidian Vault" }], captures } });
      }
      const body = route.request().postDataJSON();
      if (body.action === "prepare") {
        prepares++; generated = true; assert.equal(body.leafId, "answer"); assert.equal(body.fingerprint, "source-hash");
        if (slowPrepare) await new Promise((resolve) => setTimeout(resolve, 500));
        return route.fulfill({ json: { proposal } }).catch(() => {});
      }
      saves++; assert.equal(body.confirmed, true);
      if (failOnce) { failOnce = false; proposal.notes[0].saved = true; return route.fulfill({ status: 409, json: { proposal, error: "已有笔记发生修改；已保存的第一篇保留。" } }); }
      proposal.notes.forEach((note) => { note.saved = true; });
      return route.fulfill({ json: { proposal } });
    }
    if (path === "/api/sessions") return route.fulfill({ json: { sessions: [info], runningSessionIds: [], sessionListVersion: 1 } });
    if (path === `/api/sessions/${id}`) return route.fulfill({ json: detail });
    if (path.endsWith("/state")) return route.fulfill({ json: { running: false } });
    if (path === "/api/models") return route.fulfill({ json: { models: {}, modelList: [{ provider: "test", id: "test-model", name: "Test model" }], defaultModel: { provider: "test", modelId: "test-model" } } });
    if (path === "/api/agent/running") return route.fulfill({ json: { runningSessionIds: [], sessionListVersion: 1 } });
    if (path === "/api/worktrees") return route.fulfill({ json: { worktrees: [], projectRoot: cwd, projectKey: cwd, currentWorktreePath: cwd } });
    if (path === "/api/home") return route.fulfill({ json: { home: "/tmp" } });
    if (path === "/api/project-trust") return route.fulfill({ json: { cwd, trusted: true, hasProjectResources: false, resources: [] } });
    if (path === "/api/robin/notes-agent") return route.fulfill({ json: { finals: {} } });
    return route.fulfill({ json: {} });
  });
  await page.goto(`/?session=${id}`);
  const trigger = page.getByRole("button", { name: "沉淀到知识库", exact: true });
  await trigger.waitFor();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "沉淀到知识库", exact: true });
  await dialog.waitFor();
  await page.getByText("检查原文 · 共选中 2/2 条正文消息", { exact: true }).click();
  await dialog.getByText("知识正文放哪里？", { exact: true }).waitFor();
  assert.equal(prepares, 0); assert.equal(saves, 0);
  await dialog.getByLabel("所属项目", { exact: true }).fill("Robin");
  await dialog.getByRole("button", { name: "生成预览", exact: true }).click();
  await dialog.getByRole("button", { name: "确认保存全部笔记", exact: true }).waitFor();
  assert.equal(saves, 0, "model preparation cannot save files");
  await dialog.getByText("已有正文 · 保持不变", { exact: true }).click();
  await dialog.getByText("这是我原来的架构说明。", { exact: true }).waitFor();
  await page.screenshot({ path: `${screenshots}/preview.png` });
  await dialog.getByRole("button", { name: "确认保存全部笔记", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "发生修改" }).waitFor();
  await dialog.getByRole("status").filter({ hasText: "已保存 1/2" }).waitFor();
  assert.equal(await dialog.getByRole("link", { name: "在 Obsidian 打开", exact: true }).count(), 1);
  await dialog.getByRole("button", { name: "确认保存全部笔记", exact: true }).click();
  await dialog.getByRole("status").filter({ hasText: "已保存 2/2" }).waitFor();
  assert.equal(await dialog.getByRole("link", { name: "在 Obsidian 打开", exact: true }).count(), 2);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.matches('[data-knowledge-trigger="true"]'));
  await trigger.click();
  await dialog.getByText(/已保存 2\/2/).waitFor();
  assert.equal(prepares, 1, "reopening does not spend model tokens");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  const more = page.locator('[data-mobile-toolbar-more="true"]');
  await more.waitFor();
  await more.click();
  await page.locator('[data-mobile-toolbar-action="knowledge"]').click();
  await dialog.waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.screenshot({ path: `${screenshots}/mobile.png` });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.matches('[data-mobile-toolbar-more="true"]'));
  slowPrepare = true;
  await more.click();
  await page.locator('[data-mobile-toolbar-action="knowledge"]').click();
  await dialog.getByRole("button", { name: "生成预览", exact: true }).click();
  await dialog.getByRole("button", { name: "取消生成", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(saves, 2, "cancellation cannot write files");
  assert.deepEqual(errors, []);
  console.log("Knowledge capture UI: toolbar, exact source, preview-before-write, append review, partial failure/retry, history, cancellation, focus and mobile passed.");
} catch (error) {
  await debugPage?.screenshot({ path: `${screenshots}/failure.png` }).catch(() => {});
  throw error;
} finally { await browser.close(); }
