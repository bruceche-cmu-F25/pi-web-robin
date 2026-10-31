// Synthetic data only. Checks generated app URLs, not installed-app handoff.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';
import { localDate } from '../extension/robin/dates.ts';
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const output = '/tmp/robin-dashboard-entrypoints';
await mkdir(output, { recursive: true });
const today = localDate();
const links = [
  ['gmail', 'Gmail', 'https://mail.google.com/mail/u/0/#inbox'],
  ['notion', '周计划', 'https://www.notion.so/1234567890abcdef1234567890abcdef?source=copy_link#notes'],
  ['calendar', 'Google Calendar', 'https://calendar.google.com/'],
  ['docs', 'Google Docs', 'https://docs.google.com/document/u/0/?tgif=d'],
  ['github', 'GitHub', 'https://github.com/'],
  ['print', '手机打印', 'https://mobile.eprintitsaas.com/app/add-files?locationid=fixture'],
  ['chatgpt', 'ChatGPT', 'https://chatgpt.com/'],
  ['notebook', 'NotebookLM', 'https://notebooklm.google.com/'],
].map(([id, title, url]) => ({ id, title, url, group: '日常入口', iconCheckedAt: today }));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
try {
  for (const platform of ['ios', 'android', 'desktop']) {
    const device = platform === 'ios' ? devices['iPhone 13'] : platform === 'android' ? devices['Pixel 7'] : {};
    const context = await browser.newContext({ ...device, baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
    await context.addInitScript(() => {
      localStorage.setItem('pi-locale', 'zh-CN'); localStorage.setItem('pi-theme', 'glass');
      window.testOpened = [];
      // Never try a real native protocol or leave the fixture server in this test.
      document.addEventListener('click', event => {
        const anchor = event.target.closest?.('a');
        if (anchor && (anchor.matches('.robin-saved-link') || anchor.closest('[data-app-link], .robin-link-actions'))) {
          event.preventDefault(); window.testOpened.push({ href: anchor.getAttribute('href'), target: anchor.getAttribute('target') });
        }
      });
    });
    const writes = [], errors = [];
    await context.route('**/api/**', route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (req.method() !== 'GET') writes.push(`${req.method()} ${path}`);
      const fixtures = {
        '/api/robin/todos': { today, todos: [] }, '/api/robin/events': { today, events: [], google: { connected: true } },
        '/api/robin/links': { links }, '/api/robin/gmail': { today, connected: true, review: null },
        '/api/robin/rounds': { rounds: [] }, '/api/robin/jobs': { jobs: [], configured: true },
      };
      return route.fulfill({ json: fixtures[path] ?? {} });
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto('/dashboard?view=daily&session=fixture&cwd=%2Ftmp%2Ffixture');
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
    const shortcuts = page.locator('#daily-shortcuts');
    await shortcuts.locator('.robin-saved-link').first().waitFor();
    assert.equal(await page.getByRole('heading', { name: '日历', exact: true }).count(), 0);
    assert.equal(await shortcuts.locator('.robin-saved-link').count(), 6);
    assert.equal(await shortcuts.getByRole('link', { name: /打开网页版/ }).count(), 0, 'No permanent Web labels beside shortcuts');
    assert.equal(await shortcuts.getByText('App 或网页', { exact: true }).count(), 0);
    const dateSummary = page.locator('summary').filter({ hasText: '切换日期' });
    assert.equal((await dateSummary.innerText()).trim(), '切换日期', 'Do not repeat Today below the page title');
    assert.equal(await shortcuts.locator('[data-app-link]').count(), platform === 'ios' ? 4 : 0);
    if (platform === 'ios') {
      const gmail = shortcuts.locator('[data-app-link="Gmail"]');
      await gmail.locator('.robin-saved-link').click();
      assert.deepEqual((await page.evaluate(() => window.testOpened)).at(-1), { href: 'googlegmail://', target: null });
      assert.equal(await shortcuts.locator('[data-app-link="Notion"] .robin-saved-link').getAttribute('href'), links[1].url.replace('https:', 'notion:'));
      assert.ok((await gmail.innerText()).includes('App 首页'));
      assert.ok((await shortcuts.locator('[data-app-link="Notion"]').innerText()).includes('App 内打开'));
    }
    assert.equal(await shortcuts.getByRole('link', { name: /手机打印/ }).getAttribute('href'), links[5].url);
    assert.equal(await shortcuts.getByRole('link', { name: /手机打印/ }).getAttribute('target'), null, 'Mobile HTTPS handoff uses a normal same-tab link');
    await page.locator('[aria-controls="daily-shortcuts"]').click();
    assert.equal(await shortcuts.locator('.robin-saved-link').count(), 8, 'Later saved daily entries are reachable without editing their order');
    assert.equal(await shortcuts.getByRole('link', { name: /NotebookLM/ }).getAttribute('href'), links[7].url);
    if (platform === 'ios') {
      for (const theme of ['glass', 'glass-dark', 'light', 'dark']) {
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle('dark', theme.endsWith('dark')); }, theme);
        for (const width of [320, 390, 812]) {
          await page.setViewportSize({ width, height: width === 812 ? 390 : 844 });
          await shortcuts.scrollIntoViewIfNeeded();
          assert.ok(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
          for (const link of await shortcuts.locator('[data-app-link] a').all()) {
            const box = await link.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44);
          }
          if (width === 390) await page.screenshot({ path: `${output}/links-${theme}.png` });
          await page.locator('.robin-dashboard-dock').getByRole('button', { name: '更多', exact: true }).click();
          const entries = page.locator('[data-workspace]');
          await entries.first().waitFor();
          assert.equal(await entries.count(), 10);
          assert.equal(await entries.locator('small').count(), 10);
          assert.equal(new Set(await entries.locator('svg:first-child path').evaluateAll(nodes => nodes.map(node => node.getAttribute('d')))).size >= 10, true);
          for (const entry of await entries.all()) {
            const href = new URL(await entry.getAttribute('href'), baseURL);
            assert.equal(href.searchParams.get('session'), 'fixture'); assert.equal(href.searchParams.get('cwd'), '/tmp/fixture');
            assert.ok((await entry.boundingBox()).height >= 44);
          }
          await page.locator('.robin-page').evaluate(el => el.scrollTop = 0);
          assert.ok(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
          if (width === 390) await page.screenshot({ path: `${output}/more-${theme}.png` });
          await page.locator('.robin-dashboard-dock').getByRole('button', { name: '首页', exact: true }).click();
        }
      }
      await page.setViewportSize({ width: 320, height: 844 });
      await page.addStyleTag({ content: 'html{font-size:24px!important}' });
      assert.ok(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await page.locator('.robin-dashboard-dock').getByRole('button', { name: '更多', exact: true }).click();
      assert.ok(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await page.locator('[data-disclosure="dashboard-links"] > summary').click();
      await page.locator('#dashboard-links [data-app-link="Gmail"] .robin-saved-link').waitFor();
      assert.equal(await page.locator('#dashboard-links [data-app-link="Gmail"] .robin-saved-link').getAttribute('href'), 'googlegmail://', 'The full collection uses the same handoff policy');
      const original = page.locator('#dashboard-links').getByRole('link', { name: '打开网页版：Gmail', exact: true });
      assert.equal(await original.isVisible(), false, 'Web fallback is secondary, not a permanent row label');
      await page.locator('#dashboard-links summary[aria-label="操作：Gmail"]').click();
      await original.click();
      assert.deepEqual((await page.evaluate(() => window.testOpened)).at(-1), { href: links[0].url, target: '_blank' });
      assert.ok(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Expanded actions fit at 320px with large text');
    }
    if (platform === 'desktop') {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator('#dashboard-daily-links .robin-saved-link').first().waitFor();
      const gmail = page.locator('#dashboard-daily-links .robin-saved-link').first();
      assert.equal(await gmail.getAttribute('href'), links[0].url); assert.equal(await gmail.getAttribute('target'), '_blank');
      assert.equal(await page.locator('#dashboard-daily-links [data-app-link]').count(), 0);
    }
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(`PASS mobile entrypoints: iOS/Android/desktop URL policies, web fallback, grouped directory, four themes, 320–1440px; screenshots ${output}`);
} finally { await browser.close(); }
