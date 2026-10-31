// All business/model APIs are fixtures. No personal resume writes or paid inference.
// node --env-file-if-exists=.env.local --experimental-strip-types e2e/resume-workspace.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { RESUME_TEMPLATE } from "../extension/robin/resume.ts";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const out = process.env.E2E_SCREENSHOT_DIR ?? "/tmp/robin-resume";
const revised = source => source.replace("[Your name]", "Example Candidate") + "\n% Agent revision\n";
const converted = RESUME_TEMPLATE + "% converted from PDF\n";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  for (const [width, height, theme] of [[1440, 1000, "light"], [390, 844, "dark"], [320, 740, "light"], [812, 375, "dark"]]) {
    const context = await browser.newContext({ baseURL, viewport: { width, height }, reducedMotion: "reduce", serviceWorkers: "block" });
    if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
    await context.addInitScript(({ theme }) => { if (!localStorage.getItem("pi-locale")) localStorage.setItem("pi-locale", "en"); localStorage.setItem("pi-theme", theme); }, { theme });
    let stored = { source: width === 320 ? "" : RESUME_TEMPLATE, revision: "1", updatedAt: width === 320 ? null : "2026-10-01T00:00:00Z" };
    let failSave = false, failPdf = false, invalidAgent = false, saveGate = null, agentGate = null;
    const writes = [], errors = [];
    await context.route("**/api/**", async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path === "/api/robin/resume/preview") return route.fulfill({ status: 503, json: { error: "Preview is mocked off in the editor regression; see resume-preview.mjs." } });
      if (path === "/api/robin/resume/import") {
        assert.match(req.headers()["content-type"], /^multipart\/form-data;/);
        assert.match(req.postDataBuffer().toString(), /filename="candidate.pdf"/);
        writes.push({ method: "IMPORT" });
        if (agentGate) await agentGate;
        if (failPdf) return route.fulfill({ status: 422, json: { error: "Fixture scanned PDF needs OCR" } });
        return route.fulfill({ json: { proposal: { source: converted, summary: "Converted without rewriting candidate facts. Verify the layout.", questions: [] }, sessionId: "fixture-pdf-agent", imported: { name: "candidate.pdf", pages: 2, text: "--- page 1 ---\nAda Example\n--- page 2 ---\nSoftware Engineer, 2024 - 2026" } } }).catch(() => {});
      }
      if (path === "/api/robin/resume") {
        if (req.method() === "GET") return route.fulfill({ json: { document: stored, hasProfile: width !== 320 } });
        const data = req.postDataJSON(); writes.push({ method: req.method(), data });
        if (req.method() === "PUT") {
          if (saveGate) await saveGate;
          if (failSave) return route.fulfill({ status: 500, json: { error: "Fixture disk unavailable" } });
          if (data.revision !== stored.revision) return route.fulfill({ status: 409, json: { error: "Fixture revision conflict" } });
          stored = { ...stored, source: data.source, revision: String(Number(stored.revision) + 1) };
          return route.fulfill({ json: { document: stored } });
        }
        if (agentGate) await agentGate;
        return route.fulfill({ json: { proposal: { source: invalidAgent ? "truncated source" : revised(data.source), summary: "Tightened phrasing. Verify facts before compiling.", questions: ["Confirm your graduation date."] }, sessionId: "fixture-resume-agent" } }).catch(() => {});
      }
      if (req.method() !== "GET") throw new Error(`Unexpected write: ${req.method()} ${path}`);
      const fixtures = {
        "/api/robin/jobs": { jobs: [], scan: null, minScore: 3.75, configured: false },
        "/api/robin/tech-events": { events: [], today: "2026-10-27", scanning: false, scan: null },
        "/api/robin/rounds": { rounds: [] },
        "/api/robin/events": { events: [], google: { connected: false } },
      };
      return route.fulfill({ json: fixtures[path] ?? { todos: [], jobs: [], events: [], links: [], rounds: [], records: [], finals: {} } });
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
    await page.goto("/dashboard/jobs/resume?session=keep&cwd=%2Ftmp%2Fexample");
    const source = page.getByRole("textbox", { name: "LaTeX source", exact: true });
    const save = page.getByRole("button", { name: "Save source", exact: true });
    const generate = page.getByRole("button", { name: "Edit with agent", exact: true });
    const instruction = page.getByRole("textbox", { name: "What would you like to change?" });
    const result = page.getByRole("region", { name: "Latest agent changes", exact: true });
    const undo = page.getByRole("button", { name: "Undo last agent edit", exact: true });
    const stale = page.getByText("You edited the source during generation, so this result was not applied. Ask the agent to edit the current draft again.", { exact: true });
    const waitSource = value => page.waitForFunction(value => document.getElementById("resume-source")?.value === value, value);
    const saveNow = async () => { await save.click(); await page.getByRole("status").filter({ hasText: "Source saved" }).waitFor(); };
    const hideResult = () => result.getByRole("button", { name: "Hide change record", exact: true }).click();
    const jump = async () => {
      const button = result.getByRole("button", { name: /^Go to source line/ }).last();
      const line = Number((await button.textContent()).match(/\d+/)[0]);
      await button.focus(); await page.keyboard.press("Enter");
      const selection = await source.evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, text: el.value.slice(el.selectionStart, el.selectionEnd), focused: document.activeElement === el, scrollTop: el.scrollTop }));
      assert.equal(selection.focused, true);
      assert.equal(selection.text, (await source.inputValue()).split("\n")[line - 1]);
      assert.equal(await page.locator('[class*="gutter"]').evaluate(el => el.scrollTop), selection.scrollTop);
      assert.ok(await source.evaluate(el => el.getBoundingClientRect().bottom > 0 && el.getBoundingClientRect().top < innerHeight));
    };
    await source.waitFor(); assert.equal(await source.inputValue(), stored.source); assert.equal(writes.length, 0);
    const tabs = page.getByRole("navigation", { name: "Job hunt views" });
    assert.equal(await tabs.getByRole("link", { name: "Resume", exact: true }).getAttribute("aria-current"), "page");
    assert.equal(await page.locator('.robin-nav-entry[href^="/dashboard/jobs"]').getAttribute("aria-current"), "page");
    assert.match(await tabs.getByRole("link", { name: "Events", exact: true }).getAttribute("href"), /session=keep/);
    const tabTops = await tabs.getByRole("link").evaluateAll(links => links.map(link => link.getBoundingClientRect().top));
    assert.ok(tabTops.every(top => top === tabTops[0]), "three job tabs fit on one row");
    await page.screenshot({ path: `${out}/${width}-${theme}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const button of await page.locator('[class*="ResumeWorkspace"] button:visible').all()) assert.ok((await button.boundingBox()).height >= 44);

    // PDF conversion writes the editor directly, including an empty workspace; never the server.
    const original = await source.inputValue();
    const pdfInput = page.locator('input[accept^=".pdf"]');
    const fixturePdf = { name: "candidate.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 fixture upload") };
    await pdfInput.setInputFiles(fixturePdf); await waitSource(converted);
    await result.getByText("Converted from candidate.pdf · 2 pages", { exact: true }).waitFor();
    assert.equal(stored.source, original); assert.equal(writes.filter(w => w.method === "PUT").length, 0);
    assert.equal(await page.getByRole("button", { name: "Apply to draft", exact: true }).count(), 0);
    await result.getByText("Compare with extracted PDF text", { exact: true }).click();
    await result.getByText(/Ada Example/).waitFor();
    await jump();
    assert.ok(await result.locator('[data-kind="added"]').count() > 0);
    await result.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/${width}-${theme}-pdf-changes.png`, fullPage: true });
    await undo.click(); await waitSource(original);
    await result.getByText("Agent edit undone. The comparison below is kept for reference.", { exact: true }).waitFor();
    await hideResult();
    failPdf = true; await pdfInput.setInputFiles(fixturePdf);
    await page.getByText("Fixture scanned PDF needs OCR", { exact: true }).waitFor();
    assert.equal(await source.inputValue(), original); failPdf = false;

    if (width === 1440 || width === 390) {
      // A PDF result arriving after manual typing is retained as a conflict, never auto-applied.
      let releasePdf; agentGate = new Promise(resolve => { releasePdf = resolve; });
      await pdfInput.setInputFiles(fixturePdf); await page.getByText(/Converting candidate.pdf/).waitFor();
      await source.fill(original + "% edit while PDF converts\n");
      releasePdf(); agentGate = null; await stale.waitFor();
      assert.equal(await source.inputValue(), original + "% edit while PDF converts\n");
      assert.equal(await result.getByRole("button", { name: /^Go to source line/ }).first().isDisabled(), true);
      await hideResult(); await source.fill(original);
      agentGate = new Promise(resolve => { releasePdf = resolve; });
      await pdfInput.setInputFiles(fixturePdf);
      await page.getByRole("button", { name: "Stop generating", exact: true }).first().click();
      await page.getByText("Generation stopped. Your source is unchanged.", { exact: true }).waitFor();
      releasePdf(); agentGate = null; assert.equal(await source.inputValue(), original);

      const draft = RESUME_TEMPLATE + "% local edits 中文\n";
      await source.fill(draft); failSave = true; await save.click();
      await page.getByText("Fixture disk unavailable", { exact: true }).waitFor();
      assert.equal(await source.inputValue(), draft); assert.equal(stored.source, RESUME_TEMPLATE);
      await page.reload(); await source.waitFor();
      assert.equal(await source.inputValue(), RESUME_TEMPLATE, "recovery never silently overwrites saved text");
      await page.getByRole("button", { name: "Restore draft", exact: true }).click();
      assert.equal(await source.inputValue(), draft); failSave = false; await saveNow();

      // Slow acknowledgements preserve newer edits and their recovery receipt.
      let releaseSave; saveGate = new Promise(resolve => { releaseSave = resolve; });
      await source.fill(draft + "% older snapshot\n"); await save.click();
      await page.getByRole("button", { name: "Saving…", exact: true }).waitFor();
      const newer = draft + "% newer edit\n"; await source.fill(newer);
      releaseSave(); saveGate = null;
      await page.getByRole("status").filter({ hasText: "Unsaved changes" }).waitFor();
      assert.equal(await source.inputValue(), newer); await saveNow();

      await instruction.fill("Tighten wording. Do not invent facts.");
      let releaseAgent; agentGate = new Promise(resolve => { releaseAgent = resolve; });
      await generate.click(); await page.getByRole("button", { name: "Stop generating" }).waitFor();
      const typedDuring = newer + "% typed during generation\n"; await source.fill(typedDuring);
      releaseAgent(); agentGate = null; await stale.waitFor();
      assert.equal(await source.inputValue(), typedDuring);
      assert.equal(writes.findLast(w => w.method === "POST").data.source, newer);
      await hideResult();
      const beforeEditWrites = writes.filter(w => w.method === "PUT").length;
      await generate.click(); await waitSource(revised(typedDuring));
      assert.equal(writes.filter(w => w.method === "PUT").length, beforeEditWrites, "direct agent editing is not a disk save");
      assert.ok(await result.locator('[data-kind="removed"]').count() > 0);
      assert.ok(await result.locator('[data-kind="added"]').count() > 0);
      await jump();
      await result.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/${width}-${theme}-agent-diff.png`, fullPage: true });

      // A malformed result cannot replace the draft or discard the previous diff/undo.
      invalidAgent = true; await generate.click();
      await page.getByText("The agent returned incomplete LaTeX. Your source is unchanged.", { exact: true }).waitFor();
      assert.equal(await source.inputValue(), revised(typedDuring));
      assert.equal(writes.findLast(w => w.method === "POST").data.source, revised(typedDuring), "follow-up reads the agent-updated editor, not the saved CV");
      assert.ok(await result.locator('[data-kind="removed"]').count() > 0);
      invalidAgent = false;
      await source.fill(revised(typedDuring) + "% later typing\n");
      assert.equal(await undo.isDisabled(), true);
      assert.equal(await result.getByRole("button", { name: /^Go to source line/ }).first().isDisabled(), true);
      await source.fill(revised(typedDuring)); await undo.click(); await waitSource(typedDuring);

      // Server conflicts remain explicit; rebasing the save baseline is not an automatic write.
      stored = { ...stored, source: RESUME_TEMPLATE + "% other editor\n", revision: "100" };
      await save.click(); await page.getByText("Fixture revision conflict", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Compare with saved version", exact: true }).click();
      await page.getByRole("button", { name: "Keep my draft against this version", exact: true }).click();
      assert.equal(await source.inputValue(), typedDuring); assert.ok(stored.source.includes("other editor"));
      await saveNow(); assert.equal(stored.source, typedDuring);

      agentGate = new Promise(resolve => { releaseAgent = resolve; });
      await generate.click(); await page.getByRole("button", { name: "Stop generating", exact: true }).click();
      await page.getByText("Generation stopped. Your source is unchanged.", { exact: true }).waitFor();
      releaseAgent(); agentGate = null; assert.equal(await source.inputValue(), typedDuring);
      const imported = RESUME_TEMPLATE + "% imported UTF-8 中文\n";
      await page.locator('input[accept^=".tex"]').setInputFiles({ name: "candidate.tex", mimeType: "text/plain", buffer: Buffer.from(imported) });
      await waitSource(imported);
      const downloaded = page.waitForEvent("download"); await page.getByRole("button", { name: "Download .tex", exact: true }).click();
      assert.equal((await downloaded).suggestedFilename(), "resume.tex");
      await saveNow(); await page.reload(); await waitSource(imported);
      assert.equal(await page.getByRole("button", { name: "Restore draft", exact: true }).count(), 0);
    }
    if (width === 320) {
      await page.evaluate(() => localStorage.setItem("pi-locale", "zh-CN")); await page.reload();
      await page.getByRole("button", { name: "上传 PDF → LaTeX", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `${out}/320-chinese.png`, fullPage: true });
    }
    assert.deepEqual(errors, []); await context.close();
  }
  console.log(`Resume passed: direct PDF/agent edits, numbered diff, keyboard line jump, gutter sync, undo, newer-edit protection, malformed output, recovery, saves and responsive layouts. Screenshots: ${out}`);
} finally { await browser.close(); }
