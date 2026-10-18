// Dashboard APIs are mocked; no personal data is written.
// node --env-file-if-exists=.env.local --experimental-strip-types e2e/robin-daily-rail.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fullstackPlan, practicePlan } from '../extension/robin/learning.ts';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  if (process.env.PI_WEB_PASSWORD) {
    const login = await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(login.ok());
  }
  await context.addInitScript(() => localStorage.setItem('pi-locale', 'en'));
  const today = '2030-05-13';
  const todos = Array.from({ length: 5 }, (_, i) => ({ id: `task-${i}`, title: `Task ${i}: prepare the architecture walkthrough`, done: false, revision: 'v1' }));
  const links = ['Reading', '日常入口', 'Tools', 'Projects'].map((group, i) => ({ id: `link-${i}`, title: group === '日常入口' ? 'Daily app' : `${group} resource`, group, url: `https://example.com/${i}`, iconCheckedAt: today }));
  const writes = [];
  const fixtures = {
    '/api/robin/todos': { todos, today },
    '/api/robin/links': { links },
    '/api/robin/events': { events: [], today, google: { connected: false } },
    '/api/robin/jobs': { jobs: [], minScore: 4, configured: false },
    '/api/robin/gmail': { review: null, connected: false, today },
    '/api/robin/practice': { records: [], today },
    '/api/robin/rounds': { rounds: [] },
    '/api/robin/notes-agent': { finals: {} },
    '/api/robin/learning': { practice: practicePlan([], 'neetcode150', today), fullstack: fullstackPlan([]) },
  };
  await context.route('**/api/**', (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'GET') return route.fulfill({ json: fixtures[path] ?? {} });
    const body = request.postDataJSON();
    writes.push({ path, method: request.method(), body });
    assert.equal(path, '/api/robin/links');
    if (request.method() === 'POST') links.push({ ...body, id: 'new-link', title: 'New daily link', iconCheckedAt: today });
    return route.fulfill({ json: { success: true } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/dashboard?calendar=week');
  const rail = page.locator('[data-dashboard-panels] > aside');
  const daily = page.locator('#dashboard-daily-links');
  const other = page.locator('#dashboard-links');
  const viewport = page.locator('.robin-dashboard');
  await daily.getByRole('link', { name: 'Daily app', exact: true }).waitFor();
  assert.equal(await page.locator('#dashboard-todos').count(), 1);
  assert.equal(await other.getByRole('link', { name: 'Daily app', exact: true }).count(), 0);
  assert.equal(await daily.getByRole('link', { name: 'Tools resource', exact: true }).count(), 0, 'Only the exact category, not the inferred daily family');
  await other.getByRole('link', { name: 'Tools resource', exact: true }).waitFor();
  for (const width of [960, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1080 });
    await viewport.evaluate((node) => node.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForFunction(() => document.querySelector('.robin-dashboard').scrollTop === 0);
    const calendar = await page.locator('.robin-calendar').boundingBox();
    const side = await rail.boundingBox();
    const grid = await page.locator('[data-dashboard-panels]').boundingBox();
    const columns = width >= 1440 ? 3 : 2;
    const gap = columns === 3 ? 20 : 16;
    assert.ok(Math.abs(side.width - (grid.width - gap * (columns - 1)) / columns) < 1, 'Keep the original right column width');
    assert.ok(Math.abs(side.y - calendar.y) < 1, 'Right card starts at Calendar, not at the dashboard heading');
    assert.ok(side.x >= calendar.x + calendar.width && side.x + side.width <= width);
    assert.equal(await rail.locator('.pi-card').count(), 0, 'One outer box, not separate nested cards');
    await viewport.evaluate((node) => node.scrollTo({ top: 500, behavior: 'instant' }));
    const sticky = await rail.boundingBox();
    const header = await page.locator('.robin-dashboard-header').boundingBox();
    assert.ok(Math.abs(sticky.y - header.y - header.height - 16) < 2, 'Sticky stays below the dashboard header');
    assert.ok(sticky.y + sticky.height <= 1080, 'Card stays within the dashboard viewport');
    assert.ok(await viewport.evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
    assert.ok((await other.boundingBox()).y > (await page.locator('#fullstack-open').boundingBox()).y, 'Remaining links finish the left lane');
  }
  assert.equal(await other.locator('[data-link-groups]').evaluate((node) => getComputedStyle(node).columnCount), '2', 'Wide footer links use two columns');
  await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'PATCH' && res.url().endsWith('/api/robin/links')),
    other.getByRole('button', { name: 'Move Projects up', exact: true }).click(),
  ]);
  assert.deepEqual(writes[0].body.groups, ['Reading', '日常入口', 'Projects', 'Tools']);
  await daily.locator('.robin-panel-add').click();
  await daily.locator('input[inputmode="url"]').fill('https://example.com/new');
  await daily.locator('form button[type="submit"]').click();
  await daily.getByRole('link', { name: 'New daily link', exact: true }).waitFor();
  assert.equal(writes.find(({ method }) => method === 'POST').body.group, '日常入口');
  if (process.env.E2E_SCREENSHOT_DIR) {
    await mkdir(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
    await viewport.evaluate((node) => node.scrollTo({ top: 0, behavior: 'instant' }));
    for (const theme of ['dark', 'light']) {
      await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
      await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/daily-card-${theme}.png` });
    }
  }
  // Both sections scroll together inside the box when tasks are long.
  todos.push(...Array.from({ length: 60 }, (_, i) => ({ id: `long-${i}`, title: `Long task ${i}`, done: false })));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#dashboard-todos input[type="checkbox"]').length === 65);
  assert.ok(await rail.evaluate((node) => node.scrollHeight > node.clientHeight));
  assert.equal(await page.locator('#dashboard-todos').evaluate((node) => getComputedStyle(node).overflowY), 'visible');
  await daily.scrollIntoViewIfNeeded();
  assert.ok(await rail.evaluate((node) => node.scrollTop > 0), 'Daily links use the same scrollbar as todos');
  // Resizing preserves the task draft and restores all links inline on phones.
  await page.locator('#dashboard-todos .robin-panel-add').click();
  const draft = page.locator('#robin-todo-form input').first();
  await draft.fill('Keep this draft');
  await page.setViewportSize({ width: 390, height: 844 });
  await daily.waitFor({ state: 'detached' });
  assert.equal(await draft.inputValue(), 'Keep this draft');
  await other.getByRole('link', { name: 'Daily app', exact: true }).waitFor();
  assert.equal(await page.locator('#dashboard-todos').count(), 1);
  assert.equal(await rail.evaluate((node) => getComputedStyle(node).display), 'contents');
  assert.ok(await viewport.evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/dashboard/gmail');
  assert.equal(await page.locator('#dashboard-todos').count(), 0, 'This is a dashboard card, not a global sidebar');
  assert.deepEqual(errors, []);
  console.log('PASS: single dashboard card, calendar alignment, bounded sticky scrolling, original widths, exact category split, two-column footer, and phone layout');
} finally { await browser.close(); }
