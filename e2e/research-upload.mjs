// All Research routes are mocked. No paid model calls or personal library/vault writes.
// node --env-file-if-exists=.env.local e2e/research-upload.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const shots = "/tmp/research-upload"; mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
const now = () => new Date().toISOString();
const projects = [{ id: "heat", name: "HEAT", brief: "Study local PDFs", objective: "Old focus", note: "Keep my notes", links: [], createdAt: now(), updatedAt: now(), objectiveUpdatedAt: now(), papers: 0, read: 0, needsPdf: 0, messages: 0, hasNotes: true }];
const papers = [], turns = [], uploads = [], errors = [];
let run = null, rejectRead = false, rejectUpload = false, slowUpload = null, holdReplies = false, finishReading = null;
const conversations = new Map();
function conversation(projectId, paperId) {
  const id = paperId ? `paper:${projectId}:${paperId}` : `discussion:${projectId}`;
  if (!conversations.has(id)) conversations.set(id, { id, projectId, paperId, title: paperId ? papers.find(p => p.id === paperId)?.title : "Discussion", kind: paperId ? "paper" : "discussion", default: true, revision: 0, messageCount: 0, createdAt: now(), updatedAt: now(), messages: [] });
  return conversations.get(id);
}
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => { if (!localStorage.getItem("pi-locale")) localStorage.setItem("pi-locale", "en"); });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/research/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.slice("/api/research/".length);
    const body = req.headers()["content-type"]?.includes("application/json") ? req.postDataJSON() : {};
    const reply = (json, status = 200) => route.fulfill({ json, status });
    if (path === "projects") return reply({ projects, activeId: "heat" });
    if (path === "objective") {
      const project = projects[0];
      if (req.method() === "PUT") Object.assign(project, body);
      return reply({ objective: project.objective, note: project.note, revision: JSON.stringify([project.objective, project.note]), updatedAt: now(), captureState: { captures: [], vaults: [], vaultId: "" } });
    }
    if (path === "papers/source") {
      const form = req.postDataBuffer().toString();
      const projectId = form.match(/name="projectId"\r\n\r\n([^\r\n]+)/)?.[1];
      assert.ok(projectId, "direct import supplies project, not an existing paper ID");
      assert.ok(!form.includes('name="id"'));
      uploads.push({ projectId, objective: projects[0].objective });
      if (rejectUpload) { rejectUpload = false; return reply({ error: "Scanned PDFs need OCR" }, 400); }
      if (slowUpload) await slowUpload;
      const paper = { id: `local-${papers.length}`, title: `Local PDF ${papers.length}`, url: "", pdfUrl: "", authors: [], year: "", abstract: "", provider: "Uploaded PDF", revision: 1, status: "queued", tags: "", note: "", messages: [], exports: [], createdAt: now(), updatedAt: now(), projectIds: projectId === "general" ? [] : [projectId], source: { kind: "pdf", label: "local.pdf", text: "Local evidence from a PDF.", pages: 2, truncated: false, loadedAt: now(), pdfHash: "a".repeat(64) } };
      papers.push(paper); return reply({ paper });
    }
    if (path === "papers") return url.searchParams.has("id") ? reply({ paper: papers.find(p => p.id === url.searchParams.get("id")) }) : reply({ papers: papers.filter(p => !url.searchParams.has("project") || p.projectIds.includes(url.searchParams.get("project"))) });
    if (path === "agent") {
      if (req.method() === "POST") {
        turns.push(body);
        if (rejectRead) { rejectRead = false; return reply({ error: "Model unavailable; retry reading" }, 503); }
        const selected = conversation(body.projectId, body.paperId);
        selected.messages.push({ id: `q${turns.length}`, role: "user", text: body.question, paperId: body.paperId, at: now() });
        const accepted = { id: `run-${turns.length}`, projectId: body.projectId, paperId: body.paperId, conversationId: selected.id, phase: "reading", startedAt: now() };
        run = accepted;
        finishReading = () => { selected.messages.push({ id: `a${turns.length}`, role: "assistant", text: "A summary grounded in the uploaded PDF [p. 1].", paperId: body.paperId, at: now() }); run = null; };
        if (!holdReplies) finishReading();
        return reply({ run: accepted }, 202);
      }
      const projectId = url.searchParams.get("project") ?? "general";
      const selected = conversations.get(url.searchParams.get("conversation")) ?? conversation(projectId, url.searchParams.get("paper") || undefined);
      return reply({ conversation: selected, messages: selected.messages, sessions: [...conversations.values()].filter(c => c.projectId === projectId), run });
    }
    return reply({ error: `Unmocked: ${path}` }, 404);
  });
  const uploader = () => page.getByRole("region", { name: "Upload PDF and read", exact: true });
  const choose = async () => {
    const chooser = page.waitForEvent("filechooser");
    await uploader().getByRole("button", { name: "Upload PDF and read", exact: true }).click();
    await (await chooser).setFiles({ name: "local.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-test") });
  };
  await page.goto("/research");
  await page.getByRole("button", { name: "Assistant discussion", exact: true }).click();
  await page.locator("#research-question").waitFor();
  assert.ok(await uploader().evaluate(node => !!node.closest('form[aria-label="Message the research assistant"]')), "PDF and text share the conversational composer");
  assert.equal(await page.getByRole("region", { name: "Find papers", exact: true }).isVisible(), false);
  await page.screenshot({ path: `${shots}/home.png` });
  await choose();
  await uploader().getByText(/agent has started reading/).waitFor();
  assert.equal(uploads[0].projectId, "general"); assert.deepEqual(papers[0].projectIds, []);
  assert.equal(turns[0].paperId, papers[0].id); assert.equal(turns[0].projectId, "general");
  await page.waitForURL(/conversation=paper/);
  await page.getByText(/A summary grounded/).waitFor();
  await uploader().getByRole("button", { name: /Open Local PDF/ }).click();
  await page.getByRole("dialog").locator("#research-paper-title").waitFor();
  assert.equal(await page.getByRole("dialog").locator('a[href=""]').count(), 0);
  await page.getByRole("dialog").getByRole("button", { name: /Back/ }).click();

  await page.getByRole("tab", { name: "HEAT", exact: true }).click();
  await page.getByRole("textbox", { name: "This week", exact: true }).fill("New focus before uploading");
  await page.getByRole("button", { name: "Assistant discussion", exact: true }).click();
  await choose(); await uploader().getByText(/agent has started reading/).waitFor();
  assert.equal(uploads[1].projectId, "heat"); assert.equal(uploads[1].objective, "New focus before uploading");
  assert.equal(turns[1].paperId, papers[1].id); assert.equal(turns[1].projectId, "heat");
  await page.waitForURL(url => url.searchParams.get("conversation") === `paper:heat:${papers[1].id}`);
  await page.screenshot({ path: `${shots}/desktop.png` });

  // Upload while the worker is elsewhere: save the source, no silent second model call.
  run = { id: "elsewhere", projectId: "general", conversationId: "discussion:general", startedAt: now(), phase: "reading" };
  await page.reload(); await page.getByRole("status").filter({ hasText: /Another conversation/ }).waitFor();
  const beforeBusy = turns.length; await choose(); await uploader().getByText(/reading has not started/).waitFor();
  assert.equal(turns.length, beforeBusy); assert.equal(papers.length, 3);
  run = null; await page.reload(); await uploader().waitFor();

  // Extraction failure creates no paper; a rejected model request keeps the successful upload.
  rejectUpload = true; await choose(); await uploader().getByRole("alert").filter({ hasText: /OCR/ }).waitFor();
  assert.equal(papers.length, 3);
  rejectRead = true; await choose(); await uploader().getByText(/reading has not started/).waitFor();
  assert.equal(papers.length, 4); await page.getByRole("alert").filter({ hasText: /Model unavailable/ }).waitFor();
  await uploader().getByRole("button", { name: /Open Local PDF 3/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Read it for me", exact: true }).click();
  await page.getByRole("dialog").getByText(/A summary grounded/).waitFor();
  assert.equal(papers.length, 4, "retry reading does not upload a duplicate");
  await page.getByRole("dialog").getByRole("button", { name: /Back/ }).click();

  for (const width of [375, 320, 812]) {
    await page.setViewportSize({ width, height: width === 812 ? 375 : 812 });
    await uploader().scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const button = uploader().getByRole("button", { name: "Upload PDF and read", exact: true });
    assert.ok((await button.boundingBox()).height >= 44);
    await page.screenshot({ path: `${shots}/phone-${width}.png` });
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => document.documentElement.dataset.theme = "dark");
  await page.screenshot({ path: `${shots}/phone-dark.png` });

  const beforeSwitch = turns.length;
  let release; slowUpload = new Promise(resolve => { release = resolve; });
  await choose(); await uploader().getByRole("button", { name: /Uploading and preparing/ }).waitFor();
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await page.waitForURL(url => !url.searchParams.has("project"));
  release(); slowUpload = null; await page.waitForTimeout(800);
  assert.equal(turns.length, beforeSwitch, "leaving the project during upload cannot start a late reading");
  assert.equal(new URL(page.url()).searchParams.has("project"), false);

  // Progress is real saved worker state, not simulated streaming or a guessed percentage.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Assistant discussion", exact: true }).click();
  holdReplies = true; await choose();
  await page.getByRole("status").filter({ hasText: "Getting and reading the paper" }).waitFor();
  await page.getByText("Please read this PDF and explain the main ideas, method, evidence and limitations.", { exact: true }).waitFor();
  await page.getByText("Full reading request", { exact: true }).click();
  await page.getByText(turns.at(-1).question, { exact: true }).waitFor();
  await page.getByText("Full reading request", { exact: true }).click();
  await page.locator("#research-question").fill("Keep my follow-up draft while the agent reads");
  const composer = page.getByRole("form", { name: "Message the research assistant" });
  assert.equal(await composer.getByRole("button", { name: "Ask", exact: true }).isDisabled(), true);
  await page.screenshot({ path: `${shots}/conversation-reading.png` });
  run.phase = "summarizing";
  await page.getByRole("status").filter({ hasText: "Writing up the reading" }).waitFor();
  finishReading(); holdReplies = false;
  await page.getByText("Continue below, or open the paper to check the original.", { exact: true }).waitFor();
  await page.getByText("Research assistant", { exact: true }).waitFor();
  assert.equal(await composer.getByRole("button", { name: "Ask", exact: true }).isEnabled(), true);
  await page.getByRole("button", { name: "Method", exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator("#research-question").inputValue(), "Keep my follow-up draft while the agent reads", "quick asks never discard an unrelated draft");
  await page.screenshot({ path: `${shots}/conversation-followup.png` });
  await page.evaluate(() => localStorage.setItem("pi-locale", "zh-CN"));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/research");
  await page.getByRole("button", { name: "研究助手", exact: true }).click();
  await page.getByRole("button", { name: "上传 PDF 并阅读", exact: true }).waitFor();
  assert.equal(await page.getByText("rw.chat.", { exact: false }).count(), 0);
  await page.screenshot({ path: `${shots}/conversation-phone-zh.png` });
  assert.deepEqual(errors, []);
  console.log(`Research direct PDF upload passed; screenshots: ${shots}`);
} finally { await browser.close(); }
