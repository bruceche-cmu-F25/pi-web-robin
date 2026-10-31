// Independent static prototype: no real app reads/writes, no production theme changes.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const output = process.env.E2E_SCREENSHOT_DIR ?? 'outputs/glass-from-scratch';
await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({ baseURL, reducedMotion: 'reduce', serviceWorkers: 'block' });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.route('**/api/**', route => { throw new Error(`Prototype called an API: ${route.request().url()}`); });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const ready = () => page.waitForFunction(() => {
    const glass = document.querySelector('.glass');
    const map = document.querySelector('feImage');
    return document.querySelector('.scene').dataset.optics === 'ready' && Number(map?.getAttribute('width')) === glass.offsetWidth && Number(map?.getAttribute('height')) === glass.offsetHeight;
  });
  const choose = async (group, value) => { await page.locator(`[data-control="${group}"] [data-value="${value}"]`).click(); await ready(); };
  for (const width of [1440, 390, 320, 1920]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/prototypes/glass/index.html'); await ready();
    assert.equal(await page.locator('[data-liquid-glass-defs]').count(), 0, 'The production theme engine is not mounted');
    const contrast = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement), probe = document.createElement('span'); document.body.append(probe);
      const rgba = key => { probe.style.color = root.getPropertyValue(key); return getComputedStyle(probe).color.match(/[\d.]+/g).map(Number); };
      const wash = rgba('--color-wash'), fill = rgba('--color-glass'), ink = rgba('--color-ink');
      const background = wash.slice(0, 3).map((v, i) => v * wash[3] * (1 - fill[3]) + fill[i] * fill[3]);
      const lum = rgb => rgb.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
      probe.remove(); return { ratio: (lum(background) + .05) / (lum(ink) + .05), wash, fill, ink };
    });
    assert.ok(contrast.ratio >= 4.5, `Even a black photo region retains AA ink contrast: ${JSON.stringify(contrast)}`);
    for (const component of ['search', 'toolbar', 'sheet']) {
      await choose('component', component);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const bounds = await page.locator('.glass').boundingBox(), stage = await page.locator('.scene').boundingBox();
      assert.ok(bounds.x >= stage.x && bounds.x + bounds.width <= stage.x + stage.width + 1);
      assert.ok(bounds.y >= stage.y && bounds.y + bounds.height <= stage.y + stage.height + 1, `${width} ${component}: ${JSON.stringify({ bounds, stage })}`);
      await page.screenshot({ path: `${output}/${component}-${width}.png`, fullPage: true });
    }
    await choose('component', 'search');
    const input = page.getByRole('searchbox'); await input.fill('草稿保留，不发送');
    await page.getByRole('button', { name: '预览搜索反馈' }).click();
    assert.match(await page.locator('.feedback').textContent(), /不会发出搜索请求/);
    await choose('background', 'paper'); await choose('material', 'frost');
    assert.equal(await input.inputValue(), '草稿保留，不发送');
    await choose('material', 'solid');
    assert.equal(await page.locator('.optics').evaluate(el => getComputedStyle(el).display), 'none');
    await page.reload(); await ready();
    assert.equal(await page.locator('[data-control="material"] [data-value="solid"]').getAttribute('aria-pressed'), 'true', 'View choice survives via URL');
    await page.getByRole('button', { name: '恢复初始状态' }).click(); await ready();
    await choose('background', 'grid');
    if (width === 1440) {
      await page.locator('.glass').screenshot({ path: `${output}/grid-active.png` });
      const active = await sharp(await page.locator('.glass').screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      await page.locator('.refraction input').uncheck();
      const flat = await sharp(await page.locator('.glass').screenshot({ path: `${output}/grid-zero.png` })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const { width: w, height: h, channels } = active.info;
      let edge = 0, count = 0;
      for (let y = 8; y < h - 8; y++) for (let x = 6; x < 24; x++) for (let c = 0; c < 3; c++) {
        const i = (y * w + x) * channels + c; edge += Math.abs(active.data[i] - flat.data[i]); count++;
      }
      assert.ok(edge / count > 1, `The grid actually bends (${edge / count})`);
      await page.locator('.refraction input').check();
    }
    const range = page.getByRole('slider', { name: '玻璃水平位置' });
    await range.focus(); await page.keyboard.press('End');
    assert.equal(await range.inputValue(), '100');
    const box = await page.locator('.glass').boundingBox(), stage = await page.locator('.scene').boundingBox();
    assert.ok(box.x + box.width <= stage.x + stage.width, 'Movement stays inside the scene');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    await page.waitForFunction(() => document.querySelector('.refraction input').disabled);
    assert.equal(await page.locator('.optics').evaluate(el => getComputedStyle(el).display), 'none');
    assert.equal(await page.locator('feDisplacementMap').count(), 0);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await ready();
    console.log(`PASS independent glass prototype ${width}px: bounds, rendered optics, controls, URL, draft, keyboard, preferences, no APIs.`);
  }
  assert.deepEqual(errors, []);
  await context.close();
} finally { await browser.close(); }
