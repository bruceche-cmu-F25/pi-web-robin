// Real dashboard/CSS, mocked APIs only; no personal task writes.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/todo-row-motion.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fullstackPlan, practicePlan } from '../extension/robin/learning.ts';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => localStorage.setItem('pi-locale', 'en'));
  const today = '2030-05-13';
  const title = '整理项目设计与面试复盘，详细说明性能优化过程及最终结果，同时准备架构讨论、部署方案和下一轮技术面试的问题清单。'.repeat(2);
  const fixtures = {
    '/api/robin/todos': { today, todos: [{ id: 'long', title, done: false, url: 'https://example.com/task' }, { id: 'short', title: 'Short task', done: false }] },
    '/api/robin/events': { today, events: [], google: { connected: false } },
    '/api/robin/jobs': { jobs: [] }, '/api/robin/links': { links: [] }, '/api/robin/rounds': { rounds: [] },
    '/api/robin/learning': { practice: practicePlan([], 'neetcode150', today), fullstack: fullstackPlan([]) },
  };
  await context.route('**/api/**', route => {
    assert.equal(route.request().method(), 'GET', 'Reading a title never writes');
    return route.fulfill({ json: fixtures[new URL(route.request().url()).pathname] ?? {} });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/dashboard?calendar=agenda');
  const panel = page.locator('#dashboard-todos');
  const longRow = panel.locator('[class~="group/todo"]').filter({ has: page.getByRole('link', { name: title, exact: true }) });
  const shortRow = panel.locator('[class~="group/todo"]').filter({ hasText: 'Short task' });
  await longRow.waitFor();
  await page.evaluate(() => document.fonts.ready);
  await longRow.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  const rest = await longRow.boundingBox(), shortRest = await shortRow.boundingBox();
  const hover = async () => {
    const box = await longRow.boundingBox();
    await page.mouse.move(box.x + 6, box.y + 6);
  };
  const sample = async () => {
    await page.waitForFunction(() => [...document.querySelectorAll('#dashboard-todos *')].some(node => node.getAnimations().some(a => a.transitionProperty === 'grid-template-rows')));
    await longRow.evaluate(node => node.getAnimations({ subtree: true }).forEach(a => { a.pause(); a.currentTime = 60; }));
    const mid = await longRow.boundingBox(), sibling = await shortRow.boundingBox();
    await longRow.evaluate(node => node.getAnimations({ subtree: true }).forEach(a => a.finish()));
    return { mid, sibling };
  };
  await hover();
  const opening = await sample();
  const full = await longRow.boundingBox();
  assert.ok(full.height > rest.height + 30, 'Long title expands the actual todo row');
  assert.ok(opening.mid.height > rest.height && opening.mid.height < full.height, 'Row has an intermediate opening height');
  assert.ok(opening.sibling.y > shortRest.y && opening.sibling.y < (await shortRow.boundingBox()).y, 'Following rows move smoothly with it');
  await page.mouse.move(0, 0);
  const closing = await sample();
  assert.ok(closing.mid.height > rest.height && closing.mid.height < full.height, `Closing also interpolates instead of snapping: ${JSON.stringify({ rest, full, closing })}`);
  assert.equal((await longRow.boundingBox()).height, rest.height);
  await shortRow.hover(); await page.waitForTimeout(220);
  assert.equal((await shortRow.boundingBox()).height, shortRest.height, 'Short titles do not grow');

  // Reverse during expansion: the current height remains the starting point.
  await hover();
  await longRow.evaluate(node => node.getAnimations({ subtree: true }).forEach(a => { a.pause(); a.currentTime = 60; }));
  const interrupted = await longRow.boundingBox();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(240);
  assert.ok(interrupted.height < full.height);
  assert.equal((await longRow.boundingBox()).height, rest.height);

  await page.emulateMedia({ reducedMotion: 'reduce' }); await hover();
  assert.equal(await longRow.evaluate(n => n.getAnimations({ subtree: true }).length), 0);
  assert.equal((await longRow.boundingBox()).height, full.height);
  await page.mouse.move(0, 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const link = longRow.getByRole('link', { name: title, exact: true });
  await link.focus();
  assert.equal(await longRow.evaluate(n => n.getAnimations({ subtree: true }).length), 0, 'Keyboard reveals immediately');
  assert.equal((await longRow.boundingBox()).height, full.height);
  assert.equal(await link.getAttribute('href'), 'https://example.com/task');

  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(100);
    const text = await link.evaluate(n => ({ height: n.clientHeight, scrollHeight: n.scrollHeight, width: n.clientWidth, scrollWidth: n.scrollWidth }));
    assert.ok(text.height >= text.scrollHeight && text.width >= text.scrollWidth, 'Phone titles remain fully readable');
    assert.equal(await longRow.locator('[aria-hidden="true"]').filter({ hasText: title }).isVisible(), false);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: actual todo row expansion/collapse, sibling movement, reversal, short titles, keyboard, links, reduced motion and phone full text');
} finally { await browser.close(); }
