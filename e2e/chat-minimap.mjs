// Read-only fixture: never starts an agent or writes a real session.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const output = process.env.E2E_SCREENSHOT_DIR ?? '/tmp/chat-minimap';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
try {
  for (const count of [3, 45]) {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
    await context.addInitScript(() => {
      localStorage.setItem('pi-theme', 'glass');
      localStorage.setItem('pi-locale', 'zh-CN');
      localStorage.removeItem('pi-web:minimap-preview-locked');
      window.EventSource = class {
        readyState = 1;
        constructor() { setTimeout(() => { this.onopen?.(); this.onmessage?.({ data: JSON.stringify({ type: 'connected', isStreaming: false }) }); }, 50); }
        close() { this.readyState = 2; }
      };
    });
    const cwd = '/tmp/minimap-fixture', timestamp = '2030-01-01T12:00:00Z';
    const info = { id: 'minimap-fixture', cwd, projectKey: cwd, projectRoot: cwd, name: '对话目录测试', path: `${cwd}/fixture.jsonl`, created: timestamp, modified: timestamp, messageCount: count * 2, firstMessage: '优化聊天进度条' };
    const prompts = ['就是加一层网格，和其他主题一样', '还有很多边边角角并没有做前端主题适配，比如 session 里的搜索、打开的 terminal，还有系统和工具的显示位置问题', '玻璃的左侧视图有问题，每个地方都检查一下'];
    const messages = Array.from({ length: count }, (_, index) => [
      { role: 'user', content: prompts[index % 3] + (count > 3 ? ` ${index + 1}` : '') },
      { role: 'assistant', content: Array.from({ length: index === 1 ? 76 : 2 }, (_, n) => ({ type: 'toolCall', toolCallId: `call-${index}-${n}`, toolName: 'read', input: { path: 'fixture.ts' } })) },
      { role: 'assistant', content: [{ type: 'text', text: `## 检查结果 ${index + 1}\n\n已补齐主题适配，保留原有交互。\n\n${'这里是用于验证滚动定位的正文，不应全部展示在目录中。\n\n'.repeat(8)}` }] },
    ]).flat();
    const fixtures = {
      '/api/home': { home: '/tmp', generalProject: { root: cwd, key: cwd } },
      '/api/sessions': { sessions: [info], runningSessionIds: [], sessionListVersion: 1 },
      '/api/sessions/ui-state': { version: 1, revision: 0, sessions: {}, projects: { [cwd]: { root: cwd } }, projectOrder: [cwd] },
      '/api/agent/running': { runningSessionIds: [], awaitingInputSessionIds: [], sessionListVersion: 1 },
      '/api/models': { models: {}, modelList: [] },
      '/api/worktrees': { isGit: false, worktrees: [], projectRoot: cwd, projectKey: cwd },
      '/api/sessions/minimap-fixture': { info, sessionId: info.id, leafId: 'answer', tree: [], context: { messages, entryIds: messages.map((_, i) => `entry-${i}`), turnsBefore: 15, hasMore: false, oldestEntryId: 'entry-0', thinkingLevel: 'off' } },
      '/api/sessions/minimap-fixture/state': { running: false, state: { isStreaming: false } },
      '/api/agent/minimap-fixture': { running: false, state: { isStreaming: false } },
    };
    await context.route('**/api/**', route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path === '/api/cwd/validate') return route.fulfill({ json: { cwd, projectRoot: cwd, projectKey: cwd } });
      if (path.endsWith('/lease')) return route.fulfill({ json: { success: true } });
      if (req.method() !== 'GET') {
        const body = req.postDataJSON();
        assert.ok(path === '/api/agent/minimap-fixture' && ['get_state', 'get_tools', 'get_commands'].includes(body?.type), `Unexpected write: ${path}`);
        return route.fulfill({ json: { success: true, data: { commands: [], isStreaming: false } } });
      }
      return route.fulfill({ json: fixtures[path] ?? {} });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/?session=minimap-fixture');
    const rail = page.locator('[data-minimap-rail]');
    const preview = page.locator('[data-minimap-preview-box]');
    await rail.waitFor();
    await page.waitForFunction(count => document.querySelectorAll('[data-minimap-node-index]').length === count, count);
    for (const theme of ['glass', 'light', 'dark', 'matrix']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle('dark', ['dark', 'matrix'].includes(theme)); }, theme);
      await rail.focus();
      await rail.press('Home');
      await preview.waitFor();
      assert.ok((await preview.textContent()).includes(`16 / ${count + 15} 轮`), 'Numbers include unloaded earlier turns');
      assert.ok(await preview.getByRole('img', { name: '本轮 76 次工具调用', exact: true }).count(), 'Tool count remains separately labelled');
      await page.waitForFunction(() => document.querySelector('[data-minimap-preview-user="0"]')?.getAttribute('aria-current') === 'step');
      const geometry = await preview.evaluate(el => {
        const r = el.getBoundingClientRect(), rail = el.parentElement.getBoundingClientRect();
        const list = el.querySelector('[data-minimap-preview-list]');
        return { x: r.x, right: r.right, height: r.height, bottom: r.bottom, railBottom: rail.bottom, railHeight: rail.height, overflow: list.scrollHeight > list.clientHeight, horizontalOverflow: list.scrollWidth > list.clientWidth };
      });
      assert.ok(geometry.x >= 0 && geometry.right <= 1440 && geometry.bottom <= geometry.railBottom, JSON.stringify(geometry));
      assert.ok(!geometry.horizontalOverflow, 'Long questions must not overflow the outline');
      assert.ok(geometry.height <= 560, 'Preview is bounded, not full-height');
      if (count === 3) assert.ok(geometry.height < geometry.railHeight * 0.65, 'Short history shrinks to its content');
      else assert.ok(geometry.overflow, 'Long history scrolls inside the outline');
      const active = rail.locator('[data-minimap-node-active] span');
      assert.equal(await active.evaluate(el => getComputedStyle(el).backgroundColor), await rail.evaluate(el => { const probe = document.createElement('span'); probe.style.color = 'var(--accent)'; el.append(probe); const value = getComputedStyle(probe).color; probe.remove(); return value; }));
      await page.screenshot({ path: `${output}/${count}-${theme}.png` });
      await rail.press('Escape');
      await preview.waitFor({ state: 'detached' });
      await rail.press('Enter');
    }
    await rail.press('End');
    await page.waitForFunction(index => document.querySelector(`[data-minimap-node-index="${index}"]`)?.hasAttribute('data-minimap-node-active'), count - 1);
    await rail.press('Home');
    await rail.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector('[data-minimap-preview-user="1"]')?.getAttribute('aria-current') === 'step');
    await preview.locator('[data-minimap-preview-user="0"]').focus();
    await page.mouse.move(1, 1);
    await page.waitForTimeout(350);
    assert.ok(await preview.isVisible(), 'Keyboard focus keeps the preview open when the pointer leaves');
    await preview.locator('[data-minimap-preview-user="0"]').press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-minimap-node-index="0"]')?.hasAttribute('data-minimap-node-active'));
    await preview.locator('[data-preview-heading-index="0"]').first().click();
    await preview.getByRole('button', { name: '关闭', exact: true }).click();
    await preview.waitFor({ state: 'detached' });
    assert.ok(await rail.evaluate(el => el === document.activeElement), 'Dismiss restores keyboard focus');
    await rail.locator('[data-minimap-lock]').click();
    await rail.hover({ position: { x: 18, y: 15 } });
    assert.equal(await preview.count(), 0, 'Lock still suppresses hover preview');
    await rail.locator('[data-minimap-lock]').click();
    await page.mouse.move(1, 1);
    await rail.hover({ position: { x: 18, y: 15 } });
    await preview.waitFor();
    await page.locator('.chat-input-textarea').focus();
    await page.mouse.move(1, 1);
    await preview.waitFor({ state: 'detached' });
    await rail.hover({ position: { x: 18, y: 15 } });
    await preview.waitFor();
    await page.mouse.move(1, 1);
    await preview.waitFor({ state: 'detached' });
    await rail.focus();
    await page.setViewportSize({ width: 812, height: 450 });
    await rail.focus();
    await page.waitForTimeout(300);
    assert.ok(await preview.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.bottom <= innerHeight && r.height <= el.parentElement.clientHeight; }), 'Fits a short, narrow chat');
    await page.screenshot({ path: `${output}/${count}-short.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await rail.waitFor({ state: 'detached' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${count} turns: four themes, compact/scrolling outline, active state, keyboard, focus, lock, narrow/short/mobile layouts.`);
  }
} finally { await browser.close(); }
