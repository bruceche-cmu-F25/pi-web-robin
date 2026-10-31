// Existing dev server. Default: isolated fixtures. LEARNING_GRAPH_LIVE=1: read-only checks of registered roadmaps.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const live = process.env.LEARNING_GRAPH_LIVE === '1';
const screenshots = '/tmp/learning-graph';
mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => { localStorage.setItem('pi-locale', 'zh-CN'); localStorage.setItem('pi-theme', 'light'); });
  const fixture = { graph: { id: 'full-stack', title: 'Full Stack', source: 'https://roadmap.sh/full-stack', retrievedOn: '2026-10-24', nodes: [
    { id: 'html', type: 'topic', label: 'HTML', x: 300, y: 0, width: 160, height: 49, content: '**HTML** is meaningful structure.\n\n<img src="https://evil.test/leak">\n\n![image](https://evil.test/leak)' },
    { id: 'redis', type: 'topic', label: 'Redis', x: 300, y: 200, width: 160, height: 49, content: '**缓存**不是事实来源。\n\n先查缓存，未命中再查数据库。' },
    { id: 'pending', type: 'subtopic', label: 'Unprepared', x: 800, y: 400, width: 160, height: 49 },
    // Imported paragraph dimensions include the link below. Text must use only the free band.
    { id: 'intro', type: 'paragraph', label: 'Find the detailed version of this roadmap along with other similar roadmaps', x: 0, y: -180, width: 355, height: 143 },
    { id: 'resource', type: 'button', label: 'roadmap.sh', href: 'https://roadmap.sh', x: 12, y: -98, width: 330, height: 49 },
    { id: 'heading', type: 'label', label: 'Working With LLMs', x: 500, y: -20, width: 188, height: 42, fontSize: 20 },
    { id: 'above', type: 'button', label: 'Related roadmap', href: 'https://roadmap.sh', x: 0, y: 500, width: 270, height: 49 },
    { id: 'explanation', type: 'paragraph', label: 'This explanation starts above the preceding button’s bottom edge in the saved snapshot.', x: 0, y: 539, width: 325, height: 102 },
  ], edges: [{ id: 'edge', source: 'html', target: 'redis', sourceHandle: 'x2', targetHandle: 'w1' }] }, note: { path: 'Full Stack.roadmap.md', modified: '2026-10-24', url: 'obsidian://open?path=example' } };
  let sources, catalog, vaultId;
  if (live) {
    const response = await context.request.get('/api/robin/obsidian/vault');
    const { vaults } = await response.json();
    assert.equal(vaults.length, 1, 'Live test requires an explicit single registered vault');
    vaultId = vaults[0].id;
    catalog = await (await context.request.get(`/api/robin/learning/graph?vaultId=${vaultId}`)).json();
    assert.ok(catalog.notes.length >= 3, JSON.stringify(catalog));
    sources = await Promise.all(catalog.notes.map(async (n) => {
      const response = await context.request.get(`/api/robin/learning/graph?${new URLSearchParams({ vaultId, path: n.path })}`);
      assert.equal(response.status(), 200); return response.json();
    }));
  } else {
    vaultId = 'local'; sources = [fixture];
    catalog = { notes: [{ path: fixture.note.path, title: 'Full Stack' }], limited: false, skipped: 0 };
  }
  const page = await context.newPage(), errors = [], consoleErrors = [], writes = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) consoleErrors.push(m.text()); });
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== baseURL) { external.push(url.href); return route.abort(); }
    if (url.pathname.startsWith('/api/robin/')) {
      if (request.method() !== 'GET') writes.push(url.pathname);
      if (url.pathname === '/api/robin/obsidian/vault') return route.fulfill({ json: { vaults: [{ id: vaultId, name: 'Learning vault' }] } });
      if (url.pathname === '/api/robin/learning/graph') {
        const source = sources.find(s => s.note.path === url.searchParams.get('path'));
        return route.fulfill({ json: url.searchParams.has('path') ? source : catalog });
      }
      return route.fulfill({ json: { todos: [], jobs: [], rounds: [], events: [], records: [], review: null } });
    }
    return route.continue();
  });
  await page.goto('/learn/roadmap?session=keep');
  await page.getByRole('heading', { name: '学习路线图', exact: true }).waitFor();
  const picker = page.getByRole('combobox', { name: '定位知识点…' });
  await picker.waitFor();
  const full = sources.find(s => s.graph.id === 'full-stack');
  assert.equal(await page.locator('[data-node]').count(), full.graph.nodes.filter(n => ['topic','subtopic'].includes(n.type)).length);
  await page.screenshot({ path: `${screenshots}/overview.png` });
  const redis = full.graph.nodes.find(n => n.label === 'Redis');
  await picker.selectOption(redis.id);
  const reading = page.getByRole('region', { name: 'Redis', exact: true });
  await reading.waitFor();
  assert.match(await reading.innerText(), /缓存/);
  assert.match(page.url(), /session=keep/);
  await page.screenshot({ path: `${screenshots}/expanded.png` });
  await reading.getByRole('button', { name: '收起', exact: true }).click();
  await reading.waitFor({ state: 'detached' });
  assert.equal(await page.locator('[data-node]:focus').getAttribute('data-node'), redis.id);
  await page.locator(`[data-node="${redis.id}"]`).click(); await reading.waitFor();
  await reading.getByRole('button', { name: '收起', exact: true }).focus();
  await page.keyboard.press('Escape'); await reading.waitFor({ state: 'detached' });
  await page.goBack(); await reading.waitFor();
  await page.reload(); await reading.waitFor();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(100);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow ${width}`);
    const box = await reading.boundingBox();
    assert.ok(box.width <= width && box.x >= -1 && box.x + box.width <= width + 1, `reader not visible at ${width}: ${JSON.stringify(box)}`);
    await page.screenshot({ path: `${screenshots}/${width}.png` });
  }
  async function assertLegible(label) {
    const problems = await page.locator('[data-graph-item]').evaluateAll(elements => {
      const boxes = elements.filter(e => e.textContent.trim()).map(e => ({ e, rect: e.getBoundingClientRect() }));
      const failures = [];
      for (let i = 0; i < boxes.length; i++) {
        const { e, rect } = boxes[i];
        const text = e.querySelector('span').getBoundingClientRect();
        if (text.top < rect.top - 1 || text.bottom > rect.bottom + 1 || text.left < rect.left - 1 || text.right > rect.right + 1)
          failures.push(`text outside box: ${e.textContent}`);
        for (const b of boxes.slice(i + 1)) {
          if (Math.min(rect.right, b.rect.right) - Math.max(rect.left, b.rect.left) > 1
            && Math.min(rect.bottom, b.rect.bottom) - Math.max(rect.top, b.rect.top) > 1)
            failures.push(`overlap: ${e.textContent} / ${b.e.textContent}`);
        }
      }
      return failures;
    });
    assert.deepEqual(problems, [], label);
    const colors = await page.locator('ul[aria-label] li[data-kind]').evaluateAll(elements => elements.map(e => getComputedStyle(e).getPropertyValue('--graph-tone').trim()));
    assert.equal(new Set(colors).size, 3, `distinct type colors: ${label}`);
    assert.ok(colors.every(Boolean), `resolved color tokens: ${label}`);
  }
  let visited = 0;
  for (let i = 0; i < sources.length; i++) {
    await page.getByRole('navigation', { name: '选择路线图' }).getByRole('button', { name: catalog.notes[i].title, exact: true }).click();
    const source = sources[i], nodes = source.graph.nodes.filter(n => ['topic','subtopic'].includes(n.type));
    await page.waitForFunction(count => document.querySelectorAll('[data-node]').length === count, nodes.length);
    assert.equal(await page.locator('[data-edge]').count(), source.graph.edges.length);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await assertLegible(`${source.graph.id} ${theme} ${width}`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      }
      await page.screenshot({ path: `${screenshots}/${source.graph.id}-${theme}.png` });
    }
    for (const n of nodes) {
      await picker.selectOption(n.id);
      await page.getByRole('heading', { name: n.label, exact: true }).waitFor();
      // ResizeObserver reserves the reader's measured height on the next frame.
      await page.waitForFunction(() => {
        const r = document.querySelector('#graph-reading').getBoundingClientRect();
        return ![...document.querySelectorAll('[data-graph-item]')].some(e => {
          const b = e.getBoundingClientRect();
          return Math.min(r.right, b.right) > Math.max(r.left, b.left) + 1 && Math.min(r.bottom, b.bottom) > Math.max(r.top, b.top) + 1;
        });
      }, undefined, { timeout: 3000 });
      visited++;
    }
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.screenshot({ path: `${screenshots}/dark.png` });
  assert.equal(writes.length, 0, 'exploration must not write progress');
  assert.equal(external.length, 0, 'no external images or diagram fetches');
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []);
  console.log(`Passed: ${visited} nodes; original edge counts; light/dark colors, text bounds, no overlaps; expansion, collapse, focus, history, reload, 320–1440px; no writes or external requests.`);
} finally { await browser.close(); }
