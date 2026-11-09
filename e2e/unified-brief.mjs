// Synthetic API/model results only. No production initialization, model calls, sends or task writes.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:30141';
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const out = '/tmp/robin-unified-brief'; mkdirSync(out, { recursive: true });
const id1 = '11111111-1111-4111-8111-111111111111', id2 = '22222222-2222-4222-8222-222222222222';
function edition(id, revision) {
  const items = [
    { id: 'todo:one', source: 'todos', section: 'tasks', title: '确认材料截止日期', summary: '这是测试任务，不是真实个人记录。', href: '/dashboard?view=todos&todo=one', due: '2026-10-31', evidence: { kind: 'record', reference: 'one' } },
    { id: 'world:one', source: 'world', section: 'world', title: '历史工具更新', summary: '这是测试公开资料，不是真实新闻。', href: 'https://example.com/fixture', publishedOn: '2026-10-23', evidence: { kind: 'legacy-passage', reference: 'one' } },
    { id: 'calendar:one', source: 'calendar', section: 'schedule', title: '下午的项目讨论', summary: '14:00 项目讨论；这是模拟日程。', href: '/dashboard?view=calendar', eventDate: '2026-10-30', evidence: { kind: 'record', reference: 'calendar-one' } },
    { id: 'mail:one', source: 'mail', section: 'attention', title: '核对邮件中的时间', summary: '发件人请你核对时间；这是模拟邮件。', href: 'https://example.com/mail', evidence: { kind: 'mail-message', reference: 'mail-one' } },
  ];
  return { id, runId: 'fixture', mode: 'shadow', day: '2026-10-30', timezone: 'UTC', revision, createdAt: '2026-10-30T10:00:00Z', inputsCompletedAt: '2026-10-30T09:59:00Z', items, previewIds: items.map(i => i.id),
    coverage: ['mail','calendar','todos','world'].map(source => ({ source, observedAt: '2026-10-30T09:59:00Z', coverage: source === 'mail' ? 'unavailable' : 'partial', detail: 'Fixture internal diagnostic: acquisition incomplete; not a live sync status.' })),
    editorial: { headline: revision === 1 ? '先确认材料，再了解工具变化。' : '第二版：先核对来源，再决定行动。', consideredIds: items.map(i => i.id), omittedCount: 3,
      items: items.map((item, index) => ({ sourceIds: [item.id], section: item.source === 'world' ? 'world' : 'personal', what: index > 1 ? item.summary : index ? '历史周报记录了一次工具预览；这不是今天发布的新消息。' : '先查看材料的原始要求，确认截止日期。这是模拟数据，不会执行真实操作。', why: index ? '' : '这是模型判断示例：先消除不确定性，再安排时间。', suggestion: index ? '' : '核对原任务，不自动创建新的待办。', caveat: index > 1 ? '' : index ? '仅供历史背景，尚未采集新报道。' : '邮件尚未覆盖，不能据此认为没有其他重要事项。', quotes: [{ sourceId: item.id, quote: item.summary }] })) } };
}
const first = edition(id1, 1), second = edition(id2, 2);
let initialized = false, latest = null, failNext = true, held = false, release, todayOverride = '2026-10-30';
const writes = [], errors = [];
let deliveryView = { schedule: null, receipts: [] };
let inspected;
const view = entry => ({ initialized, edition: entry, notification: entry ? { id: `brief:${entry.id}`, title: `每日简报 · ${entry.day}`, body: entry.editorial.headline, url: `/dashboard/gmail?feed=brief&edition=${entry.id}` } : null });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => { if (!localStorage.getItem('pi-locale')) localStorage.setItem('pi-locale', 'zh-CN'); localStorage.setItem('pi-theme', 'glass'); });
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (req.method() !== 'GET') {
      writes.push({ path, body: req.postDataJSON() });
      assert.equal(path, '/api/robin/brief', 'no legacy writes, sends or migrations');
      assert.equal(req.postDataJSON().allowPrivateModel, true);
      if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { error: 'Synthetic unconfirmed response' } }); }
      if (held) await new Promise(resolve => { release = resolve; });
      latest = latest ? second : first;
      return route.fulfill({ json: view(latest) });
    }
    if (path === '/api/robin/brief/tick') return route.fulfill({ json: deliveryView });
    if (path === '/api/robin/brief') {
      const selected = url.searchParams.get('edition');
      const entry = selected ? [first, second].find(e => e.id === selected) ?? null : latest;
      return route.fulfill({ status: selected && !entry ? 404 : 200, json: view(entry) });
    }
    if (path === '/api/robin/todos') return route.fulfill({ json: { today: todayOverride, todos: [] } });
    if (path === '/api/robin/events') return route.fulfill({ json: { events: [], google: { connected: false } } });
    if (path === '/api/robin/links') return route.fulfill({ json: { links: [] } });
    if (path === '/api/robin/rounds') return route.fulfill({ json: { rounds: [] } });
    if (path === '/api/robin/gmail') return route.fulfill({ json: { today: '2026-10-30', review: null, connected: false } });
    if (path === '/api/sessions/reviews') return route.fulfill({ json: { reviews: [], revision: 0 } });
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage(); inspected = page; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/dashboard/gmail?feed=brief&session=fixture-session&cwd=%2Ftmp%2Ffixture');
  await page.getByText('尚无编辑后的简报。', { exact: true }).waitFor();
  assert.equal(writes.length, 0);
  await page.getByText('生成编辑预览', { exact: true }).click();
  const generate = page.getByRole('button', { name: /生成预览/ });
  assert.equal(await generate.isDisabled(), true);
  await page.getByRole('checkbox', { name: /同意将有限/ }).check();
  assert.equal(await generate.isDisabled(), true, 'consent cannot initialize storage');
  initialized = true;
  await page.getByRole('button', { name: '刷新视图', exact: true }).click();
  await generate.click();
  await page.getByRole('alert').filter({ hasText: 'Synthetic unconfirmed response' }).waitFor();
  const requestId = writes[0].body.requestId;
  await page.reload();
  await page.getByText('生成编辑预览', { exact: true }).click();
  const retry = page.getByRole('button', { name: /重试本次请求/ });
  assert.equal(await retry.isDisabled(), true, 'reload resets private-model consent');
  assert.equal(await page.getByRole('combobox', { name: /输入来源/ }).isDisabled(), true, 'a saved request freezes its input policy');
  await page.getByRole('checkbox', { name: /同意将有限/ }).check();
  await retry.click();
  await page.getByRole('heading', { name: first.editorial.headline, exact: true }).waitFor();
  assert.equal(writes[1].body.requestId, requestId);
  assert.equal(await page.getByRole('main').getByText('模型判断', { exact: true }).count(), 1, 'empty optional interpretation has no blank label');
  assert.equal(await page.locator('article[data-brief-lead="true"]').count(), 1, 'exactly one reading lead, not one urgent item per section');
  assert.equal(await page.getByRole('heading', { level: 3 }).count(), 4, 'article facts are navigable headings');
  assert.equal(await page.locator('[data-brief-source]').count(), 4, 'labels follow saved source identities');
  await page.getByText('记录截止', { exact: false }).first().waitFor();
  assert.equal(await page.locator('article[data-brief-lead="true"] time[datetime="2026-10-31"]').count(), 1, 'recorded deadline is visible without opening evidence');
  await page.getByRole('link', { name: '版本已保存，打开查看', exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('edition') === id1);
  assert.equal(new URL(page.url()).searchParams.get('edition'), id1);
  assert.equal(new URL(page.url()).searchParams.get('session'), 'fixture-session');
  assert.equal(new URL(page.url()).searchParams.get('cwd'), '/tmp/fixture');
  await page.getByText('来源与引用片段', { exact: true }).first().click();
  assert.match(await page.getByRole('link', { name: '确认材料截止日期', exact: true }).getAttribute('href'), /session=fixture-session/);
  await page.getByText('2026-10-23 · 历史周报资料', { exact: true }).waitFor();
  await page.getByText('通知预览 · 未发送', { exact: true }).waitFor();
  assert.equal(await page.getByText('通知预览 · 未发送', { exact: true }).evaluate(node => node.parentElement.open), false, 'notification detail stays below the reading flow');
  assert.equal(writes.length, 2);
  for (const width of [320, 375, 390, 812, 1440]) {
    await page.setViewportSize({ width, height: width === 812 ? 390 : 1000 });
    for (const theme of ['glass', 'dark', 'glass-dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await page.getByRole('main').evaluate(element => { element.scrollTop = 0; });
      const tones = await page.locator('[data-brief-source]').evaluateAll(nodes => nodes.map(node => getComputedStyle(node, '::before').backgroundColor));
      assert.equal(new Set(tones).size, 4, `four distinct source colors in ${theme}`);
      const surfaces = await page.locator('[data-brief-item]').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
      assert.notEqual(surfaces[0], surfaces[1], 'the lead has a distinct surface, not color alone');
      const contrasts = await page.locator('[data-brief-source], article h3, article > p, article > details > summary').evaluateAll(nodes => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const rgba = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].map((v, i) => i === 3 ? v / 255 : v); };
        const luminance = rgb => rgb.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        return nodes.map(node => {
          const layers = []; for (let parent = node; parent; parent = parent.parentElement) layers.unshift(rgba(getComputedStyle(parent).backgroundColor));
          const bg = layers.reduce((base, layer) => base.map((v, i) => layer[i] * layer[3] + v * (1 - layer[3])), [255, 255, 255]);
          const ink = rgba(getComputedStyle(node).color), fg = bg.map((v, i) => ink[i] * ink[3] + v * (1 - ink[3]));
          const l1 = luminance(fg), l2 = luminance(bg);
          return { text: node.textContent.slice(0, 30), ratio: (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05) };
        });
      });
      for (const sample of contrasts) assert.ok(sample.ratio >= 4.5, `${theme}: ${sample.text} contrast ${sample.ratio}`);
      await page.screenshot({ path: `${out}/header-${width}-${theme}.png`, fullPage: true });
      const lead = await page.locator('[data-brief-item="personal"]').first().boundingBox();
      assert.ok(lead.y < 600, `the first priority is above operational controls at ${width}`);
      const form = await page.locator('details').filter({ has: page.getByText('生成编辑预览', { exact: true }) }).boundingBox();
      assert.ok(form.y > lead.y, 'generation controls follow the editorial content');
      await page.getByRole('heading', { name: /^需要你关注的事/ }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/reader-${width}-${theme}.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow at ${width}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const mailCoverage = page.locator('[data-brief-coverage="mail"]');
  await mailCoverage.locator('summary').first().click();
  await mailCoverage.getByText('本次未取得此来源的可用资料，不代表没有值得关注的内容。', { exact: true }).waitFor();
  const diagnostic = mailCoverage.getByText('Fixture internal diagnostic: acquisition incomplete; not a live sync status.', { exact: true });
  assert.equal(await diagnostic.isVisible(), false, 'raw English diagnostics remain hidden when source coverage is opened');
  const observed = await mailCoverage.locator('time').textContent();
  assert.match(observed, /17:59/); assert.match(observed, /GMT\+8/); assert.ok(!observed.includes('T09:59'));
  await mailCoverage.getByText('技术详情（原文）', { exact: true }).focus();
  await page.keyboard.press('Enter'); await diagnostic.waitFor();
  await page.keyboard.press('Enter'); assert.equal(await diagnostic.isVisible(), false);
  assert.equal(writes.length, 2, 'opening coverage never resumes collection or sends');
  for (const theme of ['glass', 'glass-dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await mailCoverage.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/coverage-390-${theme}.png`, fullPage: true });
  }
  await page.getByText('生成编辑预览', { exact: true }).click();
  await page.getByRole('button', { name: '开始新的请求', exact: true }).click();
  assert.equal(await page.getByRole('checkbox', { name: /同意将有限/ }).isChecked(), false);
  await page.getByRole('combobox', { name: /输入来源/ }).selectOption('gmail');
  await page.getByRole('checkbox', { name: /同意将有限/ }).check(); held = true;
  await page.getByRole('button', { name: /生成预览/ }).click();
  const dispatchDeadline = Date.now() + 30_000;
  while (!release && Date.now() < dispatchDeadline) await page.waitForTimeout(10);
  assert.equal(typeof release, 'function', 'explicit generation dispatches within the browser test deadline');
  assert.equal(writes.at(-1).body.input, 'gmail');
  assert.equal(await page.getByRole('button', { name: /重试本次请求/ }).isDisabled(), true);
  await page.getByRole('navigation', { name: '新信息来源' }).getByRole('button', { name: '邮箱', exact: true }).click();
  release(); await page.waitForTimeout(200);
  assert.notEqual(new URL(page.url()).searchParams.get('feed'), 'brief', 'completion must not steal navigation');
  await page.getByRole('navigation', { name: '新信息来源' }).getByRole('button', { name: '每日简报', exact: true }).click();
  await page.getByRole('link', { name: '版本已保存，打开查看', exact: true }).click();
  await page.getByRole('heading', { name: second.editorial.headline, exact: true }).waitFor();
  await page.waitForURL(url => url.searchParams.get('edition') === id2);
  assert.equal(new URL(page.url()).searchParams.get('edition'), id2);
  todayOverride = await page.evaluate(() => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; });
  await page.goto('/dashboard?view=daily&session=fixture-session&cwd=%2Ftmp%2Ffixture');
  assert.equal(await page.locator('[data-brief-edition]').count(), 0, 'an old edition is not shown as today');
  second.day = todayOverride;
  await page.reload();
  const preview = page.locator(`[data-brief-edition="${id2}"]`);
  await preview.waitFor();
  assert.equal(await preview.getByRole('link', { name: /发件人请你核对时间/ }).count(), 1, 'Home omits duplicated tasks/calendar and links to original mail');
  assert.equal(await preview.getByText(second.editorial.headline).count(), 0, 'Home does not repeat the noisy edition headline');
  assert.ok((await preview.getByRole('link', { name: '阅读这个版本' }).getAttribute('href')).includes(id2));
  await preview.screenshot({ path: `${out}/home-preview.png` });
  second.mailReport = { failed: 1, messages: [
    { id: 'one', reviewed: true, priority: 2, summary: '请核对模拟项目申请的截止日期；原通知中还有适用条件，需要打开邮件确认。', href: 'https://example.com/mail/one' },
    { id: 'two', reviewed: true, priority: 2, summary: '测试活动的报名窗口即将结束，请先确认自己是否符合参与资格。', href: 'https://example.com/mail/two' },
    { id: 'three', reviewed: true, priority: 2, summary: '模拟课程材料已经发布，提交要求和时间请以原邮件为准。', href: 'https://example.com/mail/three' },
  ] };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  const desktopNote = page.locator(`[data-brief-edition="${id2}"]:visible`);
  await desktopNote.waitFor();
  await page.locator('.robin-calendar:visible').waitFor();
  assert.equal(await desktopNote.locator('li').count(), 3);
  const [noteBox, calendarBox, railBox, leadBox, secondBox, thirdBox] = await Promise.all([
    desktopNote, page.locator('.robin-calendar:visible'), page.locator('#dashboard-todos-view:visible'),
    desktopNote.locator('li').nth(0), desktopNote.locator('li').nth(1), desktopNote.locator('li').nth(2),
  ].map(node => node.boundingBox()));
  assert.ok(Math.abs(noteBox.x - calendarBox.x) < 2 && Math.abs(noteBox.x + noteBox.width - railBox.x - railBox.width) < 2, 'the brief aligns to both desktop columns');
  assert.ok(leadBox.x < secondBox.x && Math.abs(secondBox.x - thirdBox.x) < 2 && thirdBox.y > secondBox.y, 'one lead and two shorter lines form the desktop reading grid');
  const paper = await Promise.all([page.locator('.robin-calendar:visible'), desktopNote].map(node => node.evaluate(element => {
    const style = getComputedStyle(element); return { background: style.backgroundColor, radius: style.borderTopLeftRadius, shadow: style.boxShadow };
  })));
  assert.equal(paper[0].background, paper[1].background, 'the desktop brief uses the calendar paper color');
  assert.equal(paper[0].radius, paper[1].radius);
  assert.equal(paper[1].shadow, 'none', 'the brief remains lighter than a full module card');
  await desktopNote.screenshot({ path: `${out}/home-desktop-note.png` });
  await page.setViewportSize({ width: 960, height: 900 });
  await desktopNote.waitFor();
  assert.ok(await page.locator('main').evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'the desktop brief does not overflow at the split breakpoint');
  await desktopNote.screenshot({ path: `${out}/home-desktop-960.png` });
  delete second.mailReport;
  assert.equal(writes.length, 3);
  await page.evaluate(() => localStorage.setItem('pi-locale', 'en'));
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(`/dashboard/gmail?feed=brief&edition=${id2}`);
  await page.getByRole('heading', { name: second.editorial.headline, exact: true }).waitFor();
  const sourceTabs = page.locator('nav.robin-workspace-tabs');
  assert.equal(await sourceTabs.getByRole('button').count(), 4);
  await sourceTabs.getByRole('button', { name: 'AI weekly', exact: true }).focus();
  await page.keyboard.press('Tab');
  const lastTab = await sourceTabs.getByRole('button', { name: 'Podcasts', exact: true }).boundingBox();
  assert.ok(lastTab.x + lastTab.width <= 321, 'overflow tabs remain keyboard reachable');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${out}/english-320.png`, fullPage: true });
  deliveryView = { schedule: { time: '08:00', startDate: '2026-10-30' }, receipts: [{ edition_id: id2, state: 'uncertain', attempts: 1, accepted: 0 }] };
  await page.reload();
  await page.getByText('Schedule & delivery receipts', { exact: true }).click();
  await page.getByText('Delivery is uncertain. Automatic resend is stopped; check before resolving.', { exact: true }).waitFor();
  await page.getByText('Notification content', { exact: true }).waitFor();
  await page.getByText('Generate an editorial preview', { exact: true }).click();
  await page.getByRole('button', { name: 'Start a new request', exact: true }).click();
  await page.getByRole('combobox', { name: 'Input source', exact: true }).selectOption('live');
  await page.getByText(/All sources: Gmail, Google Calendar/).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: /Allow bounded mail/ }).isChecked(), false);
  assert.equal(writes.length, 3, 'reading delivery receipts and selecting live input never sends');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.ok(await page.getByRole('main').evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'large text wraps within the reading sheet');
  await page.screenshot({ path: `${out}/large-text-320.png`, fullPage: true });
  await page.goto('/dashboard/gmail?feed=brief&edition=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('heading', { name: second.editorial.headline, exact: true }).count(), 0, 'missing pinned editions never fall back');
  assert.equal(writes.length, 3);
  latest = structuredClone(second);
  latest.editorial.items = latest.editorial.items.filter(row => row.section === 'world');
  await page.goto('/dashboard/gmail?feed=brief');
  await page.locator('article[data-brief-lead="true"][data-brief-item="world"]').waitFor();
  assert.equal(await page.locator('[data-brief-source="todos"]').count(), 0, 'world-only editions never invent personal tasks');
  latest.editorial.items = [];
  await page.reload();
  await page.getByText('No items selected. Check source coverage; this does not establish that nothing needs attention.', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-brief-lead="true"]').count(), 0, 'empty editions never invent a priority');
  assert.equal(writes.length, 3, 'all reading emphasis is read-only');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('Unified Brief: consent, same-ID retry, exact-version reading, inactive navigation, shared Home preview, responsive themes; no real mutations.');
} catch (error) {
  console.error('Browser errors:', errors);
  if (inspected && !inspected.isClosed()) {
    await inspected.screenshot({ path: `${out}/failure.png`, fullPage: true });
    console.error(await inspected.locator('main').allTextContents());
    console.error(await inspected.locator('details').evaluateAll(nodes => nodes.map(n => ({ open: n.open, summary: n.querySelector('summary')?.textContent }))));
  }
  throw error;
} finally { await browser.close(); }
