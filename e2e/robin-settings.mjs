// Existing dev server; all application APIs mocked after login. No credential writes or messages.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/robin-settings.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", reducedMotion: "reduce" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", {
    headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD },
  })).ok());
  await context.addInitScript(() => {
    localStorage.setItem("pi-locale", "en");
    localStorage.setItem("pi-theme", "light");
  });
  const unset = { set: false };
  const data = {
    notifications: { channel: "telegram" },
    google: { clientId: unset, clientSecret: unset, calendars: [] },
    notion: { apiToken: unset }, playwright: { extensionToken: unset },
    storedAt: "/fixture/robin/secrets.json", googleRedirectUri: `${baseURL}/api/robin/google/callback`,
    telegram: { botToken: unset, allowedChatIds: [],
      dailyAgenda: { enabled: true, time: "08:00", locale: "en" },
      jobDigest: { enabled: false, morning: "08:00", evening: "20:00", count: 10, locale: "en", chatIds: [], sweepAt: "03:00" },
      gmailDigest: { enabled: false, time: "08:00", locale: "en", chatIds: [], query: "newer_than:1d" },
      reminders: { enabled: true, lead: 30, locale: "en", chatIds: [] },
      transcription: { enabled: false, baseUrl: "https://api.openai.com/v1", model: "whisper-1", apiKey: unset },
    },
  };
  const writes = [], errors = [];
  let failSave = false, failLoad = false, holdSave = false, releaseSave;
  await context.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== "GET") writes.push({ path, body: request.postDataJSON() });
    if (path === "/api/robin/settings") {
      if (request.method() === "GET") return route.fulfill({ status: failLoad ? 503 : 200, json: failLoad ? { error: "Settings unavailable (fixture)" } : data });
      if (failSave) return route.fulfill({ status: 500, json: { error: "Save failed (fixture)" } });
      if (holdSave) await new Promise(resolve => { releaseSave = resolve; });
      const payload = request.postDataJSON();
      if (payload.transcription) data.telegram.transcription = { ...data.telegram.transcription, ...payload.transcription,
        apiKey: payload.transcription.apiKey ? { set: true, hint: 'fake' } : data.telegram.transcription.apiKey };
      return route.fulfill({ json: { ok: true } }).catch(() => {});
    }
    if (path === "/api/robin/google") return route.fulfill({ json: { configured: false, connected: false, redirectUri: data.googleRedirectUri } });
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(20_000);
  const choose = async id => {
    if (page.viewportSize().width >= 960) await page.getByRole("navigation", { name: "Settings category" }).locator(`a[href="#${id}"]`).click();
    else await page.getByRole("combobox", { name: "Settings category" }).selectOption(id);
    await page.locator(`#${id}`).waitFor({ state: "visible" });
  };
  const noOverflow = async () => assert.ok(await page.evaluate(() => {
    const root = document.querySelector("main");
    return document.documentElement.scrollWidth <= innerWidth && root.scrollWidth <= root.clientWidth + 1;
  }), "No horizontal page overflow");
  await page.goto("/dashboard/settings");
  await page.locator("#general").waitFor();
  await page.waitForFunction(() => !document.body.textContent.includes("Loading settings…"));
  assert.equal(await page.locator("main section:visible").count(), 2);
  assert.equal(await page.locator("#privacy").isVisible(), false, "Credentials do not dominate the first screen");
  assert.ok(await page.locator("#general h2").evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 20));
  // Independent native links, not an incomplete ARIA tab pattern.
  await page.getByRole("navigation", { name: "Settings category" }).getByRole("link", { name: "Google & Calendar" }).focus();
  await page.keyboard.press("Enter");
  await page.locator("#google").waitFor();
  const google = page.locator("#google");
  await google.getByLabel("Client ID", { exact: true }).fill("draft-client-id");
  await google.getByLabel("Client Secret", { exact: true }).fill("draft-client-secret");
  await google.getByLabel("Client ID", { exact: true }).evaluate(el => { el.draftMarker = true; });
  await choose("notion");
  await choose("google");
  assert.equal(await google.getByLabel("Client ID", { exact: true }).inputValue(), "draft-client-id");
  assert.equal(await google.getByLabel("Client ID", { exact: true }).evaluate(el => el.draftMarker), true, "Category changes do not remount forms");
  await page.goBack();
  await page.locator("#notion").waitFor();
  await page.goForward();
  await page.locator("#google").waitFor();
  assert.equal(writes.length, 0, "Browsing categories never writes settings");
  failSave = true;
  await page.locator("#google").getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Save failed" }).waitFor();
  assert.equal(await google.getByLabel("Client Secret", { exact: true }).inputValue(), "draft-client-secret");
  assert.equal(await page.locator("main").getByRole("alert").evaluate(el => el === document.activeElement), true, "Failed save is brought into view");
  failSave = false;
  await page.locator("#google").getByRole("button", { name: "Save", exact: true }).click();
  await page.locator("#google").getByRole("button", { name: "Saved", exact: true }).waitFor();
  assert.equal(await google.getByLabel("Client Secret", { exact: true }).inputValue(), "");
  assert.deepEqual(writes.at(-1).body, { section: "google", clientId: "draft-client-id", clientSecret: "draft-client-secret" });
  assert.equal(await page.locator("#google").getByRole("button", { name: "Saved", exact: true }).evaluate(el => getComputedStyle(el).animationName), "none");

  // Saving a different category must not reset an unsaved model.
  await choose('transcription');
  const model = page.locator('#transcription').getByLabel('Model', { exact: true });
  await model.fill('unsaved-model');
  await choose('google');
  await google.getByLabel('Client ID', { exact: true }).fill('another-client');
  await google.getByLabel('Client Secret', { exact: true }).fill('another-secret');
  await google.getByRole('button', { name: 'Save', exact: true }).click();
  await google.getByRole('button', { name: 'Saved', exact: true }).waitFor();
  await choose('transcription');
  assert.equal(await model.inputValue(), 'unsaved-model');
  // The same field can acquire a newer draft while its prior value saves.
  holdSave = true;
  await page.locator('#transcription').getByRole('button', { name: 'Save voice settings', exact: true }).click();
  while (!releaseSave) await page.waitForTimeout(10);
  await model.fill('newer-draft');
  holdSave = false; releaseSave(); releaseSave = null;
  await page.locator('#transcription').getByRole('button', { name: 'Saved', exact: true }).waitFor();
  assert.equal(data.telegram.transcription.model, 'unsaved-model');
  assert.equal(await model.inputValue(), 'newer-draft');
  await page.getByRole('status').filter({ hasText: 'Unsaved changes' }).waitFor();
  // Native navigation and reload both permit staying without losing the draft.
  let guardCount = 0;
  const dismissLeave = async dialog => { assert.equal(dialog.type(), 'beforeunload'); guardCount++; await dialog.dismiss(); };
  page.once('dialog', dismissLeave);
  await page.locator('.robin-nav-entry[data-nav-label="Chat"]').click({ noWaitAfter: true });
  await page.waitForTimeout(150);
  assert.equal(new URL(page.url()).pathname, '/dashboard/settings');
  assert.equal(await model.inputValue(), 'newer-draft');
  page.once('dialog', dismissLeave);
  await page.reload({ timeout: 3000 }).catch(() => {});
  assert.equal(guardCount, 2); assert.equal(await model.inputValue(), 'newer-draft');
  // Read failure after confirmed save is not a failed write or a reason to replay it.
  await page.locator('#transcription').getByRole('button', { name: 'Save voice settings', exact: true }).waitFor();
  failLoad = true;
  const beforeConfirmed = writes.length;
  await page.locator('#transcription').getByRole('button', { name: 'Save voice settings', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Saved, but the status' }).waitFor();
  assert.equal(writes.length, beforeConfirmed + 1);
  failLoad = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('main').getByRole('alert').waitFor({ state: 'hidden' });
  assert.equal(writes.length, beforeConfirmed + 1, 'Retry reloads status without another write');
  assert.equal(await page.getByRole('status').filter({ hasText: 'Unsaved changes' }).count(), 0);

  // Existing deep links, refresh and unknown fragments.
  for (const id of ["notifications", "cold-reach-email"]) {
    await page.goto(`/dashboard/settings#${id}`);
    await page.locator(`#${id}`).waitFor();
    await page.reload();
    await page.locator(`#${id}`).waitFor();
    assert.equal(await page.locator("main section:visible").count(), 1);
  }
  await page.goto("/dashboard/settings#unknown");
  await page.locator("#general").waitFor();
  await choose("transcription");
  const key = page.locator('#transcription input[type="password"]');
  await key.fill("retryable-key");
  failSave = true;
  await page.locator("#transcription").getByRole("button").click();
  await page.getByRole("alert").filter({ hasText: "Save failed" }).waitFor();
  assert.equal(await key.inputValue(), "retryable-key", "A failed voice key save preserves the key");
  failSave = false;
  await page.locator("#transcription").getByRole("button").click();
  await page.locator("#transcription").getByRole("button", { name: "Saved", exact: true }).waitFor();
  assert.equal(await key.inputValue(), "");

  await choose("general");
  await page.locator('input[name="settings-language"][value="en"]').focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
  await page.keyboard.press("ArrowLeft");
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();

  const output = process.env.E2E_SCREENSHOT_DIR ?? "/tmp/robin-settings-preview";
  await mkdir(output, { recursive: true });
  for (const theme of ["light", "dark", "glass", "glass-dark"]) {
    await choose("general");
    await page.locator(".settings-theme-option").filter({ has: page.locator(`input[value="${theme}"]`) }).click();
    assert.equal(await page.locator(`input[name="theme"][value="${theme}"]`).isChecked(), true);
    await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
    const contrast = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const rgb = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
      const over = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] / 255 + bg[i] * (1 - fg[3] / 255));
      const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      return [...document.querySelectorAll('#general h2, #general p, main nav h2')].filter(el => el.getClientRects().length).map(el => {
        const ancestors = []; for (let node = el; node; node = node.parentElement) ancestors.unshift(node);
        const bg = ancestors.reduce((color, node) => over(rgb(getComputedStyle(node).backgroundColor), color), [255, 255, 255]);
        const a = luminance(over(rgb(getComputedStyle(el).color), bg)), b = luminance(bg);
        return { text: el.textContent, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
      });
    });
    for (const sample of contrast) assert.ok(sample.ratio >= 4.5, `${theme}: ${sample.text} contrast ${sample.ratio.toFixed(2)}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    const navigation = page.getByRole("navigation", { name: "Settings category" });
    const selected = navigation.locator('a[aria-current="location"]');
    assert.equal(await selected.count(), 1);
    const navStyle = await selected.evaluate(el => {
      const icon = el.querySelector('span[aria-hidden="true"]');
      const rgb = getComputedStyle(icon).color.match(/[\d.]+/g).map(Number);
      return { height: el.getBoundingClientRect().height, green: rgb[1] > rgb[0] && rgb[1] > rgb[2],
        chevron: getComputedStyle(el.lastElementChild).opacity };
    });
    assert.ok(navStyle.height >= 48 && navStyle.green, `${theme}: spacious navigation with a green current icon`);
    assert.equal(navStyle.chevron, "1");
    const inactive = navigation.locator('a:not([aria-current])').first();
    assert.equal(await inactive.evaluate(el => getComputedStyle(el.lastElementChild).opacity), "0");
    await selected.focus();
    await page.keyboard.press("Tab");
    assert.equal(await inactive.evaluate(el => getComputedStyle(el.lastElementChild).opacity), "1", "Keyboard focus reveals the navigation cue");
    await selected.focus();
    for (const width of [1440, 960, 812, 390, 320]) {
      await page.setViewportSize({ width, height: width === 812 ? 390 : 900 });
      for (const id of ["general", "notifications", "google", "cold-reach-email", "notion", "telegram", "playwright", "transcription", "privacy"]) {
        await choose(id);
        await noOverflow();
        // Every visible editable field has a real label, not only a placeholder.
        const unlabeled = await page.locator('main input:not([type="radio"]):visible, main select:visible').evaluateAll(fields => fields.filter(el => !el.labels?.length && !el.getAttribute("aria-label")).map(el => el.outerHTML));
        assert.deepEqual(unlabeled, []);
      }
      await choose("general");
      if ([1440, 390].includes(width)) await page.screenshot({ path: `${output}/settings-${theme}-${width}.png` });
      await choose("notifications");
      assert.equal(await page.getByRole("switch").count(), 4);
      const enabled = page.getByRole("switch").first();
      await enabled.focus();
      await page.keyboard.press("Space");
      assert.equal(await enabled.isChecked(), false);
      await page.keyboard.press("Space");
      assert.equal(await enabled.isChecked(), true);
      const switchColors = await enabled.evaluate(el => {
        const style = getComputedStyle(el);
        const rgb = style.backgroundColor.match(/[\d.]+/g).map(Number);
        return { green: rgb[1] > rgb[0] && rgb[1] > rgb[2], knob: getComputedStyle(el, "::before").backgroundColor, track: style.backgroundColor };
      });
      assert.ok(switchColors.green, `${theme}: enabled switch is green, not the action accent`);
      assert.notEqual(switchColors.knob, switchColors.track, `${theme}: knob remains distinct`);
      if ([1440, 390].includes(width)) await page.screenshot({ path: `${output}/notifications-${theme}-${width}.png` });
    }
  }
  // Larger type, keyboard focus, and short screens still expose every category.
  await page.setViewportSize({ width: 960, height: 400 });
  await page.evaluate(() => document.documentElement.style.fontSize = "20px");
  await choose("privacy");
  await noOverflow();
  await page.setViewportSize({ width: 320, height: 568 });
  await choose("notifications");
  await noOverflow();
  await page.evaluate(() => document.documentElement.style.fontSize = "");
  const writeCount = writes.length;
  failLoad = true;
  await page.goto("/dashboard/settings");
  await page.getByRole("alert").filter({ hasText: "Settings unavailable" }).waitFor();
  assert.equal(await page.getByRole("radiogroup", { name: "Appearance", exact: true }).isVisible(), true, "Local preferences work offline");
  failLoad = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await page.locator("main").getByRole("alert").waitFor({ state: "hidden" });
  await choose("notifications");
  await page.getByRole("switch").first().waitFor();
  await page.emulateMedia({ forcedColors: "active" });
  assert.equal(await page.getByRole("switch").first().evaluate(el => getComputedStyle(el).appearance), "auto");
  assert.equal(writes.length, writeCount, "Layout, theme, navigation and retry checks do not save settings");
  // A lost write receipt is uncertain, never automatically replayed or called saved.
  await choose('transcription');
  await page.locator('#transcription').getByLabel('Model', { exact: true }).fill('uncertain-save-model');
  holdSave = true;
  const beforeTimeout = writes.length;
  await page.locator('#transcription').getByRole('button', { name: 'Save voice settings', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'save was not confirmed' }).waitFor({ timeout: 35_000 });
  assert.equal(writes.length, beforeTimeout + 1);
  assert.equal(await page.locator('#transcription').getByLabel('Model', { exact: true }).inputValue(), 'uncertain-save-model');
  assert.equal(await page.locator('#transcription').getByRole('button', { name: 'Saved', exact: true }).count(), 0);
  holdSave = false; releaseSave(); releaseSave = null;
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('main').getByRole('alert').waitFor({ state: 'hidden' });
  assert.equal(writes.length, beforeTimeout + 1, 'Checking an uncertain result never replays the write');
  assert.equal(await page.getByRole('status').filter({ hasText: 'Unsaved changes' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: settings navigation/history/deep links, mounted drafts, save failure/retry, labels, switches, four themes, 320–1440px, landscape, large text and offline preferences");
} finally {
  await browser.close();
}
