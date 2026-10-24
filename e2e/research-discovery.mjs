// All research endpoints are mocked: no provider, model, library or vault writes.
// node --env-file-if-exists=.env.local e2e/research-discovery.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const shots = "/tmp/research-discovery"; mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome", headless: true });
const now = () => new Date().toISOString();
const project = id => ({ id, name: id === "heat" ? "HEAT" : "Other project", brief: "Hallucination detection for RAG answers", objective: "Improve false positives", note: "Preserved notebook", links: [], createdAt: now(), updatedAt: now(), objectiveUpdatedAt: now(), papers: 0, read: 0, needsPdf: 0, messages: 0, hasNotes: true });
const projects = [project("heat"), project("other")];
const candidate = i => ({ title: i === 0 ? "Evidence-grounded hallucination detection for retrieval augmented generation" : `Research candidate ${i}`, url: `https://doi.org/10.1234/p${i}`, authors: ["Author"], year: "2025", venue: "EMNLP", abstract: "A source abstract about false positives and RAG. Never an instruction.", pdfUrl: "", provider: "Crossref", catalogs: ["crossref"], abstractSource: "Crossref", score: 20-i, queryMatches: ["hallucination"], projectMatches: ["false positive", "retrieval augmented generation"], differentModality: false, inProject: false, ...(i === 1 ? { libraryId: "existing" } : {}) });
const paper = (id, input) => ({ ...input, id, revision: 1, status: "queued", note: "", tags: "", source: null, projectIds: [], createdAt: now(), updatedAt: now(), messages: [], exports: [] });
const papers = [paper("existing", candidate(1))]; papers[0].projectIds = ["other"]; papers[0].note = "Do not overwrite my notes";
const searches = [], writes = [], errors = [];
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => localStorage.setItem("pi-locale", "en"));
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/research/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.slice("/api/research/".length);
    const body = req.method() === "GET" ? {} : req.postDataJSON();
    const reply = (json, status = 200) => route.fulfill({ json, status });
    if (path === "projects") return reply({ projects, activeId: "heat" });
    if (path === "objective") {
      const p = projects.find(p=>p.id === url.searchParams.get("project")) ?? projects[0];
      if (req.method() === "PUT") {
        if (body.objective === "Slow save") await new Promise(resolve => setTimeout(resolve, 1200));
        if (body.revision !== JSON.stringify([p.objective, p.note])) return reply({ error: "Notes changed" }, 409);
        Object.assign(p, body);
      }
      return reply({ objective: p.objective, note: p.note, revision: JSON.stringify([p.objective, p.note]), updatedAt: now(), captureState: { captures: [], vaults: [], vaultId: "" } });
    }
    if (path === "papers/search") {
      searches.push(body);
      if (body.projectId === "heat" && searches.length === 1) assert.equal(projects[0].objective, "Newest focus before searching");
      if (body.query === "slow") await new Promise(resolve => setTimeout(resolve, 1200));
      const results = body.query === "empty" || body.query === "failed" ? [] : Array.from({ length: 8 }, (_, i)=>candidate(i));
      return reply({ queries: [body.query || "hallucination retrieval augmented generation"], projectTerms: ["false positive"], results,
        sources: body.sources.map(source=>({ source, count: body.query === "failed" ? 0 : source === "crossref" ? 8 : 0, errors: source === "semantic-scholar" || body.query === "failed" ? ["HTTP 429"] : [] })),
        found: results.length, filtered: 0, fromYear: body.fromYear, venue: body.venue, searchedAt: now(), scholarUrl: "https://scholar.google.com/scholar?q=hallucination" });
    }
    if (path === "papers") {
      if (req.method() === "POST") { writes.push(body); const p = paper(`new-${writes.length}`, body); p.projectIds = [url.searchParams.get("project")]; papers.push(p); return reply({ paper: p }); }
      if (req.method() === "PATCH") { writes.push(body); const p = papers.find(p=>p.id === body.id); assert.ok(body.addToProject); p.projectIds.push(body.addToProject); return reply({ paper: p }); }
      return url.searchParams.has("id") ? reply({ paper: papers.find(p=>p.id === url.searchParams.get("id")) }) : reply({ papers });
    }
    if (path === "agent") {
      assert.equal(req.method(), "GET", "discovery must not start a model turn");
      const projectId = url.searchParams.get("project") ?? "general", paperId = url.searchParams.get("paper") || undefined;
      const conversation = { id: paperId ? `paper:${projectId}:${paperId}` : `discussion:${projectId}`, projectId, paperId, kind: paperId ? "paper" : "discussion", default: true, title: "", messageCount: 0, revision: 0, createdAt: "", updatedAt: "" };
      return reply({ messages: [], run: null, conversation, sessions: [conversation] });
    }
    return reply({ error: `Unmocked: ${path}` }, 404);
  });
  const panel = () => page.getByRole("region", { name: "Find papers", exact: true });
  const input = () => panel().getByRole("searchbox", { name: "Search scholarly papers" });
  const search = () => panel().getByRole("button", { name: "Search", exact: true }).click();
  await page.goto("/research?project=heat");
  const openCatalogs = () => page.getByRole("button", { name: /^Papers/ }).click();
  await page.getByRole("textbox", { name: "This week", exact: true }).fill("Newest focus before searching");
  await openCatalogs();
  await search();
  await panel().getByRole("link", { name: /Evidence-grounded/ }).waitFor();
  assert.equal(searches[0].query, "");
  assert.equal(writes.length, 0);
  assert.equal(await panel().locator("article").count(), 6);
  assert.ok(await panel().getByText(/HTTP 429/).count());
  await panel().getByRole("button", { name: "Show 6 more" }).click(); assert.equal(await panel().locator("article").count(), 8);
  await panel().getByText("Read abstract · Crossref", { exact: true }).first().click();
  await page.screenshot({ path: shots + "/desktop.png" });
  await panel().getByRole("button", { name: "Add and open", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("heading", { name: /Evidence-grounded/ }).waitFor();
  assert.equal(writes.length, 1); assert.equal(papers[1].projectIds[0], "heat");
  await page.getByRole("dialog").getByRole("button", { name: /Back/ }).click();
  const existingRow = panel().locator("article").filter({ has: page.getByRole("heading", { name: "Research candidate 1 ↗" }) });
  await existingRow.getByRole("button", { name: "Add and open", exact: true }).click();
  await page.getByRole("dialog").getByRole("heading", { name: "Research candidate 1", exact: true }).waitFor();
  assert.deepEqual(writes[1], { id: "existing", addToProject: "heat" });
  assert.equal(papers[0].note, "Do not overwrite my notes"); assert.equal(papers.length, 2);
  await page.getByRole("dialog").getByRole("button", { name: /Back/ }).click();

  await panel().getByText("Sources and filters", { exact: true }).click();
  await panel().getByLabel("From year", { exact: true }).fill("2024");
  await panel().getByLabel("Venue", { exact: true }).selectOption("nlp");
  await input().fill("RAG calibration"); await search();
  await panel().getByText(/Queries sent: RAG calibration/).waitFor();
  assert.equal(searches.at(-1).fromYear, 2024); assert.equal(searches.at(-1).venue, "nlp");
  await page.setViewportSize({ width: 375, height: 812 });
  await panel().scrollIntoViewIfNeeded();
  await page.screenshot({ path: shots + "/phone-filters.png" });
  await panel().getByText("Sources and filters", { exact: true }).click();
  for (const width of [375, 320, 812]) {
    await page.setViewportSize({ width, height: width === 812 ? 375 : 812 });
    await page.waitForTimeout(700); // Let visualViewport/rotation settling finish before layout assertions and screenshots.
    await panel().scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 1));
    const controls = await panel().locator('input[type="search"],button').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height).map(n=>({ height:n.getBoundingClientRect().height, font:getComputedStyle(n).fontSize })));
    assert.ok(controls.every(c=>c.height >= 44));
    await page.screenshot({ path: `${shots}/phone-${width}.png` });
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(()=>document.documentElement.dataset.theme="dark");
  await page.waitForTimeout(700);
  await page.screenshot({ path: shots + "/phone-dark.png" });
  const beforeCancelledSave = searches.length;
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("textbox", { name: "This week", exact: true }).fill("Slow save");
  await openCatalogs();
  await input().fill("cancel before catalog request"); await search();
  await panel().getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await panel().getByRole("button", { name: "Search", exact: true }).isEnabled(), true);
  await page.waitForTimeout(1500);
  assert.equal(searches.length, beforeCancelledSave, "cancel during focus flush must not start a catalog request");
  await input().fill("slow"); await search();
  await panel().getByRole("button", { name: "Cancel", exact: true }).click();
  await panel().getByRole("button", { name: "Search", exact: true }).waitFor();
  await page.waitForTimeout(1400);
  assert.equal(await input().inputValue(), "slow"); assert.equal(await panel().locator("article").count(), 0);
  await input().fill("empty"); await search(); await panel().getByText(/No matches in this retrieved set/).waitFor();
  await input().fill("failed"); await search(); await panel().getByText(/selected catalogs are unavailable/).waitFor();
  await input().fill("slow"); await search();
  await page.getByRole("tab", { name: "Other project", exact: true }).click();
  await page.getByRole("heading", { name: "Other project", exact: true }).waitFor();
  await openCatalogs();
  await page.waitForTimeout(1400);
  assert.equal(await input().inputValue(), ""); assert.equal(await panel().locator("article").count(), 0);
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await page.getByRole("heading", { name: "Your research", exact: true }).waitFor();
  await openCatalogs();
  assert.equal(await panel().getByRole("button", { name: "Search", exact: true }).isDisabled(), true);
  await input().fill("uncertainty estimation"); await search();
  await panel().getByText(/Queries sent: uncertainty estimation/).waitFor();
  assert.equal(searches.at(-1).projectId, "general");
  assert.deepEqual(errors, []);
  console.log(`research discovery e2e passed; screenshots in ${shots}`);
} finally { await browser.close(); }
