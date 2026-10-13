// Against an existing dev server; note APIs are mocked, so no real drafts are changed.
// node --env-file-if-exists=.env.local e2e/notes-layout.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  if (process.env.PI_WEB_PASSWORD) {
    const login = await context.request.post("/api/web-auth", {
      headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD },
    });
    assert.ok(login.ok(), `Login failed (${login.status()})`);
  }
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const draft = { id: "layout-fixture", title: "Layout fixture", text: "# Heading\n\nA note that must survive folding the library.", notionParentId: "", updatedAt: new Date().toISOString() };
  await page.route("**/api/robin/notes", (route) => route.fulfill({ json: { drafts: [draft] } }));
  await page.route("**/api/robin/notes/attachments?*", (route) => route.fulfill({ json: { attachments: [] } }));
  let releaseReply;
  await page.route("**/api/robin/notes-agent", async (route) => {
    if (route.request().method() === "POST") {
      await new Promise((resolve) => { releaseReply = resolve; });
      return route.fulfill({ json: { reply: "Reply finished while hidden", sessionId: "layout-agent" } });
    }
    return route.fulfill({ json: { finals: {} } });
  });
  await page.route("**/api/robin/notion", (route) => route.fulfill({ json: { pages: [] } }));
  await page.route("**/api/models", (route) => route.fulfill({ json: {
    modelList: [{ provider: "test", id: "test-model", name: "Test model" }],
    defaultModel: { provider: "test", modelId: "test-model" },
  } }));
  await page.goto("/notes?draft=layout-fixture");
  const toggle = page.locator('button[aria-controls="notes-library"]');
  const library = page.locator("#notes-library");
  const note = page.locator('main[class*="notePane"]');
  const agent = page.locator('section[class*="agentPane"]');
  const agentToggle = page.locator('button[aria-controls="notes-agent"]');
  const agentInput = agent.locator("textarea");
  const editor = note.locator("textarea");
  await editor.waitFor();
  await page.waitForFunction(() => document.querySelector('main textarea')?.value.includes("A note"));

  const checkColumns = async () => {
    const n = await note.boundingBox();
    const a = await agent.boundingBox();
    assert.ok(n && a && a.x >= n.x + n.width - 1, "Agent must be beside, not below, the note");
    assert.ok(Math.abs(n.y - a.y) < 1 && Math.abs(n.height - a.height) < 1, "Both columns use full height");
    assert.ok(n.width >= 400 && a.width >= 300, "Both columns retain usable widths");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  };
  if (process.env.E2E_SCREENSHOT) await page.screenshot({ path: process.env.E2E_SCREENSHOT });
  for (const width of [1440, 960]) {
    await page.setViewportSize({ width, height: 900 });
    await checkColumns();
    const expandedWidth = (await note.boundingBox()).width;
    await toggle.focus();
    await page.keyboard.press("Enter");
    await library.waitFor({ state: "hidden" });
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.ok((await note.boundingBox()).width > expandedWidth, "Folding releases the library's space");
    assert.equal(await editor.inputValue(), draft.text);
    await checkColumns();
    await page.keyboard.press("Enter");
    await library.waitFor({ state: "visible" });
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    assert.equal(await agentToggle.evaluate((el) => el.getBoundingClientRect().right <= innerWidth), true, "Agent toggle stays reachable on narrow desktops");
    await agentInput.fill("Keep this agent draft");
    const widthWithAgent = (await note.boundingBox()).width;
    await agentToggle.focus();
    await page.keyboard.press("Enter");
    await agent.waitFor({ state: "hidden" });
    assert.equal(await agentToggle.getAttribute("aria-expanded"), "false");
    assert.ok((await note.boundingBox()).width > widthWithAgent, "Folding releases the agent's column");
    assert.equal(await agent.count(), 1, "Agent stays mounted");
    await page.keyboard.press("Enter");
    await agent.waitFor({ state: "visible" });
    assert.equal(await agentInput.inputValue(), "Keep this agent draft");
    await checkColumns();
  }
  const sent = page.waitForRequest((request) => request.url().includes("/api/robin/notes-agent") && request.method() === "POST");
  await agentInput.press("Enter");
  await sent;
  await agentToggle.click();
  await agent.waitFor({ state: "hidden" });
  releaseReply();
  await page.waitForFunction(() => document.querySelector("#notes-agent")?.textContent.includes("Reply finished while hidden"));
  assert.equal(await agent.isVisible(), false, "Replies must not reopen a folded panel");
  await agentToggle.click();
  await agent.getByText("Reply finished while hidden", { exact: true }).waitFor();
  // Folding on desktop must not hide either panel's separate tab on a phone.
  await toggle.click();
  await agentToggle.click();
  for (const width of [375, 844]) {
    await page.setViewportSize({ width, height: 700 });
    const tabs = page.getByRole("tablist").getByRole("tab");
    await tabs.nth(0).click();
    await library.waitFor({ state: "visible" });
    assert.equal(await note.isVisible(), false);
    await tabs.nth(2).click();
    await agent.waitFor({ state: "visible" });
    assert.equal(await library.isVisible(), false);
    assert.equal(await note.isVisible(), false);
    await tabs.nth(1).click();
    await note.waitFor({ state: "visible" });
    assert.equal(await agent.isVisible(), false);
    assert.equal(await editor.inputValue(), draft.text);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  assert.deepEqual(errors, []);
  console.log("PASS: Notes columns, keyboard library/agent toggles, draft and in-flight reply preservation, and mobile tabs");
} finally {
  await browser.close();
}
