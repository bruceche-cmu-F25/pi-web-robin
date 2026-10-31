// Browser-only session management checks. All research API calls are mocked; no model or vault writes.
// node --env-file-if-exists=.env.local e2e/research-sessions.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { openResearchNavigation } from "./research-navigation.mjs";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const shots = "/tmp/research-sessions"; mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome", headless: true });
const now = () => new Date().toISOString();
const project = { id: "heat", name: "HEAT", brief: "Compare source evidence.", objective: "Check methods", note: "Preserved notebook", links: [], createdAt: now(), updatedAt: now(), objectiveUpdatedAt: now(), papers: 2, read: 2, needsPdf: 0, messages: 6, hasNotes: true };
const paper = (id) => ({ id, title: `Paper ${id}`, url: `https://example.org/${id}`, pdfUrl: "", authors: [], year: "2026", provider: "Test", abstract: `Abstract ${id}`, source: null,
  status: "read", tags: "", note: "", revision: 1, projectIds: ["heat"], createdAt: now(), updatedAt: now(), messages: [], exports: [],
  analysis: { abstractExplanation: `Explanation ${id}`, summary: `Summary ${id}`, connections: {}, sourceKey: id, coverage: "Abstract only", objective: "", createdAt: now() } });
const papers = [paper("A"), paper("B")];
const session = (id, title, paperId, text) => ({ id, projectId: "heat", title, paperId, kind: paperId ? "paper" : "discussion", default: id.startsWith("paper:") || id === "discussion:heat",
  revision: 0, createdAt: now(), updatedAt: now(), messages: text ? [{ id: `${id}-q`, role: "user", text: `Question ${text}`, paperId, at: now() }, { id: `${id}-a`, role: "assistant", text, paperId, at: now() }] : [] });
const sessions = [session("discussion:heat", "", undefined, "General answer"), session("paper:heat:A", "Paper A", "A", "A-only answer"), session("paper:heat:B", "Paper B", "B", "B-only answer"),
  ...Array.from({ length: 8 }, (_, i) => session(`extra-${i}`, `Extra topic ${i}`, undefined, "")),
  { ...session('other-topic', 'Other project topic', undefined, 'Other project answer'), projectId: 'other' }];
