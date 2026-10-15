// Every dashboard API is mocked: no personal task or calendar writes.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fullstackPlan, practicePlan } from '../extension/robin/learning.ts';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 1800 }, serviceWorkers: 'block' });
  if (process.env.PI_WEB_PASSWORD) {
    const login = await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(login.ok());
  }
  await context.addInitScript(() => localStorage.setItem('pi-locale', localStorage.getItem('pi-locale') || 'en'));
  const today = '2030-05-13';
  let todos = [
    { id: 'single', title: 'My task', due: today, done: false, url: 'https://example.com/task', plannedOn: today, estimateMinutes: 45, revision: 'single-1' },
    { id: 'range', title: 'Multi-day task', startDate: '2030-05-10', due: '2030-05-15', done: false, revision: 'range-1' },
    { id: 'undated', title: 'Undated task', done: false, revision: 'undated-1' },
  ];
  const get = (id) => todos.find((todo) => todo.id === id);
  const writes = [];
  let failNext = false, failReads = false, holdNext = false, release;
  const fixtures = {
    '/api/robin/events': { today, events: [], google: { connected: false } },
    '/api/robin/jobs': { jobs: [], configured: true },
    '/api/robin/rounds': { rounds: [] },
    '/api/robin/links': { links: [] },
    '/api/robin/learning': { practice: practicePlan([], 'neetcode150', today), fullstack: fullstackPlan([]) },
  };
  await context.route('**/api/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() === 'GET') return path === '/api/robin/todos'
      ? route.fulfill(failReads ? { status: 503, json: { error: 'Read failed' } } : { json: { todos, today } })
      : route.fulfill({ json: fixtures[path] ?? {} });
    assert.equal(path, '/api/robin/todos', 'Dragging a task must not create or edit an event');
    assert.equal(req.method(), 'PATCH');
    const body = req.postDataJSON(); writes.push(body);
    if (holdNext) { holdNext = false; await new Promise((resolve) => { release = resolve; }); }
    if (failNext) { failNext = false; return route.fulfill({ status: 500, json: { error: 'Save failed' } }); }
    const current = get(body.id);
    if (!current) return route.fulfill({ status: 404, json: { error: 'Task no longer exists' } });
    if (body.revision !== current.revision) return route.fulfill({ status: 409, json: { error: 'Task changed; reload the latest version before saving' } });
    const saved = { ...current, ...body, revision: `${current.id}-${writes.length + 1}` };
    if (!saved.startDate) delete saved.startDate;
    if (!saved.due) delete saved.due;
    todos = todos.map((todo) => todo.id === saved.id ? saved : todo);
    return route.fulfill({ json: { todo: saved, today } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const card = page.locator('.robin-calendar');
  const grip = (id, side = false) => page.locator(`${side ? '#dashboard-todos' : '.robin-calendar'} [data-calendar-todo="${id}"]`).first();
  const modal = page.getByRole('dialog');
  const until = async (predicate) => {
    for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 50)); }
    assert.ok(predicate(), 'Timed out waiting for mock state');
  };
  const idle = async () => {
    await until(() => !release);
    await page.waitForFunction(() => !document.querySelector('.robin-calendar [data-busy]'));
  };
  const point = async (date, timed = false) => {
    const box = await card.locator(`[data-calendar-date="${date}"]${timed ? '[data-calendar-minute]' : ':not([data-calendar-minute])'}`).first().boundingBox();
    assert.ok(box, `Missing date ${date}`);
    return { x: box.x + box.width / 2, y: box.y + (timed ? 100 : box.height - 8) };
  };
  const drag = async (id, target, { side = false, cancel = false } = {}) => {
    const box = await grip(id, side).boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 10 });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  };
  await page.goto('/dashboard?calendar=week');
  await grip('single').waitFor();
  await drag('single', await point('2030-05-14', true));
  await until(() => get('single').due === '2030-05-14'); await idle();
  assert.deepEqual(writes[0], { id: 'single', revision: 'single-1', startDate: '', due: '2030-05-14' });
  assert.equal(get('single').plannedOn, today); assert.equal(get('single').estimateMinutes, 45);
  assert.equal(get('single').url, 'https://example.com/task');
  assert.equal(await modal.count(), 0, 'A drag must not also open the date editor');
  await page.locator('#dashboard-todos').getByText('tomorrow', { exact: true }).waitFor();

  // Same-day movements and cancellations never issue writes.
  const count = writes.length;
  await drag('single', await point('2030-05-14', true));
  await drag('single', await point('2030-05-15'), { cancel: true });
  await drag('single', { x: 5, y: 5 });
  assert.equal(writes.length, count);

  // A clipped multi-day bar starts before the visible week; keep its grab offset.
  await drag('range', await point('2030-05-16'));
  await until(() => get('range').due === '2030-05-18'); await idle();
  assert.equal(get('range').startDate, '2030-05-13');

  // External sidebar grips can assign a previously absent deadline.
  await drag('undated', await point('2030-05-17'), { side: true });
  await until(() => get('undated').due === '2030-05-17'); await idle();
  await grip('undated').waitFor();

  // Sidebar range drops place the deadline (not the start) on the target date.
  await drag('range', await point('2030-05-19'), { side: true });
  await until(() => get('range').due === '2030-05-19'); await idle();
  assert.equal(get('range').startDate, '2030-05-14');

  // A pending write blocks other changes; success survives a failed refresh.
  holdNext = true;
  await drag('single', await point('2030-05-16'));
  await until(() => Boolean(release));
  const pendingCount = writes.length;
  await drag('undated', await point('2030-05-18'));
  assert.equal(writes.length, pendingCount);
  failReads = true; release(); release = undefined;
  await until(() => get('single').due === '2030-05-16'); await idle();
  assert.ok(await grip('single').count());
  const singleBox = await grip('single').boundingBox(), targetBox = await point('2030-05-16');
  assert.ok(Math.abs(singleBox.x - targetBox.x) < 100, 'Confirmed task stays on its new date even when refresh fails');
  failReads = false;
  await page.reload(); await grip('single').waitFor();

  // Failure and cross-tab conflicts retain server data and expose an error.
  failNext = true;
  await drag('single', await point('2030-05-17'));
  await card.getByRole('alert').filter({ hasText: 'Save failed' }).waitFor(); await idle();
  assert.equal(get('single').due, '2030-05-16');
  get('single').revision = 'changed-elsewhere'; get('single').title = 'Changed elsewhere';
  await drag('single', await point('2030-05-18'));
  await card.getByRole('alert').filter({ hasText: 'Task changed' }).waitFor(); await idle();
  assert.equal(get('single').due, '2030-05-16');

  // Keyboard/click editor retains failed drafts and can clear the deadline.
  await grip('single').focus(); await page.keyboard.press('Enter');
  await modal.getByRole('heading', { name: 'Edit task deadline' }).waitFor();
  const deadline = modal.getByLabel('Deadline (optional)', { exact: true });
  await deadline.fill('2030-05-20'); failNext = true;
  await modal.getByRole('button', { name: 'Save', exact: true }).click();
  await modal.getByRole('alert').filter({ hasText: 'Save failed' }).waitFor();
  assert.equal(await deadline.inputValue(), '2030-05-20');
  await modal.getByRole('button', { name: 'Save', exact: true }).click();
  await modal.waitFor({ state: 'detached' }); await idle();
  assert.equal(get('single').due, '2030-05-20');
  await grip('single', true).click(); await deadline.fill('');
  await modal.getByRole('button', { name: 'Save', exact: true }).click();
  await modal.waitFor({ state: 'detached' }); await idle();
  assert.equal(get('single').due, undefined);

  // Month and agenda use the same date-only move semantics.
  await card.getByLabel('Calendar view', { exact: true }).selectOption('month');
  await grip('undated').waitFor();
  await drag('undated', await point('2030-05-21'));
  await until(() => get('undated').due === '2030-05-21'); await idle();
  await card.getByLabel('Calendar view', { exact: true }).selectOption('agenda');
  await card.locator('details').evaluateAll((nodes) => nodes.forEach((node) => { node.open = true; }));
  await grip('range').waitFor();
  await drag('range', await point(today));
  await until(() => get('range').startDate === '2030-05-13'); await idle();

  // Actual touch pointer events (including cancellation), not mouse emulation.
  await page.goto('/dashboard?calendar=week'); await grip('range').waitFor();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const from = await grip('range').boundingBox(), target = await point('2030-05-15');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x + from.width / 2, y: from.y + from.height / 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [target] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  const beforeTouch = writes.length;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x + from.width / 2, y: from.y + from.height / 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [target] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await until(() => writes.length === beforeTouch + 1); await idle();
  assert.equal(get('range').startDate, '2030-05-15');
  await cdp.detach();

  // Compact week titles expose full content on hover, keyboard focus and explicit activation.
  todos = [
    { ...get('single'), title: 'Prepare the architecture walkthrough and explain the deployment trade-offs in detail', due: today },
    { id: 'second', title: '整理项目设计与面试复盘，说明性能优化过程及最终结果', due: today, done: false, revision: 'second-1' },
    { id: 'unbroken', title: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(3), due: '2030-05-14', done: false, revision: 'unbroken-1' },
  ];
  await page.goto('/dashboard?calendar=week');
  if (process.env.E2E_SCREENSHOT_DIR) await mkdir(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
  for (const width of [1600, 1024, 640, 375, 320, 1024]) {
    await page.setViewportSize({ width, height: 1100 });
    await grip('single').waitFor();
    const taskCard = (todo) => card.locator(`[data-calendar-task="${todo.id}"]`);
    for (const todo of todos) {
      const row = taskCard(todo);
      if (width <= 640) {
        await page.waitForFunction(() => !document.querySelector('.robin-calendar [popover]'));
        assert.equal(await row.getByRole('button', { name: `Show full text: ${todo.title}`, exact: true }).count(), 0);
        const title = row.getByText(todo.title, { exact: true });
        const sizes = await title.locator('..').evaluate((node) => ({ width: node.clientWidth, fullWidth: node.scrollWidth,
          height: node.clientHeight, fullHeight: node.scrollHeight }));
        assert.ok(sizes.height > 0 && sizes.fullHeight <= sizes.height + 1 && sizes.fullWidth <= sizes.width + 1, 'Phone titles show the full text without disclosure controls');
        await row.hover(); await grip(todo.id).focus();
        assert.equal(await row.locator('[popover]').count(), 0, 'Phone hover and focus have no preview surface');
        continue;
      }
      const expand = row.getByRole('button', { name: `Show full text: ${todo.title}`, exact: true });
      await expand.waitFor();
      await row.hover({ trial: true });
      const before = await row.boundingBox();
      assert.ok(before.height < 100, 'Week cards stay compact');
      await row.hover();
      const preview = row.getByRole('dialog');
      await preview.waitFor();
      assert.equal(await preview.getByText(todo.title, { exact: true }).textContent(), todo.title);
      const bounds = await preview.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= 1101);
      assert.ok(bounds.width > before.width, 'The preview is wider than its date column');
      if (todo.id === 'single' && process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/todo-preview-${width}.png` });
      const after = await row.boundingBox();
      assert.equal(after.width, before.width); assert.equal(after.height, before.height);
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height - 8);
      await page.waitForTimeout(300);
      assert.ok(await preview.isVisible(), 'Pointer can enter the preview without dismissing it');
      await page.mouse.move(5, 5);
      await preview.waitFor({ state: 'hidden' });
      await row.hover(); await preview.waitFor();
      await page.keyboard.press('Escape');
      await preview.waitFor({ state: 'hidden' });
      await page.waitForTimeout(300);
      assert.equal(await preview.isVisible(), false, 'Escape must not immediately reopen the preview');
      await page.mouse.move(5, 5);
      await expand.focus(); await page.keyboard.press('Enter');
      await preview.waitFor();
      await page.keyboard.press('Escape');
      await preview.waitFor({ state: 'hidden' });
    }
    const first = await taskCard(todos[0]).boundingBox(), second = await taskCard(todos[1]).boundingBox();
    assert.ok(second.y >= first.y + first.height, 'Task lanes never overlap');
    assert.equal(await taskCard(todos[0]).getByRole('link').getAttribute('href'), 'https://example.com/task');
    assert.ok(await card.locator('[data-calendar-sticky]').evaluate((node) => node.clientHeight <= 260));
    if (process.env.E2E_SCREENSHOT_DIR) {
      await page.locator('.robin-dashboard').evaluate((node) => node.scrollTo({ top: 0, behavior: 'instant' }));
      await card.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/todo-week-${width}.png` });
    }
  }

  // Crossing to phone layout removes even an open desktop preview.
  await card.locator('[data-calendar-task="single"]').hover();
  await card.locator('[data-calendar-task="single"]').getByRole('dialog').waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForFunction(() => !document.querySelector('.robin-calendar [popover]'));
  assert.equal(await card.getByRole('dialog').count(), 0);

  // Phone day view still offers the date editor without needing a second visible date.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => localStorage.setItem('pi-locale', 'zh-CN'));
  await page.goto('/dashboard?calendar=day');
  const taskActions = page.locator('#dashboard-todos .robin-todo-actions').filter({ has: page.locator('[data-calendar-todo="single"]') });
  await taskActions.locator(':scope > summary').click();
  await grip('single', true).click();
  await modal.getByRole('heading', { name: '修改待办截止日期' }).waitFor();
  const modalBox = await modal.boundingBox();
  assert.ok(modalBox.width <= 375 && modalBox.x >= 0);
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log('PASS: todo calendar/sidebar drag, date ranges, touch, cancellation, revisions, save guards, keyboard editor and phone layout');
} finally { await browser.close(); }
