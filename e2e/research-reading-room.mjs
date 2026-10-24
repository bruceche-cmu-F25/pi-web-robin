// Existing dev server; every research/model/vault operation is mocked. No personal data writes.
// node --env-file-if-exists=.env.local e2e/research-reading-room.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const screenshots = "/tmp/research-reading-room";
mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
const copy = (value) => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();

/** An in-memory research store behind every /api/research route the workspace calls. */
function store() {
  const s = {
    activeId: "heat", aiCalls: [], uploads: 0, kept: [], captures: {}, archiveAttempts: 0, failArchiveOnce: true, failPdfOnce: true, deferReply: false, finishTurn: null, nextReply: "",
    projects: [
      { id: "heat", name: "HEAT", brief: "Hallucination detection for RAG answers.", objective: "Check the baseline", note: "Existing notes", links: [{ title: "Repository", url: "https://github.com/example/heat" }], reference: "heat", createdAt: now(), updatedAt: now(), objectiveUpdatedAt: now() },
      { id: "bio", name: "Protein design", brief: "Inverse folding on de novo backbones.", objective: "", note: "", links: [], createdAt: now(), updatedAt: now(), objectiveUpdatedAt: null },
    ],
    threads: { heat: [], bio: [], general: [] }, run: null,
    papers: [{ id: "locked", url: "https://aclanthology.org/2023.emnlp-main.557/", pdfUrl: "https://aclanthology.org/2023.emnlp-main.557.pdf", title: "SelfCheckGPT", authors: ["Potsawee Manakul"], year: "2023", abstract: "Sampling.", provider: "ACL",
      revision: 1, status: "queued", tags: "", note: "", source: null, messages: [], exports: [], createdAt: now(), updatedAt: now(), projectIds: ["heat"],
      access: { state: "needs-pdf", checkedAt: now(), attempts: [{ url: "https://aclanthology.org/2023.emnlp-main.557.pdf", error: "HTTP 403" }], links: ["https://aclanthology.org/2023.emnlp-main.557/"] } }],
  };
  return s;
}
async function mock(page, s) {
  const project = (id) => s.projects.find((item) => item.id === (id || s.activeId)) ?? { id: "general", objective: "", note: "" };
  const summary = (paper) => ({ id: paper.id, url: paper.url, title: paper.title, authors: paper.authors, year: paper.year, status: paper.status, tags: paper.tags, updatedAt: paper.updatedAt,
    archived: false, needsPdf: !!paper.access, hasAnalysis: !!paper.analysis, coverage: paper.source ? "pdf" : "abstract", projectIds: paper.projectIds, downloadLinks: paper.access ? [paper.url, paper.pdfUrl] : undefined });
  await page.route("**/api/research/projects**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      const created = { id: `p${s.projects.length}`, name: body.name, brief: body.brief, objective: body.objective, note: "", links: body.links, createdAt: now(), updatedAt: now(), objectiveUpdatedAt: null };
      s.projects.push(created); s.threads[created.id] = []; s.activeId = created.id;
      return route.fulfill({ json: { project: created } });
    }
    if (req.method() === "PUT") { s.activeId = req.postDataJSON().activeId; return route.fulfill({ json: { activeId: s.activeId } }); }
    return route.fulfill({ json: { activeId: s.activeId, projects: s.projects.map(({ note, ...item }) => ({ ...item, hasNotes: !!note, papers: s.papers.filter((paper) => paper.projectIds.includes(item.id)).length,
      needsPdf: s.papers.filter((paper) => paper.access && paper.projectIds.includes(item.id)).length, read: 0, messages: s.threads[item.id].length })) } });
  });
  await page.route("**/api/research/objective**", async (route) => {
    const req = route.request();
    const target = project(new URL(req.url()).searchParams.get("project"));
    if (req.method() === "PUT") {
      const body = req.postDataJSON();
      if (body.revision !== JSON.stringify([target.objective, target.note])) return route.fulfill({ status: 409, json: { error: "Notes changed" } });
      Object.assign(target, body);
    }
    if (req.method() === "PATCH") {
      const { messageId, vaultId } = req.postDataJSON();
      const message = s.threads[target.id].find((item) => item.id === messageId);
      assert.ok(message, "Keep sends a stored answer id, not browser-authored Markdown");
      assert.equal(vaultId, "local");
      const key = `${target.id}:${messageId}`;
      if (!s.captures[key]) {
        const text = `${message.text}\n\nSources:\n- [Too Consistent to Detect](<https://arxiv.org/abs/2505.17656>)`;
        s.kept.push(text); target.note += `\n\n${text}`;
        s.captures[key] = { messageId, notebookSaved: true };
      }
      s.archiveAttempts++;
      if (s.failArchiveOnce) { s.failArchiveOnce = false; s.captures[key].error = "Vault temporarily unavailable"; }
      else {
        delete s.captures[key].error;
        s.captures[key].archive = { draftId: key, title: "Research answer", vaultId: "local", vaultPath: "/test/vault", relativePath: "Notes/Robin-test/answer.md", url: "obsidian://open?path=/test/vault/Notes/Robin-test/answer.md", savedAt: now() };
      }
    }
    return route.fulfill({ json: { objective: target.objective, note: target.note, revision: JSON.stringify([target.objective, target.note]), updatedAt: now(), captureState: {
      captures: Object.entries(s.captures).filter(([key]) => key.startsWith(`${target.id}:`)).map(([, value]) => value),
      vaults: [{ id: "local", name: "Test vault", path: "/test/vault" }], vaultId: "local",
    } } });
  });
  await page.route("**/api/research/agent**", async (route) => {
    const req = route.request();
    if (req.method() === "GET") { const id = new URL(req.url()).searchParams.get("project"); return route.fulfill({ json: { messages: copy(s.threads[id] ?? []), run: s.run } }); }
    if (req.method() === "DELETE") { s.run = null; return route.fulfill({ json: { stopped: true } }); }
    const body = req.postDataJSON();
    s.aiCalls.push({ ...body, objectiveAtSend: project(body.projectId).objective });
    const run = { id: `r${s.aiCalls.length}`, projectId: body.projectId, paperId: body.paperId, sessionId: "session", startedAt: now(), phase: "reading", detail: "Reading the paper" };
    s.run = run;
    const thread = s.threads[body.projectId];
    thread.push({ id: `q${s.aiCalls.length}`, role: "user", text: body.question, paperId: body.paperId, at: now() });
    let paper = s.papers.find((item) => item.id === "read");
    if (!paper) {
      paper = { id: "read", url: "https://arxiv.org/abs/2505.17656", pdfUrl: "https://arxiv.org/pdf/2505.17656", title: "Too Consistent to Detect", authors: ["A. Author"], year: "2025", abstract: "Errors repeat.", provider: "arXiv",
        revision: 2, status: "queued", tags: "", note: "", messages: [], exports: [], createdAt: now(), updatedAt: now(), projectIds: [body.projectId],
        source: { kind: "pdf", label: "arxiv", text: "--- page 1 ---\nErrors that repeat across samples.", pages: 1, truncated: false, loadedAt: now() },
        analysis: { abstractExplanation: "Consistency is not truth.", summary: "Self-consistent errors grow with scale [p. 1].", connections: { [body.projectId]: { text: "Add a cross-model sample.", objective: project(body.projectId).objective, createdAt: now() } }, sourceKey: "k", coverage: "pdf", objective: "", createdAt: now() } };
      s.papers.push(paper);
    }
    const reply = s.nextReply || (body.paperId ? `Scoped answer about ${body.paperId}.` : `**Short answer:** consistency is not truth.\n\n[Too Consistent to Detect](/research?project=${body.projectId}&paper=read)`);
    s.nextReply = "";
    s.finishTurn = () => {
      thread.push({ id: `a${s.aiCalls.length}`, role: "assistant", text: reply, paperId: body.paperId, at: now() });
      s.run = null;
    };
    if (!s.deferReply) s.finishTurn();
    return route.fulfill({ status: 202, json: { run } });
  });
  await page.route("**/api/research/papers/pdf?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (!params.has("page")) return route.fulfill({ json: { pages: 2, hash: "a".repeat(64) } });
    if (params.get("page") === "2" && s.failPdfOnce) { s.failPdfOnce = false; return route.fulfill({ status: 422, json: { error: "PDF render temporarily unavailable" } }); }
    return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0y8AAAAASUVORK5CYII=", "base64") });
  });
  await page.route("**/api/research/papers/source", async (route) => {
    s.uploads++;
    const req = route.request();
    const body = req.headers()["content-type"]?.includes("application/json") ? req.postDataJSON() : {
      id: req.postData().match(/name="id"\r\n\r\n([^\r\n]+)/)?.[1],
      revision: Number(req.postData().match(/name="revision"\r\n\r\n([^\r\n]+)/)?.[1]),
    };
    const paper = s.papers.find((item) => item.id === body.id);
    if (body.revision !== paper.revision) return route.fulfill({ status: 409, json: { error: "Revision conflict" } });
    delete paper.access; paper.source = { kind: "pdf", label: "upload.pdf", text: "--- page 1 ---\nUploaded text.", pages: 1, truncated: false, loadedAt: now() }; paper.revision++;
    return route.fulfill({ json: { paper: copy(paper) } });
  });
  await page.route("**/api/research/papers?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("id")) return route.fulfill({ json: { paper: copy(s.papers.find((item) => item.id === params.get("id"))) } });
    const id = params.get("project");
    return route.fulfill({ json: { papers: s.papers.filter((paper) => !id || paper.projectIds.includes(id)).map(summary) } });
  });
  await page.route("**/api/research/papers", (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      const paper = s.papers.find((item) => item.id === body.id);
      if (body.revision !== paper.revision) return route.fulfill({ status: 409, json: { error: "Revision conflict" } });
      Object.assign(paper, body.patch); paper.revision++;
      return route.fulfill({ json: { paper: copy(paper) } });
    }
    return route.fulfill({ json: { papers: s.papers.map(summary) } });
  });
  await page.route("**/api/robin/obsidian", (route) => route.fulfill({ json: { vaults: [], archives: [] } }));
}

