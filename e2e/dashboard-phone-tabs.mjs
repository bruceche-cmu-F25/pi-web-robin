// Synthetic API data; no personal records are changed. BEFORE=1 captures the old layout.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { localDate, addDays } from '../extension/robin/dates.ts';
const before = process.env.BEFORE === '1';
const output = `/tmp/robin-phone-tabs-${before ? 'before' : 'after'}`;
await mkdir(output, { recursive: true });
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const today = localDate(), tomorrow = addDays(today, 1);
const todos = ['回复面试邀请', '提交课程作业', '去银行存钱', '读完这一章并整理遇到的问题，与同学讨论不同实现的优缺点和下一步的实验计划'].map((title, i) => ({ id: `todo-${i}`, title, due: i < 2 ? today : tomorrow, done: false, revision: `v${i}` }));
todos.push(...['申请岗位并核对招聘页面上的完整截止时间', '预约职业咨询，带上简历与问题清单', '确认参加校园招聘活动'].map((title, i) => ({ id: `overdue-${i}`, title, due: addDays(today, -i - 1), done: false, revision: `late-${i}` })));
const events = [
  { id: 'all', title: '校园开放日', date: today },
  { id: 'next-all', title: '资料整理', date: tomorrow },
  { id: 'early', title: '项目讨论', date: today, start: '08:00', end: '09:00' },
  { id: 'later', title: '课程答疑', date: today, start: '17:30', end: '18:30' },
].map(e => ({ ...e, source: 'local' }));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => { localStorage.setItem('pi-locale', 'zh-CN'); localStorage.setItem('pi-theme', 'glass'); });
  const writes = [], errors = [];
  await context.route('**/api/**', route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() !== 'GET') writes.push(`${req.method()} ${path}`);
    const fixtures = {
      '/api/robin/todos': { today, todos }, '/api/robin/events': { today, events, google: { connected: true } },
      '/api/robin/links': { links: [{ id: 'link', title: '本周计划', group: '日常入口', url: 'https://example.com/', iconCheckedAt: today }] },
      '/api/robin/gmail': { today, connected: true, review: null }, '/api/robin/rounds': { rounds: [] }, '/api/robin/jobs': { jobs: [] },
    };
    return route.fulfill({ json: fixtures[path] ?? {} });
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto('/dashboard?view=daily');
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  await page.locator('#daily-shortcuts a').waitFor();
  assert.equal(await page.title(), 'Home — Pi Web');
  assert.equal(await page.locator('.robin-dashboard-dock').getAttribute('aria-label'), '首页');
  const tab = key => page.locator(`.robin-dashboard-dock [data-view="${key}"]`).click();
  for (const theme of before ? ['glass'] : ['glass', 'glass-dark', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle('dark', theme.includes('dark')); }, theme);
    for (const width of before ? [390] : [320, 390, 812]) {
      await page.setViewportSize({ width, height: width === 812 ? 390 : 844 });
      for (const key of ['daily', 'calendar', 'todos', 'more']) {
        await tab(key);
        await page.locator(`#dashboard-${key}-view`).waitFor();
        if (key === 'calendar') await page.locator('[data-calendar-heading]').filter({ hasText: /\d/ }).waitFor();
        if (key === 'todos') await page.getByRole('button', { name: '查看待办：回复面试邀请', exact: true }).waitFor();
        // Let per-view navigation restore its saved scroll before framing a screenshot.
        await page.waitForTimeout(120);
        await page.locator('.robin-page').evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }));
        await page.screenshot({ path: `${output}/${key}-${width}-${theme}.png` });
        assert.ok(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        if (!before) {
          const heading = await page.locator('.robin-dashboard-header h1').evaluate(el => { const s = getComputedStyle(el); return { size: s.fontSize, style: s.fontStyle, weight: s.fontWeight, family: s.fontFamily }; });
          assert.equal(heading.size, '24px', `${key}: all phone tabs share one title size`);
          assert.equal(heading.style, 'italic'); assert.equal(heading.weight, '400'); assert.ok(heading.family.includes('Georgia'));
        }
        if (!before && key === 'daily') {
          const date = page.locator('.robin-dashboard-header h1 time');
          assert.ok(await date.evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 24), 'The date is the title, not metadata-sized text');
          const title = await date.boundingBox(), tools = await page.locator('.robin-dashboard-toolbar').boundingBox();
          assert.ok(title.x + title.width <= tools.x, 'Date and toolbar do not overlap');
          const overdue = page.locator('[data-tone="tasks"] li[data-overdue]');
          assert.equal(await overdue.count(), 3);
          assert.ok(await overdue.first().evaluate(el => getComputedStyle(el).backgroundImage.startsWith('linear-gradient')), 'Home and Todo share the overdue tint');
        }
        if (!before && key === 'calendar') {
          assert.equal(await page.locator('.robin-calendar select').inputValue(), 'day');
          assert.equal(await page.locator('[data-calendar-minute]:visible').count(), 1);
          assert.equal(await page.locator('.robin-calendar nav').count(), 0, 'The restored day timeline has no duplicate mobile week strip');
          assert.deepEqual(await page.locator('.robin-calendar select option').evaluateAll(nodes => nodes.map(n => n.value)), ['day', 'week']);
          assert.ok((await page.locator('[data-calendar-tasks]').boundingBox()).height <= 64, 'Date-only tasks cannot push the hours below the screen');
          if (width !== 812) {
            const hours = await page.locator('[data-calendar-minute]:visible').boundingBox();
            assert.ok(hours.y < 500, 'The hour axis starts in the first viewport');
          }
          assert.ok(await page.locator('.robin-calendar').getByRole('button', { name: '校园开放日', exact: true }).isVisible());
        }
        if (!before && key === 'todos') {
          assert.equal(await page.locator('#dashboard-todos .robin-panel-add').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'Add is a quiet text action even below the global 640px breakpoint');
          const row = page.locator('[data-todo-id="todo-0"]');
          assert.ok((await row.boundingBox()).height <= 80, 'Short dated tasks are compact, not tall cards');
          const check = await row.locator('label').boundingBox(), copy = await row.getByRole('button', { name: '查看待办：回复面试邀请' }).boundingBox();
          assert.ok(check.width >= 44 && check.height >= 44 && check.x + check.width <= copy.x, 'Touch targets and copy never overlap in phone landscape');
          assert.equal(await row.getByRole('button', { name: '查看待办：回复面试邀请' }).evaluate(el => getComputedStyle(el).fontWeight), '400');
          assert.ok(await row.evaluate(el => getComputedStyle(el).fontFamily.includes('Segoe UI')));
          const overdue = page.locator('[data-todo-id="overdue-0"]');
          assert.match(await overdue.innerText(), /已逾期/);
          assert.ok(await overdue.evaluate(el => getComputedStyle(el).backgroundImage.startsWith('linear-gradient')), 'Overdue is a tinted surface, not just a red edge');
          if (theme.startsWith('glass')) {
            assert.ok(await overdue.evaluate(el => { const s = getComputedStyle(el); return s.borderLeftColor === s.borderTopColor && s.borderLeftColor !== 'rgba(0, 0, 0, 0)' && s.boxShadow.includes('inset'); }), 'Overdue keeps a visible glass outline, not a red side stripe');
            await overdue.locator('.robin-todo-actions > summary').click();
            const menu = overdue.locator('.robin-todo-actions > div');
            await menu.scrollIntoViewIfNeeded();
            assert.ok(await menu.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), 'Tinted rows never cover their open action menus');
            await overdue.locator('.robin-todo-actions > summary').click();
          }
          const long = page.getByRole('button', { name: `查看待办：${todos[3].title}`, exact: true });
          await long.click();
          const dialog = page.getByRole('dialog', { name: '待办详情' }); await dialog.waitFor();
          assert.equal(await dialog.getByLabel('任务', { exact: true }).inputValue(), todos[3].title);
          await page.screenshot({ path: `${output}/todo-dialog-${width}-${theme}.png` });
          const bounds = await dialog.boundingBox();
          const viewport = page.viewportSize();
          assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1, 'Todo editor stays inside the viewport');
          assert.ok(await dialog.evaluate(el => parseFloat(getComputedStyle(el).borderTopLeftRadius) > 0), 'Todo editor uses the shared rounded modal surface');
          assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Todo editor does not overflow horizontally');
          const close = dialog.getByRole('button', { name: '关闭', exact: true }).first();
          assert.ok(await close.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), 'Header close control is visible, not clipped above the screen');
          await dialog.getByRole('button', { name: '保存', exact: true }).scrollIntoViewIfNeeded();
          assert.ok(await dialog.getByRole('button', { name: '保存', exact: true }).evaluate(el => { const r = el.getBoundingClientRect(); return r.bottom <= innerHeight && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), 'Save remains reachable in short landscape');
          await close.click();
        }
      }
    }
  }
  if (!before) {
    await page.setViewportSize({ width: 390, height: 844 });
    await tab('daily');
    const homeTitle = page.locator('.robin-dashboard-header h1');
    assert.equal(await homeTitle.locator('time').getAttribute('datetime'), today);
    assert.notEqual(await homeTitle.innerText(), '日');
    assert.equal(await page.locator('.robin-dashboard-dock [data-view="daily"]').innerText(), '首页');
    assert.ok(await page.locator('[data-daily-allday]').getByRole('link', { name: /校园开放日/ }).isVisible());
    await page.locator('summary').filter({ hasText: '切换日期' }).click();
    await page.locator(`[data-day="${tomorrow}"]`).click();
    const header = page.locator('.robin-dashboard-header [data-display-date]');
    await page.waitForFunction(date => document.querySelector('[data-display-date]')?.getAttribute('data-display-date') === date, tomorrow);
    assert.equal(await header.getAttribute('data-display-date'), tomorrow);
    assert.equal(await page.locator('[data-daily-allday]').getByRole('link', { name: /校园开放日/ }).count(), 0);
    assert.ok(await page.locator('[data-daily-allday]').getByRole('link', { name: /资料整理/ }).isVisible());
    await tab('calendar');
    await page.waitForFunction(date => document.querySelector('[data-single] [data-calendar-minute]')?.getAttribute('data-date') === date, today);
    assert.equal(await page.locator('[data-calendar-minute]:visible').getAttribute('data-date'), today, 'Home date browsing does not rewrite the calendar date');
    await page.locator('[data-calendar-toolbar]').getByRole('button', { name: '今天', exact: true }).click();
    await page.waitForFunction(date => document.querySelector('[data-calendar-minute]')?.getAttribute('data-date') === date, today);
    await page.locator('.robin-calendar select').selectOption('week');
    assert.equal(await page.locator('[data-calendar-minute]:visible').count(), 7);
    await page.locator('.robin-calendar select').selectOption('day');
    await page.reload(); await page.locator('[data-single] [data-calendar-minute]:visible').waitFor();
    assert.equal(await page.locator('.robin-calendar select').inputValue(), 'day');
    await tab('todos');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'glass'; });
    await page.emulateMedia({ contrast: 'more' });
    assert.equal(await page.locator('[data-todo-id="overdue-0"]').evaluate(el => getComputedStyle(el).backgroundImage), 'none');
    assert.match(await page.locator('[data-todo-id="overdue-0"]').innerText(), /已逾期/);
    await page.emulateMedia({ contrast: 'no-preference' });
    // Reproduce the reported stale Monday + old box/list view, not just clean defaults.
    for (const legacy of ['month', 'agenda']) {
      await page.evaluate(legacy => localStorage.setItem('robin-calendar-view-mobile', legacy), legacy);
      await page.goto(`/dashboard?view=daily&date=2026-10-26&calendar=${legacy}&session=test-session&cwd=%2Ftmp`);
      await page.waitForFunction(date => document.querySelector('[data-display-date]')?.getAttribute('data-display-date') === date, today);
      await page.locator('[data-daily-allday]').getByRole('link', { name: /校园开放日/ }).waitFor();
      await tab('calendar');
      await page.locator('[data-single] [data-calendar-minute]:visible').waitFor();
      assert.equal(await page.locator('.robin-calendar select').inputValue(), 'day');
      assert.equal(new URL(page.url()).searchParams.get('session'), 'test-session');
      await tab('daily');
      await page.waitForFunction(date => document.querySelector('[data-display-date]')?.getAttribute('data-display-date') === date, today);
      await page.goto(`/dashboard?view=calendar&calendar=${legacy}`);
      await page.locator('[data-single] [data-calendar-minute]:visible').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('calendar'), 'day', 'Legacy direct links also recover the hour grid');
      await page.goto('/dashboard?view=calendar');
      await page.locator('[data-single] [data-calendar-minute]:visible').waitFor();
      assert.equal(await page.locator('.robin-calendar select').inputValue(), 'day', 'Legacy stored modes cannot restore box/list views');
    }
  }
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  await context.close(); console.log(`PASS phone tabs; ${output}`);
} finally { await browser.close(); }
