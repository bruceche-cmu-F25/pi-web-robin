// Read-only fixtures; no contacts, model turns, sends or approval writes.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { DEFAULT_SOCIAL_TEMPLATES } from "../extension/robin/outreach-shape.ts";
import { renderJarvisDraft } from "../extension/robin/jarvis-template.ts";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const at = "2026-10-01T12:00:00Z";
const lead = { id: "current", name: "Dr. Ada Fixture", company: "Fixture Inc", role: "Founder", seniority: "Owner", industry: "Retail", segment: "info_exec", persona: "ecommerce_owner", sourcingLane: "dtc_shopify", audienceFit: "core", assessedVersion: 6, profileUrl: "https://example.org/ada", evidence: "Sourced operator identity", evidenceUrl: "https://example.org/team", needHypothesis: "Unverified interview hypothesis", email: "ada@example.org", emailSource: "https://example.org/team", emailQuote: "Contact ada@example.org", emailCheck: "source_found", socials: { instagram: "https://www.instagram.com/fixture/" }, opener: "I came across your work leading this brand.", subject: "Fixture subject", body: "An edited message, never sent", notes: "Private fixture note", confirmedNeeds: "", reviewed: false, status: "new", createdAt: at, updatedAt: at, history: [{ status: "new", at }] };
const templates = { ...DEFAULT_SOCIAL_TEMPLATES, instagram: "Hi {{firstName}} at {{company}} — {{shortOpener}}\n\nhttps://your-secretary.com" };
const compact = { templateDraftsDeferred: true, leads: [lead, { ...lead, id: "legacy", name: "Legacy Fixture", segment: "clinic", assessedVersion: 2, persona: undefined, sourcingLane: undefined }], run: null, socialTemplates: templates, outbox: { enabled: false } };
const full = { ...compact, templateDraftsDeferred: undefined, leads: compact.leads.map(lead => ({ ...lead, socialTemplateDrafts: Object.fromEntries(Object.entries(templates).map(([platform, body]) => [platform, renderJarvisDraft(lead, { subject: "Social", body }).body])) })) };
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  for (const width of [1440, 390]) {
    const results = [];
    for (const state of [full, compact]) {
      const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
      if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
      await context.addInitScript(() => { localStorage.setItem("pi-locale", "en"); localStorage.setItem("pi-theme", "light"); });
      const writes = [], errors = [], reads = [];
      await context.route("**/api/**", route => {
        const req = route.request(), url = new URL(req.url());
        if (req.method() !== "GET") { writes.push(url.pathname); return route.fulfill({ status: 405, json: { error: "Writes blocked" } }); }
        if (url.pathname === "/api/robin/jarvis") { reads.push(url.search); return route.fulfill({ json: state }); }
        return route.fulfill({ json: { connected: false, configured: false, todos: [], jobs: [], events: [], links: [], rounds: [], records: [], finals: {}, ideas: [], notes: [] } });
      });
      const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
      await page.goto("/outreach/research");
      await page.locator("#jarvis-row-current").waitFor();
      assert.equal(await page.locator("#jarvis-row-legacy").count(), 0);
      const header = await page.locator("main header").first().innerText();
      await page.locator("#jarvis-row-current").click();
      await page.getByRole("tab", { name: "Social", exact: true }).click();
      const social = page.locator("#jarvis-panel-social");
      await social.getByRole("button", { name: "Apply current template", exact: true }).click();
      const drafts = await social.locator("textarea").evaluateAll(nodes => nodes.map(n => n.value));
      assert.ok(drafts.some(text => text.includes("Hi Ada at Fixture Inc")));
      // A fresh read returns to the list without saving that local preview.
      await page.reload(); await page.locator("#jarvis-row-current").waitFor();
      await page.getByText("More filters · persona, ICP review and historical lists", { exact: true }).click();
      await page.getByText("Historical lists and other audiences", { exact: true }).click();
      await page.getByRole("group", { name: "Historical cohorts" }).getByRole("button", { name: /^All\s/ }).click();
      await page.locator("#jarvis-row-legacy").waitFor();
      assert.equal(await page.locator('button[id^="jarvis-row-"]').count(), 2);
      results.push({ header, drafts });
      assert.ok(reads.every(query => query === "?view=compact"));
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      await context.close();
    }
    assert.deepEqual(results[1], results[0], "deferred templates preserve counts, history and exact previews");
    console.log(`PASS ${width}px: compact/full counts, historical list, exact custom template and no writes`);
  }
} finally { await browser.close(); }
