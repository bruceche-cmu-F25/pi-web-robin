// Existing dev server; all application APIs mocked after login. No personal writes.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/glass-theme.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import sharp from "sharp";
import { fullstackPlan, practicePlan } from "../extension/robin/learning.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
const output = process.env.E2E_SCREENSHOT_DIR ?? "/tmp/tahoe-glass";
// This checks the fallback gate in Chromium, NOT Safari's rendering engine.
const optics = process.env.E2E_GLASS_FALLBACK !== '1';
await mkdir(output, { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, hasTouch: width < 640, reducedMotion: "reduce", serviceWorkers: "block", ...(!optics ? { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.2 Safari/605.1.15' } : {}) });
    if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
    await context.addInitScript(() => { localStorage.setItem("pi-locale", "en"); localStorage.setItem("pi-web:navigation-placement", "left-labels"); });
    const today = "2030-05-12";
    const fixtures = {
      "/api/sessions": { sessions: [], runningSessionIds: [], sessionListVersion: 1 },
      "/api/sessions/ui-state": { version: 1, revision: 0, sessions: {}, projects: {} },
      "/api/agent/running": { runningSessionIds: [], awaitingInputSessionIds: [], sessionListVersion: 1 },
      "/api/models": { models: [], modelList: [] },
      "/api/models-config": { providers: {} },
      "/api/auth/providers": { oauthProviders: [], apiKeyProviders: [] },
      "/api/models/enabled": { allEnabled: true, patterns: null, stalePatterns: [], enabledTotal: 0, availableTotal: 0, scope: "global", settingsPath: "fixture/settings.json", editable: true, providers: [] },
      "/api/tools/settings": { isWindows: false }, "/api/cache-miss-notices": { enabled: false },
      "/api/robin/todos": { today, todos: [] }, "/api/robin/events": { today, events: [], google: { connected: false } },
      "/api/robin/jobs": { jobs: [] }, "/api/robin/links": { links: [] }, "/api/robin/rounds": { rounds: [] },
      "/api/robin/gmail": { today, connected: false, review: null },
      "/api/robin/learning": { practice: practicePlan([], "neetcode150", today), fullstack: fullstackPlan([]) },
    };
    const errors = [];
    await context.route("**/api/**", route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path === "/api/cwd/validate") return route.fulfill({ json: { cwd: "/tmp/glass-preview" } });
      assert.equal(request.method(), "GET", `Unexpected write: ${path}`);
      if (path === "/api/robin/settings") return route.fulfill({ status: 503, json: { error: "Service settings unavailable (fixture)" } });
      return route.fulfill({ json: fixtures[path] ?? {} });
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    const theme = name => page.getByRole("radio", { name, exact: true });
    const expectTheme = id => page.waitForFunction(id => document.documentElement.dataset.theme === id, id);
    const expectOptics = async selector => {
      if (optics) await page.waitForFunction(selector => !!document.querySelector(selector)?.dataset.glassRefraction, selector).catch(async error => {
        console.error(await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, ua: navigator.userAgent, hidden: document.hidden, defs: document.querySelectorAll('[data-liquid-glass-defs]').length, filters: [...document.querySelectorAll('[data-liquid-glass-defs] filter')].map(el => ({ id: el.id, width: el.getAttribute('width'), image: el.querySelector('feImage')?.hasAttribute('href') })) })), errors);
        throw error;
      });
      else assert.equal(await page.locator('[data-glass-refraction]').count(), 0);
    };
    const expectMaterial = async (selector, kind, svg = optics) => {
      if (svg) await expectOptics(selector);
      else assert.equal(await page.locator(selector).getAttribute('data-glass-refraction'), null);
      await page.waitForFunction(({ selector, kind, optics }) => {
        const el = document.querySelector(selector), style = getComputedStyle(el);
        const filter = document.getElementById(el.dataset.glassRefraction);
        return style.getPropertyValue('--glass-material').trim() === kind && (!optics || Number(filter?.querySelector('feGaussianBlur')?.getAttribute('stdDeviation')) === (kind === 'frost' ? 10 : .7));
      }, { selector, kind, optics: svg });
    };
    const surface = selector => page.locator(selector).first().evaluate(el => {
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, image: s.backgroundImage, filter: s.backdropFilter || s.webkitBackdropFilter, color: s.color, radius: s.borderTopLeftRadius, shadow: s.boxShadow };
    });
    const openChatSettings = async () => {
      if (width < 641) await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
    };
    await page.goto("/?cwd=%2Ftmp%2Fglass-preview");
    await page.locator("textarea").first().waitFor();
    await page.locator("textarea").first().fill("The theme changes; this draft stays.");
    await openChatSettings();
    await theme("Light").locator("..").click(); await expectTheme("light");
    const oldMaterial = await surface(".settings-dialog-surface");
    await theme("Glass").locator("..").click(); await expectTheme("glass");
    assert.equal(await page.evaluate(() => localStorage.getItem("pi-theme")), "glass");
    await expectMaterial('.settings-dialog-surface', 'frost');
    assert.match((await surface(".settings-dialog-surface")).filter, optics ? /url\(/ : /blur\(10px\)/, JSON.stringify(await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return { bg: root.getPropertyValue('--bg'), fill: root.getPropertyValue('--glass-fill'), filter: root.getPropertyValue('--glass-filter'), supports: CSS.supports('backdrop-filter', 'blur(1px)'), reduce: matchMedia('(prefers-reduced-transparency: reduce)').matches, contrast: matchMedia('(prefers-contrast: more)').matches };
    })));
    assert.equal(await page.locator("html").evaluate(el => el.classList.contains("dark")), false);
    assert.equal(await page.locator("textarea").first().inputValue(), "The theme changes; this draft stays.");
    assert.equal(await page.locator(".settings-theme-options").evaluate(el => {
      const bounds = el.getBoundingClientRect();
      return bounds.right <= innerWidth && [...el.querySelectorAll('.settings-theme-name')].every(label => label.scrollWidth <= label.clientWidth && label.scrollHeight <= label.clientHeight);
    }), true, "Every swatch label fits, including on phones");
    // Overlays can cross arbitrary images/editors: their stronger ink and
    // denser fill must remain legible even on a black backdrop.
    assert.deepEqual(await page.evaluate(() => {
      const material = getComputedStyle(document.querySelector('.settings-dialog-surface'));
      const rgba = color => color.match(/[\d.]+/g).map(Number);
      const lum = values => values.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const surface = rgba(material.backgroundColor), alpha = surface[3] ?? 1;
      const background = lum(surface.slice(0, 3).map(v => v * alpha));
      const probe = document.createElement('span'); document.body.append(probe);
      const failures = ['text', 'text-muted', 'text-dim', 'accent'].filter(key => {
        probe.style.color = material.getPropertyValue(`--${key}`);
        return (background + .05) / (lum(rgba(getComputedStyle(probe).color)) + .05) < 4.5;
      });
      probe.remove(); return failures;
    }), []);
    assert.equal((await surface('.settings-dialog-surface')).radius, '30px');
    assert.match((await surface('.settings-dialog-surface')).shadow, /inset/);
    assert.equal(await page.locator('.settings-dialog-surface').evaluate(el => {
      const rim = getComputedStyle(el, '::after');
      return rim.pointerEvents === 'none' && rim.padding === '1px' && rim.backgroundImage.includes('linear-gradient') && (rim.maskComposite.includes('exclude') || rim.webkitMaskComposite?.includes('xor'));
    }), true, 'A non-interactive hollow rim models the curved glass edge');
    await page.screenshot({ path: `${output}/settings-${width}.png` });
    assert.match((await surface('.settings-dialog-backdrop')).background, /0\.12\)/, 'The scrim does not muddy clear glass');
    if (width >= 960) {
      await page.locator('.settings-section-tabs').getByRole('button', { name: 'Models', exact: true }).click();
      await page.locator('.settings-dialog-surface .config-sidebar').waitFor();
      assert.equal((await surface('.settings-dialog-surface .config-panel-root.is-embedded > .config-panel-surface')).background, 'rgba(0, 0, 0, 0)', 'No opaque sheet hides the outer material');
      assert.match((await surface('.settings-dialog-surface .config-sidebar')).background, /0\.12\)/);
      assert.equal((await surface('.settings-dialog-surface .config-sidebar')).filter, 'none', 'Inner sections share the outer blur');
      await page.locator('.settings-dialog-surface .config-sidebar').getByText('Loading...', { exact: true }).waitFor({ state: 'hidden' });
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${output}/settings-models.png` });
      await page.locator('.settings-section-tabs').getByRole('button', { name: 'General', exact: true }).click();
    }
    await theme("Glass").focus(); await page.keyboard.press("ArrowRight"); await expectTheme("glass-dark");
    await page.keyboard.press("ArrowLeft"); await expectTheme("glass");
    await theme("Light").locator("..").click(); await expectTheme("light");
    assert.deepEqual(await surface(".settings-dialog-surface"), oldMaterial, "Other themes retain their original material");
    await page.waitForFunction(() => !document.querySelector('[data-liquid-glass-defs], [data-glass-refraction]'));
    await theme("Glass").locator("..").click(); await expectTheme("glass");
    const cdp = await context.newCDPSession(page);
    for (const feature of ["prefers-reduced-transparency", "prefers-contrast"]) {
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: feature, value: feature === "prefers-contrast" ? "more" : "reduce" }] });
      assert.equal((await surface(".settings-dialog-surface")).filter, "none");
      await page.waitForFunction(() => !document.querySelector('[data-liquid-glass-defs], [data-glass-refraction]'));
      assert.equal((await surface(".settings-dialog-surface")).background, "rgb(248, 250, 252)");
      assert.equal(await page.locator("html").evaluate(el => getComputedStyle(el).backgroundImage), "none");
      if (width >= 960) assert.equal((await surface('.settings-dialog-surface .config-sidebar')).background, 'rgb(248, 250, 252)');
    }
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await page.emulateMedia({ forcedColors: "active" });
    assert.equal((await surface(".settings-dialog-surface")).filter, "none");
    await page.emulateMedia({ forcedColors: "none" });
    await page.keyboard.press("Escape");
    if (width < 641) await page.keyboard.press("Escape");
    assert.match((await surface(".sidebar-container")).filter, /blur|url/);
    assert.match((await surface(".pi-topbar")).background, /0\.3\)/);
    assert.equal((await surface('.pi-topbar')).radius, '38px');
    await expectMaterial('.pi-topbar', 'clear', false);
    if (width >= 641) {
      await expectMaterial('.sidebar-container', 'frost');
      assert.match((await surface('.sidebar-container')).background, /0\.48\)/);
    }
    assert.ok(parseFloat(await page.locator('.pi-topbar').evaluate(el => getComputedStyle(el).marginTop)) >= 8, 'Toolbar floats off the edge');
    const composer = '.chat-input-surface:not(.is-compact)';
    await expectMaterial(composer, 'clear', false);
    assert.match((await surface(composer)).filter, /^blur\(/);
    assert.equal((await surface(composer)).radius, '38px');
    assert.equal((await surface(".session-sidebar")).filter, "none", "The sidebar has only one material layer");
    assert.equal(await page.locator('.chat-shell').evaluate(el => {
      const grid = getComputedStyle(el), root = getComputedStyle(document.documentElement);
      return grid.backgroundImage === root.backgroundImage && grid.backgroundSize === root.backgroundSize && grid.backgroundSize.includes('4px 4px') && grid.backgroundSize.includes('20px 20px');
    }), true, 'Glass reuses the existing engineering grid, not a separate texture');
    await page.screenshot({ path: `${output}/chat-${width}.png` });
    await page.locator('.chat-input-textarea').focus();
    await page.keyboard.press('Meta+k');
    const palette = page.locator('.robin-command-dialog');
    await palette.waitFor();
    await expectMaterial('.robin-command-dialog', 'frost');
    await page.waitForFunction(() => document.activeElement === document.querySelector('.robin-command-dialog input'));
    assert.equal(await palette.evaluate(el => el.matches(':modal')), true);
    assert.match((await surface('.robin-command-dialog')).background, /0\.56\)/);
    for (const selector of ['.robin-command-dialog__content', '.robin-command-dialog .robin-assistant-bar']) {
      assert.equal((await surface(selector)).background, 'rgba(0, 0, 0, 0)', 'No opaque inner sheet hides command-palette frost');
      assert.equal((await surface(selector)).filter, 'none', 'One material layer only');
    }
    assert.match(await palette.evaluate(el => getComputedStyle(el, '::backdrop').backgroundColor), /0\.12\)/);
    await page.screenshot({ path: `${output}/command-${width}.png` });
    if (width >= 960) await checkPaletteFrost(page, output);
    const paletteFilter = await palette.getAttribute('data-glass-refraction');
    await page.keyboard.press('Escape');
    await palette.waitFor({ state: 'hidden' });
    if (paletteFilter) await page.waitForFunction(id => !document.getElementById(id), paletteFilter);
    await page.waitForFunction(() => document.activeElement === document.querySelector('.chat-input-textarea'));
    assert.equal(await page.locator('.chat-input-textarea').inputValue(), 'The theme changes; this draft stays.');
    if (width >= 960) {
      await page.locator(composer).screenshot({ path: `${output}/capsule.png` });
      // Render a two-colour backdrop behind the REAL input frame. A computed
      // blur alone passes even when an opaque inner layer hides the material.
      const oldBackground = await page.locator(composer).evaluate(el => {
        const host = el.parentElement, old = host.style.background;
        host.style.background = 'linear-gradient(90deg, #c0ddf2 50%, #edccd6 50%)';
        return old;
      });
      const pixels = await sharp(await page.locator(composer).screenshot({ path: `${output}/material-probe.png` })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const { width: w, height: h, channels } = pixels.info;
      const pixel = x => [...pixels.data.subarray(((h - 13) * w + Math.round(x)) * channels, ((h - 13) * w + Math.round(x)) * channels + 3)];
      const left = pixel(w * .25), right = pixel(w * .75);
      assert.ok(right[0] - left[0] >= 25 && left[2] - right[2] >= 15, `Backdrop colours must show through the centre: ${left}, ${right}`);
      const nearLeft = pixel(w / 2 - 2), nearRight = pixel(w / 2 + 2);
      assert.ok(Math.abs(nearRight[0] - nearLeft[0]) >= 20, 'CSS glass retains detail instead of reverting to the old 18px frost');
      const luminance = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const ink = await page.locator('.chat-input-textarea').evaluate(el => getComputedStyle(el).color.match(/[\d.]+/g).slice(0, 3).map(Number));
      for (const background of [left, right, nearLeft, nearRight]) assert.ok((luminance(background) + .05) / (luminance(ink) + .05) >= 4.5, 'Rendered frosted centre keeps readable text');
      await page.locator(composer).evaluate((el, background) => { el.parentElement.style.background = background; }, oldBackground);
      // Floating geometry must also work with both horizontal navigation modes.
      await openChatSettings();
      const placement = page.getByRole('radiogroup', { name: 'Global navigation', exact: true });
      for (const name of ['Top', 'Top, icons only', 'Left']) {
        await placement.getByRole('radio', { name, exact: true }).locator('..').click();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const bounds = await page.locator('.robin-navigation-container').boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
        await expectMaterial('.robin-navigation-container', name === 'Left' ? 'frost' : 'clear');
      }
      await placement.getByRole('radio', { name: 'Left, with labels', exact: true }).locator('..').click();
      await page.keyboard.press('Escape');
    }
    await page.reload(); await expectTheme("glass");
    await page.emulateMedia({ colorScheme: "dark" }); await expectTheme("glass");
    await page.goto("/dashboard"); await page.locator(".robin-assistant-form input").waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal((await surface('.robin-dashboard-header')).filter, 'none', 'The host stays clear; glass belongs to the search capsule');
    await expectMaterial('.robin-dashboard-header .robin-assistant-bar', 'clear');
    assert.match((await surface('.robin-dashboard-header .robin-assistant-bar')).filter, optics ? /url\(/ : /blur/);
    assert.equal((await surface('.robin-dashboard-header .robin-assistant-bar')).radius, '38px');
    assert.equal(await page.locator('.pi-card:not(.robin-assistant-bar)').first().evaluate(el => getComputedStyle(el).backdropFilter), 'none', 'Content cards stay solid; no per-row blur');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (width >= 960) {
      const geometry = await page.evaluate(() => Object.fromEntries(['.robin-shell', '.robin-navigation-container', '.robin-nav', '.robin-nav-utility'].map(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return [selector, { top: r.top, bottom: r.bottom, height: r.height }]; })));
      assert.ok(geometry['.robin-nav-utility'].bottom <= 900, JSON.stringify(geometry));
    }
    assert.equal(await page.locator('.robin-shell').evaluate(el => getComputedStyle(el).backgroundImage === getComputedStyle(document.documentElement).backgroundImage), true);
    await page.screenshot({ path: `${output}/dashboard-${width}.png` });
    if (optics && width >= 960) await checkRefraction(page, '.robin-dashboard-header .robin-assistant-bar', output);
    await page.keyboard.press('Control+k');
    await expectMaterial('.robin-command-dialog', 'frost');
    await page.emulateMedia({ contrast: 'more' });
    assert.equal((await surface('.robin-command-dialog')).filter, 'none');
    assert.equal((await surface('.robin-command-dialog')).background, 'rgb(248, 250, 252)');
    assert.equal(await page.locator('.robin-shell').evaluate(el => getComputedStyle(el).backgroundImage), 'none');
    await page.emulateMedia({ contrast: 'no-preference' });
    await expectMaterial('.robin-command-dialog', 'frost');
    await page.keyboard.press('Escape');
    if (width < 960) {
      await page.locator(".robin-mobile-nav-trigger").click();
      await expectMaterial('.robin-navigation-container', 'frost');
      assert.match((await surface(".robin-navigation-container")).filter, optics ? /url\(/ : /blur/);
      await page.screenshot({ path: `${output}/drawer-${width}.png` });
      await page.keyboard.press("Escape");
      const closed = await page.locator('.robin-navigation-container').boundingBox();
      assert.ok(closed.x + closed.width <= 1, 'The inset drawer fully leaves the viewport');
      await page.waitForFunction(() => document.activeElement === document.querySelector('.robin-mobile-nav-trigger'));
    }
    await page.setViewportSize({ width: width >= 960 ? width : 844, height: 390 });
    if (width < 960) await page.locator('.robin-mobile-nav-trigger').click();
    const lastNavEntry = page.locator('.robin-navigation-container .robin-nav-entry').last();
    await lastNavEntry.scrollIntoViewIfNeeded();
    const lastBounds = await lastNavEntry.boundingBox();
    assert.ok(lastBounds.y >= 0 && lastBounds.y + lastBounds.height <= 390, 'Utilities remain reachable on short/landscape screens');
    if (width < 960) await page.keyboard.press('Escape');
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard/settings");
    await page.waitForFunction(() => document.querySelector('input[name="theme"][value="glass"]')?.checked);
    await page.locator('input[name="theme"][value="glass"]').locator('..').scrollIntoViewIfNeeded();
    assert.equal(await theme("Glass").isChecked(), true);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS Glass ${width}px (${optics ? 'SVG refraction' : 'fallback gate'}): shared selectors, draft, keyboard, persistence, contrast, accessibility fallback and unchanged Light.`);
  }
} finally { await browser.close(); }

