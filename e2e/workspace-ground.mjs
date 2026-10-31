// Existing dev server; all application APIs are fixtures. No personal data or model calls.
// node --env-file-if-exists=.env.local e2e/workspace-ground.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { fullstackPlan, practicePlan } from "../extension/robin/learning.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const shots = "/tmp/workspace-ground";
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
const now = "2026-10-27T12:00:00Z";
const draft = { id: "ground", title: "A shared background", text: "# Reading stays on paper\n\nThe workspace does not add another white wash.", notionParentId: "", updatedAt: now };
const idea = { id: "ground", name: "Ground fixture", note: "Product notes keep their reading surface.", step: "spot", links: [], createdAt: now, updatedAt: now };
const note = { path: "Sample.md", title: "Sample", links: [], unresolved: [], modified: now, excerpt: "Cards keep a readable surface; the space between them shares the global ground." };
const project = { id: "ground", name: "Research fixture", brief: "A question with a readable notebook.", objective: "Check one hypothesis", note: "## Evidence\n\nReading stays on paper.", links: [], createdAt: now, updatedAt: now, papers: 0, needsPdf: 0, read: 0, messages: 0, hasNotes: true };
const errors = [], writes = [];
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => { localStorage.setItem("pi-locale", "en"); localStorage.setItem("pi-theme", "glass"); });
  await context.route("**/api/**", route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (request.method() !== "GET") {
      writes.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 409, json: { error: "No writes in appearance checks" } });
    }
    if (path === "/api/robin/obsidian/vault") return route.fulfill({ json: url.searchParams.has("path")
      ? { note: { ...note, content: "# Reading surface\n\nKeep this opaque.", url: "obsidian://open?vault=fixture&file=Sample" } }
      : url.searchParams.has("vaultId") ? { notes: [note], limited: false, skipped: 0 }
        : { vaults: [{ id: "fixture", name: "Fixture vault", path: "/fixture" }] } });
    const projectId = url.searchParams.get("project") || "general";
    const fixtures = {
      "/api/models": { modelList: [{ provider: "test", id: "test", name: "Test model" }], defaultModel: { provider: "test", modelId: "test" } },
      "/api/robin/learning": { practice: practicePlan([], "neetcode150", "2026-10-27"), fullstack: fullstackPlan([]) },
      "/api/robin/notes": { drafts: [draft] },
      "/api/robin/canvases": { canvases: [] },
      "/api/robin/notes/attachments": { attachments: [] },
      "/api/robin/products": { ideas: [idea], captures: [] },
      "/api/robin/product-library": { resources: [] },
      "/api/robin/validation": { initialized: false, projects: [] },
      "/api/research/projects": { projects: [project], activeId: "general" },
      "/api/research/objective": { objective: project.objective, note: project.note, revision: "fixture", captureState: { captures: [], vaults: [], vaultId: "" } },
      "/api/research/papers": { papers: [] },
      "/api/research/agent": { messages: [], run: null, sessions: [], conversation: { id: `discussion:${projectId}`, projectId, title: "Fixture", revision: 0, kind: "discussion", default: true, messageCount: 0, createdAt: now, updatedAt: now } },
      "/api/research/sessions": { sessions: [], run: null },
    };
    return route.fulfill({ json: fixtures[path] ?? { records: [], finals: {}, resources: [], opportunities: [], todos: [], events: [], jobs: [], rounds: [], links: [], pages: [], vaults: [], review: null } });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const baseline = new Map();
  for (const [name, url, ready, paper] of [
    ["learn", "/learn", ".pi-card", ".pi-card"],
    ["notes", "/notes?draft=ground", "main textarea", '[class*="sheetHead"]'],
    ["obsidian", "/obsidian", 'button[aria-label="Sample · Sample.md"]', 'button[aria-label="Sample · Sample.md"]'],
    ["research", "/research", "#research-home-overview", "#research-home-overview"],
    ["research-project", "/research?project=ground", "#research-focus", "#research-view-overview"],
    ["product", "/product?idea=ground", "#product-notebook-ground textarea", '[class*="__readingPane"]'],
  ]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(url);
    await page.locator(ready).first().waitFor();
    const materialWorkspace = name.startsWith("research") || name === "product";
    for (const width of [1440, 375, 320, 812]) {
      await page.setViewportSize({ width, height: width === 812 ? 375 : 1000 });
      for (const theme of ["glass", "glass-dark"]) {
        await page.evaluate(value => {
          document.documentElement.dataset.theme = value;
          document.documentElement.classList.toggle("dark", value === "glass-dark");
        }, theme);
        const result = await page.locator(".robin-workspace-ground").evaluateAll(nodes => ({
          // Inspect the whole ancestor chain too: an unmarked layout wrapper
          // can repaint an opaque grid even when every page root is clear.
          layers: nodes.flatMap(el => {
            const layers = [];
            for (let node = el; node && !node.classList.contains("robin-shell"); node = node.parentElement) {
              const css = getComputedStyle(node);
              layers.push([css.backgroundColor, css.backgroundImage, css.backdropFilter]);
            }
            return layers;
          }),
          backdrop: (() => { const css = getComputedStyle(document.querySelector(".robin-shell")); return [css.backgroundColor, css.backgroundImage]; })(),
        }));
        assert.ok(result.layers.length > 0);
        for (const layer of result.layers) assert.deepEqual(layer, ["rgba(0, 0, 0, 0)", "none", "none"], `${name}/${theme}: layout does not repaint the ground`);
        const key = `${width}/${theme}`;
        if (name === "learn") baseline.set(key, result.backdrop);
        else assert.deepEqual(result.backdrop, baseline.get(key), `${name}: same underlying backdrop as Learning`);
        const surface = name === "notes" ? page.locator(paper).locator("..") : page.locator(paper).first();
        assert.notEqual(await surface.evaluate(el => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)", `${name}: preserve the reading surface`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}/${width}: no overflow`);
        if (materialWorkspace) {
          const tabs = page.locator(".robin-workspace-view-switch");
          assert.ok(await tabs.evaluate(el => {
            const css = getComputedStyle(el);
            return css.backdropFilter !== "none" && parseFloat(css.borderRadius) >= 24 && el.scrollWidth <= el.clientWidth + 1;
          }), `${name}/${width}: bounded glass navigation`);
          for (const button of await tabs.getByRole("button").all()) {
            assert.ok(await button.evaluate(el => el.getBoundingClientRect().height >= 44 && el.scrollWidth <= el.clientWidth + 1), "44px controls, no clipped labels");
          }
          for (const rail of await page.locator(".robin-workspace-rail:visible").all()) {
            assert.ok(await rail.evaluate(el => {
              const css = getComputedStyle(el);
              return css.backdropFilter === "blur(10px)" && css.backgroundImage === "none" && !el.hasAttribute("data-glass-refraction") && parseFloat(css.borderRadius) === 24;
            }), "directories/resources use CSS frost, never a large displacement map");
          }
          assert.equal(await surface.evaluate(el => getComputedStyle(el).backdropFilter), "none", "no filter on documents");
          assert.ok(await page.locator("main").evaluateAll(nodes => nodes.every(el => el.scrollWidth <= el.clientWidth + 1)), "no overflow hidden in reading scrollports");
        }
        if (width !== 320) await page.screenshot({ path: `${shots}/${name}-${theme}-${width}.png` });
      }
    }
    // Accessibility removes texture at the common source, not via a per-page wash.
    await page.emulateMedia({ contrast: "more" });
    assert.equal(await page.locator(".robin-shell").evaluate(el => getComputedStyle(el).backgroundImage), "none");
    if (materialWorkspace) {
      for (const rail of await page.locator(".robin-workspace-rail:visible").all()) {
        assert.equal(await rail.evaluate(el => getComputedStyle(el).backdropFilter), "none", "contrast preference disables frost");
      }
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
      for (const rail of await page.locator(".robin-workspace-rail:visible").all()) {
        assert.ok(await rail.evaluate(el => {
          const css = getComputedStyle(el);
          return css.backdropFilter === "none" && !css.backgroundColor.startsWith("rgba");
        }), "reduced transparency uses solid rails");
      }
      await cdp.send("Emulation.setEmulatedMedia", { features: [] });
      await cdp.detach();
    }
    await page.emulateMedia({ contrast: "no-preference", reducedMotion: "reduce" });
    if (materialWorkspace) {
      await page.setViewportSize({ width: 375, height: 900 });
      if (name === "product") {
        const toggle = page.getByRole("button", { name: "Projects", exact: true });
        await toggle.click();
        const directory = page.getByRole("navigation", { name: "Product workspace" });
        await directory.getByRole("button", { name: "Opportunities", exact: true }).focus();
        await page.keyboard.press("Escape");
        assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        assert.ok(await toggle.evaluate(el => el === document.activeElement), "Escape returns focus to the directory trigger");
        await toggle.click();
        await directory.getByRole("button", { name: "Product map", exact: true }).click();
        assert.ok(await page.locator("main").evaluate(el => el === document.activeElement), "closing navigation does not leave focus hidden");
        await page.goBack();
        await page.locator("#product-notebook-ground textarea").waitFor();
        const tabs = page.getByRole("navigation", { name: "Project views" });
        await tabs.getByRole("button", { name: "Outreach", exact: true }).click();
        await page.getByRole("heading", { name: "Outreach stays as it is" }).waitFor();
        await page.goBack();
        await page.locator("#product-notebook-ground textarea").waitFor();
        await page.getByRole("button", { name: "Brainstorm partner", exact: true }).click();
        await page.getByRole("complementary", { name: "Brainstorm partner", exact: true }).waitFor();
        await page.getByRole("button", { name: "Hide partner", exact: true }).click();
      } else {
        const trigger = page.getByRole("button", { name: /^Research projects ·/ });
        await trigger.click();
        await page.getByRole("navigation", { name: "Research projects", exact: true }).getByRole("button").first().focus();
        await page.keyboard.press("Escape");
        assert.equal(await trigger.getAttribute("aria-expanded"), "false");
        assert.ok(await trigger.evaluate(el => el === document.activeElement));
        const tabs = page.locator(".robin-workspace-view-switch");
        await tabs.getByRole("button", { name: "Assistant discussion", exact: true }).click();
        const composer = page.locator('[id$="-assistant"]:visible textarea').first();
        await composer.fill("Unsent fixture draft");
        await tabs.getByRole("button", { name: "Papers", exact: true }).click();
        await page.goBack();
        assert.equal(await composer.inputValue(), "Unsent fixture draft", "view/history changes retain the composer without sending");
      }
      for (const theme of ["light", "dark"]) {
        await page.evaluate(value => {
          document.documentElement.dataset.theme = value;
          document.documentElement.classList.toggle("dark", value === "dark");
        }, theme);
        assert.equal(await page.locator(".robin-workspace-view-switch").evaluate(el => getComputedStyle(el).backdropFilter), "none", "ordinary palettes remain unfiltered");
      }
    }
    if (name === "obsidian") {
      await page.goto("/obsidian?vault=fixture&note=Sample.md&view=read");
      await page.locator("article .markdown-body").waitFor();
      assert.equal(await page.locator("article").evaluate(el => el.parentElement.classList.contains("robin-workspace-ground")), false, "Full reading is not structural ground");
      assert.notEqual(await page.locator("article").evaluate(el => getComputedStyle(el.parentElement).backgroundColor), "rgba(0, 0, 0, 0)");
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  console.log(`PASS: Shared Glass ground, frosted directories/resources, clear workspace tabs, opaque reading, 320–1440px/landscape, accessible fallbacks, navigation focus/history and retained discussion drafts. Screenshots: ${shots}`);
} finally { await browser.close(); }
