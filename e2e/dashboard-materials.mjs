// Real routing and materials; synthetic APIs only. No real sessions/tasks are changed.
// node --env-file-if-exists=.env.local --experimental-strip-types e2e/dashboard-materials.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { localDate, addDays } from '../extension/robin/dates.ts';
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const output = '/tmp/robin-dashboard-materials';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => { localStorage.setItem('pi-locale', 'zh-CN'); localStorage.setItem('pi-theme', 'glass'); window.documentMarker = Math.random(); });
  const today = localDate(), tomorrow = addDays(today, 1), cwd = '/tmp/dashboard 中文';
  const todos = [
    { id: 'bank', title: '去银行存钱', due: today, done: false, color: 'iris', url: 'https://example.com/bank' },
    { id: 'read', title: '读完 React 这一章，整理自己的理解', due: tomorrow, done: false },
    { id: 'application', title: '确认面试时间', due: tomorrow, done: false },
  ];
  const events = [{ id: 'meeting', title: '项目讨论', date: tomorrow, start: '10:00', end: '11:00', source: 'local', location: '线上' },
    { id: 'walk', title: '和朋友散步', date: tomorrow, start: '17:30', end: '18:30', source: 'local' }];
  const errors = [], writes = [];
  await context.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path === '/api/cwd/validate') return route.fulfill({ json: { cwd, projectRoot: cwd, projectKey: cwd } });
    if (req.method() !== 'GET') writes.push(`${req.method()} ${path}`);
    const fixtures = {
      '/api/robin/todos': { today, todos }, '/api/robin/events': { today, events, google: { connected: true } },
      '/api/robin/links': { links: [{ id: 'course', title: 'Full Stack Open', url: 'https://example.com/course', group: '日常入口', iconCheckedAt: today }, { id: 'notes', title: '我的笔记', url: 'https://example.com/notes', group: '日常入口', iconCheckedAt: today }] },
      '/api/robin/gmail': { today, connected: true, review: null }, '/api/robin/rounds': { rounds: [] }, '/api/robin/jobs': { jobs: [], configured: true },
      '/api/robin/planner': { today, to: addDays(today, 6), todos, events, google: { connected: true }, conflicts: [], minuteOfDay: 600, timezone: 'UTC', revision: 'fixture' },
      '/api/home': { home: '/tmp/home', generalProject: { root: cwd, key: cwd } },
      '/api/sessions': { sessions: [], runningSessionIds: [], sessionListVersion: 1 },
      '/api/sessions/ui-state': { version: 1, revision: 0, sessions: {}, projects: {} },
      '/api/agent/running': { runningSessionIds: [], awaitingInputSessionIds: [], sessionListVersion: 1 },
      '/api/models': { models: [], modelList: [] },
      '/api/worktrees': { isGit: false, projectRoot: cwd, projectKey: cwd, worktrees: [] },
    };
    await route.fulfill({ json: fixtures[path] ?? {} });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const hideDev = () => page.addStyleTag({ content: 'nextjs-portal { display:none !important }' });
  const chat = () => page.locator('.robin-dashboard-header a[data-dashboard-chat]:visible');
  const nav = () => page.getByRole('navigation', { name: '首页', exact: true });
  await page.goto(`/dashboard?cwd=${encodeURIComponent(cwd)}`); await hideDev();
  await page.locator('.robin-dashboard-header h1 time').waitFor();
  await page.screenshot({ path: `${output}/before.png` });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'glass-dark'; document.documentElement.classList.add('dark'); });
  const cdp = await context.newCDPSession(page);
  for (const [width, top, bottom, side] of [[390, 62, 34, 0], [320, 59, 34, 0], [430, 44, 34, 0], [844, 0, 21, 59]]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 900 });
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top, bottom, left: side, right: side } });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const geometry = await page.evaluate(() => {
      const header = document.querySelector('.robin-dashboard-header'), viewport = document.querySelector('.robin-page');
      const first = document.querySelector('#dashboard-daily-view');
      return { gap: first.getBoundingClientRect().top - header.getBoundingClientRect().bottom, top: parseFloat(getComputedStyle(header).paddingTop), paddingTop: getComputedStyle(viewport).paddingTop, paddingBottom: getComputedStyle(viewport).paddingBottom };
    });
    await page.screenshot({ path: `${output}/safe-area-${width}.png` });
    assert.ok(geometry.top >= top, 'Header still protects the status bar');
    assert.ok(geometry.gap >= 0 && geometry.gap <= 12, `Safe area ${top}px is counted only once; content gap was ${geometry.gap}px`);
    assert.equal(geometry.paddingTop, '0px');
    assert.equal(geometry.paddingBottom, '0px', 'The sibling dock owns the bottom inset');
    const dock = await page.locator('.robin-dashboard-dock').boundingBox();
    assert.ok(dock.y + dock.height <= (width === 844 ? 390 : 900) - bottom);
    assert.ok(dock.x >= side && dock.x + dock.width <= width - side, 'Landscape dock clears the notch');
    await page.getByRole('button', { name: '新建', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: '新建', exact: true });
    for (const control of await sheet.locator('a, button').all()) {
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      assert.ok(box.x >= side && box.x + box.width <= width - side);
      assert.ok(box.y >= top && box.y + box.height <= (width === 844 ? 390 : 900) - bottom);
      assert.ok(box.width >= 44 && box.height >= 44);
    }
    await sheet.getByRole('button', { name: '关闭', exact: true }).click();
  }
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 0, left: 0, right: 0 } });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await chat().count(), 1, 'Chat must be visible on Daily, not buried in More or an inaccessible drawer');
  assert.equal(new URL(await chat().getAttribute('href'), baseURL).searchParams.get('cwd'), cwd);
  await nav().getByRole('button', { name: '更多', exact: true }).click();
  const marker = await page.evaluate(() => window.documentMarker);
  await chat().click();
  await page.waitForURL(url => url.pathname === '/').catch(async error => {
    console.error('Chat navigation failed', page.url(), errors, await chat().getAttribute('href').catch(() => null));
    await page.screenshot({ path: `${output}/chat-failure.png` });
    throw error;
  });
  await page.locator('textarea').first().waitFor();
  assert.equal(new URL(page.url()).searchParams.get('cwd'), cwd);
  assert.notEqual(await page.evaluate(() => window.documentMarker), marker, 'Chat uses the same native document boundary as RobinMargin');
  await page.goBack(); await hideDev();
  await nav().getByRole('button', { name: '更多', exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('view'), 'more');
  for (const name of ['日历', '待办', '首页']) {
    await nav().getByRole('button', { name, exact: true }).click();
    assert.equal(await chat().count(), 1, `Chat is reachable from ${name}`);
  }
  for (const width of [320, 390, 812, 1440]) {
    await page.setViewportSize({ width, height: width === 812 ? 390 : 900 });
    for (const theme of ['glass', 'glass-dark', 'light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle('dark', theme.endsWith('dark')); }, theme);
      await page.waitForTimeout(250);
      await chat().waitFor({ state: width < 960 ? 'visible' : 'hidden' }).catch(async error => {
        console.error({ width, theme, errors, header: await page.locator('.robin-dashboard-header').evaluate(el => ({ text: el.textContent, box: el.getBoundingClientRect().toJSON(), markup: el.innerHTML.slice(0, 2500) })).catch(() => null) });
        await page.screenshot({ path: `${output}/failure.png` });
        throw error;
      });
      assert.equal(await chat().count(), width < 960 ? 1 : 0, `${theme}/${width}: only phone needs Chat beside search; errors: ${errors.join('; ')}`);
      if (width >= 960) {
        await page.locator('#dashboard-todos a[href="https://example.com/bank"]').waitFor({ state: 'attached' });
        const styles = await page.evaluate(() => {
          const calendar = getComputedStyle(document.querySelector('.robin-calendar'));
          const rail = getComputedStyle(document.querySelector('#dashboard-todos-view'));
          const titleNode = document.querySelector('#dashboard-todos a[href="https://example.com/bank"]');
          const title = getComputedStyle(titleNode);
          const row = titleNode.closest('[class~="group/todo"]');
          return { calendarBorder: calendar.border, railBorder: rail.border, calendarRadius: calendar.borderRadius, railRadius: rail.borderRadius, calendarInk: calendar.color, taskInk: title.color, taskWeight: title.fontWeight, taskEdge: getComputedStyle(row).borderLeftColor, chosenInk: getComputedStyle(row.querySelector('button[aria-pressed="true"]')).backgroundColor };
        });
        assert.equal(styles.railBorder, styles.calendarBorder, `${theme}: both reading planes have the same outline`);
        assert.equal(styles.railRadius, styles.calendarRadius);
        assert.equal(styles.taskInk, styles.calendarInk, `${theme}: a colored task still uses neutral calendar text ink`);
        assert.equal(styles.taskWeight, '600', 'Open task titles stand out from dates and actions');
        assert.equal(styles.taskEdge, styles.chosenInk, 'The selected task color appears on its edge');
      }
      assert.ok(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${theme}/${width}: no horizontal overflow`);
      if (width < 960) {
        const contrast = await page.evaluate(() => {
          const section = document.querySelector('#daily-links').closest('section');
          const link = section.querySelector('.robin-saved-link');
          const tile = link.parentElement;
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d');
          const rgba = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
          const panel = rgba(getComputedStyle(section).getPropertyValue('--bg-panel'));
          const paint = color => { const c = rgba(color), alpha = c[3] / 255; return c.slice(0, 3).map((v, i) => v * alpha + panel[i] * (1 - alpha)); };
          const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
          const elements = [link, ...['daily-attention', 'daily-links'].map(id => document.getElementById(id).closest('header').querySelector('a')), document.querySelector('a[href*="plan=1"] strong')];
          return { alpha: rgba(getComputedStyle(tile).backgroundColor)[3] / 255, delta: Math.max(...paint(getComputedStyle(tile).backgroundColor).map((v, i) => Math.abs(v - panel[i]))), ratios: elements.map(el => {
            const style = getComputedStyle(el), a = luminance(paint(style.color)), b = luminance(paint(style.backgroundColor));
            return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
          }) };
        });
        if (theme.startsWith('glass')) assert.ok(contrast.alpha > 0 && contrast.alpha < .5, `${theme}: shortcuts are translucent, not opaque grey fields`);
        else assert.ok(contrast.delta >= 12, `${theme}: shortcut fill must visibly differ from its card: ${JSON.stringify(contrast)}`);
        assert.ok(contrast.ratios.every(ratio => ratio >= 4.5), `${theme}: button text contrast ${contrast.ratios}`);
        const sectionColors = await page.locator('#dashboard-daily-view section[data-tone]').evaluateAll(sections => sections.map(section => getComputedStyle(section).getPropertyValue('--section-ink')));
        assert.equal(new Set(sectionColors).size, 3, 'Calendar, tasks and links keep distinct accents alongside their labels');
        if (theme.startsWith('glass')) {
          assert.equal(await page.locator('#daily-links').evaluate(h => getComputedStyle(h.closest('section').querySelector('.robin-saved-link').parentElement).backdropFilter), 'none', 'Shortcut tiles do not stack another blur');
        }
        const dock = await page.locator('.robin-dashboard-dock').boundingBox();
        assert.ok(dock.height < 84, 'One navigation row, not a double-height action shelf');
        for (const control of await page.locator('.robin-dashboard-toolbar > :is(a,button), .robin-dashboard-dock button').all()) {
          const box = await control.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44);
        }
        if (theme.startsWith('glass')) {
          await page.waitForFunction(() => ['.robin-dashboard-toolbar', '.robin-dashboard-dock'].every(selector => document.querySelector(selector)?.hasAttribute('data-glass-refraction')));
          const materials = await page.evaluate(() => ['.robin-dashboard-toolbar', '.robin-dashboard-dock'].map(selector => getComputedStyle(document.querySelector(selector)).getPropertyValue('--glass-material').trim()));
          assert.deepEqual(materials, ['clear', 'clear']);
          assert.equal(await page.locator('#dashboard-daily-view > div').evaluate(el => getComputedStyle(el).backdropFilter), 'none', 'The page itself is not another glass card');
          const reading = await page.locator('#dashboard-daily-view [data-tone="calendar"] > div').evaluate(el => {
            const style = getComputedStyle(el);
            return { role: style.getPropertyValue('--glass-material').trim(), filter: style.backdropFilter, fill: style.backgroundColor, mask: getComputedStyle(el.closest('.robin-page')).maskImage };
          });
          assert.equal(reading.role, 'frost');
          assert.equal(reading.filter, 'blur(10px)');
          assert.match(reading.fill, /rgba\(.+, 0\.48\)/);
          assert.equal(reading.mask, 'none', 'The scrollport must not isolate the canvas from the content frost');
          const viewport = await page.locator('.robin-page').boundingBox(), workspace = await page.locator('.robin-dashboard').boundingBox();
          assert.ok(Math.abs(viewport.y - workspace.y) < 1 && Math.abs(viewport.height - workspace.height) < 1, 'Content must extend behind both chrome surfaces, not stop at their edges');
        } else {
          assert.equal(await page.locator('.robin-dashboard-dock[data-glass-refraction]').count(), 0);
        }
      }
      await page.screenshot({ path: `${output}/${width}-${theme}.png` });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'glass-dark'; document.documentElement.classList.add('dark'); });
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 62, bottom: 34, left: 0, right: 0 } });
  await page.getByRole('link', { name: /帮我安排一下/ }).scrollIntoViewIfNeeded();
  const lastAction = await page.getByRole('link', { name: /帮我安排一下/ }).boundingBox();
  const footerTop = await page.locator('.robin-dashboard-dock').evaluate(el => el.parentElement.getBoundingClientRect().top);
  assert.ok(lastAction.y + lastAction.height <= footerTop - 20, 'The final action clears the overlay dock');
  await page.screenshot({ path: `${output}/safe-area-bottom-dark.png` });
  // Scroll between the endpoints, where the original hard cut was visible.
  for (const theme of ['glass', 'glass-dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle('dark', theme.endsWith('dark')); }, theme);
    await page.locator('.robin-page').evaluate(el => { el.scrollTop = 220; });
    await page.waitForTimeout(150);
    const bounds = await page.evaluate(() => {
      const card = document.querySelector('#dashboard-daily-view > div').getBoundingClientRect();
      const header = document.querySelector('.robin-dashboard-header').getBoundingClientRect();
      return { cardTop: card.top, headerBottom: header.bottom };
    });
    assert.ok(bounds.cardTop < bounds.headerBottom, 'The reading plane passes beneath the header while scrolling');
    await page.screenshot({ path: `${output}/scrolled-${theme}.png` });
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-keyboard-open', ''));
  await page.waitForFunction(() => document.querySelector('.robin-dashboard').style.getPropertyValue('--dashboard-footer-height') === '0px');
  assert.equal(await nav().isVisible(), false);
  await page.evaluate(() => document.documentElement.removeAttribute('data-keyboard-open'));
  await page.waitForFunction(() => parseFloat(document.querySelector('.robin-dashboard').style.getPropertyValue('--dashboard-footer-height')) > 44);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 0, left: 0, right: 0 } });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'glass'; document.documentElement.classList.remove('dark'); });
  await nav().getByRole('button', { name: '更多', exact: true }).click();
  await page.screenshot({ path: `${output}/more-glass.png` });
  await page.emulateMedia({ contrast: 'more' });
  await page.waitForFunction(() => !document.querySelector('.robin-dashboard-dock')?.hasAttribute('data-glass-refraction'));
  assert.equal(await page.locator('.robin-dashboard-dock').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
  await nav().getByRole('button', { name: '首页', exact: true }).click();
  const solid = await page.locator('#dashboard-daily-view [data-tone="calendar"] > div').evaluate(el => ({ filter: getComputedStyle(el).backdropFilter, fill: getComputedStyle(el).backgroundColor }));
  assert.equal(solid.filter, 'none');
  assert.match(solid.fill, /^rgb\(/, 'Accessibility preferences restore opaque reading surfaces');
  await page.goto('/dashboard?session=fixture-session'); await hideDev();
  await chat().waitFor();
  assert.equal(new URL(await chat().getAttribute('href'), baseURL).searchParams.get('session'), 'fixture-session');
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  console.log(`PASS: visible Chat, native navigation/back/context, single-row dock, clear/frost and accessibility fallback; screenshots ${output}`);
} finally { await browser.close(); }
