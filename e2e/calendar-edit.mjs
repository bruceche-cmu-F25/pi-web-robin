// Existing dev server; every dashboard API is mocked. Never writes personal calendar data.
// node --env-file-if-exists=.env.local --experimental-strip-types e2e/calendar-edit.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { eventFields } from "../components/robin/calendar-edit.ts";
import { fullstackPlan, practicePlan } from "../extension/robin/learning.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 1800 }, serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) {
    const login = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(login.ok(), `Login failed (${login.status()})`);
  }
  await context.addInitScript(() => {
    if (!localStorage.getItem("pi-locale")) localStorage.setItem("pi-locale", "en");
  });
  const today = "2030-05-13"; // Monday
  let events = [
    { id: "meeting", title: "Local meeting", date: today, start: "09:00", end: "10:30", location: "Office", createdAt: "2030-01-01T00:00:00Z" },
    { id: "trip", title: "Long trip", date: "2030-05-11", endDate: "2030-05-15", createdAt: "2030-01-01T00:00:00Z" },
    { id: "google:1", title: "Google meeting", date: today, start: "11:00", end: "12:00", source: "google" },
  ];
  const writes = [];
  const reads = [];
  let failNext = false;
  let failReads = false;
  let loseCreateResponse = false;
  let delayNext = false;
  let releaseWrite;
  const fixtures = {
    "/api/robin/todos": { today, todos: [] },
    "/api/robin/jobs": { jobs: [], scan: null, minScore: 4, configured: true },
    "/api/robin/rounds": { rounds: [] },
    "/api/robin/links": { links: [] },
    "/api/robin/learning": { practice: practicePlan([], "neetcode150", today), fullstack: fullstackPlan([]) },
  };
  await context.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path !== "/api/robin/events") return route.fulfill({ json: fixtures[path] ?? {} });
    if (req.method() === "GET") {
      reads.push(req.url());
      return failReads ? route.fulfill({ status: 503, json: { error: "Test refresh failed" } })
        : route.fulfill({ json: { events, today, google: { connected: false } } });
    }
    const body = req.postDataJSON();
    writes.push({ method: req.method(), body });
    if (delayNext) { delayNext = false; await new Promise((resolve) => { releaseWrite = resolve; }); }
    if (failNext) { failNext = false; return route.fulfill({ status: 500, json: { error: "Test save failed" } }); }
    if (req.method() === "PATCH") {
      const index = events.findIndex((event) => event.id === body.id);
      assert.ok(index >= 0 && events[index].source !== "google");
      if (JSON.stringify(body.expected) !== JSON.stringify(eventFields(events[index]))) return route.fulfill({ status: 409, json: { error: "Event changed elsewhere" } });
      events[index] = { ...events[index], ...body.changes };
      return route.fulfill({ json: { event: events[index] } });
    }
    if (req.method() === "POST") {
      const existing = body.requestId && events.find((event) => event.requestId === body.requestId);
      const event = existing || { ...body, id: `new-${writes.length}`, createdAt: "2030-01-01T00:00:00Z" };
      if (!existing) events.push(event);
      if (loseCreateResponse) { loseCreateResponse = false; return route.abort("failed"); }
      return route.fulfill({ json: { event } });
    }
    if (req.method() === "DELETE") {
      events = events.filter((event) => event.id !== body.id);
      return route.fulfill({ json: { success: true } });
    }
    throw new Error(`Unexpected write: ${req.method()}`);
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const card = page.locator(".robin-calendar");
  const form = page.locator("#robin-calendar-form");
  const event = (id) => card.locator(`[data-calendar-event="${id}"]`).first();
  const cell = (date, timed = true) => card.locator(`[data-calendar-date="${date}"]${timed ? "[data-calendar-minute]" : ":not([data-calendar-minute])"}`).first();
  const point = async (date, minute) => {
    const c = cell(date, minute !== undefined);
    const rect = await c.boundingBox();
    if (minute === undefined) return { x: rect.x + rect.width / 2, y: rect.y + rect.height - 8 };
    const first = Number(await c.getAttribute("data-calendar-minute"));
    return { x: rect.x + rect.width / 2, y: rect.y + (minute - first) * 56 / 60 };
  };
  const drag = async (id, target, { cancel, sourcePoint } = {}) => {
    const rect = await event(id).boundingBox();
    const from = sourcePoint ?? { x: rect.x + rect.width / 2, y: rect.y + 8 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 12 });
    if (cancel) await page.keyboard.press("Escape");
    await page.mouse.up();
  };
  const settled = async () => page.waitForFunction(() => document.querySelector('[aria-busy="true"]') === null);
  await page.goto("/dashboard?calendar=week");
  await event("meeting").waitFor();

  // Clicking still opens details, with a keyboard/touch alternative to dragging.
  await event("meeting").click();
  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  await form.waitFor();
  assert.equal(await form.getByLabel("Start time", { exact: true }).inputValue(), "09:00");
  await form.getByRole("button", { name: /^cancel$/i }).click();

  // Google-style empty-space drag opens a quick editor without moving the surrounding page.
  const selectRange = async (from, to, cancel = false) => {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    if (cancel) await page.keyboard.press("Escape");
    await page.mouse.up();
  };
  const scrollBefore = await card.locator('[data-calendar-scroll]').evaluate((node) => node.scrollTop);
  await selectRange(await point("2030-05-16", 13 * 60 + 18), await point("2030-05-16", 14 * 60 + 32));
  await form.waitFor();
  assert.equal(await form.getByLabel("Start time", { exact: true }).inputValue(), "13:15");
  assert.equal(await form.getByLabel("End time", { exact: true }).inputValue(), "14:45");
  assert.equal(await card.locator('[data-calendar-scroll]').evaluate((node) => node.scrollTop), scrollBefore);
  await form.getByRole("button", { name: /^cancel$/i }).click();
  await selectRange(await point("2030-05-16", 13 * 60), await point("2030-05-16", 14 * 60), true);
  assert.equal(await form.count(), 0);
  assert.equal(writes.length, 0);
  // The requested 06:00–21:00 range is laid out without a nested vertical viewport.
  const fullDay = await card.locator('[data-calendar-scroll]').evaluate((node) => ({ height: node.clientHeight, content: node.scrollHeight }));
  assert.ok(fullDay.height >= 15 * 56 && fullDay.content <= fullDay.height + 1, `Time range must fit: ${JSON.stringify(fullDay)}`);
  assert.equal(await cell(today).locator('[data-calendar-create]').count(), 15);
  assert.equal(await cell(today).getAttribute('data-calendar-minute'), '360');
  assert.equal((await cell(today).boundingBox()).height, 15 * 56);
  await cell(today).getByRole("button", { name: `New event · ${today} · 06:00`, exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await form.getByLabel("Start time", { exact: true }).inputValue(), "06:00");
  await form.getByRole("button", { name: /^cancel$/i }).click();
  await cell(today).getByRole('button', { name: `New event · ${today} · 20:00`, exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await form.getByLabel('Start time', { exact: true }).inputValue(), '20:00');
  assert.equal(await form.getByLabel('End time', { exact: true }).inputValue(), '21:00');
  await form.getByRole('button', { name: /^cancel$/i }).click();

  const target = await point("2030-05-14", 11 * 60 + 8);
  await drag("meeting", target);
  await page.waitForFunction(() => document.querySelector('[data-calendar-date="2030-05-14"] [data-calendar-event="meeting"]'));
  assert.equal(writes.length, 1);
  assert.equal(events[0].date, "2030-05-14");
  assert.equal(events[0].start, "11:00");
  assert.equal(events[0].end, "12:30");
  assert.equal(await page.locator("dialog[open]").count(), 0, "Drop must not open details");
  await settled();

  // Escape and outside drops don't persist; Google cannot start a move.
  await drag("meeting", await point("2030-05-15", 12 * 60), { cancel: true });
  await drag("meeting", { x: 5, y: 5 });
  await drag("google:1", await point("2030-05-15", 12 * 60));
  assert.equal(writes.length, 1);
  assert.equal(await event("google:1").getAttribute("data-calendar-draggable"), null);
  const googleDialog = page.locator('dialog[open]');
  await googleDialog.getByText(/Please edit it in Google Calendar/).waitFor();
  assert.equal(await googleDialog.getByRole("link", { name: "Open Google Calendar to edit" }).getAttribute("href"), "https://calendar.google.com/calendar/u/0/r");
  assert.equal(await page.getByRole("button", { name: "Edit event", exact: true }).count(), 0);
  await page.keyboard.press("Escape");
  await event("google:1").click();
  await googleDialog.getByText(/Please edit it in Google Calendar/).waitFor();
  await page.keyboard.press("Escape");
  events[2].url = "https://calendar.google.com/calendar/event?eid=fixture";

  // Failure leaves the original schedule intact and announces the error.
  failNext = true;
  await drag("meeting", await point("2030-05-16", 12 * 60 + 8));
  await card.getByRole("alert").filter({ hasText: "Test save failed" }).waitFor();
  await settled();
  assert.equal(events[0].date, "2030-05-14");
  assert.equal(await cell("2030-05-14").locator('[data-calendar-event="meeting"]').count(), 1);

  // Pull only the bottom edge to resize; the start stays fixed and Google has no resize handle.
  for (const [minute, end] of [[13 * 60, "13:00"], [12 * 60 + 30, "12:30"]]) {
    const handle = await event("meeting").locator('[data-calendar-resize]').boundingBox();
    await drag("meeting", await point("2030-05-14", minute), { sourcePoint: { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 } });
    await settled();
    assert.equal(events[0].start, "11:00");
    assert.equal(events[0].end, end);
  }
  assert.equal(await event("google:1").locator('[data-calendar-resize]').count(), 0);

  // Empty week slot seeds a snapped hour, failed create keeps the draft, slow saves can't double-submit.
  const slot = await point("2030-05-16", 14 * 60 + 22);
  await page.mouse.click(slot.x, slot.y);
  await form.waitFor();
  assert.equal(await form.locator('input[type="date"]').first().inputValue(), "2030-05-16");
  assert.equal(await form.getByLabel("Start time", { exact: true }).inputValue(), "14:15");
  assert.equal(await form.getByLabel("End time", { exact: true }).inputValue(), "15:15");
  await form.getByLabel("Event…", { exact: true }).fill("Created from week");
  failNext = true;
  await form.locator('button[type="submit"]').click();
  await settled();
  assert.equal(await form.getByLabel("Event…", { exact: true }).inputValue(), "Created from week");
  const countBeforeSave = writes.length;
  delayNext = true;
  await form.locator('button[type="submit"]').click();
  for (let i = 0; !releaseWrite && i < 500; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(releaseWrite, "Save request should arrive");
  await form.evaluate((node) => { node.requestSubmit(); node.requestSubmit(); });
  assert.equal(writes.length, countBeforeSave + 1);
  releaseWrite();
  await form.waitFor({ state: "detached" });
  await settled();
  assert.equal(events.filter((e) => e.title === "Created from week").length, 1);

  // The empty all-day band remains a creation target.
  const allDay = await point("2030-05-19");
  await page.mouse.click(allDay.x, allDay.y);
  await form.waitFor();
  assert.equal(await form.getByLabel("Start time", { exact: true }).count(), 0);
  await form.getByRole("button", { name: /^cancel$/i }).click();

  // Month: create in a blank cell without navigating; date numbers still navigate.
  await card.getByLabel("Calendar view", { exact: true }).selectOption("month");
  await cell("2030-05-20", false).waitFor();
  assert.equal(await card.locator('[data-calendar-heading]').innerText(), 'May 2030');
  assert.equal(await card.locator('[data-calendar-date]').count(), 35);
  await card.getByRole('button', { name: 'Next', exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get('date') === '2030-06-01');
  await cell('2030-06-30', false).waitFor();
  assert.ok(reads.some((url) => new URL(url).searchParams.get('to') === '2030-06-30'));
  await card.getByRole('button', { name: 'Previous', exact: true }).click();
  await cell('2030-05-01', false).waitFor();
  await card.getByLabel('My calendar', { exact: true }).uncheck();
  assert.equal(await event('meeting').count(), 0);
  assert.equal(await event('google:1').count(), 1);
  await card.getByLabel('My calendar', { exact: true }).check();
  await event('meeting').waitFor();
  await selectRange(await point('2030-05-20'), await point('2030-05-22'));
  await form.waitFor();
  assert.equal(await form.locator('input[type="date"]').first().inputValue(), '2030-05-20');
  assert.equal(await form.locator('input[type="date"]').last().inputValue(), '2030-05-22');
  await form.getByRole('button', { name: /^cancel$/i }).click();
  const blank = await point("2030-05-20");
  await page.mouse.click(blank.x, blank.y);
  await form.waitFor();
  assert.ok(page.url().includes("calendar=month"));
  assert.equal(await form.locator('input[type="date"]').first().inputValue(), "2030-05-20");
  assert.equal(await form.getByLabel("Start time", { exact: true }).count(), 0);
  await form.getByLabel("Event…", { exact: true }).fill("Created from month");
  await form.locator('button[type="submit"]').click();
  await form.waitFor({ state: "detached" });
  await settled();

  await drag("meeting", await point("2030-05-21"));
  await settled();
  assert.equal(events[0].date, "2030-05-21");
  assert.equal(events[0].start, "11:00");
  assert.equal(events[0].end, "12:30");

  const beforeGoogleMonthDrag = writes.length;
  await drag("google:1", await point("2030-05-22"));
  await googleDialog.getByText(/Please edit it in Google Calendar/).waitFor();
  assert.equal(await googleDialog.getByRole("link", { name: "Open Google Calendar to edit" }).getAttribute("href"), events[2].url);
  assert.equal(writes.length, beforeGoogleMonthDrag, "Google drag must never write locally");
  await page.keyboard.press("Escape");

  // Drag a clipped multi-day bar from its middle: shift the range, not its first day to the drop day.
  const trip = await cell("2030-05-14", false).locator("../..").locator('[data-calendar-event="trip"]').boundingBox();
  const grabbed = await cell("2030-05-14", false).boundingBox();
  await drag("trip", await point("2030-05-17"), { sourcePoint: { x: grabbed.x + grabbed.width / 2, y: trip.y + 8 } });
  await settled();
  assert.equal(events[1].date, "2030-05-14");
  assert.equal(events[1].endDate, "2030-05-18");

  // Stale data from another tab is rejected rather than overwritten.
  events[0] = { ...events[0], title: "Changed in another tab" };
  await drag("meeting", await point("2030-05-22"));
  await card.getByRole("alert").filter({ hasText: "Event changed elsewhere" }).waitFor();
  await settled();
  assert.equal(events[0].date, "2030-05-21");

  // Keyboard access to creation and editing (no drag required).
  const createButton = cell("2030-05-23", false).locator("[data-calendar-create]");
  await createButton.focus(); await page.keyboard.press("Enter");
  await form.waitFor();
  assert.equal(await form.locator('input[type="date"]').first().inputValue(), "2030-05-23");
  await form.getByRole("button", { name: /^cancel$/i }).click();
  await event("meeting").focus(); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  await form.locator('input[type="date"]').first().fill("2030-05-22");
  await form.locator('button[type="submit"]').click();
  await form.waitFor({ state: "detached" });
  await settled();
  assert.equal(events[0].date, "2030-05-22");
  assert.equal(events[0].location, "Office");
  // A committed save must render from its response, even when the following Google-backed GET fails.
  failReads = true;
  await drag("meeting", await point("2030-05-23"));
  await card.getByRole("alert").filter({ hasText: "Test refresh failed" }).waitFor();
  await settled();
  assert.equal(await cell("2030-05-23", false).locator('[data-calendar-event="meeting"]').count(), 1,
    "A failed refresh must not visually undo a successful save");
  failReads = false;

  // The POST committed, but the response was lost. Retrying the draft must be idempotent.
  const retrySlot = await point("2030-05-24");
  await page.mouse.click(retrySlot.x, retrySlot.y);
  await form.getByLabel("Event…", { exact: true }).fill("Lost response draft");
  loseCreateResponse = true;
  await form.locator('button[type="submit"]').click();
  await settled();
  assert.equal(await form.count(), 1);
  await form.locator('button[type="submit"]').click();
  await form.waitFor({ state: "detached" });
  await settled();
  assert.equal(events.filter((event) => event.title === "Lost response draft").length, 1);
  const retried = writes.filter((write) => write.body.title === "Lost response draft");
  assert.match(retried[0].body.requestId, /^[a-f0-9]{32}$/);
  assert.equal(retried[0].body.requestId, retried[1].body.requestId);

  // Closing an in-flight deletion then opening another event must not let the old completion close it.
  const disposable = events.find((event) => event.title === "Lost response draft");
  await event(disposable.id).click();
  delayNext = true;
  releaseWrite = undefined;
  await page.getByRole("button", { name: "Delete event", exact: true }).click();
  for (let i = 0; !releaseWrite && i < 500; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(releaseWrite, "Delete request should arrive");
  await page.keyboard.press("Escape");
  await event("google:1").click();
  releaseWrite();
  await settled();
  assert.equal(await page.locator('dialog[open]').getByRole("heading", { name: "Google meeting" }).count(), 1);
  await page.keyboard.press("Escape");

  await card.getByRole("button", { name: "View 2030-05-23", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("calendar") === "day");
  await cell('2030-05-23').waitFor();
  assert.equal(await card.locator('[data-calendar-minute]').count(), 1);
  // Real touch pointer events, not synthetic React callbacks; touch cancellation must never save.
  await page.setViewportSize({ width: 390, height: 1100 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  events[0] = { ...events[0], date: today, start: "09:00", end: "10:30" };
  await page.goto("/dashboard?calendar=week");
  await event("meeting").waitFor();
  await event("meeting").scrollIntoViewIfNeeded();
  const touchDrag = async (cancel = false, id = "meeting") => {
    // Keep this duration test away from page edges; edge auto-scroll is tested separately.
    await event(id).evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    const rect = await event(id).boundingBox();
    const x = rect.x + rect.width / 2, y = rect.y + 8;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + i * 7 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
  };
  const beforeTouch = writes.length;
  await touchDrag();
  await settled();
  assert.equal(writes.length, beforeTouch + 1);
  assert.equal(events[0].start, "10:00");
  assert.equal(events[0].end, "11:30");
  assert.equal(await page.locator("dialog[open]").count(), 0);
  await touchDrag(true);
  assert.equal(writes.length, beforeTouch + 1);
  await touchDrag(false, "google:1");
  await googleDialog.getByText(/Please edit it in Google Calendar/).waitFor();
  assert.equal(writes.length, beforeTouch + 1);
  await page.keyboard.press("Escape");
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await page.setViewportSize({ width: 1600, height: 1100 });
  if (process.env.E2E_SCREENSHOT_DIR) {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
    await card.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/calendar-week.png` });
    await card.getByLabel("Calendar view", { exact: true }).selectOption("month");
    await card.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/calendar-month.png` });
  }
  // Wheel and drag-edge scrolling now move the page, not a nested calendar viewport.
  await page.goto('/dashboard?calendar=week');
  await cell(today).waitFor();
  const dashboard = page.locator('.robin-dashboard');
  const wheelPoint = await point(today, 6 * 60 + 30);
  await page.mouse.move(wheelPoint.x, wheelPoint.y);
  await page.mouse.wheel(0, 300);
  await page.waitForFunction(() => document.querySelector('.robin-dashboard').scrollTop > 100);
  assert.equal(await card.locator('[data-calendar-scroll]').evaluate((node) => node.scrollTop), 0);
  await dashboard.evaluate((node) => node.scrollTo({ top: 0, behavior: 'instant' }));
  const beforeEdgeDrag = writes.length;
  const edgeStart = await point('2030-05-15', 10 * 60);
  await page.mouse.move(edgeStart.x, edgeStart.y);
  await page.mouse.down();
  await page.mouse.move(edgeStart.x, 1090, { steps: 10 });
  await page.waitForFunction(() => document.querySelector('.robin-dashboard').scrollTop > 32);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(writes.length, beforeEdgeDrag);
  assert.equal(await form.count(), 0);
  const lateSlot = cell(today).getByRole('button', { name: `New event · ${today} · 20:00`, exact: true });
  await lateSlot.scrollIntoViewIfNeeded();
  assert.ok((await lateSlot.boundingBox()).y < 1100, 'Late hours are reachable through page scrolling');
  assert.equal(await card.locator('[data-calendar-scroll]').evaluate((node) => node.scrollTop), 0);

  // Dense all-day calendars must not cover the whole time grid or steal timed hit targets.
  for (let i = 0; i < 18; i++) events.push({ id: `dense:${i}`, title: `All day ${i}`, date: today });
  await page.goto('/dashboard?calendar=week');
  await cell(today).waitFor();
  assert.ok((await card.locator('[data-calendar-sticky]').boundingBox()).height <= 260);
  await cell(today).getByRole('button', { name: `New event · ${today} · 12:00`, exact: true }).scrollIntoViewIfNeeded();
  const denseSlot = await point(today, 12 * 60 + 8);
  await page.mouse.click(denseSlot.x, denseSlot.y);
  await form.waitFor();
  assert.equal(await form.getByLabel('Start time', { exact: true }).inputValue(), '12:00');
  await form.getByLabel('Event…', { exact: true }).fill('Unsaved draft');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.keyboard.press('Escape');
  assert.equal(await form.count(), 1, 'Dismissing discard confirmation keeps the draft');
  page.once('dialog', (dialog) => dialog.accept());
  await page.keyboard.press('Escape');
  assert.equal(await form.count(), 0);
  events = events.filter((event) => !event.id.startsWith('dense:'));

  // Boundary events are clipped to the requested hours; records outside the window are retained.
  events.push(
    { id: 'early', title: 'Early boundary', date: today, start: '05:30', end: '06:30' },
    { id: 'late', title: 'Late boundary', date: today, start: '20:30', end: '22:00' },
    { id: 'night', title: 'Night event', date: today, start: '02:00', end: '03:00' },
  );
  await page.goto('/dashboard?calendar=day');
  await card.locator('[data-single="true"]').waitFor();
  await event('early').waitFor();
  const timeBounds = await cell(today).boundingBox();
  const earlyBounds = await event('early').boundingBox(), lateBounds = await event('late').boundingBox();
  assert.ok(Math.abs(earlyBounds.y - timeBounds.y) < 1);
  assert.ok(lateBounds.y + lateBounds.height <= timeBounds.y + timeBounds.height);
  assert.equal(await event('late').locator('[data-calendar-resize]').count(), 0, 'A clipped edge is not the actual event end');
  assert.equal(await event('night').count(), 0);
  assert.ok(events.some((item) => item.id === 'night'), 'Changing displayed hours never deletes an event');

  // Chinese copy and an unsafe/missing deep link still offer a safe Google Calendar destination.
  events.find((event) => event.id === "google:1").url = "javascript:alert(1)";
  await page.evaluate(() => localStorage.setItem("pi-locale", "zh-CN"));
  await page.goto("/dashboard?calendar=week");
  await event("google:1").click();
  await googleDialog.getByText("这是来自 Google 日历的日程，请到 Google 日历修改；这里不会保存更改。").waitFor();
  assert.equal(await googleDialog.getByRole("link", { name: "去 Google 日历修改" }).getAttribute("href"), "https://calendar.google.com/calendar/u/0/r");
  assert.deepEqual(errors, []);
  await context.close();
  console.log("PASS: calendar day/week/month navigation, source filters, range selection, drag/resize, touch, dense calendars, read-only guidance and save guards");
} finally { await browser.close(); }
