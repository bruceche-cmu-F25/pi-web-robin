// Existing dev server; all note writes and AI calls are mocked. No personal data is changed.
// node --env-file-if-exists=.env.local e2e/obsidian-notes.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const screenshots = "/tmp/obsidian-notes";
mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  if (process.env.PI_WEB_PASSWORD) {
    const login = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(login.ok(), `Login failed: ${login.status()}`);
  }
  // Read-only integration check against the real server, separate from the UI fixtures.
  const live = await context.request.get("/api/robin/obsidian");
  assert.ok(live.ok(), `Obsidian discovery failed: ${live.status()}`);
  console.log("Live vault discovery:", (await live.json()).vaults.map((vault) => vault.name));

  await context.addInitScript(() => { localStorage.setItem("pi-locale", "zh-CN"); if (!localStorage.getItem("pi-theme")) localStorage.setItem("pi-theme", "light"); });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let drafts = [{ id: "example", title: "React 学习笔记", text: "# 闭包\n\n这是我的理解。", notionParentId: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
  const vault = { id: "local", name: "Obsidian Vault", path: "/test/Obsidian Vault" };
  const archives = [];
  let archiveCalls = 0;
  let notionReads = 0;
  let aiCalls = 0;
  let failNext = true;
  let failDraftSave = false;
  await page.route("**/api/models", (route) => route.fulfill({ json: { models: {}, modelList: [], defaultModel: null } }));
  await page.route("**/api/robin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const body = method === "GET" ? null : route.request().postDataJSON();
    if (path === "/api/robin/obsidian") {
      if (method === "GET") return route.fulfill({ json: { vaults: [vault], archives } });
      archiveCalls++;
      assert.equal(body.confirmed, true);
      assert.equal(body.vaultId, "local");
      assert.equal(body.expectedDraft.text, drafts[0].text);
      assert.equal(body.content, drafts[0].text);
      if (failNext) { failNext = false; return route.fulfill({ status: 500, json: { error: "模拟权限错误，草稿已保留" } }); }
      const archive = { draftId: body.draftId, title: body.title, vaultId: "local", vaultPath: vault.path, relativePath: "Notes/example/note.md", url: "obsidian://open?path=%2Ftest%2Fnote.md", savedAt: new Date().toISOString() };
      archives.push(archive);
      drafts = drafts.filter((draft) => draft.id !== body.draftId);
      return route.fulfill({ json: { archive } });
    }
    if (path === "/api/robin/notes") {
      if (method === "GET") return route.fulfill({ json: { drafts } });
      if (method === "PATCH") {
        if (failDraftSave) return route.fulfill({ status: 500, json: { error: "模拟草稿保存失败" } });
        Object.assign(drafts.find((draft) => draft.id === body.id), body);
        return route.fulfill({ json: { draft: drafts.find((draft) => draft.id === body.id) } });
      }
      if (method === "POST") {
        const draft = { ...body, id: `blank-${drafts.length}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        drafts.push(draft);
        return route.fulfill({ json: { draft } });
      }
    }
    if (path === "/api/robin/notes-agent") { if (method === "POST") aiCalls++; return route.fulfill({ json: { finals: {} } }); }
    if (path === "/api/robin/notion") { notionReads++; return route.fulfill({ json: { pages: [{ id: "page", title: "Optional Notion", url: "https://notion.so/example" }] } }); }
    return route.fulfill({ json: { attachments: [], canvases: [], finals: {}, todos: [], events: [], rounds: [], jobs: [] } });
  });
  await page.goto("/notes");
  const review = page.getByRole("button", { name: "预览并保存", exact: true });
  const destination = page.getByRole("combobox", { name: "存档到", exact: true });
  await review.waitFor();
  assert.equal(await destination.inputValue(), "obsidian");
  assert.equal(notionReads, 0, "Notion is optional and not loaded by default");
  assert.equal(await review.isEnabled(), true, "saving needs no model");
  await page.getByRole("textbox", { name: "标题", exact: true }).fill("React 与闭包");
  await review.click();
  await page.getByRole("button", { name: "确认存入 Obsidian", exact: true }).waitFor();
  assert.equal(archiveCalls, 0, "preview does not write to a vault");
  await page.screenshot({ path: `${screenshots}/desktop-review.png` });
  await page.getByRole("button", { name: "确认存入 Obsidian", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "模拟权限错误" }).waitFor();
  assert.equal(drafts[0].title, "React 与闭包");
  await page.getByRole("button", { name: "确认存入 Obsidian", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已存入 Obsidian" }).waitFor();
  assert.equal(aiCalls, 0);
  assert.equal(archives.length, 1);
  assert.ok(drafts.every((draft) => draft.id !== "example"));
  assert.equal(await page.getByRole("link", { name: "在 Obsidian 打开: React 与闭包" }).getAttribute("href"), archives[0].url);
  await destination.selectOption("notion");
  await page.getByRole("button", { name: "Optional Notion", exact: true }).waitFor();
  assert.ok(notionReads > 0);
  await destination.selectOption("obsidian");
  await page.screenshot({ path: `${screenshots}/desktop-saved.png` });
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `No horizontal overflow at ${width}px`);
    assert.equal(await destination.isVisible(), true);
    await page.screenshot({ path: `${screenshots}/${width}.png`, fullPage: true });
  }
  await page.reload();
  await page.getByRole("tab", { name: "笔记库", exact: true }).click();
  await page.getByRole("link", { name: "React 与闭包", exact: true }).waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  failDraftSave = true;
  await page.getByRole("textbox", { name: "标题", exact: true }).fill("保留未保存的编辑");
  const editor = page.locator("textarea").first();
  await editor.fill("即使草稿保存失败，也不能删除这段内容。");
  await review.click();
  const callsBefore = archiveCalls;
  await page.getByRole("button", { name: "确认存入 Obsidian", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "未能保存" }).waitFor();
  assert.equal(archiveCalls, callsBefore, "a failed draft flush cannot start an archive");
  await page.getByRole("button", { name: "返回编辑", exact: true }).click();
  assert.equal(await editor.inputValue(), "即使草稿保存失败，也不能删除这段内容。");
  failDraftSave = false;
  await editor.press("Meta+s");
  await page.evaluate(() => { localStorage.setItem("pi-theme", "dark"); });
  await page.reload();
  await review.waitFor();
  await page.screenshot({ path: `${screenshots}/desktop-dark.png` });
  assert.deepEqual(errors, []);
  console.log("Obsidian Notes UI: preview, save failure/retry, raw save, archive links, Notion fallback, mobile and reload passed.");
} finally { await browser.close(); }
