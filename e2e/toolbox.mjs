// Real browser-side conversions; server jobs mocked. Domain/API tests exercise real FFmpeg/Vision.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";
import QRCode from "qrcode";
import { unzipSync } from "fflate";
const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1100 }, serviceWorkers: "block", permissions: ["clipboard-read", "clipboard-write"] });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => localStorage.setItem("pi-locale", "en"));
  let uploads = 0, held, hold = false, enginesReady = true;
  await context.route("**/api/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/robin/toolbox") {
      if (request.method() === "GET") return route.fulfill({ json: { media: enginesReady, subtitles: enginesReady, ocr: enginesReady } });
      uploads++;
      const form = await new Response(request.postDataBuffer(), { headers: { "content-type": request.headers()["content-type"] } }).formData();
      const options = JSON.parse(form.get("options"));
      if (hold) await new Promise((resolve) => { held = resolve; });
      if (options.kind === "subtitles") return route.fulfill({ headers: { "content-type": "text/plain", "content-disposition": 'attachment; filename="subtitles.srt"' }, body: "1\n00:00:00,000 --> 00:00:01,000\nLocal subtitle" });
      if (options.kind === "ocr") return route.fulfill({ headers: { "content-type": "text/plain", "content-disposition": 'attachment; filename="recognized.txt"' }, body: "Recognized locally" });
      return route.fulfill({ headers: { "content-type": options.kind === "audio" ? "audio/mpeg" : "video/mp4", "content-disposition": 'attachment; filename="converted.mp3"' }, body: "synthetic server output" });
    }
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/tools");
  await page.getByRole("heading", { name: "Local toolbox", exact: true }).waitFor();
  assert.equal(await page.locator('.robin-nav-main a[aria-current="page"]').getAttribute("href"), "/dashboard");
  assert.equal(await page.locator('.robin-nav-main a[href^="/tools"]').count(), 0);
  const catalog = page.getByRole("navigation", { name: "Choose a tool" });
  const speech = catalog.getByRole("link", { name: "Speech to text", exact: true });
  assert.equal(await speech.getAttribute("href"), "/recordings");
  assert.equal(await catalog.getByRole("link", { name: "Mac monitor & cleanup", exact: true }).getAttribute("href"), "/tools/mac");
  assert.equal(await catalog.locator("button, a").count(), 13);
  assert.equal(await catalog.locator('svg[aria-hidden="true"][focusable="false"]').count(), 13, "each tool has a decorative icon alongside its label");
  assert.equal(new Set(await catalog.locator("svg path").evaluateAll((paths) => paths.map((path) => path.getAttribute("d")))).size, 13, "each icon is distinct");
  assert.ok(await catalog.locator('button, a').evaluateAll((entries) => entries.every((entry) => {
    const style = getComputedStyle(entry);
    return style.borderTopLeftRadius === "16px" && style.borderTopWidth === "3px" && style.backgroundImage === "none";
  })), "the default catalog has rounded cards with solid category accents, not gradients");
  assert.equal(await catalog.locator('[class*="cardFooter"]').count(), 0, "only existing work needs a status label");
  const search = page.getByRole("searchbox", { name: "Search tools", exact: true });
  assert.equal(await search.evaluate((el) => getComputedStyle(el).borderTopWidth), "0px", "search has one outer frame, not nested borders");
  await search.fill("ＪＳＯＮ");
  assert.equal(await catalog.getByRole("button").count(), 2, "normalized search matches developer and CSV use cases");
  assert.ok(await catalog.getByRole("button", { name: "Developer tools", exact: true }).isVisible());
  assert.ok(await catalog.getByRole("button", { name: "CSV helper", exact: true }).isVisible());
  await search.fill("PDF");
  assert.equal(await catalog.getByRole("button").count(), 1, "unsupported PDF OCR must not appear as a PDF tool");
  await search.fill("no-such-utility");
  assert.equal(await catalog.getByRole("button").count(), 0);
  assert.equal(await catalog.getByRole("link").count(), 0);
  await page.getByText("No matching tools. Try a different word or clear the search.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  assert.ok(await search.evaluate((el) => el === document.activeElement));
  assert.equal(uploads, 0, "search never starts a conversion");
  const allTools = page.getByRole("button", { name: "All tools", exact: true });
  assert.equal(await catalog.getByRole("heading", { level: 2 }).count(), 4, "tools include a separate host-Mac category");
  assert.equal(await page.getByRole("button", { name: "Run locally", exact: true }).count(), 0, "the catalog does not show an arbitrary conversion form");
  const toolNames = await catalog.getByRole("button").evaluateAll((buttons) => buttons.map((button) => document.getElementById(button.getAttribute("aria-labelledby")).textContent));
  const checkWorkspaceSurfaces = async () => {
    const pane = page.locator('[aria-labelledby="toolbox-tool-title"]');
    const surfaces = await pane.locator('fieldset [class*="source"], fieldset [class*="options"]').evaluateAll((nodes) => nodes.map((node) => {
      const style = getComputedStyle(node); return { radius: parseFloat(style.borderTopLeftRadius), border: style.borderTopWidth, background: style.backgroundColor };
    }));
    assert.ok(surfaces.length >= 1 && surfaces.every((surface) => surface.radius === 16 && surface.border === "1px" && surface.background !== "rgba(0, 0, 0, 0)"), "every tool uses actual rounded source/options cards");
    const fieldRadii = await pane.locator('label[class*="field"] input, label[class*="field"] select, label[class*="field"] textarea').evaluateAll((nodes) => nodes.map((node) => parseFloat(getComputedStyle(node).borderTopLeftRadius)));
    assert.ok(fieldRadii.every((radius) => radius === 8), "every tool field uses the control radius");
    const primary = await pane.getByRole("button", { name: "Run locally", exact: true }).evaluate((button) => {
      const style = getComputedStyle(button);
      const rgb = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number).map((n) => n / 255);
      const luminance = (value) => rgb(value).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
      const fg = luminance(style.color), bg = luminance(style.backgroundColor);
      const channels = rgb(style.backgroundColor), max = Math.max(...channels), min = Math.min(...channels), lightness = (max + min) / 2;
      return { contrast: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05), saturation: (max - min) / (1 - Math.abs(2 * lightness - 1)), radius: parseFloat(style.borderTopLeftRadius), disabled: button.disabled };
    });
    assert.equal(primary.radius, 8);
    assert.ok(primary.saturation >= .65, "primary actions have vivid color, not a washed-out tint");
    if (!primary.disabled) assert.ok(primary.contrast >= 4.5, `primary text contrast: ${JSON.stringify(primary)}`);
    assert.ok(await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "rounded panels never widen the page");
  };
  const choose = async (name) => {
    if (!(await catalog.isVisible())) await allTools.click();
    await catalog.getByRole("button", { name, exact: true }).click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
    assert.equal(await catalog.isVisible(), false, "only the chosen workspace is visible");
    await checkWorkspaceSurfaces();
  };
  const run = async () => {
    await page.getByRole("button", { name: "Run locally", exact: true }).click();
    await page.getByRole("heading", { name: /^Result/ }).waitFor();
    const resultPanel = page.locator('[aria-labelledby="toolbox-result"]');
    assert.equal(await resultPanel.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius)), 16, "every output uses a rounded result panel");
    if (process.env.E2E_SCREENSHOT_DIR) {
      const name = (await page.locator('#toolbox-tool-title').textContent()).replace(/[^a-z0-9]+/gi, "-");
      await resultPanel.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/result-${name}.png` });
    }
  };
  const input = () => page.getByRole("textbox", { name: "Input", exact: true });
  const result = () => page.getByRole("textbox", { name: "Result", exact: true });
  const fileInput = () => page.locator('input[type="file"]');
  const download = async () => { const event = page.waitForEvent("download"); await page.getByRole("button", { name: "Download result", exact: true }).click(); const file = await event; return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) }; };
  const png = await QRCode.toBuffer("https://example.invalid/local-only", { width: 400 });
  const image = { name: "image.png", mimeType: "image/png", buffer: png };

  await choose("Text cleanup"); await input().fill("alpha\nalpha\n中文"); await run(); assert.equal(await result().inputValue(), "alpha\n中文");
  await page.getByRole("button", { name: "Copy result", exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "alpha\n中文");
  assert.ok((await page.getByRole("button", { name: "Download result", exact: true }).boundingBox()).y < (await result().boundingBox()).y, "download is available before scrolling through the result");
  assert.equal(await page.getByRole("region", { name: /^Result/ }).evaluate((el) => getComputedStyle(el).animationName), "none", "results need no entrance animation");
  await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }); });
  await page.getByRole("button", { name: "Copy result", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Clipboard unavailable" }).waitFor();
  assert.equal(await result().inputValue(), "alpha\n中文", "clipboard failure preserves editable output");
  await page.evaluate(() => { delete navigator.clipboard; });
  page.removeAllListeners("dialog"); page.once("dialog", (dialog) => dialog.dismiss());
  await choose("Text cleanup"); // Reopening the current tool retains its work.
  assert.equal(await input().inputValue(), "alpha\nalpha\n中文");
  assert.equal(await result().inputValue(), "alpha\n中文");
  await allTools.click();
  await page.waitForFunction(() => document.activeElement?.id === "toolbox-card-text");
  assert.equal(await catalog.getByRole("button", { name: "Text cleanup", exact: true }).evaluate((el) => el === document.activeElement), true, "returning restores focus to the current tool");
  await catalog.getByText("Continue your work", { exact: true }).waitFor();
  await catalog.getByRole("button", { name: "PDF organizer", exact: true }).click();
  assert.equal(await catalog.isVisible(), true, "cancelled switches stay in the catalog");
  await choose("Text cleanup");
  assert.equal(await input().inputValue(), "alpha\nalpha\n中文", "cancelled switch retains input");
  await allTools.click();
  page.once("dialog", (dialog) => dialog.dismiss());
  const leaveDialog = page.waitForEvent("dialog");
  await speech.click();
  assert.equal((await leaveDialog).type(), "beforeunload");
  assert.equal(new URL(page.url()).pathname, "/tools");
  await choose("Text cleanup");
  assert.equal(await input().inputValue(), "alpha\nalpha\n中文", "cancelled speech navigation retains input");
  assert.equal(await result().inputValue(), "alpha\n中文", "cancelled speech navigation retains output");
  page.on("dialog", (dialog) => dialog.accept());

  await choose("Developer tools"); await input().fill('{"a":1}'); await run(); assert.equal(await result().inputValue(), '{\n  "a": 1\n}');
  await page.getByLabel("Operation", { exact: true }).selectOption("diff"); await input().fill("old\n"); await page.getByRole("textbox", { name: "Compare with" }).fill("new\n"); await run(); assert.match(await result().inputValue(), /- old\n\+ new/);

  await choose("CSV helper"); await input().fill('name,note\n中文,"a,b"'); await run(); assert.equal(JSON.parse(await result().inputValue())[0].note, "a,b"); assert.equal(await page.getByRole("table").count(), 1);
  await choose("Batch rename"); await fileInput().setInputFiles([{ name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("a") }, { name: "b.txt", mimeType: "text/plain", buffer: Buffer.from("b") }]);
  await page.getByRole("button", { name: "Preview names", exact: true }).click(); await page.getByText("→ 001-a.txt", { exact: true }).waitFor();
  await run(); const zip = await download(); assert.deepEqual(Object.keys(unzipSync(zip.bytes)), ["001-a.txt", "002-b.txt"]);
  await fileInput().setInputFiles([{ name: `${"long-文件-name-".repeat(15)}.txt`, mimeType: "text/plain", buffer: Buffer.from("fixture") }]);
  await page.setViewportSize({ width: 320, height: 900 });
  assert.ok(await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "long filenames do not push reorder/remove controls off a phone");
  await page.setViewportSize({ width: 1440, height: 1100 });

  await choose("Image tools");
  await fileInput().focus();
  assert.equal(await fileInput().locator("..").evaluate((el) => getComputedStyle(el).outlineStyle), "solid", "the native picker has a visible focus ring on its drop area");
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles(image);
  await page.getByLabel("Longest edge (px, no upscaling)").fill("200"); await run(); const jpg = await download(); assert.equal(jpg.bytes[0], 255); assert.equal(jpg.bytes[1], 216);
  await page.getByRole("img", { name: "Result", exact: true }).waitFor();
  assert.equal(await page.getByRole("img", { name: "Result", exact: true }).evaluate((el) => el.naturalWidth), 200);
  await choose("Image tools");
  assert.equal(await fileInput().evaluate((el) => el.files[0]?.name), "image.png", "catalog return preserves the native file input");
  assert.equal(await page.getByLabel("Longest edge (px, no upscaling)").inputValue(), "200", "catalog return preserves settings");
  assert.equal(await page.getByRole("img", { name: "Result", exact: true }).evaluate((el) => el.naturalWidth), 200, "catalog return preserves the result preview");

  await choose("PDF organizer"); const pdf = await PDFDocument.create(); pdf.addPage([100, 100]); pdf.addPage([200, 200]);
  await fileInput().setInputFiles({ name: "pages.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByLabel("Operation", { exact: true }).selectOption("extract"); await page.getByLabel("Pages / order", { exact: false }).fill("2,1"); await run();
  const reordered = await PDFDocument.load((await download()).bytes); assert.deepEqual(reordered.getPages().map((p) => p.getWidth()), [200, 100]);

  await choose("QR codes"); await input().fill("https://example.invalid/no-navigation"); await run(); const qr = await download(); assert.equal(qr.name, "qrcode.png");
  await page.getByLabel("Operation", { exact: true }).selectOption("read"); await fileInput().setInputFiles({ ...image, buffer: qr.bytes }); await run(); assert.equal(await result().inputValue(), "https://example.invalid/no-navigation");
  await page.getByLabel("Operation", { exact: true }).selectOption("wifi");
  await page.getByLabel("Wi-Fi name", { exact: true }).fill("Fixture WiFi");
  await page.getByLabel("Wi-Fi password (blank = open network)", { exact: true }).fill("test-only-password");
  await run();
  const wifi = await download();
  await page.getByLabel("Operation", { exact: true }).selectOption("read");
  await fileInput().setInputFiles({ ...image, buffer: wifi.bytes });
  await run();
  assert.match(await result().inputValue(), /Fixture WiFi/);
  assert.equal(uploads, 0, "browser tools never upload file contents");

  await choose("Audio converter"); await fileInput().setInputFiles({ name: "sample.wav", mimeType: "audio/wav", buffer: Buffer.from("mock") }); await run(); assert.equal(uploads, 1);
  await choose("Video tools"); await fileInput().setInputFiles({ name: "sample.mp4", mimeType: "video/mp4", buffer: Buffer.from("mock") }); await run(); assert.equal(uploads, 2);
  await choose("Subtitle generator"); await fileInput().setInputFiles({ name: "sample.wav", mimeType: "audio/wav", buffer: Buffer.from("mock") }); await run(); assert.match(await result().inputValue(), /00:00:00,000 --> 00:00:01,000/);
  await result().fill("Edited subtitle"); assert.equal((await download()).bytes.toString(), "Edited subtitle");
  await choose("Image to text"); await fileInput().setInputFiles([image, { ...image, name: "second.png" }]); await run(); assert.match(await result().inputValue(), /# image.png\nRecognized locally\n\n# second.png/);
  assert.equal(uploads, 5);

  // Reduced motion and cancellation: stop waiting, never auto-retry the upload.
  await choose("Audio converter"); await fileInput().setInputFiles({ name: "sample.wav", mimeType: "audio/wav", buffer: Buffer.from("mock") });
  hold = true; await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Run locally", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).waitFor();
  assert.equal(await allTools.isDisabled(), true, "the running workspace cannot be hidden or switched");
  assert.equal(await page.locator('main').getByRole("status").evaluate((el) => getComputedStyle(el, '::before').animationName), "none");
  await page.waitForTimeout(100); await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Cancelled" }).waitFor(); hold = false; held?.();
  assert.equal(uploads, 6);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await allTools.click();
  enginesReady = false; await page.reload();
  await choose("Audio converter");
  await page.getByText(/Local engine unavailable/).waitFor();
  assert.ok(await page.getByRole("button", { name: "Run locally", exact: true }).isDisabled());
  await fileInput().setInputFiles({ name: "retained.wav", mimeType: "audio/wav", buffer: Buffer.from("mock") });
  enginesReady = true;
  await page.getByRole("button", { name: "Recheck engine", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Run locally"]').disabled);
  assert.equal(await fileInput().evaluate((el) => el.files[0]?.name), "retained.wav", "engine recheck does not clear selected files");
  assert.equal(uploads, 6);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await allTools.click();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => { document.documentElement.setAttribute("data-theme", theme); document.documentElement.classList.toggle("dark", theme === "dark"); }, theme);
    for (const [width, height] of [[320, 900], [375, 900], [844, 390], [1440, 1100]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(400); // Let theme/hover colors settle before checking contrast.
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${width} document overflow`);
      assert.ok(await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${theme} ${width} overflow`);
      assert.ok(await catalog.locator("button, a").evaluateAll((entries) => entries.every((entry) => {
        const box = entry.getBoundingClientRect(), icon = entry.querySelector("svg").getBoundingClientRect();
        return box.height >= 44 && box.width >= 44 && entry.scrollWidth <= entry.clientWidth + 1 && icon.width === 24 && icon.height === 24;
      })), `${theme} ${width} labels fit, icons stay visible and targets remain 44px`);
      const colors = await catalog.locator('section').evaluateAll((groups) => groups.map((group) => getComputedStyle(group.querySelector('[class*="iconTile"]')).backgroundColor));
      assert.equal(new Set(colors).size, 4, "all four categories have distinct vivid colors, including Mac");
      const surfaces = await catalog.locator('button, a').evaluateAll((cards) => cards.map((card) => {
        const style = getComputedStyle(card), icon = getComputedStyle(card.querySelector('[class*="iconTile"]'));
        const rgb = icon.backgroundColor.match(/[\d.]+/g).map(Number).slice(0, 3).map((n) => n / 255);
        const max = Math.max(...rgb), min = Math.min(...rgb);
        const luminance = (color) => color.match(/[\d.]+/g).map(Number).slice(0, 3).map((n) => n / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
        const fg = luminance(icon.color), bg = luminance(icon.backgroundColor);
        return { radius: style.borderTopLeftRadius, border: style.borderTopWidth, accent: style.borderTopColor === icon.backgroundColor, saturation: (max - min) / (1 - Math.abs(max + min - 1)), contrast: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) };
      }));
      assert.equal(surfaces.length, 13);
      assert.ok(surfaces.every((s) => s.radius === "16px" && s.border === "3px" && s.accent && s.saturation >= .65 && s.contrast >= 4.5), `${theme} ${width} rounded catalog cards and vivid, legible icons: ${JSON.stringify(surfaces)}`);
      assert.equal(await page.locator('main > header').evaluate((el) => getComputedStyle(el).borderTopLeftRadius), "24px");
      const firstCard = catalog.locator('button, a').first();
      await page.keyboard.press("Tab");
      await firstCard.focus();
      assert.ok(await firstCard.evaluate((el) => {
        const style = getComputedStyle(el);
        return style.outlineStyle === "solid" && style.outlineWidth === "2px" && style.outlineColor === getComputedStyle(el.querySelector('[class*="iconTile"]')).backgroundColor;
      }), "keyboard focus uses a visible category-colored ring");
      const lowContrast = await catalog.locator('button, a').evaluateAll((cards) => {
        const rgba = (color) => color.match(/[\d.]+/g).map(Number);
        const over = (fg, bg) => fg.slice(0, 3).map((n, i) => n * (fg[3] ?? 1) + bg[i] * (1 - (fg[3] ?? 1)));
        const luminance = (color) => {
          const rgb = color.slice(0, 3).map((n) => n / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
          return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
        };
        return cards.flatMap((card) => {
          // Hover is a translucent wash, not an opaque dark background. Measure painted colors.
          const ancestors = [];
          for (let el = card; el; el = el.parentElement) ancestors.unshift(el);
          const background = ancestors.reduce((bg, el) => over(rgba(getComputedStyle(el).backgroundColor), bg), [255, 255, 255]);
          const bg = luminance(background);
          return [...card.querySelectorAll('span[id], span[class*="cardFooter"]')].flatMap((text) => {
            const color = getComputedStyle(text).color, fg = luminance(over(rgba(color), background));
            const contrast = (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05);
            return contrast >= 4.5 ? [] : [{ id: text.id, color, background, contrast }];
          });
        });
      });
      assert.deepEqual(lowContrast, [], `${theme} ${width} card text contrast is at least 4.5:1`);
      await page.locator('main').evaluate((el) => { el.parentElement.scrollTop = 0; });
      if (process.env.E2E_SCREENSHOT_DIR && [375, 1440].includes(width)) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/toolbox-${theme}-${width}.png` });
      await choose("Audio converter");
      assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1, "workspace has one primary title");
      const layout = await page.locator('[class*="editorLayout"]').evaluate((el) => ({ width: el.getBoundingClientRect().width, columns: getComputedStyle(el).gridTemplateColumns.split(" ").length }));
      assert.equal(layout.columns, layout.width >= 720 ? 2 : 1, "input and settings use available workspace width");
      assert.ok(await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${theme} ${width} workspace overflow`);
      await page.waitForFunction(() => document.activeElement?.id === "toolbox-tool-title");
      assert.equal(await page.locator('#toolbox-tool-title').evaluate((el) => el === document.activeElement), true);
      if (process.env.E2E_SCREENSHOT_DIR && [375, 1440].includes(width)) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/toolbox-workspace-${theme}-${width}.png` });
      for (const name of toolNames.filter((name) => name !== "Audio converter")) {
        await choose(name);
        if (process.env.E2E_SCREENSHOT_DIR && [320, 1440].includes(width)) {
          await page.locator('main').evaluate((el) => { el.parentElement.scrollTop = 0; });
          await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/inside-${name.replace(/[^a-z0-9]+/gi, "-")}-${theme}-${width}.png` });
        }
      }
      await allTools.click();
    }
  }
  await context.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN")); await page.reload();
  await page.getByRole("heading", { name: "本地工具箱", exact: true }).waitFor();
  await page.getByRole("link", { name: "语音转文字", exact: true }).waitFor();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.setAttribute("data-theme", value); document.documentElement.classList.toggle("dark", value === "dark"); }, theme);
    for (const width of [320, 375, 1440]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.waitForTimeout(350); // Let shell resize and theme transitions settle before checking paint.
      await page.locator('main').evaluate((el) => { el.parentElement.scrollTop = 0; });
      assert.ok(await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${theme} ${width} Chinese overflow`);
      assert.equal(await page.getByRole("navigation", { name: "选择工具" }).getByRole("heading", { level: 2 }).count(), 4);
      if (process.env.E2E_SCREENSHOT_DIR && [375, 1440].includes(width)) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/toolbox-zh-${theme}-${width}.png` });
    }
  }
  await page.getByRole("searchbox", { name: "查找工具", exact: true }).fill("裁剪");
  assert.equal(await page.getByRole("navigation", { name: "选择工具" }).getByRole("button").count(), 3);
  await page.getByRole("button", { name: "图片工具", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "图片工具", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("Toolbox: search/empty states, 13 entries, responsive source/options layout, native keyboard picker, retained work/focus, top result actions, clipboard fallback, engine recovery, all 11 conversions, no-upload boundaries, cancellation and bilingual light/dark layouts passed.");
} finally { await browser.close(); }
