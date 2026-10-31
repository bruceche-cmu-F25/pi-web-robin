// Both Glass palettes: real picker, persisted scheme, gradient + original grid,
// composited contrast and preference fallback. All app APIs/streams mocked.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const output = process.env.E2E_SCREENSHOT_DIR ?? '/tmp/glass-palettes';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
    await context.addInitScript(() => {
      localStorage.setItem('pi-locale', 'en');
      window.EventSource = class { close() {} };
    });
    const fixtures = {
      '/api/sessions': { sessions: [], runningSessionIds: [], sessionListVersion: 1 },
      '/api/sessions/ui-state': { version: 1, revision: 0, sessions: {}, projects: {} },
      '/api/agent/running': { runningSessionIds: [], awaitingInputSessionIds: [] },
      '/api/models': { models: [], modelList: [] },
      '/api/robin/todos': { todos: [], today: '2030-01-01' },
      '/api/robin/gmail': { connected: false, review: null },
      '/api/robin/jobs': { jobs: [] }, '/api/robin/rounds': { rounds: [] },
      '/api/robin/practice': { records: [] }, '/api/robin/tech-events': { events: [] },
    };
    await context.route('**/api/**', route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path === '/api/cwd/validate') return route.fulfill({ json: { cwd: '/tmp/glass-palette-fixture' } });
      assert.equal(req.method(), 'GET', `Unexpected write: ${path}`);
      if (path === '/api/robin/settings') return route.fulfill({ status: 503, json: { error: 'Fixture unavailable' } });
      return route.fulfill({ json: fixtures[path] ?? {} });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && /hydrated|hydration/i.test(m.text())) errors.push(m.text()); });
    await page.goto('/?cwd=%2Ftmp%2Fglass-palette-fixture');
    await page.locator('.chat-input-textarea').fill('Keep this draft across both glass palettes');
    await page.locator('.chat-input-textarea').evaluate(el => { el.paletteMarker = true; });
    if (width < 641) await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    for (const [id, label, bg, solid] of [
      ['glass', 'Glass', 'rgb(245, 247, 250)', 'rgb(248, 250, 252)'],
      ['glass-dark', 'Dark glass', 'rgb(20, 20, 22)', 'rgb(44, 44, 46)'],
    ]) {
      await page.getByRole('radio', { name: label, exact: true }).locator('..').click();
      await page.waitForFunction(id => document.documentElement.dataset.theme === id, id);
      await page.waitForFunction(() => !!document.querySelector('.settings-dialog-surface')?.dataset.glassRefraction);
      const state = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement), shell = getComputedStyle(document.querySelector('.chat-shell'));
        return { dark: document.documentElement.classList.contains('dark'), scheme: root.colorScheme, bg: root.backgroundColor, grid: root.getPropertyValue('--page-grid-image'), image: root.backgroundImage, sizes: root.backgroundSize, same: root.backgroundImage === shell.backgroundImage, stored: localStorage.getItem('pi-theme') };
      });
      assert.equal(state.dark, id === 'glass-dark');
      assert.equal(state.scheme, id === 'glass-dark' ? 'dark' : 'light');
      assert.equal(state.bg, bg); assert.equal(state.stored, id); assert.ok(state.same);
      assert.equal((state.grid.match(/gradient\(/g) ?? []).length, 7, 'Original seven grid layers retained');
      assert.equal((state.image.match(/gradient\(/g) ?? []).length, 9, 'Two colour washes coexist with the seven grid layers');
      assert.ok(state.sizes.includes('4px 4px') && state.sizes.includes('20px 20px'));
      assert.ok(await page.locator('.chat-input-textarea').evaluate(el => el.paletteMarker));
      assert.deepEqual(await page.locator('.settings-dialog-surface').evaluate(el => {
        const s = getComputedStyle(el), rgba = color => color.match(/[\d.]+/g).map(Number);
        const lum = rgb => rgb.slice(0, 3).map(v => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
        const fill = rgba(s.backgroundColor), alpha = fill[3] ?? 1, failures = [];
        const probe = document.createElement('span'); document.body.append(probe);
        for (const backdrop of [0, 255]) for (const token of ['text', 'text-muted', 'text-dim', 'accent']) {
          probe.style.color = s.getPropertyValue(`--${token}`);
          const a = lum(fill.slice(0, 3).map(v => v * alpha + backdrop * (1 - alpha))), b = lum(rgba(getComputedStyle(probe).color));
          if ((Math.max(a, b) + .05) / (Math.min(a, b) + .05) < 4.5) failures.push(`${token} on ${backdrop}`);
        }
        probe.remove(); return failures;
      }), [], 'Overlay text clears AA over black AND white content');
      if (id === 'glass-dark' && width >= 641) {
        const levels = await page.evaluate(() => {
          const rgb = color => color.match(/[\d.]+/g).map(Number);
          const base = rgb(getComputedStyle(document.documentElement).backgroundColor);
          const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length;
          const composite = selector => {
            const fill = rgb(getComputedStyle(document.querySelector(selector)).backgroundColor), a = fill[3] ?? 1;
            return mean(fill.slice(0, 3).map((v, i) => v * a + base[i] * (1 - a)));
          };
          return [mean(base), composite('.pi-topbar'), composite('.sidebar-container'), composite('.settings-dialog-surface')];
        });
        assert.ok(levels.every((value, i) => i === 0 || value > levels[i - 1]), `Base → control → sidebar → overlay rises in brightness: ${levels}`);
      }
      await page.screenshot({ path: `${output}/${id}-settings-${width}.png` });
      // Render exactly the page-ground paint in isolation. Comparing only the
      // wash catches an opaque grid mask accidentally hiding the new colour.
      if (width === 1440) {
        await page.evaluate(() => {
          const s = getComputedStyle(document.documentElement), probe = document.createElement('div');
          probe.id = 'palette-ground-probe';
          probe.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
          probe.style.backgroundColor = s.backgroundColor; probe.style.backgroundImage = s.backgroundImage;
          probe.style.backgroundSize = s.backgroundSize; probe.style.backgroundPosition = s.backgroundPosition;
          document.body.append(probe);
        });
        const probe = page.locator('#palette-ground-probe');
        const tinted = await sharp(await probe.screenshot({ path: `${output}/${id}-grid-colour.png` })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        await probe.evaluate(el => {
          const s = getComputedStyle(document.documentElement);
          el.style.backgroundImage = s.getPropertyValue('--page-grid-image');
          el.style.backgroundSize = s.getPropertyValue('--page-grid-size');
          el.style.backgroundPosition = s.getPropertyValue('--page-grid-position');
        });
        const neutral = await sharp(await probe.screenshot()).removeAlpha().raw().toBuffer();
        const pixel = (data, x, y) => [...data.subarray((y * tinted.info.width + x) * 3, (y * tinted.info.width + x) * 3 + 3)];
        const delta = (x, y) => pixel(tinted.data, x, y).map((v, i) => Math.abs(v - pixel(neutral, x, y)[i]));
        const farY = id === 'glass-dark' ? tinted.info.height - 22 : 22;
        assert.ok(Math.max(...delta(22, 82)) >= 4 && Math.max(...delta(width - 22, farY)) >= 4, 'Both corner colours remain visible through the original grid');
        if (id === 'glass-dark') {
          for (const [x, y] of [[22, 82], [width - 22, farY]]) {
            const ambient = pixel(tinted.data, x, y);
            assert.ok(Math.max(...ambient) - Math.min(...ambient) <= 4, 'Dark ground stays near-neutral, not purple or amber');
            assert.ok(Math.max(...delta(x, y)) <= 9, 'Ambient wash remains subordinate to material depth');
          }
        }
        assert.ok(Math.max(...delta(width / 2 + 2, 802)) < Math.max(...delta(22, 82)), 'Colour recedes toward the neutral reading area');
        const a = pixel(tinted.data, 20, 82), b = pixel(tinted.data, 22, 82);
        assert.ok(a.some((v, i) => v !== b[i]), 'Original grid lines still render through the colour');
        await probe.evaluate(el => el.remove());
      }
      const cdp = await context.newCDPSession(page);
      for (const name of ['prefers-reduced-transparency', 'prefers-contrast']) {
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name, value: name === 'prefers-contrast' ? 'more' : 'reduce' }] });
        await page.waitForFunction(() => !document.querySelector('[data-glass-refraction]'));
        const flat = await page.locator('.settings-dialog-surface').evaluate(el => ({ fill: getComputedStyle(el).backgroundColor, filter: getComputedStyle(el).backdropFilter, canvas: getComputedStyle(document.documentElement).backgroundImage }));
        assert.deepEqual(flat, { fill: solid, filter: 'none', canvas: 'none' });
      }
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await cdp.detach();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => !!document.querySelector('.settings-dialog-surface')?.dataset.glassRefraction);
    }
    await page.keyboard.press('Escape');
    if (width < 641) await page.locator('.sidebar-overlay-backdrop').click({ position: { x: width - 4, y: 450 } });
    await page.screenshot({ path: `${output}/glass-dark-chat-${width}.png` });
    await page.keyboard.press('Meta+k');
    await page.waitForFunction(() => !!document.querySelector('.robin-command-dialog')?.dataset.glassRefraction);
    assert.equal(await page.locator('.robin-command-dialog').evaluate(el => el.matches(':modal')), true);
    await page.screenshot({ path: `${output}/glass-dark-command-${width}.png` });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.chat-input-textarea').inputValue(), 'Keep this draft across both glass palettes');
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'glass-dark' && document.documentElement.classList.contains('dark'));
    await page.emulateMedia({ colorScheme: 'light' });
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'glass-dark', 'Explicit dark glass is not overwritten by OS light mode');
    await page.goto('/dashboard/settings');
    // The server's radio starts at the default; wait for preference hydration.
    await page.waitForFunction(() => document.querySelector('input[name="theme"][value="glass-dark"]')?.checked);
    await page.getByRole('radio', { name: 'Light', exact: true }).locator('..').click();
    await page.waitForFunction(() => !document.querySelector('[data-glass-refraction], [data-liquid-glass-defs]'));
    assert.deepEqual(errors, []);
    console.log(`PASS paired Glass ${width}px: picker, scheme, colour + grid, AA overlays, solid fallback, command dialog, draft, reload, Robin settings and cleanup`);
    await context.close();
  }
} finally { await browser.close(); }
