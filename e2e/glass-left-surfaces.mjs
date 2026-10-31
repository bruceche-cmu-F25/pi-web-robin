// Existing dev server; synthetic long names/many rows only. All APIs/streams
// intercepted after login: no agents, file writes or changes to the user's data.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/glass-left-surfaces.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { showSidebarFiles, showSidebarSessions } from './sidebar.mjs';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const theme = process.env.E2E_THEME ?? 'glass';
const output = process.env.E2E_SCREENSHOT_DIR ?? `/tmp/${theme}-left-surfaces`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(theme => {
    localStorage.setItem('pi-theme', theme); localStorage.setItem('pi-locale', 'en');
    window.EventSource = class { readyState = 1; close() { this.readyState = 2; } };
  }, theme);
  const cwd = '/tmp/glass-sidebar-fixture';
  const timestamp = new Date().toISOString();
  const titles = ['简短标题', '👩🏽‍💻 Long title — quarterly platform infrastructure review '.repeat(4), 'x'.repeat(180), 'نور الهدى — مشروع جديد', ''];
  const sessions = Array.from({ length: 96 }, (_, i) => {
    const project = i < 64 ? cwd : `${cwd}/a-very-long-project-name-${i % 4}`;
    return { id: `sidebar-${i}`, cwd: project, projectKey: project, projectRoot: project, path: `${project}/${i}.jsonl`, name: titles[i % titles.length], firstMessage: 'Fixture conversation', created: timestamp, modified: timestamp, messageCount: i };
  });
  const fixtures = {
    '/api/home': { home: '/tmp', generalProject: { root: cwd, key: cwd } },
    '/api/sessions': { sessions, runningSessionIds: [], sessionListVersion: 1 },
    '/api/sessions/ui-state': { version: 1, revision: 0, sessions: {}, projects: { [cwd]: { root: cwd } }, projectOrder: [cwd] },
    '/api/sessions/search': { results: [], hasMore: false },
    '/api/agent/running': { runningSessionIds: [], awaitingInputSessionIds: [], sessionListVersion: 1 },
    '/api/models': { models: {}, modelList: [] },
    '/api/worktrees': { isGit: false, worktrees: [], projectRoot: cwd, projectKey: cwd },
    '/api/git/status': { files: [], isGit: false },
    '/api/file-index': { files: [] },
    '/api/robin/todos': { today: '2030-01-01', todos: Array.from({ length: 120 }, (_, i) => ({ id: `todo-${i}`, title: 'Fixture', due: '2029-01-01', done: false })) },
    '/api/robin/gmail': { review: null, connected: false },
    '/api/robin/jobs': { jobs: [] },
    '/api/robin/practice': { records: [] },
    '/api/robin/rounds': { rounds: [] },
    '/api/robin/tech-events': { events: [] },
  };
  const unexpectedWrites = [];
  await context.route('**/api/**', route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (path === '/api/cwd/validate') return route.fulfill({ json: { cwd, projectRoot: cwd, projectKey: cwd } });
    if (req.method() !== 'GET') unexpectedWrites.push(`${req.method()} ${path}`);
    if (path === '/api/robin/settings') return route.fulfill({ status: 503, json: { error: 'Unavailable fixture' } });
    if (path.startsWith('/api/files/')) return route.fulfill({ json: { entries: Array.from({ length: 70 }, (_, i) => ({ name: `${i}-年度项目详细报告-${'long-name-'.repeat(12)}.md`, isDir: false, size: 1234, modified: timestamp })) } });
    return route.fulfill({ json: fixtures[path] ?? {} });
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => {
    if (message.type() === 'error' && /hydrated|hydration/i.test(message.text())) errors.push(message.text());
  });
  const placement = async value => {
    await page.evaluate(value => {
      const key = 'pi-web:navigation-placement'; localStorage.setItem(key, value);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
    }, value);
    await page.waitForFunction(value => document.querySelector('[data-navigation-placement]')?.dataset.navigationPlacement === value, value);
  };
  const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No page overflow');
  const checkMenu = async () => {
    const menu = page.locator('.sidebar-menu, .sidebar-sheet');
    await menu.waitFor();
    const geometry = await menu.evaluate(el => {
      const r = el.getBoundingClientRect();
      return { fits: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1, hit: el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(50, r.height / 2))), nested: !!el.closest('.sidebar-container') };
    });
    assert.deepEqual(geometry, { fits: true, hit: true, nested: false }, 'Sidebar menus escape the filtered sidebar and remain clickable');
    await page.screenshot({ path: `${output}/menu-${page.viewportSize().width}.png` });
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });
  };
  const checkSidebarControls = async () => {
    const clipped = await page.locator('.sidebar-container').evaluate(el => {
      const outer = el.getBoundingClientRect();
      return Array.from(el.querySelectorAll('.sidebar-header button, .sidebar-files-header button, .sidebar-files-actions button, .sidebar-settings-shortcuts button')).filter(button => {
        const r = button.getBoundingClientRect();
        return r.width && r.height && (r.left < outer.left - 1 || r.right > outer.right + 1);
      }).map(button => button.getAttribute('aria-label') || button.title || button.textContent);
    });
    assert.deepEqual(clipped, [], 'Sidebar chrome actions must fit even at minimum width');
  };
  // Check actual glyphs against every clipping ancestor, not merely whether
  // the rail's OUTER box has the expected width. Rails also have is-horizontal.
  const checkNavigation = async () => {
    const entries = await page.locator('.robin-nav-entry').all();
    for (const [index, entry] of entries.entries()) {
      if (index === 0) await entry.focus();
      else await page.keyboard.press('Tab');
      assert.ok(await entry.evaluate(el => document.activeElement === el), 'Keyboard follows navigation order');
      if (await page.getByRole('tooltip').count()) await page.keyboard.press('Escape');
      const geometry = await entry.evaluate(el => {
        const icon = el.querySelector('.robin-nav-icon').getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const clipped = [];
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
          const s = getComputedStyle(parent), b = parent.getBoundingClientRect();
          if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && (icon.left < b.left - 1 || icon.right > b.right + 1)) clipped.push(parent.className);
          if (/(auto|scroll|hidden|clip)/.test(s.overflowY) && (icon.top < b.top - 1 || icon.bottom > b.bottom + 1)) clipped.push(parent.className);
        }
        const hit = document.elementFromPoint(icon.left + icon.width / 2, icon.top + icon.height / 2);
        return { label: el.dataset.navLabel, clipped, width: r.width, height: r.height, hit: el.contains(hit), hitClass: hit?.getAttribute('class') };
      });
      if (geometry.clipped.length || !geometry.hit) {
        await page.screenshot({ path: `${output}/failure.png` });
        console.log(await entry.evaluate(el => {
          const n = el.closest('.robin-nav'), r = el.getBoundingClientRect();
          return { entry: r.toJSON(), nav: n.getBoundingClientRect().toJSON(), scrollLeft: n.scrollLeft, scrollWidth: n.scrollWidth, active: document.activeElement === el, overflow: getComputedStyle(n).overflow, scrollBehavior: getComputedStyle(n).scrollBehavior };
        }));
      }
      assert.deepEqual(geometry.clipped, [], `Navigation glyph clipped: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.hit && geometry.width >= 44 && geometry.height >= 44, JSON.stringify(geometry));
    }
    await noOverflow();
  };
  await page.goto(`/?cwd=${encodeURIComponent(cwd)}`);
  await page.locator('.chat-input-textarea').fill('Draft survives left-side layout checks');
  await page.waitForFunction(() => document.querySelector('.robin-nav.is-rail'));
  await page.screenshot({ path: `${output}/initial.png` });
  assert.deepEqual(errors, [], 'Glass must not decorate server HTML before the workspace hydrates');
  await checkNavigation();

  for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 400 }, { width: 960, height: 768 }, { width: 959, height: 768 }, { width: 641, height: 768 }, { width: 640, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(size);
    await page.waitForFunction(wide => !!document.querySelector('.robin-nav.is-rail') === wide, size.width >= 960);
    // Wait for the responsive effect to dismiss the desktop sidebar before
    // checking the horizontal navigation behind the mobile drawer.
    if (size.width <= 640) await page.locator('.sidebar-container.sidebar-closed').waitFor({ state: 'attached' });
    for (const value of size.width >= 960 ? ['left', 'left-labels', 'top', 'top-icons'] : ['left']) {
      await placement(value);
      if (theme.startsWith('glass') && size.width > 640) {
        assert.equal(await page.locator('.sidebar-container.sidebar-open').evaluate(el => getComputedStyle(el).marginLeft), '12px', 'Floating sidebar keeps breathing room beside the edge or rail');
      }
      await checkNavigation();
      await page.screenshot({ path: `${output}/chat-${size.width}-${value}.png` });
    }
    await placement('left');
    const sidebar = page.locator('.sidebar-container');
    if (!(await sidebar.getAttribute('class')).includes('sidebar-open')) await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
    await showSidebarSessions(page);
    if (size.width > 640) await page.getByRole('separator', { name: 'Resize sidebar', exact: true }).press('Home');
    await page.locator('.session-tree-title').first().hover();
    await page.locator('.session-tree-more-action').first().click();
    await checkMenu();
    await page.locator('.sidebar-search-toggle').click();
    await page.locator('#session-search-input').fill('long title');
    await page.locator('.sidebar-search-toggle').click();
    await showSidebarFiles(page);
    await page.locator('.sidebar-files-scroll').getByText(/^0-年度项目详细报告-/).waitFor();
    await checkSidebarControls();
    await page.locator('#session-sidebar-panel-files .project-picker-button.is-project').click();
    await checkMenu();
    await page.locator('.sidebar-files-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.locator('.sidebar-files-scroll').getByText(/^69-年度项目详细报告-/).waitFor();
    assert.ok(await sidebar.evaluate(el => {
      const r = el.getBoundingClientRect();
      return r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight;
    }), `Sidebar fits ${size.width}px`);
    await page.screenshot({ path: `${output}/sidebar-${size.width}.png` });
    await page.locator('.sidebar-settings-shortcuts').getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('.settings-dialog-surface').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.settings-dialog-surface').waitFor({ state: 'detached' });
    if (size.width <= 640) await page.locator('.sidebar-overlay-backdrop').click({ position: { x: size.width - 4, y: size.height / 2 } });
    else {
      await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.sidebar-container').getBoundingClientRect().width === 0);
      await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
      await page.getByRole('separator', { name: 'Resize sidebar', exact: true }).press('Enter');
    }
    assert.equal(await page.locator('.chat-input-textarea').inputValue(), 'Draft survives left-side layout checks');
    await noOverflow();
    console.log(`PASS left surfaces ${size.width}×${size.height}: keyboard/glyphs, minimum-width sidebar, row/project menus, search, file scrolling, draft and bounds`);
  }
  for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 400 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(size);
    await page.goto('/dashboard/gmail');
    if (size.width < 960) await page.locator('.robin-mobile-nav-trigger').click();
    else await page.waitForFunction(() => document.querySelector('.robin-nav.is-rail'));
    await checkNavigation();
    await page.screenshot({ path: `${output}/robin-${size.width}.png` });
    if (size.width < 960) {
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.robin-mobile-nav-trigger').getAttribute('aria-expanded'), 'false');
    }
    console.log(`PASS Robin navigation ${size.width}px`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(unexpectedWrites, []);
  await context.close();
} finally { await browser.close(); }
