// All APIs are mocked. Never starts a model or changes personal data.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fullstackPlan, practicePlan } from '../extension/robin/learning.ts';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  for (const locale of ['en', 'zh-CN']) {
    const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
    if (process.env.PI_WEB_PASSWORD) {
      const login = await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
      assert.ok(login.ok());
    }
    await context.addInitScript((locale) => localStorage.setItem('pi-locale', locale), locale);
    let record = { sessionId: null, running: false }, release;
    let failRead = false, failPost = false;
    const writes = [];
    const today = '2030-05-13';
    const fixtures = {
      '/api/robin/todos': { todos: [], today }, '/api/robin/events': { events: [], today },
      '/api/robin/jobs': { jobs: [] }, '/api/robin/rounds': { rounds: [] }, '/api/robin/links': { links: [] },
      '/api/robin/learning': { practice: practicePlan([], 'neetcode150', today), fullstack: fullstackPlan([]) },
    };
    await context.route('**/api/**', async (route) => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path !== '/api/robin/assistant') {
        assert.equal(req.method(), 'GET');
        return route.fulfill({ json: fixtures[path] ?? {} });
      }
      if (req.method() === 'GET') return route.fulfill(failRead ? { status: 503, json: { error: 'Status read failed' } } : { json: record });
      assert.equal(req.method(), 'POST', 'Dismissal must never reset or delete the conversation');
      writes.push(req.postDataJSON());
      record = { sessionId: 'act-session', running: true };
      if (failPost) return route.fulfill({ status: 500, json: { error: 'Request timed out' } });
      await new Promise((resolve) => { release = resolve; });
      record.running = false;
      return route.fulfill({ json: { reply: `Action result. ${'A long explanation with details. '.repeat(90)} https://example.com/result`, usedTools: ['todo_add'], sessionId: record.sessionId } });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const bar = page.locator('.robin-assistant-bar');
    const input = bar.locator('input');
    const send = bar.locator('button[type="submit"]');
    const trace = bar.locator('.robin-assistant-result-toolbar a');
    const dismiss = bar.getByRole('button', { name: locale === 'en' ? 'Close reply, keep execution record' : '关闭回复，保留执行记录' });
    const reply = bar.locator('.robin-assistant-reply');
    const refresh = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const activate = async () => {
      // The hydrated Day grid distinguishes a ready page from the inert SSR form.
      await page.locator('.robin-calendar [data-single]').waitFor();
      await bar.locator('select').selectOption('execute');
      assert.equal(await bar.getAttribute('data-mode'), 'execute');
    };
    await page.goto('/dashboard');
    await activate();
    assert.equal(await trace.count(), 0, 'No invented execution record');
    await input.fill('Create my task'); await input.press('Enter'); await input.press('Enter');
    try { await trace.waitFor(); } catch (error) {
      console.error({ record, writes, text: await bar.innerText(), errors });
      throw error;
    }
    assert.equal(await trace.getAttribute('href'), '/?session=act-session');
    assert.ok(await send.isDisabled()); assert.equal(writes.length, 1);
    assert.equal(await reply.count(), 0);
    release();
    await reply.waitFor();
    assert.ok(await reply.getByRole('link', { name: 'https://example.com/result' }).isVisible());
    assert.ok(await reply.evaluate((node) => node.scrollHeight > node.clientHeight), 'Long replies scroll without consuming the page');
    await reply.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    for (const width of [320, 430, 375]) {
      await page.setViewportSize({ width, height: 812 });
      await dismiss.click({ trial: true });
      const closeBox = await dismiss.boundingBox();
      assert.ok(closeBox.width >= 44 && closeBox.height >= 44 && closeBox.x >= 0 && closeBox.x + closeBox.width <= width);
    }
    await dismiss.click();
    await reply.waitFor({ state: 'detached' });
    assert.ok(await trace.isVisible()); assert.equal(writes.length, 1);
    assert.equal(await input.evaluate((node) => document.activeElement === node), false, 'Closing a reply must not open the phone keyboard');

    await page.reload(); await activate();
    await trace.waitFor();
    assert.equal(await trace.getAttribute('href'), '/?session=act-session', 'Record survives refresh without storing reply text in the browser');
    assert.equal(await reply.count(), 0);
    failRead = true; await refresh();
    await bar.getByText(locale === 'en' ? 'Execution status is temporarily unavailable.' : '暂时无法读取执行状态。', { exact: true }).waitFor();
    assert.equal(await trace.getAttribute('href'), '/?session=act-session');
    failRead = false; await refresh();
    await bar.getByText(locale === 'en' ? 'Execution status is temporarily unavailable.' : '暂时无法读取执行状态。', { exact: true }).waitFor({ state: 'hidden' });

    // HTTP failure can leave the agent running. Keep the draft and do not auto-retry.
    failPost = true;
    await input.fill('A second task'); await send.click();
    await bar.getByRole('alert').waitFor();
    await bar.getByText(locale === 'en' ? 'A failed request does not mean nothing changed. Check the execution record before retrying.' : '请求失败不代表操作未发生，请先检查执行记录再重试。', { exact: true }).waitFor();
    assert.equal(await input.inputValue(), 'A second task');
    await refresh();
    await page.waitForFunction(() => document.querySelector('.robin-assistant-submit').disabled);
    assert.equal(writes.length, 2);
    await dismiss.click();
    assert.equal(await bar.getByRole('alert').count(), 0);
    assert.ok(await send.isDisabled()); assert.ok(await trace.isVisible());
    await page.reload(); await activate(); await trace.waitFor();
    await input.fill('Do not duplicate this');
    assert.ok(await send.isDisabled(), 'Refresh does not allow another command during the same running session');
    record.running = false; await refresh();
    await page.waitForFunction(() => !document.querySelector('.robin-assistant-submit').disabled);
    assert.equal(writes.length, 2);
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.ok(await trace.isVisible());
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS: Act dismissal, live trace, refresh recovery, long replies, duplicate protection and uncertain failure in English/Chinese');
} finally { await browser.close(); }
