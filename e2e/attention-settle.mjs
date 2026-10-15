// Existing server, mocked APIs only: no personal email or hiring status is changed.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/attention-settle.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fullstackPlan, practicePlan } from "../extension/robin/learning.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 1100 }, reducedMotion: "reduce", serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) {
    const login = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(login.ok());
  }
  const today = "2030-05-12";
  const rounds = [
    { id: "oa:1", company: "Acme", kind: "oa", status: "open", due: "2030-05-14" },
    { id: "call:1", company: "Example", kind: "interview", status: "open", due: "2030-05-13" },
  ];
  const board = { today, connected: true, review: { day: today, items: [
    { id: "message:1", threadId: "thread:1", subject: "Send documents", next: "Send documents", summary: "Upload the requested documents", category: "document", action: "none", triage: "act", due: today },
  ] } };
  let failNext = false, failReads = false, releaseWrite = null;
  let writeGate = null, signalWrite = null;
  const writes = [];
  await context.route("**/api/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      const body = request.postDataJSON();
      writes.push({ method: request.method(), path, body });
      assert.equal(request.method(), "PATCH");
      assert.ok(path === "/api/robin/gmail" || path === "/api/robin/rounds", `Unexpected write: ${path}`);
      if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { error: "Fixture save failed" } }); }
      if (writeGate) { const gate = writeGate; writeGate = null; signalWrite?.(); await gate; }
      if (path.endsWith("gmail")) {
        assert.equal(body.id, "message:1", "Use the source message id, not the thread or namespaced display id");
        board.review.items[0].done = body.done;
        return route.fulfill({ json: board });
      }
      const round = rounds.find((item) => item.id === body.id);
      assert.ok(round);
      round.status = body.status;
      return route.fulfill({ json: { round } });
    }
    if (failReads && ["/api/robin/gmail", "/api/robin/rounds", "/api/robin/todos"].includes(path)) return route.fulfill({ status: 503, json: { error: "Fixture refresh failed" } });
    const fixtures = {
      "/api/robin/gmail": board, "/api/robin/rounds": { rounds },
      "/api/robin/todos": { today, todos: [] }, "/api/robin/events": { today, events: [], google: { connected: false } },
      "/api/robin/jobs": { jobs: [] }, "/api/robin/links": { links: [] },
      "/api/robin/learning": { practice: practicePlan([], "neetcode150", today), fullstack: fullstackPlan([]) },
    };
    return route.fulfill({ json: fixtures[path] ?? {} });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => { if (!localStorage.getItem("pi-locale")) localStorage.setItem("pi-locale", "en"); });
  await page.goto("/dashboard?calendar=agenda");
  const panel = page.locator("#dashboard-attention");
  const row = (id) => panel.locator(`[data-attention-id="${id}"]`);
  const mail = row("mail:message:1"), oa = row("round:oa:1"), call = row("round:call:1");
  await mail.waitFor();
  const url = page.url();
  assert.equal(await mail.getByRole("button").count(), 1, "Mail offers handled, not hiring-round statuses");
  const done = mail.getByRole("button", { name: /handled/ });
  failNext = true;
  await done.click();
  await panel.getByRole("alert").filter({ hasText: "Fixture save failed" }).waitFor();
  assert.equal(await mail.count(), 1);
  assert.equal(board.review.items[0].done, undefined);

  const writeStarted = new Promise((resolve) => { signalWrite = resolve; });
  writeGate = new Promise((resolve) => { releaseWrite = resolve; });
  const before = writes.length;
  await done.evaluate((button) => { button.click(); button.click(); });
  await page.waitForFunction(() => document.querySelector('[data-attention-id="mail:message:1"]')?.getAttribute("aria-busy") === "true");
  assert.ok(await oa.getByRole("button").first().isDisabled());
  await writeStarted;
  assert.equal(writes.length, before + 1, "Double activation cannot submit twice");
  failReads = true;
  releaseWrite();
  await mail.waitFor({ state: "detached" });
  await panel.getByRole("button", { name: "Undo", exact: true }).waitFor();
  await panel.getByRole("alert").waitFor();
  assert.equal(await mail.count(), 0, "Confirmed settlement survives failed follow-up reads");
  assert.equal(page.url(), url);
  assert.equal(board.review.items[0].done, true);

  // Undo is itself a confirmed write; a failed undo must retain the success notice.
  failNext = true;
  await panel.getByRole("button", { name: "Undo", exact: true }).click();
  await panel.getByRole("alert").filter({ hasText: "Fixture save failed" }).waitFor();
  assert.equal(await mail.count(), 0);
  assert.ok(await panel.getByRole("button", { name: "Undo", exact: true }).isVisible());
  failReads = false;
  await panel.getByRole("button", { name: "Undo", exact: true }).click();
  await mail.waitFor();
  assert.equal(board.review.items[0].done, false);

  for (const status of ["Done", "Missed", "Cancelled"]) {
    await oa.getByRole("button", { name: `Mark “Acme” as ${status}`, exact: true }).click();
    await oa.waitFor({ state: "detached" });
    assert.equal(rounds[0].status, status.toLowerCase());
    assert.equal(page.url(), url);
    await panel.getByRole("button", { name: "Undo", exact: true }).click();
    await oa.waitFor();
    assert.equal(rounds[0].status, "open");
  }
  await call.getByRole("button", { name: "Mark “Example” as Done", exact: true }).click();
  await call.waitFor({ state: "detached" });
  assert.equal(rounds[1].status, "done");

  // Chinese, phone-width controls, and the last item disappearing without navigation.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => localStorage.setItem("pi-locale", "zh-CN"));
  await page.reload();
  await oa.waitFor();
  await oa.scrollIntoViewIfNeeded();
  for (const button of await oa.getByRole("button").all()) {
    const box = await button.boundingBox();
    assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= 390);
  }
  await oa.getByRole("button", { name: "将“Acme”标记为已完成", exact: true }).click();
  await oa.waitFor({ state: "detached" });
  await mail.getByRole("button").click();
  await mail.waitFor({ state: "detached" });
  assert.ok(await panel.isVisible(), "The final success still offers Undo");
  await panel.getByRole("button", { name: "关闭", exact: true }).click();
  await panel.waitFor({ state: "hidden" });
  await page.reload();
  await page.locator("#fullstack-open").waitFor();
  await panel.waitFor({ state: "hidden" });
  assert.equal(new URL(page.url()).pathname, "/dashboard");
  assert.deepEqual(errors, []);
  await context.close();
  console.log("PASS: inline mail/round settlement, undo, duplicate guards, failed writes/refreshes, persistence and mobile Chinese controls");
} finally { await browser.close(); }