// A native dialog lives in the top layer. Computed blur alone does not prove
// that it can sample the page behind it, so compare the rendered boundary.
async function checkPaletteFrost(page, output) {
  const palette = page.locator('.robin-command-dialog');
  await page.evaluate(() => {
    const backdrop = document.createElement('div');
    backdrop.id = 'command-frost-fixture';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;background:linear-gradient(90deg,#294f79 50%,#e8f4fb 50%)';
    document.body.append(backdrop);
  });
  const step = async name => {
    const { data, info: { width, height, channels } } = await sharp(await palette.screenshot({ path: `${output}/${name}.png` })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const red = x => data[((height - 10) * width + Math.round(x)) * channels];
    return Math.abs(red(width / 2 + 2) - red(width / 2 - 2));
  };
  const frosted = await step('command-frost');
  await palette.evaluate(el => el.style.setProperty('backdrop-filter', 'none', 'important'));
  const plain = await step('command-unfiltered');
  assert.ok(plain > 30 && frosted < plain / 2, `Native command dialog actually frosts the backdrop: ${frosted} vs ${plain}`);
  await palette.evaluate(el => el.style.removeProperty('backdrop-filter'));
  await page.locator('#command-frost-fixture').evaluate(el => el.remove());
}

async function checkRefraction(page, selector, output) {
  const lens = page.locator(selector);
  const before = await lens.evaluate(el => {
    const host = el.parentElement;
    const old = { background: host.style.background, width: el.style.width };
    host.style.background = 'repeating-linear-gradient(90deg, #294f79 0 8px, #e8f4fb 8px 16px)';
    return old;
  });
  const snapshot = async name => sharp(await lens.screenshot({ path: `${output}/${name}.png` })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const refracted = await snapshot('refraction-active');
  const scales = await lens.evaluate(el => [...document.getElementById(el.dataset.glassRefraction).querySelectorAll('feDisplacementMap')].map(displacement => {
    const scale = displacement.getAttribute('scale');
    displacement.setAttribute('scale', '0');
    return scale;
  }));
  assert.equal(scales.length, 3, 'Short clear controls use the study’s subtle RGB dispersion');
  // Same DOM, colours, blur and shadows. Only displacement differs.
  const straight = await snapshot('refraction-zero-scale');
  assert.deepEqual(refracted.info, straight.info);
  const { width: w, height: h, channels } = refracted.info;
  const difference = (x0, x1, y0, y1) => {
    let total = 0, samples = 0;
    for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) {
      for (let c = 0; c < 3; c++) {
        const i = (y * w + x) * channels + c;
        total += Math.abs(refracted.data[i] - straight.data[i]); samples++;
      }
    }
    return total / samples;
  };
  // Vertical stripes bend near the rounded left end, where the normals have
  // an X component; the flat middle must not get zoomed or filter foreground.
  const edgeDifference = difference(8, 22, h * .25, h * .75);
  const centreDifference = difference(w * .55, w * .7, h * .45, h * .55);
  assert.ok(edgeDifference > 8, `Real rim refraction must move pixels, not just blur (${edgeDifference})`);
  assert.ok(centreDifference < 3, `Neutral centre must not warp (${centreDifference})`);
  console.log(`Rendered refraction: rim Δ=${edgeDifference.toFixed(2)}, centre Δ=${centreDifference.toFixed(2)} (0–255).`);
  await lens.evaluate((el, scales) => document.getElementById(el.dataset.glassRefraction).querySelectorAll('feDisplacementMap').forEach((node, i) => node.setAttribute('scale', scales[i])), scales);
  const oldId = await lens.getAttribute('data-glass-refraction');
  await lens.evaluate(el => { el.style.width = '520px'; });
  await page.waitForFunction(({ selector, oldId }) => {
    const el = document.querySelector(selector), id = el.dataset.glassRefraction;
    return id && id !== oldId && Number(document.getElementById(id).querySelector('feImage').getAttribute('width')) === el.offsetWidth;
  }, { selector, oldId });
  assert.equal(await page.locator(`#${oldId}`).count(), 0, 'Resizing releases the old filter');
  await lens.evaluate((el, old) => { el.style.width = old.width; el.parentElement.style.background = old.background; }, before);
  await page.waitForFunction(selector => {
    const el = document.querySelector(selector), filter = document.getElementById(el.dataset.glassRefraction);
    return filter && Number(filter.querySelector('feImage').getAttribute('width')) === el.offsetWidth;
  }, selector);
  // An asynchronously mounted surface is discovered; unmount releases its map.
  await page.evaluate(() => {
    const surface = document.createElement('div');
    surface.id = 'glass-lifecycle-fixture'; surface.className = 'pi-topbar';
    surface.style.cssText = 'position:fixed;bottom:20px;left:20px;width:180px;height:44px';
    document.body.append(surface);
  });
  await page.waitForFunction(() => document.getElementById('glass-lifecycle-fixture')?.dataset.glassRefraction);
  const clearId = await page.locator('#glass-lifecycle-fixture').getAttribute('data-glass-refraction');
  // Same 180×44 geometry and clamped radius: role alone must rebuild the map.
  await page.locator('#glass-lifecycle-fixture').evaluate(el => { el.className = 'settings-dialog-surface'; });
  await page.waitForFunction(oldId => {
    const el = document.getElementById('glass-lifecycle-fixture'), id = el.dataset.glassRefraction;
    const filter = document.getElementById(id);
    return id && id !== oldId && filter?.querySelector('feGaussianBlur').getAttribute('stdDeviation') === '10' && filter.querySelectorAll('feDisplacementMap').length === 1;
  }, clearId);
  assert.equal(await page.locator(`#${clearId}`).count(), 0, 'Switching material releases the old clear filter');
  const removedId = await page.locator('#glass-lifecycle-fixture').getAttribute('data-glass-refraction');
  await page.locator('#glass-lifecycle-fixture').evaluate(el => el.remove());
  await page.waitForFunction(id => !document.getElementById(id), removedId);
}
