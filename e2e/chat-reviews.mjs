// Synthetic APIs only: no prompts, real session writes or acceptance of user work.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { localDate } from "../extension/robin/dates.ts";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const output = "/tmp/pi-chat-reviews";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", reducedMotion: "reduce" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => { localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-theme", "glass"); });
  let reviews = [], reads = 0, failRead = false, failWrite = false, releaseWrite, holdWrite = false;
  const writes = [], errors = [];
  await context.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path === "/api/sessions/reviews") {
      if (req.method() === "GET") { reads++; return route.fulfill({ status: failRead ? 503 : 200, json: failRead ? { error: "Unavailable" } : { reviews } }); }
      const body = req.postDataJSON(); writes.push(body);
      if (holdWrite) await new Promise(resolve => { releaseWrite = resolve; });
      if (failWrite) return route.fulfill({ status: 500, json: { error: "Save failed" } });
      reviews = reviews.filter(item => item.id !== body.id || item.entryId !== body.entryId);
      return route.fulfill({ json: body });
    }
    assert.equal(req.method(), "GET", `Unexpected mutation: ${path}`);
    const today = localDate();
    const fixtures = {
      "/api/robin/todos": { today, todos: [] }, "/api/robin/events": { today, events: [{ id: "noon", title: "14795: Progress Milestone Q&A Meeting", date: today, start: "12:00", source: "local" }], google: { connected: true } },
      "/api/robin/links": { links: [] }, "/api/robin/gmail": { today, connected: true, review: null },
      "/api/robin/rounds": { rounds: [] }, "/api/robin/jobs": { jobs: [] },
    };
    return route.fulfill({ json: fixtures[path] ?? {} });
  });
  // Test the native document boundary without starting the real chat runtime.
  await context.route(`${baseURL}/?session=*`, route => route.fulfill({ contentType: "text/html", body: "<h1>Chat destination</h1>" }));
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto("/dashboard?view=daily&cwd=%2Fwrong&session=old-chat");
  await page.addStyleTag({ content: 'nextjs-portal { display:none!important }' });
  const panel = page.locator("#dashboard-chat-reviews");
  await panel.getByText("暂无待验收的对话。", { exact: true }).waitFor();
  const make = (id, title = `完成的任务 ${id}`, entryId = `reply-${id}`) => ({ id, title, entryId, cwd: "/work/a-very-long-project-name-with-no-spaces", completedAt: Date.now() });
  reviews = [make("chat-1", "/skill:apple-design 手机上的 dashboard 要优化有哪些地方"), make("chat-2", "检查实现和测试结果，确认不同手机尺寸下正确显示")];
  await panel.getByRole("status").filter({ hasText: "2 个对话待验收" }).waitFor();
  const accept = panel.locator('li button').first();
  assert.match(await accept.getAttribute('aria-label'), /Noted/);
  assert.equal((await accept.innerText()).trim(), 'Noted');
  const dot = panel.locator('li a > [aria-hidden="true"]').first();
  const circle = await dot.evaluate(el => { const s = getComputedStyle(el); return { radius: s.borderRadius, width: el.getBoundingClientRect().width, color: s.backgroundColor, border: s.borderTopWidth }; });
  assert.equal(circle.radius, '50%'); assert.equal(circle.width, 8); assert.equal(circle.border, '0px');
  const rgb = circle.color.match(/[\d.]+/g).map(Number);
  assert.ok(rgb[1] > rgb[0] && rgb[1] > rgb[2], 'The ready indicator is a small SOLID green dot inside the chat link');
  const firstRow = panel.locator('li').first();
  const closed = () => page.waitForFunction(() => document.querySelector('#dashboard-chat-reviews li').scrollLeft < 1);
  const opened = () => page.waitForFunction(() => { const el = document.querySelector('#dashboard-chat-reviews li'); return el.scrollLeft > 0 && Math.abs(el.scrollLeft - (el.scrollWidth - el.clientWidth)) < 1; });
  await closed();
  // Native focus scrolling exposes the same action without requiring a gesture.
  await firstRow.locator('a').focus(); await page.keyboard.press('Tab');
  await opened(); assert.ok(await accept.evaluate(el => el === document.activeElement));
  await accept.blur();
  await firstRow.evaluate(el => { el.scrollLeft = 0; }); await closed();
  const cdp = await context.newCDPSession(page);
  const swipe = async (dx, dy = 0, cancel = false) => {
    await firstRow.scrollIntoViewIfNeeded();
    const box = await firstRow.boundingBox(), x = box.x + Math.min(box.width / 2, 130), y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 8, y: y + dy * i / 8 }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  };
  await swipe(100); await closed();
  await swipe(-100); await opened();
  const rowBox = await firstRow.boundingBox(), buttonBox = await accept.boundingBox();
  assert.ok(Math.abs(buttonBox.x + buttonBox.width - (rowBox.x + rowBox.width)) < 1, 'Left swipe reveals Noted at the right edge');
  assert.equal(writes.length, 0, 'A swipe only reveals Noted; even a full swipe never accepts');
  assert.equal(new URL(page.url()).pathname, '/dashboard', 'Swipe must not activate the session link');
  await page.screenshot({ path: `${output}/swipe-noted.png` });
  const priorReads = reads;
  await opened();
  await page.waitForTimeout(2700);
  assert.ok(reads > priorReads); await opened();
  await swipe(100); await closed();
  await swipe(2, -70); await closed();
  await swipe(-60, 0, true);
  assert.equal(writes.length, 0, 'Vertical movement and cancellation never accept');
  // Capture the default state on a fresh document, without an in-flight native snap.
  await page.reload();
  await page.addStyleTag({ content: 'nextjs-portal { display:none!important }' });
  await panel.getByRole('status').filter({ hasText: '2 个对话待验收' }).waitFor();
  await closed();
  const featured = page.locator('[data-daily-featured]');
  await featured.waitFor();
  assert.ok(await featured.locator('strong').evaluate(el => getComputedStyle(el).fontFamily.includes('Segoe UI')));
  assert.equal(await featured.locator('strong').evaluate(el => getComputedStyle(el).fontWeight), '400');
  assert.equal(await featured.locator('strong').evaluate(el => getComputedStyle(el).fontSize), '18px');
  const timeStyle = await featured.locator(':scope > span').nth(1).evaluate(el => ({ family: getComputedStyle(el).fontFamily, size: getComputedStyle(el).fontSize }));
  assert.ok(timeStyle.family.includes('Segoe UI')); assert.equal(timeStyle.size, '34px');
  for (const theme of ['glass', 'glass-dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle('dark', theme.includes('dark')); }, theme);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await panel.locator('ul').evaluate(el => (getComputedStyle(el).backdropFilter || getComputedStyle(el).webkitBackdropFilter).includes('blur')));
      assert.equal(await panel.locator('li a > span > span').first().evaluate(el => getComputedStyle(el).fontWeight), '400');
      assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await page.screenshot({ path: `${output}/home-${theme}-${width}.png` });
    }
  }
  await page.emulateMedia({ contrast: 'more' });
  assert.equal(await panel.locator('ul').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
  await page.emulateMedia({ contrast: 'no-preference' });
  reviews = [make("chat-1", "检查这份实现和测试结果，确认在不同手机尺寸以及中英文界面下都能够正确显示"), make("chat-2"), make("chat-3"), make("chat-4")];
  await panel.getByRole("status").filter({ hasText: "4 个对话待验收" }).waitFor();
  assert.equal(await panel.locator("li:visible").count(), 3);
  await panel.locator("summary").click();
  assert.equal(await panel.locator("li:visible").count(), 4);
  assert.equal(await panel.locator('li').last().evaluate(el => el.scrollLeft), 0, 'Initially hidden rows also start closed');
  assert.equal(await panel.locator("li a").first().getAttribute("href"), "/?session=chat-1");
  assert.match(await page.locator("[data-dashboard-chat]").getAttribute("aria-label"), /4 个对话待验收/);
  for (const theme of ["glass", "glass-dark", "dark"]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle('dark', theme.includes('dark')); }, theme);
    for (const [width, height] of [[320, 844], [375, 844], [812, 390]]) {
      await page.setViewportSize({ width, height });
      assert.ok(await page.locator("main").evaluate(el => el.scrollWidth <= el.clientWidth + 1), "No horizontal overflow");
      const badge = page.locator('[data-dashboard-chat] span[aria-hidden="true"]');
      assert.ok(await badge.evaluate(el => el.getBoundingClientRect().width >= 18 && getComputedStyle(el).clipPath === "none"), "Count badge stays visible when the Chat label is hidden on small phones");
      for (const button of await panel.locator("li button").all()) { const box = await button.boundingBox(); assert.ok(box.height >= 44 && box.width >= 44); }
      await page.screenshot({ path: `${output}/${theme}-${width}.png` });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  failWrite = true;
  await panel.locator('li a > [aria-hidden="true"]').first().click();
  await panel.getByRole("alert").waitFor();
  assert.equal(new URL(page.url()).pathname, "/dashboard", "A failed acceptance must not leave the chat review behind");
  assert.equal(await panel.locator('[data-review-id="chat-1"]').count(), 1);
  failWrite = false;
  await panel.locator('li a > [aria-hidden="true"]').first().click();
  await page.waitForURL(url => url.pathname === "/" && url.searchParams.get("session") === "chat-1");
  assert.equal(new URL(page.url()).searchParams.has("cwd"), false);
  assert.deepEqual(writes.slice(0, 2), [{ id: "chat-1", entryId: "reply-chat-1" }, { id: "chat-1", entryId: "reply-chat-1" }]);
  await page.goBack();
  await panel.getByRole("status").filter({ hasText: "3 个对话待验收" }).waitFor();
  await page.reload();
  assert.equal(await panel.locator('[data-review-id="chat-1"]').count(), 0, "One tap keeps the reply removed after navigation and reload");
  reviews = [make("chat-1", "后续的新回复", "another-reply"), ...reviews];
  await panel.getByRole("status").filter({ hasText: "4 个对话待验收" }).waitFor();
  failWrite = true;
  await panel.locator("li button").first().click();
  await panel.getByRole("alert").waitFor();
  assert.equal(await panel.locator('[data-review-id="chat-1"]').count(), 1, "Failed acceptance retains the row");
  failWrite = false; holdWrite = true;
  await panel.locator("li button").first().evaluate(el => { el.click(); el.click(); });
  await page.waitForFunction(() => document.querySelector("#dashboard-chat-reviews li button")?.disabled);
  assert.equal(writes.length, 4, "Duplicate activation is guarded synchronously");
  reviews[0] = make("chat-1", "更新后的结果", "new-reply");
  await panel.getByRole("link", { name: /更新后的结果/ }).waitFor();
  releaseWrite(); holdWrite = false;
  await page.waitForFunction(() => !document.querySelector("#dashboard-chat-reviews li button")?.disabled);
  assert.equal(await panel.getByRole("link", { name: /更新后的结果/ }).count(), 1, "An old acceptance receipt cannot hide a newer reply");
  await panel.locator("li button").first().click();
  await page.waitForFunction(() => !document.querySelector('[data-review-id="chat-1"]'));
  failRead = true;
  await panel.getByRole("status").filter({ hasText: "暂时无法更新" }).waitFor();
  assert.equal(await panel.locator("li:visible").count(), 3, "Failed polling keeps last known rows");
  failRead = false;
  await panel.getByRole("button", { name: "重试", exact: true }).click();
  await panel.getByRole("status").filter({ hasText: "3 个对话待验收" }).waitFor();
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(200);
  const hiddenReads = reads;
  await page.waitForTimeout(2800);
  assert.equal(reads, hiddenReads, "Background tabs pause polling");
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(200);
  assert.ok(reads > hiddenReads, "Returning to the foreground refreshes immediately");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(200);
  const desktopReads = reads;
  await page.waitForTimeout(2800);
  assert.equal(reads, desktopReads, "Desktop does not poll this phone feature");
  assert.deepEqual(errors, []);
  console.log(`PASS chat review navigation, polling, acceptance races and phone layouts; ${output}`);
  await context.close();
} finally { await browser.close(); }
