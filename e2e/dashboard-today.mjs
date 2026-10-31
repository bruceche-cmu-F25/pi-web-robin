// Existing server; every business read/write is mocked. No real tasks are changed.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/dashboard-today.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { localDate, addDays } from '../extension/robin/dates.ts';
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const output = '/tmp/robin-dashboard-today';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => { if (!localStorage.getItem('pi-locale')) localStorage.setItem('pi-locale', 'zh-CN'); localStorage.setItem('pi-theme', 'glass'); });
  const today = localDate(), tomorrow = addDays(today, 1);
  let todos = [
    { id: 'bank', title: '去银行存钱', due: today, done: false, revision: 'v1' },
    { id: 'interview', title: '确认面试时间', due: tomorrow, done: false, revision: 'v2' },
    { id: 'read', title: '读完 React 这一章，整理自己的理解', due: tomorrow, done: false, revision: 'v3' },
    { id: 'undated', title: '以后想读的书', done: false, revision: 'v4' },
  ];
  let events = [
    { id: 'meeting', title: '项目讨论', date: today, start: '10:00', end: '11:00', source: 'local', location: '线上 · Design review' },
    { id: 'walk', title: '和朋友散步', date: today, start: '17:30', end: '18:30', source: 'local' },
  ];
  let links = [{ id: 'course', title: 'Full Stack Open', url: 'https://fullstackopen.com/en/', group: '日常入口', iconCheckedAt: today }, { id: 'notes', title: '我的笔记', url: 'https://github.com/', group: '日常入口', iconCheckedAt: today }];
  let failWrite = false, failRead = false, googleError = false, delayWrite = false;
  const writes = [], errors = [];
  await context.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() !== 'GET') {
      assert.equal(path, '/api/robin/todos'); assert.equal(req.method(), 'PATCH');
      const body = req.postDataJSON(); writes.push(body);
      if (delayWrite) await new Promise(resolve => setTimeout(resolve, body.id === 'bank' ? 800 : 400));
      if (failWrite) return route.fulfill({ status: 409, json: { error: 'Fixture conflict: reload before changing this task' } });
      const index = todos.findIndex(todo => todo.id === body.id);
      assert.equal(body.revision, todos[index].revision);
      todos[index] = { ...todos[index], ...body, revision: `${body.revision}-saved` };
      return route.fulfill({ json: { todo: todos[index], today } });
    }
    if (failRead && ['/api/robin/todos', '/api/robin/events'].includes(path)) return route.fulfill({ status: 503, json: { error: 'Fixture unavailable' } });
    const fixtures = {
      '/api/robin/todos': { today, todos }, '/api/robin/events': { today, events, google: { connected: true, ...(googleError ? { error: 'Fixture partial calendar' } : {}) } },
      '/api/robin/links': { links }, '/api/robin/gmail': { today, connected: true, review: null }, '/api/robin/rounds': { rounds: [] }, '/api/robin/jobs': { configured: true, jobs: [] },
    };
    return route.fulfill({ json: fixtures[path] ?? {} });
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date(`${today}T10:30:00`));
  const load = async () => { await page.goto('/dashboard?view=daily&session=fixture'); await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }); await page.locator('.robin-dashboard-header h1 time').waitFor(); };
  await load();
  await page.getByRole('checkbox', { name: '完成待办：去银行存钱' }).waitFor();
  assert.deepEqual(writes, []);
  await page.locator('[data-daily-featured]').getByText('正在进行', { exact: true }).waitFor();
  assert.ok((await page.locator('[data-daily-featured]').innerText()).includes('项目讨论'));
  const taskBox = await page.getByRole('checkbox', { name: '完成待办：去银行存钱' }).boundingBox();
  const dockBox = await page.locator('.robin-dashboard-dock').boundingBox();
  assert.ok(taskBox.y + taskBox.height < dockBox.y, 'The first actionable deadline is above the dock without scrolling');
  assert.equal(await page.locator('[data-day]').first().isVisible(), false, 'Date browsing is progressive, not permanent chrome');
  const phoneHeading = await page.locator('.robin-dashboard-header h1 time').evaluate(el => ({ family: getComputedStyle(el).fontFamily, weight: getComputedStyle(el).fontWeight, style: getComputedStyle(el).fontStyle, size: getComputedStyle(el).fontSize }));
  assert.equal(phoneHeading.weight, '400');
  assert.equal(phoneHeading.style, 'italic');
  assert.equal(phoneHeading.size, '24px');
  assert.ok(phoneHeading.family.includes('Georgia'), 'Home date uses the shared serif heading typeface');
  assert.ok(await page.locator('#dashboard-daily-view :is(h2, strong)').evaluateAll(nodes => nodes.every(el => getComputedStyle(el).fontWeight === '400')), 'Hierarchy uses size and spacing, not bold');
  assert.ok(await page.locator('[data-tone="tasks"] strong').first().evaluate(el => getComputedStyle(el).fontFamily.includes('Segoe UI')), 'Phone Home uses the native UI typeface, not the desktop monospace body');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('main h1').evaluate(el => getComputedStyle(el).fontStyle), 'italic', 'Desktop heading keeps its existing serif italic treatment');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#daily-links').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('#dashboard-daily-view img[data-link-icon="site"]')].length === 2 && [...document.querySelectorAll('#dashboard-daily-view img[data-link-icon="site"]')].every(img => img.complete && img.naturalWidth > 0));
  assert.deepEqual(await page.locator('#dashboard-daily-view img[data-link-icon="site"]').evaluateAll(images => images.map(img => img.getAttribute('src'))), ['/robin/logos/fullstackopen.com.png', '/robin/logos/github.com.svg']);
  await page.screenshot({ path: `${output}/site-icons.png` });
  await page.locator('.robin-page').evaluate(el => el.scrollTop = 0);
  assert.equal(await page.locator('[data-daily-featured]').count(), 1);
  assert.equal(await page.locator('[data-day]').count(), 7, 'The calendar is available on Today alongside tasks');
  await page.locator('summary').filter({ hasText: '切换日期' }).click();
  await page.locator(`[data-day="${today}"]`).click();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get('dailyDate'), addDays(today, 7));
  await page.goBack();
  await page.locator(`[data-day="${today}"][aria-pressed="true"]`).waitFor();
  assert.equal(await page.locator('#dashboard-daily-view').getByText('以后想读的书').count(), 0, 'No invented deadline for undated intentions');
  assert.equal(new URL(await page.locator('[data-daily-featured]').getAttribute('href'), baseURL).searchParams.get('session'), 'fixture');
  await page.locator('summary').filter({ hasText: '切换日期' }).click();
  await page.clock.setFixedTime(new Date(`${today}T12:00:00`));
  await load();
  await page.locator('[data-daily-featured]').getByText('接下来', { exact: true }).waitFor();
  assert.ok((await page.locator('[data-daily-featured]').innerText()).includes('和朋友散步'), 'A finished morning event no longer leads the afternoon');
  await page.locator('summary').filter({ hasText: '其他日程' }).click();
  await page.getByRole('link', { name: /项目讨论/ }).waitFor();
  await page.locator('summary').filter({ hasText: '其他日程' }).click();
  for (const theme of ['glass', 'glass-dark', 'light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle('dark', theme.endsWith('dark')); }, theme);
    for (const width of [320, 390, 430, 812]) {
      await page.setViewportSize({ width, height: width === 812 ? 390 : 844 });
      await page.locator('.robin-page').evaluate(el => el.scrollTop = 0);
      await page.waitForTimeout(100);
      assert.ok(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${theme}/${width}: no horizontal overflow`);
      const input = await page.getByRole('checkbox').first().boundingBox(); assert.ok(input.width >= 44 && input.height >= 44);
      if (width === 390) await page.screenshot({ path: `${output}/${theme}-390.png` });
      if (width === 320) await page.screenshot({ path: `${output}/${theme}-320.png` });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  failWrite = true;
  await page.getByRole('checkbox', { name: '完成待办：去银行存钱' }).click();
  await page.getByRole('alert').filter({ hasText: 'Fixture conflict' }).waitFor();
  assert.equal(todos[0].done, false);
  assert.equal(await page.getByRole('checkbox', { name: '完成待办：去银行存钱' }).isChecked(), false);
  failWrite = false; delayWrite = true;
  const completion = page.getByRole('checkbox', { name: '完成待办：去银行存钱' });
  await completion.click();
  assert.equal(await completion.isDisabled(), true, 'Pending writes disable the action');
  await page.getByRole('status').filter({ hasText: '已完成：去银行存钱' }).waitFor();
  assert.equal(todos[0].done, true);
  assert.deepEqual(writes.at(-1), { id: 'bank', revision: 'v1', done: true });
  assert.equal(await page.getByRole('checkbox', { name: '完成待办：去银行存钱' }).count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-labelledby')), 'daily-attention', 'Removing the row leaves keyboard focus at the task section');
  await page.getByRole('button', { name: '重新打开', exact: true }).click();
  await completion.waitFor();
  assert.equal(todos[0].done, false);
  assert.deepEqual(writes.at(-1), { id: 'bank', revision: 'v1-saved', done: false }, 'Reopen uses the saved revision, not the pre-completion snapshot');
  assert.equal(writes.length, 3);
  // Different records remain actionable, and out-of-order receipts each retain Undo.
  await completion.click();
  const second = page.getByRole('checkbox', { name: '完成待办：确认面试时间' });
  assert.equal(await second.isEnabled(), true);
  await second.click();
  assert.equal(await completion.isDisabled(), true);
  assert.equal(await second.isDisabled(), true);
  const third = page.getByRole('checkbox', { name: /完成待办：读完/ });
  assert.equal(await third.isEnabled(), true);
  await third.focus();
  await page.getByRole('status').filter({ hasText: '已完成：确认面试时间' }).waitFor();
  await page.getByRole('status').filter({ hasText: '已完成：去银行存钱' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '重新打开', exact: true }).count(), 2);
  assert.equal(await third.evaluate(el => el === document.activeElement), true, 'Late confirmations do not steal focus from another task');
  for (const title of ['去银行存钱', '确认面试时间']) {
    await page.getByRole('status').filter({ hasText: `已完成：${title}` }).locator('..').getByRole('button').click();
    await page.getByRole('checkbox', { name: `完成待办：${title}` }).waitFor();
  }
  assert.equal(writes.length, 7);
  // All-day/spanning events and long unbroken content, not only the happy screenshot.
  events = [{ id: 'trip', title: '跨天旅行' + 'VeryLongUnbrokenTitle'.repeat(12), date: today, endDate: addDays(today, 3), source: 'local' }];
  todos[0].title = 'LongTaskName'.repeat(24);
  links[0].title = 'LongSavedLink'.repeat(20);
  await load();
  await page.locator('[data-daily-allday]').getByText('全天', { exact: true }).waitFor();
  await page.addStyleTag({ content: 'html{font-size:24px!important}' });
  await page.setViewportSize({ width: 320, height: 844 });
  assert.ok(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Large type and unbroken titles do not overflow');
  await page.screenshot({ path: `${output}/large-type.png` });
  await page.emulateMedia({ forcedColors: 'active' });
  assert.equal(await page.locator('[data-daily-allday]').evaluate(el => getComputedStyle(el.parentElement).backdropFilter), 'none');
  await page.emulateMedia({ forcedColors: 'none' });
  // Empty / incomplete reads never make a "free day" promise.
  todos = []; events = []; links = [];
  await load();
  await page.getByText('这一天暂未记录日程。', { exact: true }).waitFor();
  assert.ok(await page.locator('.robin-dashboard-dock').getByRole('button', { name: '日历', exact: true }).isVisible());
  await page.screenshot({ path: `${output}/empty.png` });
  googleError = true; await load();
  await page.getByRole('alert').filter({ hasText: '日历信息不完整' }).waitFor();
  assert.equal(await page.getByText('这一天暂未记录日程。', { exact: true }).count(), 0);
  failRead = true; await load();
  await page.getByRole('alert').filter({ hasText: 'Fixture unavailable' }).first().waitFor();
  assert.equal(await page.getByText('这一天暂未记录日程。', { exact: true }).count(), 0);
  assert.equal(await page.getByText('暂未记录未来两天内截止或逾期的待办。', { exact: true }).count(), 0);
  assert.equal(writes.length, 7);
  assert.deepEqual(errors, []);
  console.log(`PASS Today: four themes, 320–812px, large type, completion/reopen/revisions, failure, empty/partial states; screenshots ${output}`);
} finally { await browser.close(); }
