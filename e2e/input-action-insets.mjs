// Existing dev server; application APIs and streams mocked. Never sends a prompt.
// node --env-file-if-exists=.env.local --experimental-strip-types e2e/input-action-insets.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { fullstackPlan, practicePlan } from "../extension/robin/learning.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const output = process.env.E2E_SCREENSHOT_DIR ?? "/tmp/pi-input-insets";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  for (const width of [1440, 812, 375, 320]) {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 1000 }, hasTouch: width <= 640, serviceWorkers: "block", reducedMotion: "reduce" });
    if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
    await context.addInitScript(() => {
      localStorage.setItem("pi-locale", "en");
      localStorage.setItem("pi-theme", "light");
      window.EventSource = class {
        readyState = 1;
        constructor() { setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "connected", isStreaming: location.search.includes("streaming") }) }), 10); }
        close() { this.readyState = 2; }
      };
    });
    const today = "2030-05-12", cwd = "/tmp/input-insets-fixture", timestamp = `${today}T12:00:00Z`;
    const sessions = ["idle", "streaming"].map(id => ({ id, cwd, projectKey: cwd, projectRoot: cwd, path: `${cwd}/${id}.jsonl`, name: id, created: timestamp, modified: timestamp, messageCount: 1, firstMessage: "Input geometry fixture" }));
    const fixtures = {
      "/api/home": { home: "/tmp", generalProject: { root: cwd, key: cwd } },
      "/api/sessions": { sessions, runningSessionIds: ["streaming"], sessionListVersion: 1 },
      "/api/sessions/ui-state": { version: 1, revision: 0, sessions: {}, projects: { [cwd]: { root: cwd } }, projectOrder: [cwd] },
      "/api/agent/running": { runningSessionIds: ["streaming"], awaitingInputSessionIds: [], sessionListVersion: 1 },
      "/api/models": { models: {}, modelList: [] },
      "/api/worktrees": { isGit: false, worktrees: [], projectRoot: cwd, projectKey: cwd },
      "/api/robin/todos": { today, todos: [] },
      "/api/robin/events": { today, events: [], google: { connected: false } },
      "/api/robin/links": { links: [] }, "/api/robin/rounds": { rounds: [] },
      "/api/robin/gmail": { today, connected: false, review: null },
      "/api/robin/jobs": { jobs: [], configured: false, minScore: 4 },
      "/api/robin/learning": { practice: practicePlan([], "neetcode150", today), fullstack: fullstackPlan([]) },
    };
    for (const info of sessions) {
      const running = info.id === "streaming";
      fixtures[`/api/sessions/${info.id}`] = { info, sessionId: info.id, leafId: "question", tree: [], context: { messages: [{ role: "user", content: info.firstMessage }], entryIds: ["question"], hasMore: false, oldestEntryId: "question", thinkingLevel: "off" } };
      fixtures[`/api/sessions/${info.id}/state`] = fixtures[`/api/agent/${info.id}`] = { running, state: { isStreaming: running, isPromptRunning: running } };
    }
    const writes = [], errors = [];
    await context.route("**/api/**", route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path === "/api/cwd/validate") return route.fulfill({ json: { cwd, projectRoot: cwd, projectKey: cwd } });
      if (req.method() !== "GET") {
        const body = req.postDataJSON();
        if (!path.startsWith("/api/agent/") || !["get_state", "get_tools", "get_commands"].includes(body?.type)) writes.push({ path, body });
        return route.fulfill({ json: { success: true, data: body?.type === "get_tools" ? [] : { commands: [], isStreaming: path.endsWith("streaming") } } });
      }
      return route.fulfill({ json: fixtures[path] ?? {} });
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    const theme = value => page.evaluate(value => {
      document.documentElement.dataset.theme = value;
      document.documentElement.classList.toggle("dark", value === "dark");
    }, value);
    for (const id of ["idle", "streaming"]) {
      await page.goto(`/?session=${id}`);
      const input = page.locator(".chat-input-textarea");
      await input.waitFor().catch(async error => {
        await page.screenshot({ path: `${output}/load-failure.png` });
        console.error({ url: page.url(), errors, text: (await page.locator("body").innerText()).slice(0, 2000) });
        throw error;
      });
      await page.locator('.chat-input-actions button[aria-expanded]').waitFor();
      if (id === "streaming") await page.getByRole("button", { name: "Steer", exact: true }).waitFor();
      for (const currentTheme of ["light", "dark", "glass"]) {
        await theme(currentTheme);
        for (const draft of ["", "A draft that stays unsent.", "Line one\nLine two\nLine three\nLine four"]) {
          await input.fill(draft);
          const geometry = await page.locator(".chat-input-surface").evaluate(el => {
            const surface = el.getBoundingClientRect(), css = getComputedStyle(el);
            const field = el.querySelector("textarea").getBoundingClientRect();
            const buttons = [...el.querySelectorAll(".chat-input-actions button")].map(button => {
              const b = button.getBoundingClientRect();
              return { label: button.textContent || button.getAttribute("aria-label"), height: b.height, width: b.width, bottom: surface.bottom - b.bottom, right: surface.right - b.right, top: b.top, radius: parseFloat(getComputedStyle(button).borderTopRightRadius) };
            });
            return { buttons, fieldWidth: field.width, fieldBottom: field.bottom, inset: parseFloat(css.paddingBottom), radius: parseFloat(css.borderTopRightRadius), width: surface.width, scroll: document.documentElement.scrollWidth, viewport: innerWidth };
          });
          const tag = `${width}/${id}/${currentTheme}/${draft.split("\n").length}`;
          assert.ok(geometry.scroll <= geometry.viewport, `No page overflow: ${tag}`);
          assert.ok(geometry.fieldWidth >= 100, `Editable space: ${tag}: ${JSON.stringify(geometry)}`);
          for (const b of geometry.buttons) {
            assert.equal(b.height, 44, `Equal action height: ${tag}/${b.label}`);
            assert.ok(b.width >= 44, `Touch target: ${tag}/${b.label}`);
            assert.ok(Math.abs(b.bottom - geometry.inset - 1) <= 1, `Bottom inset: ${tag}/${b.label}`);
            assert.ok(b.radius + b.bottom >= geometry.radius - 1, `Nested curve: ${tag}/${b.label}`);
          }
          assert.ok(Math.abs(geometry.buttons.at(-1).right - geometry.inset - 1) <= 1, `Right inset: ${tag}: ${JSON.stringify(geometry)}`);
          if (id === "streaming" && width <= 640) assert.ok(geometry.buttons[0].top >= geometry.fieldBottom, `Narrow actions get their own line: ${tag}`);
        }
        await page.screenshot({ path: `${output}/chat-${width}-${id}-${currentTheme}.png`, animations: "disabled" });
      }
    }
    await page.goto("/dashboard?calendar=agenda");
    if (width < 960) await page.getByRole('button', { name: 'Find something', exact: true }).click();
    const bar = page.locator('.robin-assistant-bar:visible');
    await bar.locator('input').waitFor();
    for (const currentTheme of ["light", "dark", "glass"]) {
      await theme(currentTheme);
      for (const mode of ["search", "execute"]) {
        if (await bar.locator(".robin-assistant-mobile-mode").isVisible()) await bar.locator(".robin-assistant-mobile-mode").selectOption(mode);
        else await bar.locator(`.robin-assistant-modes button`).nth(mode === "search" ? 0 : 1).click();
        await bar.locator("input").fill("Unsent draft");
        assert.equal(await bar.locator('button[type="submit"]').count(), 0, 'Search and execution have no redundant action button');
        const geometry = await bar.evaluate(el => {
          const outer = el.getBoundingClientRect();
          const rowElement = el.querySelector('.robin-assistant-row');
          const row = rowElement.getBoundingClientRect();
          const padding = getComputedStyle(rowElement);
          const button = el.querySelector('form button').getBoundingClientRect();
          const input = el.querySelector("input").getBoundingClientRect();
          const form = el.querySelector("form").getBoundingClientRect();
          return { right: outer.right - button.right, rightInset: parseFloat(padding.paddingRight) + parseFloat(getComputedStyle(el).borderRightWidth), topInset: parseFloat(padding.paddingTop), bottomInset: parseFloat(padding.paddingBottom), top: button.top - row.top, centered: Math.abs((button.top + button.bottom) - (form.top + form.bottom)) < 1, bottom: row.bottom - button.bottom, height: button.height, inputWidth: input.width, scroll: document.documentElement.scrollWidth, viewport: innerWidth };
        });
        assert.equal(geometry.height, 44);
        assert.ok(Math.abs(geometry.right - geometry.rightInset) <= 1, JSON.stringify(geometry));
        assert.equal(geometry.centered, true, JSON.stringify(geometry));
        // Both modes have only a microphone, and phone capture lives in the
        // command dialog with its own close-button inset. Extra row height must
        // centre the action, never erode the specified (at least 8px) padding.
        assert.ok(geometry.topInset >= 8 && geometry.bottomInset >= 8);
        assert.ok(geometry.top >= geometry.topInset && geometry.bottom >= geometry.bottomInset, JSON.stringify(geometry));
        assert.ok(geometry.inputWidth >= 40, `Dashboard input width: ${width}: ${JSON.stringify(geometry)}`);
        assert.ok(geometry.scroll <= geometry.viewport);
      }
      await page.screenshot({ path: `${output}/dashboard-${width}-${currentTheme}.png`, animations: "disabled" });
    }
    assert.deepEqual(writes, [], "Geometry checks never submit or mutate data");
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(`PASS: input action insets, alignment, drafts and narrow streaming layout; screenshots: ${output}`);
} finally { await browser.close(); }
