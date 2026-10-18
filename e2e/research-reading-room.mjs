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
    activeId: "heat", aiCalls: [], uploads: 0, kept: [],
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
    if (req.method() === "PUT") Object.assign(target, req.postDataJSON());
    if (req.method() === "PATCH") { const { text } = req.postDataJSON(); s.kept.push(text); target.note += `\n\n${text}`; }
    return route.fulfill({ json: { objective: target.objective, note: target.note, updatedAt: now() } });
  });
  await page.route("**/api/research/agent**", async (route) => {
    const req = route.request();
    if (req.method() === "GET") { const id = new URL(req.url()).searchParams.get("project"); return route.fulfill({ json: { messages: copy(s.threads[id] ?? []), run: s.run } }); }
    if (req.method() === "DELETE") { s.run = null; return route.fulfill({ json: { stopped: true } }); }
    const body = req.postDataJSON();
    s.aiCalls.push({ ...body, objectiveAtSend: project(body.projectId).objective });
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
    const reply = body.paperId ? `Scoped answer about ${body.paperId}.` : `**Short answer:** consistency is not truth.\n\n[Too Consistent to Detect](/research?project=${body.projectId}&paper=read)`;
    thread.push({ id: `a${s.aiCalls.length}`, role: "assistant", text: reply, paperId: body.paperId, at: now() });
    return route.fulfill({ json: { reply, sessionId: "session" } });
  });
  await page.route("**/api/research/papers/source", async (route) => {
    s.uploads++;
    const paper = s.papers.find((item) => item.id === "locked");
    delete paper.access; paper.source = { kind: "pdf", label: "upload.pdf", text: "--- page 1 ---\nUploaded text.", pages: 1, truncated: false, loadedAt: now() }; paper.revision++;
    return route.fulfill({ json: { paper: copy(paper) } });
  });
  await page.route("**/api/research/papers?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("id")) return route.fulfill({ json: { paper: copy(s.papers.find((item) => item.id === params.get("id"))) } });
    const id = params.get("project");
    return route.fulfill({ json: { papers: s.papers.filter((paper) => !id || paper.projectIds.includes(id)).map(summary) } });
  });
  await page.route("**/api/research/papers", (route) => route.fulfill({ json: { papers: s.papers.map(summary) } }));
  await page.route("**/api/robin/obsidian", (route) => route.fulfill({ json: { vaults: [], archives: [] } }));
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
  await page.getByRole("heading", { name: "Read a paper, or ask about anything" }).waitFor();
  await page.getByRole("button", { name: /Summarise a paper/ }).click();
  const homeComposer = page.getByLabel("Ask the research agent");
  assert.match(await homeComposer.inputValue(), /Read this paper in full/);
  await homeComposer.press("End");
  await homeComposer.pressSequentially("https://arxiv.org/abs/2505.17656");
  await homeComposer.press("Enter");
  await page.getByText("consistency is not truth").waitFor();
  assert.equal(s.aiCalls[0].projectId, "general");
  assert.match(s.aiCalls[0].question, /arxiv\.org\/abs\/2505\.17656$/);
  await page.screenshot({ path: `${screenshots}/home.png` });
  s.aiCalls.length = 0; s.papers = s.papers.filter((item) => item.id !== "read");

  // A project tab: project, focus, composer and starters without scrolling.
  await page.getByRole("tab", { name: "HEAT" }).click();
  await page.getByRole("heading", { name: "HEAT", level: 1 }).waitFor();
  for (const locator of [page.getByRole("textbox", { name: "This week" }), page.getByLabel("Ask the research agent"), page.getByRole("button", { name: /Find papers for this week/ })]) {
    const box = await locator.boundingBox();
    assert.ok(box && box.y + box.height <= 900, "core controls fit the first screen");
  }
  assert.equal(await page.getByRole("heading", { name: /Needs your PDF/ }).count(), 1);
  await page.screenshot({ path: `${screenshots}/desktop.png` });

  // The focus is flushed before the agent starts; the starter runs without extra clicks.
  await page.getByRole("textbox", { name: "This week" }).fill("Validate atomic-fact extraction");
  await page.getByRole("button", { name: /Find papers for this week/ }).click();
  await page.getByText("consistency is not truth").waitFor();
  assert.equal(s.aiCalls[0].projectId, "heat");
  assert.equal(s.aiCalls[0].objectiveAtSend, "Validate atomic-fact extraction");
  await page.getByText("Too Consistent to Detect").first().waitFor();

  // Keep: appended with the paper's original link.
  await page.getByRole("button", { name: "Keep in notebook" }).first().click();
  await page.getByRole("button", { name: "In notebook ✓" }).waitFor();
  assert.match(s.kept[0], /Sources:\n- \[Too Consistent to Detect\]\(<https:\/\/arxiv\.org\/abs\/2505\.17656>\)/);

  // Needs your PDF: upload straight from the margin, then the agent reads it scoped to that paper.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload PDF" }).click();
  await (await chooser).setFiles({ name: "paper.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await page.waitForFunction(() => !document.querySelector("#research-needs-pdf"));
  assert.equal(s.uploads, 1);
  await page.waitForFunction(() => document.body.textContent.includes("Scoped answer about locked"));
  assert.equal(s.aiCalls.at(-1).paperId, "locked");

  // Paper sheet: reading on one side, scoped questions on the other, in the same project thread.
  await page.getByRole("link", { name: "Too Consistent to Detect" }).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("heading", { name: "Too Consistent to Detect" }).waitFor();
  await sheet.getByText("Add a cross-model sample.").waitFor();
  await sheet.getByRole("button", { name: "Explain simply" }).click();
  await sheet.getByText("Scoped answer about read.").waitFor();
  assert.equal(s.aiCalls.at(-1).paperId, "read");
  await page.screenshot({ path: `${screenshots}/sheet.png` });
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });

  // Switching projects swaps the thread, focus and papers.
  await page.getByRole("tab", { name: "Protein design" }).click();
  await page.getByRole("heading", { name: "Protein design", level: 1 }).waitFor();
  await page.getByRole("heading", { name: "What do you want to find out?" }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "This week" }).inputValue(), "");
  assert.equal(s.activeId, "bio");

  // A new project from the switcher becomes the current one.
  await page.getByRole("button", { name: "+ New project" }).click();
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

  assert.deepEqual(errors, []);
  console.log(`research workspace e2e passed; screenshots in ${screenshots}`);
} finally {
  await browser.close();
}
