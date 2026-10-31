// Existing server. All application APIs are intercepted after login; no real sends or writes.
// node --env-file-if-exists=.env.local e2e/design-navigation.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { fullstackPlan, practicePlan } from "../extension/robin/learning.ts";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const shots = "/tmp/pi-design-fixes"; mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
const now = "2026-10-27T12:00:00Z";
const project = { id: "heat", name: "HEAT", brief: "Compare evidence for retrieval methods.", objective: "Check the baseline", note: "Preserved notebook", links: [{ title: "Experiment sheet", url: "https://docs.google.com/spreadsheets/d/test/edit" }], reference: "heat", createdAt: now, updatedAt: now, objectiveUpdatedAt: now, papers: 0, needsPdf: 0, read: 0, messages: 0, hasNotes: true };
const conversation = { id: "discussion:heat", projectId: "heat", title: "Methods discussion", revision: 0, kind: "discussion", messageCount: 0, createdAt: now, updatedAt: now };
const lead = { id: "demo", revision: 1, name: "Example Operator", company: "Example Brand", role: "Founder", seniority: "Owner", industry: "Retail", segment: "clinic", status: "new", profileUrl: "https://example.org/profile", evidence: "Public operator profile", evidenceUrl: "https://example.org", needHypothesis: "Compare operational changes", email: "operator@example.org", emailSource: "https://example.org", emailQuote: "operator@example.org", emailCheck: "source_found", opener: "Hello", subject: "Feedback", body: "Sample message, never sent", interviewNote: "", reviewed: false, createdAt: now, updatedAt: now, outreachWorkflow: { stage: "review", at: now } };
const fixtures = {
  "/api/research/projects": { projects: [project], activeId: "heat" },
  "/api/research/objective": { objective: project.objective, note: project.note, revision: JSON.stringify([project.objective, project.note]), captureState: { captures: [], vaults: [], vaultId: "" } },
  "/api/research/papers": { papers: [] },
  "/api/research/agent": { messages: [], run: null, conversation, sessions: [conversation] },
  "/api/research/sessions": { sessions: [conversation], run: null },
  "/api/robin/jarvis": { leads: [lead], template: { subject: "Hello", body: "Sample template" }, run: null, outbox: { enabled: false }, daily: { enabled: false, count: 15, hour: 6 } },
  "/api/robin/google": { configured: true, connected: true, email: "sender@example.org", canSendGmail: true },
  "/api/robin/todos": { todos: [], today: "2026-10-27" },
  "/api/robin/kanban": { capacity: [], google: { connected: false }, options: {} },
  "/api/robin/events": { events: [], today: "2026-10-27", google: { connected: false } },
  "/api/robin/tech-events": { events: [], today: "2026-10-27" },
  "/api/robin/jobs": { jobs: [] },
  "/api/robin/gmail": { review: null, connected: false },
  "/api/robin/practice": { records: [] },
  "/api/robin/rounds": { rounds: [] },
  "/api/robin/notes-agent": { finals: {} },
  "/api/robin/links": { links: [] },
  "/api/robin/learning": { practice: practicePlan([], "neetcode150", "2026-10-27"), fullstack: fullstackPlan([]) },
};
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => { localStorage.setItem("pi-locale", "en"); localStorage.setItem("pi-theme", "light"); });
  const writes = [], errors = [];
  await context.route("**/api/**", route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== "GET") { writes.push(`${request.method()} ${path}`); return route.fulfill({ status: 409, json: { error: "Writes blocked in design regression" } }); }
    return route.fulfill({ json: fixtures[path] ?? {} });
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  const view = name => page.locator("main nav").getByRole("button", { name, exact: true });
  const selected = async name => { await page.waitForFunction(name => [...document.querySelectorAll('main nav button[aria-pressed="true"]')].some(el => el.textContent.trim() === name), name); };
  const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "page must not overflow horizontally");
  await page.goto("/research?project=heat&conversation=discussion:heat");
  const composer = page.getByLabel("Ask the research agent");
  await composer.fill("Keep this unsent draft");
  await view("Papers").click(); await selected("Papers");
  assert.equal(new URL(page.url()).searchParams.get("view"), "papers");
  await page.goBack(); await selected("Assistant discussion");
  assert.equal(await composer.inputValue(), "Keep this unsent draft");
  await page.goForward(); await selected("Papers");
  await view("Overview").click(); await selected("Overview");
  await page.reload(); await selected("Overview");
  await view("Papers").click(); await page.reload(); await selected("Papers");
  const resources = page.getByRole("complementary", { name: "Resources & shortcuts" });
  assert.equal(await resources.locator("details").first().getAttribute("open"), "", "desktop resources start expanded");
  const sheetLink = resources.getByRole("link", { name: /Experiment sheet/ });
  assert.equal(await sheetLink.getAttribute("href"), project.links[0].url);
  assert.equal(await page.locator('a[href^="/research/"]').count(), 0, "no retired reference links");
  const resourceBox = await resources.boundingBox(), contentBox = await page.locator('#research-view-papers').boundingBox();
  assert.ok(resourceBox.x >= contentBox.x + contentBox.width, "resources sit in the right column");
  await view("Assistant discussion").click(); await selected("Assistant discussion");
  assert.equal(await sheetLink.isVisible(), true, "resources remain available beside discussion");
  await view("Papers").click(); await selected("Papers");
  await page.screenshot({ path: `${shots}/research-desktop.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await view("Overview").click(); await selected("Overview");
  const navigation = page.getByRole("navigation", { name: "Research projects", exact: true });
  const trigger = page.getByRole("button", { name: "Research projects · HEAT", exact: true });
  assert.equal(await navigation.isVisible(), false);
  assert.equal(await sheetLink.isVisible(), false, "mobile resources start folded");
  const resourceToggle = resources.locator('summary').first();
  await resourceToggle.focus(); await resourceToggle.press("Enter");
  assert.equal(await sheetLink.isVisible(), true, "resources are keyboard accessible");
  await resourceToggle.press("Enter");
  const focus = await page.locator("#research-focus").boundingBox();
  assert.ok(focus.y < 650, `goal begins in the mobile first screen, got ${focus.y}`);
  await trigger.click(); assert.equal(await navigation.isVisible(), true);
  await page.keyboard.press("Escape"); assert.equal(await navigation.isVisible(), false);
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  await trigger.click(); await navigation.getByRole("link", { name: /^Methods discussion/ }).click();
  await selected("Assistant discussion");
  assert.equal(await navigation.isVisible(), false, "selection closes phone navigation");
  await view("Overview").click(); await selected("Overview");
  await noOverflow(); await page.screenshot({ path: `${shots}/research-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(await navigation.isVisible(), true, "desktop navigation remains present after resizing");

  for (const path of ["/research/heat", "/research/brief", "/research/report", "/research/code", "/research/run", "/research/urrag", "/learn/map", "/design/rounded-surfaces.html", "/prototypes/global-sidebar.html", "/prototypes/learning-atlas.html"]) {
    assert.equal((await context.request.get(path)).status(), 404, `${path} is retired`);
  }
  for (const path of ["/learn/gpt2", "/learn/watch"]) assert.equal((await context.request.get(path)).status(), 200, `${path} remains available`);
  await page.goto("/learn");
  const learningRail = page.locator('aside').filter({ has: page.locator('a[href="/learn/gpt2"]') });
  await learningRail.getByRole("link", { name: /GPT-2/ }).waitFor();
  assert.equal(await learningRail.locator('a[href="/learn/watch"]').count(), 1);
  assert.equal(await page.locator('a[href="/learn/map"]').count(), 0);
  const learningBox = await learningRail.boundingBox(), dailyBox = await page.locator('#fullstack-open').boundingBox();
  assert.ok(learningBox.x >= dailyBox.x + dailyBox.width, "learning entry points sit to the right of daily work");
  await page.screenshot({ path: `${shots}/learning-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await learningRail.locator('a[href="/learn/gpt2"]').waitFor({ state: "hidden" });
  await learningRail.locator('summary').first().click();
  assert.equal(await learningRail.locator('a[href="/learn/gpt2"]').isVisible(), true);
  await noOverflow(); await page.screenshot({ path: `${shots}/learning-mobile.png` });
  await learningRail.locator('summary').first().click();
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto("/outreach/research?view=review");
  const queue = page.getByRole("region", { name: "Review queue", exact: true });
  await queue.getByRole("textbox", { name: "Message", exact: true }).fill("Preserved review draft");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("navigation", { name: "Outreach workflow" }).getByRole("button", { name: /^3 · Send queue/ }).click();
  assert.equal(new URL(page.url()).searchParams.get("view"), "review", "cancel keeps the URL and editor");
  assert.equal(await queue.getByRole("textbox", { name: "Message", exact: true }).inputValue(), "Preserved review draft");
  await page.setViewportSize({ width: 390, height: 844 });
  const picker = page.getByRole("combobox", { name: "Workspace", exact: true });
  assert.equal(await picker.locator("option").count(), 8);
  page.once("dialog", dialog => dialog.dismiss()); await picker.selectOption("send");
  assert.equal(await picker.inputValue(), "review", "phone picker uses the same discard guard");
  page.once("dialog", dialog => dialog.accept()); await picker.selectOption("send");
  await page.getByRole("region", { name: "Send queue", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("view"), "send");
  await page.reload(); await page.getByRole("region", { name: "Send queue", exact: true }).waitFor();
  assert.equal(await picker.inputValue(), "send");
  assert.ok((await page.getByRole("region", { name: "Send queue", exact: true }).boundingBox()).y < 650, "queue begins in the mobile first screen");
  await noOverflow(); await page.screenshot({ path: `${shots}/crm-mobile.png` });
  await picker.selectOption("contacts"); await page.screenshot({ path: `${shots}/crm-contacts-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("navigation", { name: "Outreach workflow" }).getByRole("button", { name: /^2 · Review queue/ }).click();
  await queue.waitFor(); await page.screenshot({ path: `${shots}/crm-desktop.png` });
  assert.ok((await page.locator('.robin-nav-entry[aria-current="page"]').getAttribute("href")).startsWith("/product"));
  await page.addInitScript(() => { localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-theme", "dark"); });
  await page.setViewportSize({ width: 320, height: 812 });
  await page.reload(); await page.getByRole("region", { name: "Review queue", exact: true }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "工作区", exact: true }).inputValue(), "review");
  await noOverflow(); await page.screenshot({ path: `${shots}/crm-narrow-zh-dark.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/dashboard/kanban");
  await page.locator('.robin-nav-entry[aria-current="page"]').waitFor();
  assert.ok((await page.locator('.robin-nav-entry[aria-current="page"]').getAttribute("href")).startsWith("/dashboard"));
  await page.goto("/tools");
  assert.equal(await page.locator('main header a').first().getAttribute("href"), "/dashboard");
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  console.log(`Design navigation regression passed (desktop + mobile); screenshots: ${shots}`);
} finally { await browser.close(); }
