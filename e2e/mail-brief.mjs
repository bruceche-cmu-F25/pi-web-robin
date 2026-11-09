// Mocked email reports only. No acquisition, paid turns, configuration writes or push sends.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:30141';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const id = '33333333-3333-4333-8333-333333333333';
const items = Array.from({ length: 8 }, (_, i) => ({ id: `mail:${i}`, source: 'mail', section: 'updates', title: `模拟邮件 ${i}`, summary: `邮件正文 ${i}`, href: `https://example.com/mail/${i}`, evidence: { kind: 'mail-message', reference: String(i) } }));
const edition = { id, runId: 'fixture', day: '2026-11-02', timezone: 'America/Los_Angeles', deliveryTime: '08:00', mode: 'shadow', revision: 1,
  createdAt: '2026-11-02T16:03:00Z', inputsCompletedAt: '2026-11-02T16:02:00Z', items, previewIds: items.map(i => i.id),
  coverage: ['mail','calendar','todos','world'].map(source => ({ source, observedAt: '2026-11-02T16:02:00Z', coverage: source === 'mail' ? 'partial' : 'ready', detail: 'Internal diagnostic, not live progress' })),
  editorial: { headline: '12封邮件，11封已审阅，1封待核对；1封有附件', omittedCount: 0, consideredIds: items.map(i => i.id), items: items.map(i => ({ sourceIds: [i.id], section: 'personal', what: i.summary, why: '', suggestion: '', caveat: '', quotes: [{ sourceId: i.id, quote: i.summary }] })) },
  mailReport: { from: '2026-11-02T02:00:00Z', to: '2026-11-02T16:00:00Z', accountKey: 'fixture', total: 12, reviewed: 11, failed: 1,
    messages: Array.from({ length: 12 }, (_, i) => ({ id: String(i), subject: `完整清单邮件 ${i}`, href: `https://example.com/mail/${i}`, date: '2026-11-02T15:59:00Z', summary: i === 11 ? '未能完整审阅这封邮件。' : `完整正文审阅结果 ${i}`, attachments: i === 0 ? ['申请材料.pdf'] : [], attachmentCount: i === 0 ? 1 : 0, reviewed: i !== 11 })) } };
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles', serviceWorkers: 'block' });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => { localStorage.setItem('pi-locale','zh-CN'); localStorage.setItem('pi-theme','glass-dark'); });
  const writes = [], errors = [];
  let currentEdition = edition;
  const evening = { ...structuredClone(edition), id: '55555555-5555-4555-8555-555555555555', deliveryTime: '18:00', editorial: { ...structuredClone(edition.editorial), headline: '晚间新增2封邮件' } };
  await context.route('**/api/**', route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() !== 'GET') { writes.push(path); return route.abort(); }
    if (path === '/api/robin/brief') {
      const viewed = new URL(req.url()).searchParams.get('edition');
      const shown = viewed === evening.id ? evening : viewed === edition.id ? edition : currentEdition;
      return route.fulfill({ json: { initialized: true, edition: shown, editions: [{ id: evening.id, time: '18:00' }, { id, time: '08:00' }], notification: { title: shown.kind === 'daily' ? '每日简报' : '邮箱早报', body: shown.editorial.headline, url: `/dashboard/gmail?feed=brief&edition=${shown.id}` } } });
    }
    if (path === '/api/robin/brief/tick') return route.fulfill({ json: { schedule: { time: '08:00', startDate: '2026-11-02', mailOnly: true, timezone: 'America/Los_Angeles' }, receipts: [{ edition_id: id, state: 'accepted', attempts: 1, accepted: 1 }] } });
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`/dashboard/gmail?feed=brief&edition=${id}`);
  await page.getByRole('heading', { name: edition.editorial.headline, exact: true }).waitFor();
  await page.getByRole('link', { name: '晚报 · 18:00' }).click();
  await page.getByRole('heading', { name: '晚间新增2封邮件' }).waitFor();
  assert.equal(await page.getByRole('link', { name: '晚报 · 18:00' }).getAttribute('aria-current'), 'page');
  await page.getByRole('link', { name: '早报 · 08:00' }).click();
  await page.getByRole('heading', { name: edition.editorial.headline, exact: true }).waitFor();
  mkdirSync('/tmp/robin-mail-brief', { recursive: true });
  await page.screenshot({ path: '/tmp/robin-mail-brief/reading-top-390.png' });
  const all = page.locator('[data-mail-report]'); await all.locator('summary').focus(); await page.keyboard.press('Enter');
  assert.equal(await all.locator('article').count(), 12);
  await all.getByText('有 1 个附件（未读取）：申请材料.pdf', { exact: true }).waitFor();
  await all.getByText('未完整审阅，请打开原邮件核对。', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-brief-coverage]').count(), 1, 'mail-only report does not imply calendar/world acquisition');
  await page.getByText('定时与投递记录', { exact: true }).click();
  await page.getByText(/08:00 \/ 18:00 \(America\/Los_Angeles\)/).waitFor();
  mkdirSync('/tmp/robin-mail-brief', { recursive: true });
  for (const width of [320,390,1440]) {
    await page.setViewportSize({ width, height: 900 }); await all.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `/tmp/robin-mail-brief/all-mail-${width}.png` });
  }
  const combined = structuredClone(edition);
  combined.id = '44444444-4444-4444-8444-444444444444'; combined.kind = 'daily'; combined.editorial.headline = '今日行动与两条工程资讯';
  combined.items.push({ id: 'todo:one', source: 'todos', section: 'tasks', title: '提交申请', summary: '2026-11-02', due: '2026-11-02',
    href: '/dashboard?view=todos&todo=one', evidence: { kind: 'record', reference: 'one' } });
  combined.items.push({ id: 'world:one', source: 'world', section: 'world', title: '工程动态', summary: '发布方更新', publishedOn: '2026-11-01',
    href: 'https://example.com/news', evidence: { kind: 'public-feed', reference: 'one', quote: '工程动态' } });
  combined.editorial.items = [
    { sourceIds: ['todo:one'], section: 'personal', actionable: true, what: '提交申请 · 2026-11-02', why: '', suggestion: '', caveat: '', quotes: [{ sourceId: 'todo:one', quote: '提交申请' }] },
    { sourceIds: ['world:one'], section: 'world', what: '工程动态', why: '', suggestion: '', caveat: '', quotes: [{ sourceId: 'world:one', quote: '工程动态' }] },
  ];
  currentEdition = combined;
  await page.goto(`/dashboard/gmail?feed=brief&edition=${combined.id}`);
  await page.getByRole('heading', { name: '今天可处理' }).waitFor();
  await page.getByRole('heading', { name: '值得了解的动态' }).waitFor();
  assert.equal(await page.locator('[data-brief-coverage]').count(), 4, 'combined morning discloses every source');
  assert.ok((await page.getByRole('link', { name: /打开原记录.*提交申请/ }).getAttribute('href')).includes('todo=one'));
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  console.log('Mail reader: concise action/news lead, full mail list, source coverage, responsive; zero real mutations.');
} finally { await browser.close(); }
