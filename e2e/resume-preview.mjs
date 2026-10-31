// Synthetic source only. One real HTTP compilation, then controlled response races.
// No personal resume writes or paid model calls.
// node --env-file-if-exists=.env.local --experimental-strip-types e2e/resume-preview.mjs
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createJiti } from "jiti";
import { chromium } from "playwright";
import { RESUME_TEMPLATE } from "../extension/robin/resume.ts";
const { compileResumePreview } = await createJiti(import.meta.url).import("../lib/resume-preview.ts");
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const out = "/tmp/robin-resume-preview";
mkdirSync(out, { recursive: true });
const original = await compileResumePreview(RESUME_TEMPLATE);
const revised = await compileResumePreview(RESUME_TEMPLATE.replace("[Your name]", "Rendered Candidate").replace("\\end{document}", "\\newpage Second page\\end{document}"));
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  for (const [width, height, theme] of [[1440, 1000, "light"], [390, 844, "dark"], [320, 740, "light"], [812, 375, "dark"]]) {
    const context = await browser.newContext({ baseURL, viewport: { width, height }, reducedMotion: "reduce", serviceWorkers: "block" });
    if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
    await context.addInitScript(({ theme }) => { localStorage.setItem("pi-locale", "en"); localStorage.setItem("pi-theme", theme); }, { theme });
    const calls = [], writes = [], errors = [];
    let real = width === 1440, gate;
    await context.route("**/api/**", async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path === "/api/robin/resume/preview") {
        const { source } = req.postDataJSON(); calls.push(source);
        if (real) { real = false; return route.continue(); }
        if (source.includes("slow A") && gate) await gate;
        if (source.includes("broken")) return route.fulfill({ status: 422, json: { error: "resume.tex:42: Undefined control sequence." } }).catch(() => {});
        return route.fulfill({ json: source === RESUME_TEMPLATE || source.includes("slow A") ? original : revised }).catch(() => {});
      }
      if (path === "/api/robin/resume" && req.method() === "GET") return route.fulfill({ json: { document: { source: RESUME_TEMPLATE, revision: "1", updatedAt: "2026-10-01T00:00:00Z" }, hasProfile: false } });
      if (path === "/api/robin/resume" && req.method() === "POST") {
        const { source } = req.postDataJSON();
        return route.fulfill({ json: { proposal: { source: source.replace("[Your name]", "Agent Candidate"), summary: "Changed the fixture heading.", questions: [] }, sessionId: "preview-test" } });
      }
      if (req.method() !== "GET") { writes.push(`${req.method()} ${path}`); throw new Error("Unexpected write"); }
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
    await page.goto("/dashboard/jobs/resume");
    const source = page.getByRole("textbox", { name: "LaTeX source", exact: true });
    const preview = page.locator("#resume-preview");
    const ready = () => preview.getByText("Preview matches the current draft.", { exact: true }).waitFor();
    const stale = () => preview.getByText("Previous preview — it does not match the current source. PDF download is disabled until the latest draft compiles.", { exact: true }).waitFor();
    const download = preview.getByRole("button", { name: "Download PDF", exact: true });
    const refresh = preview.getByRole("button", { name: "Recompile", exact: true });
    await ready();
    assert.equal(calls.length, 1);
    if (width === 1440) {
      real = true;
      const aborted = await page.evaluate(async source => {
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 500);
        try { await fetch("/api/robin/resume/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source }), signal: controller.signal }); return false; }
        catch (error) { return error.name === "AbortError"; }
        finally { clearTimeout(timer); }
      }, String.raw`\documentclass{article}\begin{document}\loop\iftrue\repeat\end{document}`);
      assert.equal(aborted, true);
      await page.waitForTimeout(200); real = true;
      const retryStatus = await page.evaluate(async source => (await fetch("/api/robin/resume/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source }) })).status, RESUME_TEMPLATE);
      assert.equal(retryStatus, 200, "HTTP cancellation terminates the real compiler and releases its slot");
    }
    await page.waitForFunction(() => document.querySelector("#resume-preview img")?.naturalWidth > 0);
    await page.getByRole("button", { name: "PDF preview", exact: true }).click();
    assert.equal(await preview.evaluate(el => document.activeElement === el), true);
    await page.screenshot({ path: `${out}/${width}-${theme}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const button of await preview.getByRole("button").all()) assert.ok((await button.boundingBox()).height >= 44);

    if (width === 1440 || width === 390) {
      if (width === 1440) {
        // Real HTTP + real pixels for the reported legacy-font/structured-resume regression.
        real = true;
        const legacy = readFileSync(new URL("../extension/robin/fixtures/resume-legacy.tex", import.meta.url), "utf8");
        await source.fill(legacy); await ready();
        await page.waitForFunction(() => document.querySelector("#resume-preview img")?.naturalWidth > 0);
        assert.equal(calls.at(-1), legacy);
        assert.equal(await source.inputValue(), legacy, "preview does not rewrite legacy source to avoid font errors");
        assert.equal(await download.isDisabled(), false);
        await page.getByRole("button", { name: "PDF preview", exact: true }).click();
        await page.screenshot({ path: `${out}/1440-legacy-structured.png`, fullPage: true });
        // Second report: fractional contact text selects an independently cached optical font.
        const fractional = legacy.replace(String.raw`\usepackage{lmodern}`, "")
          .replace(String.raw`\begin{center}`, String.raw`\begin{center}\fontsize{8.4}{10}\selectfont`)
          .replace(String.raw`\Large\bfseries`, String.raw`\fontsize{21}{23}\selectfont\bfseries`);
        real = true; await source.fill(fractional); await ready();
        assert.equal(calls.at(-1), fractional);
        assert.equal(await source.inputValue(), fractional);
        assert.equal(await download.isDisabled(), false);
        await page.getByRole("button", { name: "PDF preview", exact: true }).click();
        await page.screenshot({ path: `${out}/1440-fractional-fonts.png`, fullPage: true });
      }
      // One debounce for a burst; a valid render never moves typing focus or saves the draft.
      let count = calls.length;
      for (const n of [1, 2, 3]) { await source.fill(RESUME_TEMPLATE + `% rapid ${n}\n`); await page.waitForTimeout(80); }
      await ready(); assert.equal(calls.length, count + 1);
      assert.ok(calls.at(-1).includes("rapid 3"));
      assert.equal(await source.evaluate(el => el === document.activeElement), true);
      assert.equal(await preview.getByText("Page 1 / 2", { exact: true }).count(), 1);
      await preview.getByRole("button", { name: "Next page", exact: true }).click();
      await preview.getByText("Page 2 / 2", { exact: true }).waitFor();
      await preview.getByRole("combobox", { name: "Preview zoom", exact: true }).selectOption("200");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await preview.getByRole("combobox", { name: "Preview zoom", exact: true }).selectOption("100");
      const lastImage = await preview.locator("img").getAttribute("src");
      await source.fill(RESUME_TEMPLATE + "% broken\n"); await stale();
      assert.equal(await download.isDisabled(), true);
      await preview.getByText("resume.tex:42: Undefined control sequence.", { exact: true }).waitFor();
      assert.equal(await preview.locator("img").getAttribute("src"), lastImage);
      assert.ok((await source.inputValue()).includes("broken"));
      await preview.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${out}/${width}-error.png`, fullPage: true });

      // Pause cancels work. A manual retry while paused is one-shot, not implicit auto-enable.
      await preview.getByRole("checkbox", { name: "Auto preview" }).uncheck();
      count = calls.length; await source.fill(RESUME_TEMPLATE + "% paused\n");
      await page.waitForTimeout(1100); assert.equal(calls.length, count);
      await refresh.click(); await ready(); assert.equal(calls.length, count + 1);
      await source.fill(RESUME_TEMPLATE + "% still paused\n");
      await page.waitForTimeout(1100); assert.equal(calls.length, count + 1);
      await preview.getByRole("checkbox", { name: "Auto preview" }).check(); await ready();

      // A late older response cannot replace the newer image or re-enable a stale PDF download.
      let release; gate = new Promise(resolve => { release = resolve; });
      await source.fill(RESUME_TEMPLATE + "% slow A\n");
      await page.waitForRequest(req => req.url().endsWith("/resume/preview") && req.postData().includes("slow A"));
      await source.fill(RESUME_TEMPLATE + "% fast B\n"); await ready();
      const currentImage = await preview.locator("img").getAttribute("src");
      release(); gate = null; await page.waitForTimeout(400);
      assert.equal(await preview.locator("img").getAttribute("src"), currentImage);
      assert.ok((await source.inputValue()).includes("fast B")); assert.equal(await download.isDisabled(), false);
      const downloaded = page.waitForEvent("download"); await download.click();
      assert.equal((await downloaded).suggestedFilename(), "resume.pdf");

      // A direct agent edit automatically triggers the same preview path with the new draft.
      await source.fill(RESUME_TEMPLATE); await ready();
      await page.getByRole("textbox", { name: "What would you like to change?" }).fill("Change the test heading.");
      await page.getByRole("button", { name: "Edit with agent", exact: true }).click();
      await page.waitForFunction(() => document.getElementById("resume-source").value.includes("Agent Candidate"));
      await ready(); assert.ok(calls.at(-1).includes("Agent Candidate"));
      await page.getByRole("button", { name: "Undo last agent edit", exact: true }).click();
      await page.waitForFunction(expected => document.getElementById("resume-source").value === expected, RESUME_TEMPLATE);
      await ready(); assert.equal(calls.at(-1), RESUME_TEMPLATE);
      // Empty source does not compile and cannot download the old PDF.
      count = calls.length; await source.fill(""); await page.waitForTimeout(1100);
      assert.equal(calls.length, count); assert.equal(await download.isDisabled(), true);
    }
    if (width === 320) {
      await page.evaluate(() => localStorage.setItem("pi-locale", "zh-CN"));
      // The initializer sets en on reload; switch through an overridden initializer for this check.
      await context.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
      await page.reload(); await preview.getByText("预览与当前草稿一致。", { exact: true }).waitFor();
      await page.getByRole("button", { name: "PDF 预览", exact: true }).click();
      await page.screenshot({ path: `${out}/320-chinese.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(`Resume preview passed: real HTTP compilation, debounce, focus, races, errors, pause/manual retry, agent edits/undo, PDF download, pagination/zoom and responsive layouts. Screenshots: ${out}`);
} finally { await browser.close(); }
