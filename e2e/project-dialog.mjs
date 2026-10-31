// Existing dev server; every application API is mocked after login. No personal-data writes.
// node --env-file-if-exists=.env.local e2e/project-dialog.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
const now = "2026-10-27T12:00:00Z";
const original = { id: "heat", name: "HEAT", brief: "Original question", objective: "", note: "", links: [], createdAt: now, updatedAt: now, papers: 0, read: 0, needsPdf: 0, hasNotes: false };
const conversation = { id: "discussion:heat", projectId: "heat", title: "Discussion", revision: 0, kind: "discussion", messageCount: 0, createdAt: now, updatedAt: now };
try {
  for (const touch of [false, true]) {
    const context = await browser.newContext({ baseURL, viewport: touch ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: touch, isMobile: touch, serviceWorkers: "block", reducedMotion: "reduce" });
    if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
    await context.addInitScript(() => { localStorage.setItem("pi-locale", "en"); localStorage.setItem("pi-theme", "light"); });
    let project = { ...original }, fail = true, release;
    const gate = new Promise(resolve => { release = resolve; });
    const writes = [], unexpected = [], errors = [];
    await context.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (request.method() === "PATCH" && path === "/api/research/projects") {
        const body = request.postDataJSON(); writes.push(body);
        await gate;
        if (fail) return route.fulfill({ status: 503, json: { error: "Test save failed — retry" } });
        project = { ...project, ...body.patch };
        return route.fulfill({ json: { project } });
      }
      if (request.method() !== "GET") { unexpected.push(`${request.method()} ${path}`); return route.fulfill({ status: 405, json: { error: "Unmocked write blocked" } }); }
      const fixtures = {
        "/api/research/projects": { projects: [project], activeId: "heat" },
        "/api/research/objective": { objective: "", note: "", revision: "fixture", captureState: { captures: [], vaults: [], vaultId: "" } },
        "/api/research/papers": { papers: [] },
        "/api/research/agent": { messages: [], run: null, conversation, sessions: [conversation] },
        "/api/research/sessions": { sessions: [conversation], run: null },
      };
      return route.fulfill({ json: fixtures[path] ?? {} });
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/research?project=heat");
    const trigger = page.getByRole("button", { name: "Edit project", exact: true }).first();
    const dialog = page.getByRole("dialog", { name: "Edit project", exact: true });
    const name = dialog.getByRole("textbox", { name: "Name", exact: true });
    await trigger.click(); await dialog.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), touch ? "H2" : "INPUT", "choose native initial focus without flashing the software keyboard");
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true, "closing restores the trigger");
    await trigger.click(); await name.fill("Unsaved title");
    const confirmDiscard = action => {
      const handled = new Promise(resolve => page.once("dialog", async prompt => { assert.equal(prompt.type(), "confirm"); assert.match(prompt.message(), /unsaved/i); await prompt.dismiss(); resolve(); }));
      return Promise.all([action(), handled]);
    };
    await confirmDiscard(() => dialog.getByRole("button", { name: "Cancel", exact: true }).click());
    assert.equal(await name.inputValue(), "Unsaved title");
    await confirmDiscard(() => page.keyboard.press("Escape"));
    await confirmDiscard(() => dialog.getByRole("button", { name: "Archive project", exact: true }).click());
    assert.equal(writes.length, 0);
    await name.fill("HEAT"); await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    await trigger.click(); await name.fill("Saved title");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.getByRole("status").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), true, "pending save cannot be dismissed by Escape");
    assert.equal(await name.getAttribute("readonly"), "");
    assert.equal(await dialog.getByRole("button", { name: "Cancel", exact: true }).isDisabled(), true);
    release(); await dialog.getByRole("alert").waitFor();
    assert.equal(await name.inputValue(), "Saved title");
    assert.equal(await name.getAttribute("readonly"), null);
    await confirmDiscard(() => page.keyboard.press("Escape"));
    assert.equal(await dialog.isVisible(), true, "declining discard after a failed save keeps the dialog open");
    fail = false;
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(writes.length, 2, "one failed request and one explicit retry");
    assert.equal(project.name, "Saved title");
    await trigger.click(); await name.fill("Discard me");
    page.once("dialog", prompt => prompt.accept());
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(project.name, "Saved title", "discard never writes");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Project dialog passed: desktop/touch focus, cancel/Escape/discard, archive guard, slow/failed saves and explicit retry; all API writes mocked.");
} finally { await browser.close(); }