const otherProject = { ...project, id: 'other', name: 'Other project', papers: 0, messages: 1 };
const listReads = [];
let failOtherList = true;
let run = null, finish = null, counter = 0;
const calls = [];
const summary = ({ messages, ...item }) => ({ ...item, messageCount: messages.length });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => { localStorage.setItem("pi-locale", "en"); });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/research/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const path = url.pathname.replace("/api/research/", "");
    const body = method === "GET" ? {} : request.postDataJSON() ?? {};
    const reply = (json, status = 200) => route.fulfill({ status, json });
    if (path === "projects") return reply({ projects: [project, otherProject], activeId: "heat" });
    if (path === "objective") {
      if (method === "PUT") {
        if (body.revision !== JSON.stringify([project.objective, project.note])) return reply({ error: "Notes changed" }, 409);
        Object.assign(project, body);
      }
      return reply({ objective: project.objective, note: project.note, revision: JSON.stringify([project.objective, project.note]), updatedAt: now(), captureState: { captures: [], vaults: [], vaultId: "" } });
    }
    if (path === "papers") {
      if (method === "PATCH") { const found = papers.find((p) => p.id === body.id); Object.assign(found, body.patch, { revision: found.revision + 1 }); return reply({ paper: found }); }
      return url.searchParams.has("id") ? reply({ paper: papers.find((p) => p.id === url.searchParams.get("id")) }) : reply({ papers: papers.map((p) => ({ ...p, hasAnalysis: true, coverage: "abstract", archived: false })) });
    }
    if (path === "sessions") {
      if (method === "POST") {
        const created = session(`topic-${++counter}`, body.title, body.paperId); sessions.push(created);
        return reply({ conversation: summary(created) }, 201);
      }
      if (method === "PATCH") {
        const found = sessions.find((s) => s.id === body.id);
        if (!found || found.revision !== body.revision) return reply({ error: "Conversation changed elsewhere" }, 409);
        if (body.patch.archived && run?.conversationId === found.id) return reply({ error: "Conversation is running" }, 409);
        Object.assign(found, body.patch, { revision: found.revision + 1, updatedAt: now() });
        return reply({ conversation: summary(found) });
      }
      listReads.push(url.searchParams.get('project'));
      if (url.searchParams.get('project') === 'other' && failOtherList) { failOtherList = false; return reply({ error: 'Metadata temporarily unavailable' }, 503); }
      return reply({ sessions: sessions.filter(s => s.projectId === url.searchParams.get('project')).map(summary), run });
    }
    if (path === "agent") {
      if (method === "GET") {
        const id = url.searchParams.get("conversation") || (url.searchParams.get("paper") ? `paper:heat:${url.searchParams.get("paper")}` : "discussion:heat");
        const current = sessions.find((s) => s.id === id);
        if (!current) return reply({ error: "Research conversation not found" }, 404);
        return reply({ messages: current.messages, run, conversation: summary(current), sessions: sessions.filter(s => s.projectId === current.projectId).map(summary), stopped: current.stopped });
      }
      if (method === "DELETE") { if (run) { sessions.find((s) => s.id === run.conversationId).stopped = true; run = null; finish = null; } return reply({ stopped: true }); }
      if (run) return reply({ error: "Already running" }, 409);
      const current = sessions.find((s) => s.id === body.conversationId);
      assert.ok(current); assert.ok(!current.archived);
      calls.push({ ...body, history: structuredClone(current.messages) });
      run = { id: `run-${++counter}`, projectId: "heat", conversationId: current.id, paperId: current.paperId, phase: "reading", detail: "Reading source", sessionId: null, startedAt: now() };
      current.messages.push({ id: `q-${counter}`, role: "user", text: body.question, paperId: current.paperId, at: now() });
      current.updatedAt = now();
      finish = () => { current.messages.push({ id: `a-${counter}`, role: "assistant", text: "Background answer in its own conversation", paperId: current.paperId, at: now() }); current.updatedAt = now(); run = null; finish = null; };
      return reply({ run }, 202);
    }
    return reply({ error: `Unmocked research endpoint: ${method} ${path}` }, 500);
  });
  const manager = () => page.getByRole("navigation", { name: "Research projects" }).getByRole("region", { name: "HEAT", exact: true });
  async function actions() {
    const button = manager().locator('a[aria-current="page"]').locator('..').getByRole('button');
    if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  }
  const composer = () => page.getByLabel("Ask the research agent");
  async function openList(container = manager()) {
    const button = container.getByRole("button", { name: /^Conversations ·|^Search conversations$/ });
    if (await button.getAttribute("aria-expanded") !== "true") await button.click();
  }
  async function choose(title, container = manager()) {
    await openList(container);
    await container.getByRole("searchbox", { name: "Search conversations" }).fill(title);
    const role = await container.locator('[class*="treeSessions"]').count() ? "link" : "button";
    await container.getByRole(role, { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `) }).click();
  }
  await page.goto("/research?project=heat&conversation=paper:heat:A");
  await page.getByText("A-only answer", { exact: true }).waitFor();
  assert.deepEqual(listReads, [], 'collapsed inactive projects do not fetch metadata');
  assert.equal(await manager().locator('[class*="treeSessions"] > li').count(), 6, 'six initial rows, not an unbounded transcript list');
  await manager().getByRole('button', { name: /^Show more/ }).click();
  assert.equal(await manager().locator('[class*="treeSessions"] > li').count(), 11);
  const groupToggle = manager().getByRole('button', { name: /^HEAT/ });
  await groupToggle.focus(); await groupToggle.press('Enter');
  assert.equal(await manager().locator('a[aria-current="page"]').isVisible(), false, 'keyboard collapse');
  await groupToggle.press('Enter');
  assert.equal(await manager().locator('[class*="treeSessions"] > li').count(), 6, 'reopening resets the window');
  const other = page.getByRole('region', { name: 'Other project', exact: true });
  const originalUrl = page.url();
  await other.getByRole('button', { name: /^Other project$/ }).click();
  await other.getByRole('alert').filter({ hasText: 'Metadata temporarily unavailable' }).waitFor();
  await other.getByRole('button', { name: 'Retry', exact: true }).click();
  await other.getByRole('link', { name: /^Other project topic/ }).waitFor();
  assert.deepEqual(listReads, ['other', 'other']);
  assert.equal(page.url(), originalUrl, 'expanding a group does not navigate or start a model');
  await other.getByRole('button', { name: 'Actions for Other project topic', exact: true }).click();
  await other.getByRole('button', { name: 'Rename', exact: true }).click();
  await other.getByRole('textbox', { name: 'Rename', exact: true }).fill('Renamed elsewhere');
  await other.getByRole('button', { name: 'Save', exact: true }).click();
  await other.getByRole('link', { name: /^Renamed elsewhere/ }).waitFor();
  assert.equal(sessions.find(s => s.id === 'paper:heat:A').title, 'Paper A', 'row actions target the row, not the selected conversation');
  assert.equal(calls.length, 0);
  await other.getByRole('link', { name: /^Renamed elsewhere/ }).click();
  await page.getByText('Other project answer', { exact: true }).waitFor();
  await manager().getByRole('link', { name: /^Paper A / }).click();
  await page.getByText('A-only answer', { exact: true }).waitFor();
  assert.equal(await page.getByText("B-only answer", { exact: true }).count(), 0);
  assert.equal(await page.getByText("General answer", { exact: true }).count(), 0);
  await composer().fill("Draft A");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  assert.equal(await composer().isVisible(), false);
  await choose("Paper B");
  await composer().waitFor({ state: "visible" });
  assert.equal(await composer().isVisible(), true, "picking a sidebar conversation opens discussion from any surface");
  await page.getByText("B-only answer", { exact: true }).waitFor();
  assert.equal(await composer().inputValue(), "");
  await composer().fill("Draft B");
  await choose("Paper A");
  await page.getByText("A-only answer", { exact: true }).waitFor();
  assert.equal(await composer().inputValue(), "Draft A");

  await actions();
  await manager().getByRole("button", { name: "Rename", exact: true }).click();
  await manager().getByRole("textbox", { name: "Rename", exact: true }).fill("A methods");
  await manager().getByRole("button", { name: "Save", exact: true }).click();
  await manager().locator('a[aria-current="page"]').filter({ hasText: 'A methods' }).waitFor();
  await manager().getByRole("button", { name: "New conversation in HEAT", exact: true }).click();
  await manager().getByRole("textbox", { name: "Conversation title" }).fill("A ablation study");
  await manager().getByRole("button", { name: "Save", exact: true }).click();
  await manager().locator('a[aria-current="page"]').filter({ hasText: 'A ablation study' }).waitFor();
  assert.equal(await manager().locator('[class*="treeSessions"] > li').count(), 7, 'selected topic outside the six-row window remains visible');
  assert.equal(await composer().inputValue(), "");
  assert.equal(await page.getByText("A-only answer", { exact: true }).count(), 0);
  const topic = sessions.find((s) => s.title === "A ablation study"); assert.equal(topic.paperId, "A");
  await composer().fill("Preserve topic draft");
  await actions();
  await manager().getByRole("button", { name: "Archive conversation", exact: true }).click();
  await manager().getByText(/This conversation is archived/).waitFor();
  assert.equal(await composer().isDisabled(), true);
  await choose("Paper B");
  await page.getByText("B-only answer", { exact: true }).waitFor();
  await openList();
  await manager().getByRole("button", { name: /^Archived ·/ }).click();
  await manager().getByRole("searchbox").fill("A ablation");
  await manager().getByRole("link", { name: /^A ablation study / }).click();
  await actions();
  await manager().getByRole("button", { name: "Restore conversation", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#research-question")?.disabled);
  assert.equal(await composer().inputValue(), "Preserve topic draft");

  await composer().fill("Read this topic only"); await composer().press("Enter");
  await page.getByText("Reading source", { exact: true }).waitFor();
  assert.equal(calls.at(-1).conversationId, topic.id); assert.equal(calls.at(-1).paperId, "A");
  assert.equal(calls.at(-1).history.length, 0);
  // Switch while work is running. Completion must not replace the visible B thread.
  await openList();
  if (await manager().getByRole("button", { name: /^Active conversations ·/ }).count()) await manager().getByRole("button", { name: /^Active conversations ·/ }).click();
  await choose("Paper B");
  await page.getByText("B-only answer", { exact: true }).waitFor();
  await page.getByText(/Another conversation is running/).waitFor();
  assert.equal(await page.getByRole("button", { name: "Ask", exact: true }).isDisabled(), true);
  finish();
  await page.waitForFunction(() => !document.body.textContent.includes("Another conversation is running"));
  assert.equal(await page.getByText("Background answer in its own conversation", { exact: true }).count(), 0);
  await choose("A ablation study");
  await page.getByText("Background answer in its own conversation", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("Background answer in its own conversation", { exact: true }).waitFor();
  await openList();
  await page.screenshot({ path: `${shots}/desktop-management.png` });

  // Phone: same-paper topics are accessible in the reader; switching flushes notes but not another topic's draft.
  await page.setViewportSize({ width: 390, height: 844 });
  await openResearchNavigation(page);
  assert.ok((await manager().locator('a[aria-current="page"]').boundingBox()).height >= 44);
  assert.equal(await manager().locator('a[aria-current="page"]').locator('..').getByRole('button').evaluate(el => getComputedStyle(el).opacity), '1', 'row actions stay visible on phones');
  await actions();
  await manager().getByRole("button", { name: "Open paper →", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Paper A", exact: true });
  await sheet.getByRole("heading", { name: "Paper A", exact: true }).waitFor();
  await sheet.getByText("My notes", { exact: true }).click();
  await sheet.getByRole("textbox", { name: "My notes" }).fill("Keep these paper notes");
  await sheet.getByRole("tab", { name: /^Ask/ }).click();
  const sheetManager = sheet.getByRole("region", { name: "Conversation management" });
  await sheet.getByRole("textbox", { name: "Ask about this paper" }).fill("Paper topic draft");
  await choose("A methods", sheetManager);
  await sheet.getByText("A-only answer", { exact: true }).waitFor();
  assert.equal(papers[0].note, "Keep these paper notes");
  assert.equal(await sheet.getByRole("textbox", { name: "Ask about this paper" }).inputValue(), "");
  await choose("A ablation study", sheetManager);
  await sheet.getByText("Background answer in its own conversation", { exact: true }).waitFor();
  assert.equal(await sheet.getByRole("textbox", { name: "Ask about this paper" }).inputValue(), "Paper topic draft");
  await openList(sheetManager);
  await page.screenshot({ path: `${shots}/phone-management.png` });
  assert.ok(await sheet.evaluate((node) => node.scrollWidth <= node.clientWidth));
  await sheet.getByRole("button", { name: "Back to papers", exact: true }).click();
  await sheet.waitFor({ state: "detached" });
  assert.ok(page.url().includes(`conversation=${topic.id}`));
  await page.goto("/research?project=heat&conversation=missing");
  await page.getByText("Research conversation not found", { exact: true }).waitFor();
  await openResearchNavigation(page);
  await manager().getByRole("link", { name: /Project discussion/ }).click();
  await page.getByRole("button", { name: "Assistant discussion", exact: true }).click();
  await page.getByText("General answer", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(`research sessions e2e passed; screenshots in ${shots}`);
} finally { await browser.close(); }