async function holdTurn(page) {
  let observed, release;
  const received = new Promise((resolve) => { observed = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const handler = async (route) => {
    if (route.request().method() === "POST") { observed(); await gate; }
    await route.fallback();
  };
  await page.route("**/api/research/agent**", handler);
  return { received, release, dispose: () => page.unroute("**/api/research/agent**", handler) };
}

try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  if (process.env.PI_WEB_PASSWORD) {
    const login = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(login.ok());
  }
  await context.addInitScript(() => { localStorage.setItem("pi-locale", "en"); for (const key of Object.keys(localStorage)) if (key.startsWith("pi-research-")) localStorage.removeItem(key); });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const s = store();
  await mock(page, s);

  // Home: paste a link with no project; the agent reads it into the general thread.
  await page.goto("/research");
  await page.getByRole("heading", { name: "Your research" }).waitFor();
  assert.equal(await page.getByLabel("Ask the research agent").isVisible(), false);
  await page.getByRole("button", { name: "Assistant discussion", exact: true }).click();
  await page.getByRole("button", { name: /Understand a paper/ }).click();
  const homeComposer = page.getByLabel("Ask the research agent");
  assert.match(await homeComposer.inputValue(), /Read this paper in full/);
  await homeComposer.press("End");
  await homeComposer.pressSequentially("https://arxiv.org/abs/2505.17656");
  const homeTurn = await holdTurn(page);
  await homeComposer.press("Enter"); await homeTurn.received;
  await homeComposer.fill("A new question while sending"); homeTurn.release();
  await page.getByText("consistency is not truth").waitFor();
  assert.equal(await homeComposer.inputValue(), "A new question while sending");
  await homeTurn.dispose();
  assert.equal(s.aiCalls[0].projectId, "general");
  assert.match(s.aiCalls[0].question, /arxiv\.org\/abs\/2505\.17656$/);
  await page.screenshot({ path: `${screenshots}/home.png` });
  s.aiCalls.length = 0; s.papers = s.papers.filter((item) => item.id !== "read");

  // A project opens on goals and notes, not a chat or an expanded reference library.
  await page.getByRole("tab", { name: "HEAT" }).click();
  await page.getByRole("heading", { name: "HEAT", level: 1 }).waitFor();
  await page.screenshot({ path: `${screenshots}/desktop.png` });
  assert.equal(await page.getByLabel("Ask the research agent").isVisible(), false);
  assert.equal(await page.getByRole("heading", { name: /Takeover reading list/ }).count(), 0);
  for (const locator of [page.getByRole("textbox", { name: "This week" }), page.getByRole("heading", { name: "Research notebook" })]) {
    const box = await locator.boundingBox();
    assert.ok(box && box.y + box.height <= 900, `core controls fit the first screen: ${JSON.stringify(box)}`);
  }
  assert.equal(await page.getByRole("button", { name: /need your PDF/ }).count(), 1);
  await page.screenshot({ path: `${screenshots}/desktop.png` });
  await page.getByRole("button", { name: "+ Direction / experiment outline", exact: true }).click();
  const notebook = page.getByRole("textbox", { name: "Notebook", exact: true });
  assert.match(await notebook.inputValue(), /^## Direction & hypothesis/);
  assert.ok((await notebook.inputValue()).endsWith("Existing notes"), "an outline preserves existing notes");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("navigation", { name: "Notebook outline", exact: true }).getByRole("button", { name: "Direction & hypothesis", exact: true }).waitFor();
  await page.getByRole("button", { name: "Assistant discussion", exact: true }).click();
  await page.getByLabel("Ask the research agent").fill("Draft survives switching sections");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Assistant discussion", exact: true }).click();
  assert.equal(await page.getByLabel("Ask the research agent").inputValue(), "Draft survives switching sections");
  await page.getByLabel("Ask the research agent").fill("");
  await page.getByRole("button", { name: "Overview", exact: true }).click();

  // The focus is flushed before the agent starts; the starter runs without extra clicks.
  await page.getByRole("textbox", { name: "This week" }).fill("Validate atomic-fact extraction");
  await page.getByRole("button", { name: "Assistant discussion", exact: true }).click();
  await page.getByRole("button", { name: /Find papers for this week/ }).click();
  await page.getByText("consistency is not truth").waitFor();
  assert.equal(s.aiCalls[0].projectId, "heat");
  assert.equal(s.aiCalls[0].objectiveAtSend, "Validate atomic-fact extraction");
  await page.locator('[class*="conversationColumn"]').getByText("Too Consistent to Detect").first().waitFor();

  // Keep: archive failure retains the notebook; retry and reload do not duplicate either destination.
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByText("Obsidian archive settings", { exact: true }).click();
  assert.equal(await page.getByLabel("Keep in notebook → Obsidian vault").inputValue(), "local");
  await page.getByRole("button", { name: "Assistant discussion", exact: true }).click();
  await page.getByRole("button", { name: "Keep in notebook", exact: true }).first().click();
  await page.getByText(/Kept in the project notebook, but not archived/).waitFor();
  assert.equal(s.kept.length, 1);
  await page.getByRole("button", { name: "In notebook · Retry Obsidian archive", exact: true }).click();
  await page.getByRole("button", { name: "In notebook · Archived to Obsidian ✓", exact: true }).waitFor();
  assert.match(s.kept[0], /Sources:\n- \[Too Consistent to Detect\]\(<https:\/\/arxiv\.org\/abs\/2505\.17656>\)/);
  assert.equal(s.kept.length, 1); assert.equal(s.archiveAttempts, 2);
  await page.reload();
  await page.getByRole("button", { name: "Assistant discussion", exact: true }).click();
  await page.getByRole("button", { name: "In notebook · Archived to Obsidian ✓", exact: true }).waitFor();
  assert.match(await page.getByRole("link", { name: "Open saved note ↗" }).getAttribute("href"), /^obsidian:/);
  assert.equal(s.archiveAttempts, 2, "reload is read-only");
  await page.screenshot({ path: `${screenshots}/capture-archived.png` });

  // Needs your PDF: upload straight from the margin, then the agent reads it scoped to that paper.
  await page.getByRole("button", { name: /^Papers/ }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload PDF", exact: true }).click();
  await (await chooser).setFiles({ name: "paper.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await page.waitForFunction(() => !document.querySelector("#research-needs-pdf"));
  assert.equal(s.uploads, 1);
  await page.waitForFunction(() => document.body.textContent.includes("Scoped answer about locked"));
  assert.equal(s.aiCalls.at(-1).paperId, "locked");

  // Paper sheet: reading on one side, scoped questions on the other, in the same project thread.
  await page.getByRole("button", { name: "Assistant discussion", exact: true }).click();
  await page.getByRole("link", { name: "Too Consistent to Detect" }).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("heading", { name: "Too Consistent to Detect" }).waitFor();
  await sheet.getByText("Add a cross-model sample.").waitFor();
  const sheetTurn = await holdTurn(page);
  await sheet.getByRole("button", { name: "Explain simply" }).click(); await sheetTurn.received;
  const paperComposer = sheet.getByRole("textbox", { name: "Ask about this paper", exact: true });
  await paperComposer.fill("Next paper question"); sheetTurn.release();
  await sheet.getByText("Scoped answer about read.").waitFor();
  assert.equal(await paperComposer.inputValue(), "Next paper question");
  await sheetTurn.dispose();
  assert.equal(s.aiCalls.at(-1).paperId, "read");
  // Note save -> source write -> read, with no second PATCH using the old note revision.
  await sheet.getByText("My notes", { exact: true }).click();
  await sheet.getByRole("textbox", { name: "My notes", exact: true }).fill("Keep this note before uploading");
  const uploadedReading = page.waitForResponse((response) => response.url().includes("/api/research/agent") && response.request().method() === "POST");
  await sheet.locator('input[type="file"]').setInputFiles({ name: "paper.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  assert.equal((await uploadedReading).status(), 202);
  assert.equal(s.papers.find((paper) => paper.id === "read").note, "Keep this note before uploading");
  assert.equal(await paperComposer.inputValue(), "Next paper question");
  await page.screenshot({ path: `${screenshots}/sheet.png` });
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });

  // Switching projects swaps the thread, focus and papers.
  await page.getByRole("tab", { name: "Protein design" }).click();
  await page.getByRole("heading", { name: "Protein design", level: 1 }).waitFor();
  await page.getByRole("heading", { name: "Research notebook" }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "This week" }).inputValue(), "");
  assert.equal(s.activeId, "bio");

  // A new project from the switcher becomes the current one.
  await page.getByRole("button", { name: /New project/ }).click();
  await page.getByLabel("Name").fill("Urban heat islands");
  await page.getByLabel("What are you trying to find out?").fill("Which mitigation works at street scale?");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("heading", { name: "Urban heat islands", level: 1 }).waitFor();

  // Phone: no horizontal scroll, and the waiting PDFs are announced above the discussion.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/research?project=heat");
  await page.getByRole("heading", { name: "HEAT", level: 1 }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: `${screenshots}/phone.png` });

  // Emulate an installed iPhone's status bar/home indicator: navigation must remain below the safe area.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 59, bottom: 34, left: 0, right: 0 } });
  async function assertBackVisible() {
    const back = sheet.getByRole("button", { name: "Back to papers", exact: true });
    await back.waitFor();
    const box = await back.boundingBox();
    assert.ok(box && box.y >= 59 && box.height >= 44 && box.width >= 44, "Back clears the status bar and has a touch-sized target");
    assert.ok(box.x >= 0 && box.x + box.width <= page.viewportSize().width && box.y + box.height <= page.viewportSize().height);
    assert.equal(await back.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), true, "Back is not covered by the scrolled content");
  }

  // A phone can reload during a reading: the accepted run survives and the sheet polls its answer.
  s.deferReply = true; s.nextReply = "Recovered reading after page reload.";
  await page.goto("/research?project=heat&paper=read");
  await sheet.getByRole("heading", { name: "Too Consistent to Detect" }).waitFor();
  await assertBackVisible();
  await sheet.getByRole("tab", { name: "Full text", exact: true }).click();
  const originalPage = sheet.getByRole("img", { name: "Original PDF page 1" });
  await originalPage.waitFor();
  await originalPage.evaluate((img) => img.complete && img.naturalWidth > 0 || new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; }));
  await sheet.getByRole("button", { name: "Next", exact: true }).click();
  await sheet.getByText("This PDF page could not be loaded. Retry or use the PDF link above.", { exact: true }).waitFor();
  await sheet.getByRole("button", { name: "Retry", exact: true }).click();
  await sheet.getByRole("img", { name: "Original PDF page 2" }).waitFor();
  assert.match(await sheet.getByRole("img", { name: "Original PDF page 2" }).getAttribute("src"), /page=2/);
  await sheet.getByLabel("PDF zoom", { exact: true }).selectOption("200");
  assert.equal(await sheet.evaluate((node) => node.scrollWidth <= node.clientWidth), true, "zoom scrolls inside the PDF, not the whole sheet");
  await sheet.getByText("Extracted text (layout may differ)", { exact: true }).click();
  await sheet.getByText("Uploaded text.", { exact: true }).waitFor();
  await sheet.locator("article").first().evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await assertBackVisible();
  await sheet.getByRole("tab", { name: /^Ask/ }).click();
  const accepted = page.waitForResponse((response) => response.url().includes("/api/research/agent") && response.request().method() === "POST");
  await sheet.getByRole("button", { name: "Explain simply" }).click();
  assert.equal((await accepted).status(), 202);
  assert.ok(s.run);
  await page.reload();
  await sheet.getByRole("heading", { name: "Too Consistent to Detect" }).waitFor();
  await sheet.getByRole("tab", { name: /^Ask/ }).click();
  await sheet.getByRole("button", { name: "Stop", exact: true }).waitFor();
  assert.ok(s.run, "reload must not cancel server work");
  await assertBackVisible();
  const runningId = s.run.id;
  await sheet.getByRole("button", { name: "Back to papers", exact: true }).click();
  await sheet.waitFor({ state: "detached" });
  assert.equal(new URL(page.url()).searchParams.get("project"), "heat");
  assert.equal(new URL(page.url()).searchParams.has("paper"), false);
  assert.equal(s.run.id, runningId, "Back leaves the reading running");
  await page.goto("/research?project=heat&paper=read");
  await sheet.getByRole("tab", { name: /^Ask/ }).click();
  s.finishTurn();
  await sheet.getByText("Recovered reading after page reload.").waitFor();
  await sheet.getByRole("button", { name: "Stop", exact: true }).waitFor({ state: "detached" });
  for (const viewport of [{ width: 320, height: 568 }, { width: 812, height: 375 }, { width: 402, height: 874 }]) {
    await page.setViewportSize(viewport);
    await sheet.getByLabel("Ask about this paper", { exact: true }).last().focus();
    await assertBackVisible();
    assert.equal(await sheet.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
  }
  await page.screenshot({ path: `${screenshots}/phone-sheet-back.png` });
  await sheet.getByRole("button", { name: "Back to papers", exact: true }).click();
  await sheet.waitFor({ state: "detached" });
  // A deep link from home returns to home, not to an unrelated browser-history entry.
  await page.goto("/research?paper=read");
  await sheet.getByRole("button", { name: "Back to papers", exact: true }).click();
  await sheet.waitFor({ state: "detached" });
  assert.equal(new URL(page.url()).search, "");

  // Two independent editors: Keep in A must survive B's stale autosave, and B keeps its draft.
  const editorA = await context.newPage(), editorB = await context.newPage();
  for (const editor of [editorA, editorB]) {
    editor.on("pageerror", (error) => errors.push(error.message));
    await mock(editor, s); await editor.goto("/research?project=heat");
    await editor.getByRole("textbox", { name: "This week" }).waitFor();
    await editor.waitForFunction(() => !document.querySelector("#research-focus")?.disabled);
  }
  const heat = s.projects.find((p) => p.id === "heat"), oldFocus = heat.objective;
  await editorA.getByRole("button", { name: "Assistant discussion", exact: true }).click();
  await editorA.getByRole("button", { name: "Keep in notebook", exact: true }).last().click();
  await editorA.getByRole("button", { name: "In notebook · Archived to Obsidian ✓", exact: true }).last().waitFor();
  const keptNote = heat.note;
  await editorB.getByRole("textbox", { name: "This week" }).fill("Unsaved focus from stale tab");
  await editorB.getByRole("alert").filter({ hasText: "Another page changed these notes" }).waitFor();
  assert.equal(heat.note, keptNote); assert.equal(heat.objective, oldFocus);
  assert.equal(await editorB.getByRole("textbox", { name: "This week" }).inputValue(), "Unsaved focus from stale tab");
  await editorB.getByRole("tab", { name: "Protein design" }).click();
  await editorB.getByText(/The project notes could not be saved/).first().waitFor();
  assert.equal(new URL(editorB.url()).searchParams.get("project"), "heat");
  editorB.once("dialog", (dialog) => dialog.dismiss());
  await editorB.getByRole("button", { name: "Reload latest", exact: true }).click();
  assert.equal(await editorB.getByRole("textbox", { name: "This week" }).inputValue(), "Unsaved focus from stale tab");
  await editorA.close(); await editorB.close();

  assert.deepEqual(errors, []);
  console.log(`research workspace e2e passed; screenshots in ${screenshots}`);
} finally {
  await browser.close();
}
