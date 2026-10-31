// Existing dev server; all APIs/streams are mocked. Never sends a prompt.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import sharp from "sharp";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const output = "/tmp/glass-chat-scroll";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  for (const theme of ["glass", "glass-dark"]) {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
    if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
    await context.addInitScript(theme => {
      localStorage.setItem("pi-theme", theme); localStorage.setItem("pi-locale", "en");
      window.EventSource = class { readyState = 1; close() {} };
    }, theme);
    const cwd = "/tmp/glass-scroll-fixture", timestamp = "2030-01-01T12:00:00Z";
    const info = { id: "scroll-fixture", cwd, projectKey: cwd, projectRoot: cwd, name: "Scrolling fixture", path: `${cwd}/fixture.jsonl`, created: timestamp, modified: timestamp, messageCount: 2, firstMessage: "First prompt" };
    const fixtures = {
      "/api/home": { home: "/tmp", generalProject: { root: cwd, key: cwd } },
      "/api/sessions": { sessions: [info], runningSessionIds: [], sessionListVersion: 1 },
      "/api/sessions/ui-state": { version: 1, revision: 0, sessions: {}, projects: { [cwd]: { root: cwd } }, projectOrder: [cwd] },
      "/api/agent/running": { runningSessionIds: [], awaitingInputSessionIds: [], sessionListVersion: 1 },
      "/api/models": { models: {}, modelList: [] },
      "/api/worktrees": { isGit: false, worktrees: [], projectRoot: cwd, projectKey: cwd },
      "/api/sessions/scroll-fixture": { info, sessionId: info.id, leafId: "answer", tree: [], context: { messages: [
        { role: "user", content: "First prompt" },
        { role: "assistant", content: [{ type: "text", text: Array.from({ length: 50 }, (_, i) => `## Section ${i}\n\nA continuous reading surface. Paragraph ${i} stays readable while scrolling through the conversation.\n\n[Reference ${i}](https://example.com/#${i})\n\n`).join("") + "Last visible line." }] },
      ], entryIds: ["question", "answer"], hasMore: false, oldestEntryId: "question", thinkingLevel: "off" } },
      "/api/sessions/scroll-fixture/state": { running: false, state: { isStreaming: false } },
      "/api/agent/scroll-fixture": { running: false, state: { isStreaming: false } },
    };
    await context.route("**/api/**", route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path === "/api/cwd/validate") return route.fulfill({ json: { cwd, projectRoot: cwd, projectKey: cwd } });
      if (req.method() !== "GET") {
        assert.ok(path === "/api/agent/scroll-fixture" && ["get_state", "get_tools", "get_commands"].includes(req.postDataJSON()?.type), `Unexpected write: ${path}`);
        return route.fulfill({ json: { success: true, data: { commands: [], isStreaming: false } } });
      }
      return route.fulfill({ json: fixtures[path] ?? {} });
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/?session=scroll-fixture");
    const scroll = page.locator(".chat-transcript-scroll"), input = page.locator(".chat-input-textarea");
    await page.locator("[data-scroll-chrome]").waitFor();
    await input.fill("Unsent draft");
    for (const width of [1440, 812, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);
      const geometry = await scroll.evaluate(el => {
        const r = el.getBoundingClientRect(), h = document.querySelector(".pi-topbar").getBoundingClientRect(), c = document.querySelector(".chat-composer").getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, headerBottom: h.bottom, composerTop: c.top, mask: getComputedStyle(el).maskImage };
      });
      assert.ok(geometry.top < geometry.headerBottom && geometry.bottom > geometry.composerTop, `Messages must extend behind both pieces of chrome: ${JSON.stringify(geometry)}`);
      assert.equal(geometry.mask, "none", "The scrollport must not cut off backdrop sampling");
      await scroll.evaluate(el => el.scrollTop = 0);
      const first = await page.getByText("First prompt", { exact: true }).last().boundingBox();
      assert.ok(first.y >= geometry.headerBottom, "First line clears the header");
      await scroll.evaluate(el => el.scrollTop = el.scrollHeight);
      const last = await page.getByText("Last visible line.", { exact: true }).boundingBox();
      assert.ok(last.y + last.height <= geometry.composerTop + 1, "Last line clears the composer");
      await input.fill("Draft grows\n".repeat(8));
      await page.waitForTimeout(100);
      await scroll.evaluate(el => el.scrollTop = el.scrollHeight);
      assert.ok(await page.getByText("Last visible line.", { exact: true }).evaluate(el => el.getBoundingClientRect().bottom <= document.querySelector(".chat-composer").getBoundingClientRect().top + 1), "Growing drafts update the bottom inset");
      await input.fill("Unsent draft");
      for (const index of [0, 49]) {
        const link = page.getByRole("link", { name: `Reference ${index}`, exact: true });
        await link.focus();
        assert.ok(await link.evaluate(el => {
          const r = el.getBoundingClientRect();
          return r.top >= document.querySelector(".pi-topbar").getBoundingClientRect().bottom
            && r.bottom <= document.querySelector(".chat-composer").getBoundingClientRect().top;
        }), "Keyboard focus is never obscured by the floating chrome");
      }
      const searchButton = page.locator(".pi-topbar").getByRole("button", { name: "Search current session (Ctrl/⌘ F)", exact: true });
      if (!(await searchButton.isVisible())) await page.locator("[data-mobile-toolbar-more]").click();
      await searchButton.click();
      const search = page.locator("[data-session-search-bar]");
      await search.waitFor();
      await page.waitForTimeout(100);
      await scroll.evaluate(el => el.scrollTop = 0);
      assert.ok(await page.getByText("First prompt", { exact: true }).last().evaluate(el => el.getBoundingClientRect().top >= document.querySelector("[data-session-search-bar]").getBoundingClientRect().bottom), "Search chrome is included in the top inset");
      await search.locator("input").press("Escape");
      await scroll.evaluate(el => el.scrollTop = el.scrollHeight / 2);
      await page.screenshot({ path: `${output}/${theme}-${width}.png` });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.setViewportSize({ width: 390, height: 520 });
    await page.evaluate(() => document.documentElement.setAttribute("data-keyboard-open", ""));
    await page.waitForTimeout(100);
    await scroll.evaluate(el => el.scrollTop = el.scrollHeight);
    assert.ok(await page.getByText("Last visible line.", { exact: true }).evaluate(el => el.getBoundingClientRect().bottom <= document.querySelector(".chat-composer").getBoundingClientRect().top + 1), "Keyboard-sized viewport retains the last line");
    await page.evaluate(() => document.documentElement.removeAttribute("data-keyboard-open"));
    // A real coloured backdrop under the topbar/composer must transmit, not
    // merely report backdrop-filter in computed styles. No production content changes.
    await page.setViewportSize({ width: 1440, height: 900 });
    await scroll.evaluate(el => { el.scrollTop = el.scrollHeight / 2; el.firstElementChild.style.background = "#ed365b"; });
    const capture = async () => sharp(await page.screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const red = await capture();
    await scroll.evaluate(el => el.firstElementChild.style.background = "#2679ef");
    const blue = await capture();
    const points = await page.evaluate(() => [".pi-topbar", ".chat-input-surface"].map(selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { x: Math.round(r.left + r.width * .55), y: Math.round(r.top + r.height - 8) };
    }));
    for (const { x, y } of points) {
      const index = (y * red.info.width + x) * red.info.channels;
      const difference = [0, 1, 2].reduce((sum, c) => sum + Math.abs(red.data[index + c] - blue.data[index + c]), 0);
      assert.ok(difference > 25, `Chrome must show underlying message colour (${difference})`);
    }
    await scroll.evaluate(el => el.firstElementChild.style.background = "");
    await page.emulateMedia({ contrast: "more" });
    assert.equal(await page.locator(".chat-composer").evaluate(el => getComputedStyle(el, "::before").backdropFilter), "none");
    await page.emulateMedia({ contrast: "no-preference" });
    // Switching out of Glass restores the original layout without remounting the draft.
    await input.evaluate(el => { el.draftMarker = true; });
    await page.evaluate(() => document.documentElement.dataset.theme = "light");
    await page.waitForTimeout(100);
    assert.ok(await scroll.evaluate(el => el.getBoundingClientRect().top >= document.querySelector(".pi-topbar").getBoundingClientRect().bottom));
    assert.equal(await input.inputValue(), "Unsent draft");
    assert.equal(await input.evaluate(el => el.draftMarker), true);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${theme}: continuous backdrop, visible first/last lines, resizing drafts, 320–1440px, contrast fallback and unchanged non-Glass layout`);
  }
} finally { await browser.close(); }
