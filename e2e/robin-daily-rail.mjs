// Existing dev server; all business APIs are synthetic. No personal data is written.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/robin-daily-rail.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { addDays, localDate } from '../extension/robin/dates.ts';
import { fullstackPlan, practicePlan } from '../extension/robin/learning.ts';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const output = process.env.E2E_SCREENSHOT_DIR ?? '/tmp/robin-daily-rail';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => { localStorage.setItem('pi-locale', 'zh-CN'); localStorage.setItem('pi-theme', 'glass'); });
  const today = localDate();
  const todos = [
    { id: 'near', title: '今天提交报告', due: today, done: false, revision: 'v1', url: 'https://example.com/task' },
    { id: 'overdue', title: '昨天到期的任务', due: addDays(today, -1), done: false, revision: 'v1' },
    { id: 'later', title: '下个月的安排', due: addDays(today, 30), done: false, revision: 'v1' },
    { id: 'done', title: '已完成的旧记录', done: true, completedAt: '2020-01-01T12:00:00Z', revision: 'v1' },
    ...Array.from({ length: 54 }, (_, i) => ({ id: `task-${i}`, title: `未定日期任务 ${i}`, done: false, revision: 'v1' })),
  ];
  const links = Array.from({ length: 10 }, (_, i) => ({ id: `link-${i}`, title: i === 0 ? '常用网站的很长标题也应该保持可读' : `常用入口 ${i + 1}`, group: '日常入口', url: `https://example.com/${i}`, iconCheckedAt: today }));
  links.push({ id: 'other', title: '参考资料', group: 'Reading', url: 'https://example.com/reference', iconCheckedAt: today });
  const writes = [], errors = [];
  const fixtures = {
    '/api/robin/todos': { todos, today }, '/api/robin/links': { links },
    '/api/robin/events': { events: [], today, google: { connected: false } },
    '/api/robin/jobs': { jobs: [], minScore: 4, configured: false },
    '/api/robin/gmail': { review: null, connected: false, today }, '/api/robin/rounds': { rounds: [] },
    '/api/sessions/reviews': { reviews: [] }, '/api/robin/practice': { records: [], today },
    '/api/robin/learning': { practice: practicePlan([], 'neetcode150', today), fullstack: fullstackPlan([]) },
    '/api/robin/planner': { today, to: addDays(today, 6), todos, events: [], google: { connected: false }, conflicts: [], minuteOfDay: 600, timezone: 'UTC', revision: 'v1' },
  };
  await context.route('**/api/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'GET') return route.fulfill({ json: fixtures[path] ?? {} });
    const body = request.postDataJSON();
    writes.push({ path, method: request.method(), body });
    assert.equal(request.method(), 'POST');
    if (path === '/api/robin/links') {
      const link = { ...body, id: 'new-link', title: '新增常用入口', iconCheckedAt: today };
      links.push(link); return route.fulfill({ json: { link } });
    }
    assert.equal(path, '/api/robin/todos');
    const todo = { ...body, id: 'new-task', done: false, revision: 'v1' };
    todos.push(todo); return route.fulfill({ json: { todo, today } });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const rail = page.locator('#dashboard-todos-view');
  const daily = page.locator('#dashboard-daily-links');
  const tasks = page.locator('#dashboard-todos');
  const viewport = page.locator('.robin-dashboard > .robin-page');
  const summary = id => page.locator(`[data-disclosure="${id}"] > summary`);
  const resetScroll = async () => {
    await viewport.evaluate(node => node.scrollTop = 0);
    await rail.evaluate(node => node.scrollTop = 0);
  };
  await page.goto('/dashboard');
  await daily.locator('.robin-saved-link').nth(5).waitFor();
  assert.equal(await daily.locator('.robin-saved-link').count(), 6);
  assert.equal(await daily.locator('.robin-saved-link').first().getAttribute('target'), '_blank');
  assert.equal(await tasks.getByRole('button', { name: '近期截止', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await tasks.locator('input[type="checkbox"]').count(), 2);
  assert.ok((await tasks.innerText()).includes('未来 7 天'));
  assert.equal(await page.locator('#dashboard-work-queue').count(), 0, 'Collapsed tools remain unmounted');

  for (const width of [960, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['glass', 'glass-dark', 'light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle('dark', theme.endsWith('dark')); }, theme);
      await resetScroll(); await page.waitForTimeout(100);
      const linksBox = await daily.boundingBox(), tasksBox = await tasks.boundingBox();
      assert.ok(linksBox.y + linksBox.height <= tasksBox.y, 'Shortcuts come before tasks in both DOM and layout');
      assert.ok(tasksBox.y < 800, `${width}/${theme}: tasks still start on the first screen`);
      assert.ok(await page.locator('main').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
      assert.ok(await daily.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
      const surfaces = await page.locator('.robin-calendar, #dashboard-more-view').evaluateAll(nodes => nodes.map(node => {
        const style = getComputedStyle(node);
        return { background: style.backgroundColor, radius: style.borderTopLeftRadius, border: style.borderTopWidth };
      }));
      assert.equal(surfaces.length, 2);
      assert.equal(surfaces[0].background, surfaces[1].background, `${width}/${theme}: calendar and reading sheet share the same paper`);
      assert.equal(surfaces[0].radius, surfaces[1].radius);
      assert.equal(surfaces[0].border, surfaces[1].border);
      await page.screenshot({ path: `${output}/${width}-${theme}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetScroll();
  await daily.locator('.robin-links-more').click();
  assert.equal(await daily.locator('.robin-saved-link').count(), 10);
  await daily.locator('.robin-links-more').click();
  assert.equal(await daily.locator('.robin-saved-link').count(), 6);
  // Editing stays explicit; its two fields can use the whole grid width.
  await daily.locator('.robin-link-actions > summary').first().focus();
  await page.keyboard.press('Enter');
  assert.equal(await daily.locator('.robin-link-actions[open]').count(), 1);
  await daily.getByRole('button', { name: '编辑 常用网站的很长标题也应该保持可读', exact: true }).click();
  const name = daily.getByRole('textbox').first();
  await name.fill('未提交的名称'); await name.press('Escape');
  assert.deepEqual(writes, [], 'Opening, expanding and cancelling never writes');

  for (const id of ['dashboard-links', 'fullstack-open']) {
    assert.equal(await page.locator(`#${id}`).isVisible(), true, 'Desktop previews are readable without an accordion');
    assert.equal(await page.locator(`[data-disclosure="${id}"]`).count(), 0);
  }
  assert.equal(await page.locator('#dashboard-planner > details').count(), 0, 'Saved plan slots are not hidden behind a second disclosure');
  assert.equal(await page.locator('#fullstack-open details').count(), 0, 'Desktop learning points to the full workspace instead of stacking disclosures');
  const control = summary('dashboard-work-queue');
  assert.ok((await control.locator('small').innerText()).length > 5, 'Optional planning remains clearly described');
  await control.focus(); await page.keyboard.press('Enter');
  assert.equal(await control.locator('..').getAttribute('open'), '');
  await page.keyboard.press('Enter');
  assert.equal(await control.locator('..').getAttribute('open'), null);
  await page.screenshot({ path: `${output}/readable-sections.png` });
  await summary('dashboard-work-queue').click();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-disclosure="dashboard-work-queue"]')?.open);
  await summary('dashboard-work-queue').click();
  await page.goto('/dashboard#fullstack-open');
  await page.locator('#fullstack-open').waitFor({ state: 'visible' });

  await page.goto('/dashboard?tasks=all&session=fixture');
  await tasks.locator('input[type="checkbox"]').nth(56).waitFor();
  assert.equal(await tasks.getByRole('button', { name: '全部未完成', exact: true }).getAttribute('aria-pressed'), 'true');
  await tasks.getByRole('button', { name: '近期截止', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get('session'), 'fixture');
  await page.goBack();
  await page.waitForFunction(() => document.querySelectorAll('#dashboard-todos input[type="checkbox"]').length === 57);
  await tasks.getByRole('button', { name: '已完成', exact: true }).click();
  assert.ok((await tasks.innerText()).includes('已完成的旧记录'));
  // Record links still open tasks excluded from the near list.
  await page.goto('/dashboard?tasks=near&todo=task-0');
  const dialog = page.getByRole('dialog', { name: '待办详情', exact: true });
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel('任务', { exact: true }).inputValue(), '未定日期任务 0');
  await dialog.getByRole('button', { name: '关闭', exact: true }).first().click();
  assert.deepEqual(writes, []);

  await page.goto('/dashboard');
  await daily.locator('.robin-panel-add').click();
  await daily.locator('input[inputmode="url"]').fill('https://example.com/new');
  await daily.locator('form button[type="submit"]').click();
  await daily.getByRole('link', { name: '新增常用入口', exact: true }).waitFor();
  assert.equal(writes[0].body.group, '日常入口');
  assert.equal(await daily.locator('.robin-saved-link').count(), 11, 'A saved shortcut is revealed, not hidden past the preview');
  await daily.locator('.robin-links-more').click();
  await tasks.locator('.robin-panel-add').click();
  await tasks.locator('#robin-todo-form').getByLabel('任务', { exact: true }).fill('新增无日期待办');
  await tasks.locator('#robin-todo-form button[type="submit"]').click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get('tasks') === 'all');
  assert.ok((await tasks.innerText()).includes('新增无日期待办'));

  // Phone default/layout stays unchanged, and resizing does not destroy task drafts.
  await tasks.locator('.robin-panel-add').click();
  const draft = tasks.locator('form').getByLabel('任务', { exact: true });
  await draft.fill('保留草稿');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('navigation', { name: '首页', exact: true }).getByRole('button', { name: '待办', exact: true }).click();
  await daily.waitFor({ state: 'detached' });
  assert.equal(await draft.inputValue(), '保留草稿');
  await page.goto('/dashboard?view=todos');
  await tasks.getByRole('button', { name: '全部未完成', exact: true }).waitFor();
  assert.equal(await tasks.getByRole('button', { name: '全部未完成', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('main').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  await page.screenshot({ path: `${output}/phone.png` });
  assert.deepEqual(writes.map(w => `${w.method} ${w.path}`), ['POST /api/robin/links', 'POST /api/robin/todos']);
  assert.deepEqual(errors, []);
  console.log(`PASS: shortcuts first, bounded preview, explicit edits, near default/URL filters, disclosure summaries/keyboard/history, saved records, phone drafts. Screenshots: ${output}`);
} finally { await browser.close(); }
