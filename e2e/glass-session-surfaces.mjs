// Shared dev server; all APIs and EventSources are mocked. No shells or agents start.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const theme = process.env.E2E_THEME ?? 'glass';
const output = process.env.E2E_SCREENSHOT_DIR ?? `/tmp/${theme}-session-surfaces`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
try {
  for (const width of [1440, 812, 390, 320]) {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, hasTouch: width < 641, reducedMotion: 'reduce', serviceWorkers: 'block' });
    if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
    await context.addInitScript(theme => {
      localStorage.setItem('pi-theme', theme); localStorage.setItem('pi-locale', 'en');
      window.__terminalStreams = 0;
      window.EventSource = class {
        readyState = 1;
        constructor(url) {
          if (url.includes('/terminal/')) window.__terminalStreams++;
          setTimeout(() => {
            this.onopen?.();
            this.onmessage?.({ data: JSON.stringify(url.includes('/terminal/') ? { type: 'output', data: 'Terminal fixture\r\n$ ', offset: 1 } : { type: 'connected', isStreaming: false }) });
          }, 50);
        }
        close() { this.readyState = 2; }
      };
    }, theme);
    const cwd = '/tmp/glass-session-fixture', timestamp = '2030-01-01T12:00:00Z';
    const info = { id: 'glass-fixture', cwd, projectKey: cwd, projectRoot: cwd, name: 'Glass fixture', path: `${cwd}/fixture.jsonl`, created: timestamp, modified: timestamp, messageCount: 2, firstMessage: 'Find this fixture' };
    const fixtures = {
      '/api/home': { home: '/tmp', generalProject: { root: cwd, key: cwd } },
      '/api/sessions': { sessions: [info], runningSessionIds: [], sessionListVersion: 1 },
      '/api/sessions/ui-state': { version: 1, revision: 0, sessions: {}, projects: { [cwd]: { root: cwd } }, projectOrder: [cwd] },
      '/api/agent/running': { runningSessionIds: [], awaitingInputSessionIds: [], sessionListVersion: 1 },
      '/api/models': { models: {}, modelList: [] },
      '/api/worktrees': { isGit: false, worktrees: [], projectRoot: cwd, projectKey: cwd },
      '/api/sessions/glass-fixture': { info, sessionId: info.id, leafId: 'answer', tree: ['answer', 'alternate'].map(id => ({ entry: { id, type: 'message', parentId: null, timestamp, message: { role: 'assistant', content: `Branch ${id}` } }, children: [] })), context: { messages: [{ role: 'user', content: 'Find this fixture' }, { role: 'assistant', content: [{ type: 'text', text: 'Find this fixture in a finished answer.' }] }], entryIds: ['question', 'answer'], hasMore: false, oldestEntryId: 'question', thinkingLevel: 'off' } },
      '/api/sessions/glass-fixture/state': { running: false, state: { isStreaming: false } },
      '/api/agent/glass-fixture': { running: false, state: { isStreaming: false } },
      '/api/sessions/search': { results: [], hasMore: false },
    };
    let creates = 0;
    const errors = [];
    await context.route('**/api/**', route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path === '/api/cwd/validate') return route.fulfill({ json: { cwd, projectRoot: cwd, projectKey: cwd } });
      if (path === '/api/terminal' && req.method() === 'POST') { creates++; return route.fulfill({ json: { id: req.postDataJSON().id, cwd } }); }
      if (path.startsWith('/api/terminal/') || path.endsWith('/lease')) return route.fulfill({ json: { success: true } });
      if (req.method() !== 'GET') {
        const body = req.postDataJSON();
        assert.ok(path === '/api/agent/glass-fixture' && ['get_state', 'get_tools', 'get_commands'].includes(body?.type), `Unexpected write ${path}: ${body?.type}`);
        return route.fulfill({ json: { success: true, data: body.type === 'get_tools' ? [{ name: 'read_fixture', active: true, description: 'A read-only fixture tool.', parameters: { type: 'object', properties: { path: { type: 'string' } } } }] : { systemPrompt: 'System prompt fixture\n' + 'Long prompt line for scrolling.\n'.repeat(120), commands: [], isStreaming: false } } });
      }
      return route.fulfill({ json: fixtures[path] ?? {} });
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    const material = async (selector, kind) => page.waitForFunction(({ selector, kind }) => {
      const el = document.querySelector(selector);
      return el && getComputedStyle(el).getPropertyValue('--glass-material').trim() === kind && !!el.dataset.glassRefraction;
    }, { selector, kind });
    const topAction = async name => {
      const action = page.locator('.pi-topbar').getByRole('button', { name, exact: true });
      if (!(await action.isVisible())) await page.locator('[data-mobile-toolbar-more]').click();
      await action.click();
    };
    await page.goto('/?session=glass-fixture');
    await page.locator('.chat-input-textarea').fill('Unsent draft');
    await material('.pi-topbar', 'clear');
    for (const name of ['System prompt', 'Tool definitions', 'Branches']) {
      await topAction(name);
      const panel = page.locator('.pi-topbar-panel'); await panel.waitFor();
      await page.screenshot({ path: `${output}/${width}-${name}.png` });
      const geometry = await panel.evaluate(el => {
        const r = el.getBoundingClientRect(), a = document.querySelector('.pi-topbar').getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(90, r.height / 2));
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, anchorLeft: a.left, anchorBottom: a.bottom, hit: el.contains(hit), nested: !!el.closest('.pi-topbar') };
      });
      assert.ok(Math.abs(geometry.left - geometry.anchorLeft) < 2 && Math.abs(geometry.top - geometry.anchorBottom) < 2, `Viewport coordinates must not be offset by a filtered ancestor: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.right <= width + 1 && geometry.bottom <= 900 && geometry.hit && !geometry.nested, JSON.stringify(geometry));
      await material('.pi-topbar-panel', 'frost');
      await page.setViewportSize({ width, height: 390 });
      assert.ok(await panel.evaluate(el => el.getBoundingClientRect().bottom <= innerHeight), 'Popover fits a short viewport');
      await page.setViewportSize({ width, height: 900 });
      if (name === 'System prompt') await page.locator('.system-prompt-text').waitFor();
      else if (name === 'Tool definitions') { await panel.getByRole('button', { name: 'read_fixture', exact: true }).click(); await panel.getByText('A read-only fixture tool.', { exact: true }).waitFor(); }
      if (width >= 960) {
        for (const choice of ['light', 'dark', theme]) {
          await page.evaluate(choice => { document.documentElement.dataset.theme = choice; document.documentElement.classList.toggle('dark', choice === 'dark' || choice === 'glass-dark'); }, choice);
          await page.waitForFunction(() => {
            const el = document.querySelector('.pi-topbar-panel');
            const r = el.getBoundingClientRect(), a = document.querySelector('.pi-topbar').getBoundingClientRect();
            return Math.abs(r.left - a.left) < 2 && Math.abs(r.top - a.bottom) < 2 && el.contains(document.elementFromPoint(r.left + 30, r.top + 30));
          });
        }
      }
      const more = page.locator('[data-mobile-toolbar-more]');
      if (await more.count() && await more.getAttribute('aria-expanded') === 'false') await more.click();
      else await topAction(name);
      await panel.waitFor({ state: 'detached' });
    }
    await topAction('Search current session (Ctrl/⌘ F)');
    const search = page.locator('[data-session-search-bar]');
    await material('[data-session-search-bar]', 'clear');
    await search.locator('input').click();
    assert.equal(await page.locator('.pi-topbar-panel').count(), 0, 'Search is not covered by a top panel');
    await search.locator('input').fill('fixture');
    await page.waitForFunction(() => document.querySelector('[data-session-search-bar] [aria-live]')?.textContent !== '0 / 0');
    await search.locator('input').press('Enter');
    await page.screenshot({ path: `${output}/${width}-search.png` });
    assert.ok(await search.locator('input').evaluate(el => parseFloat(getComputedStyle(el).borderRadius) > 0));
    await search.locator('input').press('Escape');
    assert.equal(await page.locator('.chat-input-textarea').inputValue(), 'Unsent draft');
    await topAction('Open workspace terminal');
    await page.locator('.terminal-panel .is-ready').waitFor();
    await material('.terminal-panel-header', 'clear');
    await page.locator('.terminal-panel .xterm-rows').getByText('Terminal fixture', { exact: false }).waitFor();
    const streamCount = await page.evaluate(() => window.__terminalStreams);
    const terminal = page.locator('.terminal-panel');
    assert.equal(await terminal.locator('.xterm-viewport').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(17, 19, 24)');
    await terminal.getByRole('button', { name: 'Switch terminal to light theme', exact: true }).click();
    assert.equal(await terminal.locator('.xterm-viewport').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(251, 251, 252)');
    await page.screenshot({ path: `${output}/${width}-terminal.png` });
    await page.emulateMedia({ contrast: 'more' });
    assert.equal(await page.locator('.terminal-panel-header').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
    assert.equal(await page.locator('.terminal-panel-header').evaluate(el => getComputedStyle(el).backgroundColor), theme === 'glass-dark' ? 'rgb(44, 44, 46)' : 'rgb(248, 250, 252)');
    await page.emulateMedia({ contrast: 'no-preference' });
    await material('.terminal-panel-header', 'clear');
    await page.locator('#file-panel').getByRole('button', { name: 'Hide file panel', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.terminal-panel-header')?.hasAttribute('data-glass-refraction'));
    await topAction('Show file panel');
    await material('.terminal-panel-header', 'clear');
    assert.equal(await page.evaluate(() => window.__terminalStreams), streamCount, 'Theme changes and hiding the panel do not reconnect terminals');
    assert.ok(creates >= 1 && creates <= 2, 'Only the explicitly opened mocked terminal is created (Strict Mode may mount twice)');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    await context.close(); console.log(`PASS session surfaces ${width}px: overlay coordinates/hit testing, tools, search, terminal theme and connection preservation.`);
  }
} finally { await browser.close(); }
