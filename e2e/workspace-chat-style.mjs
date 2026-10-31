// Shared Chat presentation across real workspace routes; every API is intercepted.
// node --env-file-if-exists=.env.local e2e/workspace-chat-style.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
const shots = "/tmp/workspace-chat-style";
mkdirSync(shots, { recursive: true });
const now = new Date().toISOString();
const question = "统一聊天样式 — a long question with a URL https://example.org/" + "long-path-".repeat(20);
const answer = "## Shared reply\n\nA **readable answer** with 中文 and a [source](https://example.org).\n\n```python\nprint('hello')\n```\n\n| Input | Output |\n| --- | --- |\n| 1 | 2 |";
const cwd = "/tmp/chat-style-fixture";
const info = { id: "chat-style", cwd, projectKey: cwd, projectRoot: cwd, path: `${cwd}/session.jsonl`, name: "Style fixture", created: now, modified: now, messageCount: 2, firstMessage: question };
const draft = { id: "chat-style", title: "Style fixture", text: "# A note", notionParentId: "", updatedAt: now };
const idea = { id: "chat-style", name: "Style fixture", note: "Unchanged product note", step: "spot", links: [], createdAt: now, updatedAt: now };
const paper = { id: "paper-style", title: "Style paper", url: "https://example.org/paper", pdfUrl: "", authors: [], year: "2026", abstract: "An abstract", provider: "Test", revision: 1, status: "queued", tags: "", note: "", source: null, messages: [], exports: [], projectIds: [], createdAt: now, updatedAt: now };
const errors = [], writes = [];
let page;
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(fontSize => {
    localStorage.setItem("pi-chat-content-font-size", fontSize);
    localStorage.setItem("pi-locale", "en");
    localStorage.setItem("pi-theme", "light");
    window.EventSource = class {
      readyState = 1;
      constructor() { setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "connected", isStreaming: false }) }), 10); }
      close() { this.readyState = 2; }
    };
  }, process.env.E2E_CHAT_FONT_SIZE ?? "14");
  await context.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const reply = json => route.fulfill({ json });
    if (req.method() !== "GET") {
      const body = req.postDataJSON(); writes.push({ path, body });
      if (["/api/robin/notes-agent", "/api/robin/product-assistant", "/api/robin/assistant"].includes(path)) return reply({ reply: answer, usedTools: ["practice_current", "practice_current"], sessionId: "fixture" });
      if (path === "/api/cwd/validate") return reply({ cwd, projectRoot: cwd, projectKey: cwd });
      if (path.startsWith("/api/agent/")) return reply({ success: true, data: body?.type === "get_tools" ? [] : { commands: [], isStreaming: false } });
      throw new Error(`Unexpected write: ${req.method()} ${path}`);
    }
    if (path === "/api/research/agent") {
      const projectId = url.searchParams.get("project") || "general", paperId = url.searchParams.get("paper") || undefined;
      const conversation = { id: `discussion:${projectId}`, projectId, paperId, title: "Style fixture", kind: "discussion", default: true, revision: 0, createdAt: now, updatedAt: now, messageCount: 2 };
      return reply({ conversation, sessions: [conversation], run: null, messages: [{ id: "q", role: "user", text: question, at: now }, { id: "a", role: "assistant", text: answer, at: now }] });
    }
    const fixtures = {
      "/api/home": { home: "/tmp", generalProject: { root: cwd, key: cwd } },
      "/api/sessions": { sessions: [info], runningSessionIds: [], sessionListVersion: 1 },
      "/api/sessions/ui-state": { version: 1, revision: 0, sessions: {}, projects: { [cwd]: { root: cwd } }, projectOrder: [cwd] },
      "/api/agent/running": { runningSessionIds: [], awaitingInputSessionIds: [], sessionListVersion: 1 },
      "/api/sessions/chat-style": { info, sessionId: info.id, leafId: "a", tree: [], context: { messages: [{ role: "user", content: question }, { role: "assistant", content: [{ type: "text", text: answer }] }], entryIds: ["q", "a"], hasMore: false, oldestEntryId: "q", thinkingLevel: "off" } },
      "/api/sessions/chat-style/state": { running: false, state: { isStreaming: false, isPromptRunning: false } },
      "/api/agent/chat-style": { running: false, state: { isStreaming: false, isPromptRunning: false } },
      "/api/models": { models: {}, modelList: [{ provider: "test", id: "test-model", name: "Test model" }], defaultModel: { provider: "test", modelId: "test-model" } },
      "/api/worktrees": { isGit: false, worktrees: [], projectRoot: cwd, projectKey: cwd },
      "/api/robin/notes": { drafts: [draft] },
      "/api/robin/canvases": { canvases: [] },
      "/api/robin/notes/attachments": { attachments: [] },
      "/api/robin/notion": { pages: [] },
      "/api/robin/products": { ideas: [idea], captures: [] },
      "/api/robin/validation": { initialized: false, projects: [] },
      "/api/robin/practice": { records: [], currentSlug: "two-sum", list: "neetcode150", today: now.slice(0, 10) },
      "/api/research/projects": { projects: [], activeId: "general" },
      "/api/research/objective": { objective: "", note: "", revision: "fixture", captureState: { captures: [], vaults: [], vaultId: "" } },
      "/api/research/papers": url.searchParams.has("id") ? { paper } : { papers: [paper] },
      "/api/research/sessions": { sessions: [], run: null },
      "/api/robin/voice": { configured: false, ttsConfigured: false },
    };
    return reply(fixtures[path] ?? { records: [], finals: {}, resources: [], opportunities: [], todos: [], events: [], jobs: [], rounds: [], links: [], review: null });
  });
  // Cross-origin course/problem frames do not need the network for a chat test.
  await context.route("https://neetcode.io/**", route => route.fulfill({ contentType: "text/html", body: "<p>Fixture problem</p>" }));
  page = await context.newPage(); page.on("pageerror", e => { errors.push(e.message); console.error(e.stack); }); page.setDefaultTimeout(30_000);
  const baseline = new Map();
  for (const [name, url] of [["main", "/?session=chat-style"], ["notes", "/notes?draft=chat-style"], ["practice", "/coding"], ["product", "/product?idea=chat-style"], ["research", "/research?view=assistant"], ["paper", "/research?view=assistant&paper=paper-style"]]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    console.log(`Checking ${name}`);
    await page.goto(url);
    await page.addStyleTag({ content: ".chat-input-surface { transition: none !important; }" });
    const panel = name === "main" ? page.locator(".chat-input-shell") : name === "research" ? page.locator('section[aria-label="Research discussion"]') : name === "paper" ? page.locator("aside.chat-content") : page.locator(".workspace-agent:visible");
    const input = panel.locator(".chat-input-textarea");
    if (["notes", "practice", "product"].includes(name)) {
      const toggle = page.locator(`button[aria-controls="${name === "notes" ? "notes-agent" : name === "practice" ? "practice-coach" : "product-partner"}"]`);
      await toggle.waitFor();
      assert.equal(await toggle.getAttribute("aria-expanded"), "false", `${name}: content first, assistant initially closed`);
      await toggle.click();
    }
    if (name === "product") await page.locator("#product-partner strong").filter({ hasText: "Style fixture" }).waitFor();
    await input.waitFor();
    // Next's dev-only badge otherwise sits over the bottom-right Send target.
    // Move just the badge, not error overlays or application controls.
    await page.locator("#devtools-indicator").evaluateAll(nodes => nodes.forEach(el => {
      el.style.setProperty("right", "auto", "important");
      el.style.setProperty("left", "20px", "important");
    }));
    if (!["main", "research", "paper"].includes(name)) {
      await input.fill(question);
      await panel.getByRole("button", { name: "Send", exact: true }).click();
      await panel.getByRole("heading", { name: "Shared reply" }).waitFor();
      await panel.locator(".workspace-agent-tools summary").click();
      assert.equal(await panel.locator(".workspace-agent-tools li").count(), 1);
    }
    await input.fill("Draft stays while the theme and viewport change\n第二行");
    for (const width of [1440, 375, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 812 });
      await page.waitForTimeout(250); // Let media-query subscribers switch panes.
      if (width < 900) {
        if (name === "paper") await page.getByRole("dialog").getByRole("tablist").first().getByRole("tab").nth(1).click();
        if (name === "notes") await page.getByRole("tablist").getByRole("tab").nth(2).click();
        if (name === "practice" && !await input.isVisible()) await page.locator("#practice-desk button").filter({ hasText: /^Coach$/ }).click();
        if (name === "product" && !await input.isVisible()) await page.getByRole("button", { name: "Brainstorm partner", exact: true }).click();
      }
      await input.waitFor({ state: "visible" });
      for (const theme of ["light", "dark", "glass", "glass-dark"]) {
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle("dark", theme === "dark" || theme === "glass-dark"); }, theme);
        await page.waitForTimeout(250); // Main Chat's border/background transition has settled.
        assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
        const surface = panel.locator(".chat-input-surface");
        const appearance = await surface.evaluate(el => {
          const css = getComputedStyle(el), field = getComputedStyle(el.querySelector("textarea"));
          const rect = el.getBoundingClientRect();
          const buttons = [...el.querySelectorAll(".chat-input-actions button")].map(b => { const r = b.getBoundingClientRect(); return { height: r.height, width: r.width, inside: r.right <= rect.right && r.left >= rect.left }; });
          return { style: [css.borderRadius, css.backgroundColor, css.borderTopColor, field.fontFamily, field.fontSize, field.lineHeight, field.backgroundColor, field.borderTopWidth], buttons, overflow: el.scrollWidth > el.clientWidth + 1 };
        });
        const key = `${width}/${theme}`;
        if (name === "main") baseline.set(key, appearance.style);
        else assert.deepEqual(appearance.style, baseline.get(key), `${name}/${key}: same composer as main Chat`);
        assert.equal(appearance.overflow, false, `${name}/${key}: no composer overflow`);
        if (["notes", "practice", "product"].includes(name)) {
          const geometry = await surface.evaluate(el => {
            const field = el.querySelector("textarea").getBoundingClientRect();
            const controls = el.querySelector(".workspace-agent-controls").getBoundingClientRect();
            const model = el.querySelector(".model-selector > button");
            const r = el.getBoundingClientRect(), m = model?.getBoundingClientRect();
            return { separate: controls.top >= field.bottom, modelInside: !m || (m.left >= r.left && m.right <= r.right), unboxed: !model || getComputedStyle(model).borderTopWidth === "0px" };
          });
          assert.ok(geometry.separate && geometry.modelInside && geometry.unboxed, `${name}/${key}: full text row and unboxed model ${JSON.stringify(geometry)}`);
        }
        for (const b of appearance.buttons) assert.ok(b.height >= 44 && b.width >= 44 && b.inside, `${name}/${key}: reachable action ${JSON.stringify(b)}`);
        assert.equal(await input.inputValue(), "Draft stays while the theme and viewport change\n第二行");
        const bubble = (name === "paper" ? panel : page).locator(".chat-user-bubble:visible").first();
        const bubbleStyle = await bubble.evaluate(el => { const c = getComputedStyle(el); return [c.borderRadius, c.padding, c.backgroundColor, c.fontFamily, c.fontSize, c.lineHeight]; });
        if (name === "main") baseline.set(`bubble/${key}`, bubbleStyle);
        else assert.deepEqual(bubbleStyle, baseline.get(`bubble/${key}`), `${name}/${key}: same user bubble`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}/${key}: no page overflow`);
        if (name === "notes") {
          const trigger = panel.locator(".model-selector > button");
          await trigger.click();
          const list = page.getByRole("listbox");
          const reachable = await list.evaluate(el => {
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && el.contains(hit);
          });
          assert.ok(reachable, `${name}/${key}: model menu remains reachable above the composer`);
          await trigger.press("Escape");
          assert.equal(await list.count(), 0, "Escape closes the model menu without changing the draft");
          await trigger.click();
          await list.getByRole("option").click();
          assert.equal(await input.inputValue(), "Draft stays while the theme and viewport change\n第二行");
        }
        if (width !== 320 && ["light", "glass-dark"].includes(theme)) await page.screenshot({ path: `${shots}/${name}-${width}-${theme}.png` });
      }
    }
  }
  assert.deepEqual(errors, []);
  assert.equal(writes.filter(w => ["/api/robin/assistant", "/api/robin/notes-agent", "/api/robin/product-assistant"].includes(w.path)).length, 3, "One explicit fixture send per scoped panel");
  console.log("PASS: main/notes/practice/product/research/paper share composer and bubble styles; four themes, 320/375/1440px, drafts, sends and tool disclosure");
} catch (error) {
  console.error({ errors });
  await page?.screenshot({ path: `${shots}/failure.png` }).catch(() => {});
  console.error(await page?.locator("nextjs-portal").locator("[role=dialog]").allTextContents());
  throw error;
}
finally { await browser.close(); }
