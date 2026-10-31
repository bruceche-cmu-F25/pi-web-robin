// Read-only browser fixtures: failures are not empty states; retry never writes.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/ui-recovery.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', {
    headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD },
  })).ok());
  await context.addInitScript(() => { localStorage.setItem('pi-locale', 'en'); });
  let fail = true, stall = false, release, reads = 0;
  const writes = [], errors = [];
  const fixtures = {
    '/api/robin/todos': { todos: [], today: '2030-05-12' }, '/api/robin/events': { events: [] },
    '/api/robin/jobs': { jobs: [] }, '/api/robin/rounds': { rounds: [] },
    '/api/robin/practice': { records: [] }, '/api/robin/tech-events': { events: [] },
  };
  await context.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() !== 'GET') writes.push(path);
    if (path === '/api/robin/links') {
      reads++;
      if (stall) await new Promise(resolve => { release = resolve; });
      return route.fulfill({ status: fail ? 503 : 200, json: fail ? { error: 'Links unavailable (fixture)' } : { links: [] } }).catch(() => {});
    }
    return route.fulfill({ json: fixtures[path] ?? {} });
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto('/dashboard?view=more');
  const links = page.locator('[data-disclosure="dashboard-links"]');
  await links.locator('summary').click();
  await links.getByRole('alert').waitFor();
  assert.equal(await links.getByText('No links saved yet.').count(), 0);
  const beforeRetry = reads;
  fail = false;
  await links.getByRole('button', { name: 'Try again' }).click();
  await links.getByText('No links saved yet.').waitFor();
  assert.equal(await links.getByRole('alert').count(), 0);
  assert.equal(reads, beforeRetry + 1);
  // A stalled read exposes recovery after 30 s; a late answer cannot clear it.
  stall = true;
  await page.reload();
  await links.locator('summary').waitFor();
  if (!await links.getAttribute('open').then(value => value !== null)) await links.locator('summary').click();
  const deadline = Date.now() + 10_000;
  while (!release && Date.now() < deadline) await page.waitForTimeout(20);
  assert.ok(release, 'The timeout fixture started a read');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await links.getByRole('alert').filter({ hasText: 'server took too long' }).waitFor({ timeout: 35_000 });
  assert.equal(await links.getByText('No links saved yet.').count(), 0);
  stall = false; release(); release = null;
  await page.waitForTimeout(100);
  await links.getByRole('alert').filter({ hasText: 'server took too long' }).waitFor();
  await links.getByRole('button', { name: 'Try again' }).click();
  await links.getByText('No links saved yet.').waitFor();
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  console.log('PASS: failed/empty/timeout states, late response fencing and read-only retry');
} finally { await browser.close(); }
