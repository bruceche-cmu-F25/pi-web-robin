// Run against an existing dev server. All note/canvas data and agent replies are mocked.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/notes-canvas.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
let page;
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 1000 } });
  if (process.env.PI_WEB_PASSWORD) {
    const login = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(login.ok(), `Login failed (${login.status()})`);
  }
  await context.addInitScript(() => {
    // Exercise downloads without opening the OS file picker in headless Chrome.
    delete window.showSaveFilePicker;
    delete window.showOpenFilePicker;
    window.__canvasFontSamples = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      if (String(text).includes("Double-click") || String(text).includes("Project ideas")) {
        window.__canvasFontSamples.push({ text, font: this.font });
      }
      return fillText.call(this, text, ...args);
    };
  });
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const boards = new Map();
  const chats = [];
  let failSave = 0;
  let failLibrarySave = 0;
  let assetLibrary = { revision: 0, libraryItems: [] };
  const draft = { id: "canvas-note-fixture", title: "Markdown stays intact", text: "An existing note.", notionParentId: "", updatedAt: new Date().toISOString() };
  await page.route("**/api/robin/notes", (route) => route.fulfill({ json: { drafts: [draft] } }));
  await page.route("**/api/robin/notes/attachments?*", (route) => route.fulfill({ json: { attachments: [] } }));
  await page.route("**/api/robin/notes-agent", (route) => {
    if (route.request().method() === "POST") {
      chats.push(route.request().postDataJSON());
      return route.fulfill({ json: { reply: "Try grouping the related ideas.", sessionId: "canvas-agent-fixture" } });
    }
    return route.fulfill({ json: { finals: {} } });
  });
  await page.route("**/api/robin/notion", (route) => route.fulfill({ json: { pages: [] } }));
  await page.route("**/api/models", (route) => route.fulfill({ json: { modelList: [{ provider: "test", id: "test-model", name: "Test model" }], defaultModel: { provider: "test", modelId: "test-model" } } }));
  await page.route("**/api/robin/canvases*", (route) => {
    const req = route.request();
    const input = req.method() === "GET" ? null : req.postDataJSON();
    const id = new URL(req.url()).searchParams.get("id") ?? input?.id;
    if (req.method() === "POST") {
      const now = new Date().toISOString();
      const canvas = { id: randomUUID(), title: input.title, revision: 0, createdAt: now, updatedAt: now, scene: { elements: [], files: {}, appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 } } } };
      boards.set(canvas.id, canvas);
      return route.fulfill({ json: { canvas } });
    }
    if (req.method() === "PATCH") {
      if (failSave) return route.fulfill({ status: failSave, json: { error: "Simulated save failure" } });
      const previous = boards.get(id);
      if (input.revision !== previous.revision) return route.fulfill({ status: 409, json: { error: "Revision conflict" } });
      const canvas = { ...previous, ...input, revision: previous.revision + 1 };
      boards.set(id, canvas);
      return route.fulfill({ json: { canvas: { ...canvas, scene: undefined } } });
    }
    if (req.method() === "DELETE") { boards.delete(id); return route.fulfill({ json: { deleted: true } }); }
    return route.fulfill({ json: id ? { canvas: boards.get(id) } : { canvases: [...boards.values()].map(({ id, title, revision, createdAt, updatedAt }) => ({ id, title, revision, createdAt, updatedAt })) } });
  });
  await page.route("**/api/robin/canvases/library", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: assetLibrary });
    if (failLibrarySave) return route.fulfill({ status: failLibrarySave, json: { error: "Simulated library failure" } });
    const input = route.request().postDataJSON();
    if (input.revision !== assetLibrary.revision) return route.fulfill({ status: 409, json: { error: "Library conflict" } });
    assetLibrary = { ...input, revision: assetLibrary.revision + 1 };
    return route.fulfill({ json: { revision: assetLibrary.revision } });
  });
  await page.goto("/notes");
  await page.getByRole("button", { name: "New canvas", exact: true }).click();
  await page.locator(".excalidraw canvas").first().waitFor({ timeout: 90_000 });
  const firstId = new URL(page.url()).searchParams.get("canvas");
  assert.ok(firstId);
  const title = page.getByRole("textbox", { name: "Canvas title", exact: true });
  const agentToggle = page.locator('button[aria-controls="notes-agent"]');
  const canvasAgent = page.locator("#notes-agent");
  await canvasAgent.locator("textarea").fill("Keep my canvas question");
  const canvasWidth = (await page.locator("main").boundingBox()).width;
  await agentToggle.click();
  await canvasAgent.waitFor({ state: "hidden" });
  assert.ok((await page.locator("main").boundingBox()).width > canvasWidth);
  assert.equal(await page.locator(".excalidraw").count(), 1, "Folding must not remount the drawing editor");
  await agentToggle.click();
  await canvasAgent.waitFor({ state: "visible" });
  assert.equal(await canvasAgent.locator("textarea").inputValue(), "Keep my canvas question");
  await title.fill("Planning board");
  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  const waitSaved = () => page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some((el) => el.textContent === "Saved"));
  await waitSaved();
  assert.equal(boards.get(firstId).title, "Planning board");
  assert.ok(boards.get(firstId).scene.elements.some((el) => el.type === "rectangle"));
  assert.ok(boards.get(firstId).scene.elements.some((el) => el.type === "text"));
  assert.ok(await page.evaluate(() => window.__canvasFontSamples.some((sample) => sample.font.includes("Georgia"))), "Drawn text uses Notes' serif stack, not Helvetica");
  // The custom sticky action participates in the editor's own undo stack.
  await page.keyboard.press("ControlOrMeta+z");
  await waitSaved();
  assert.equal(boards.get(firstId).scene.elements.filter((el) => !el.isDeleted).length, 0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await waitSaved();
  assert.equal(boards.get(firstId).scene.elements.filter((el) => !el.isDeleted).length, 2);
  const surface = page.locator("canvas.excalidraw__canvas.interactive");
  const box = await surface.boundingBox();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const writing = page.locator("textarea.excalidraw-wysiwyg");
  await writing.fill("Project ideas 你好");
  assert.match(await writing.evaluate((el) => getComputedStyle(el).fontFamily), /Georgia/, "Editing uses the same font as the drawing");
  await page.keyboard.press("Escape");
  await waitSaved();
  assert.ok(boards.get(firstId).scene.elements.some((el) => !el.isDeleted && el.text === "Project ideas 你好"));
  // Move the selected note, then draw an arrow with the native tools.
  const beforeMove = boards.get(firstId).scene.elements.find((el) => !el.isDeleted && el.type === "rectangle").x;
  await page.keyboard.press("v");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 90, { steps: 8 });
  await page.mouse.up();
  await waitSaved();
  assert.ok(boards.get(firstId).scene.elements.find((el) => !el.isDeleted && el.type === "rectangle").x > beforeMove);
  await page.keyboard.press("a");
  await page.mouse.move(box.x + box.width / 2 + 210, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 290, box.y + box.height / 2 + 150, { steps: 8 });
  await page.mouse.up();
  await waitSaved();
  assert.ok(boards.get(firstId).scene.elements.some((el) => !el.isDeleted && el.type === "arrow"));
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 40; c.height = 40;
    const ctx = c.getContext("2d"); ctx.fillStyle = "teal"; ctx.fillRect(0, 0, 40, 40);
    return c.toDataURL("image/png").split(",")[1];
  });
  const transfer = await page.evaluateHandle((data) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], "fixture.png", { type: "image/png" }));
    return dt;
  }, png);
  const imageSaved = page.waitForResponse((response) => response.url().includes("/api/robin/canvases") && response.request().method() === "PATCH" && Object.keys(response.request().postDataJSON().scene.files).length > 0);
  await surface.dispatchEvent("drop", { dataTransfer: transfer, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 + 250 });
  await imageSaved;
  await waitSaved();
  assert.ok(Object.keys(boards.get(firstId).scene.files).length > 0);
  const imagesBeforeReload = structuredClone(boards.get(firstId).scene.files);
  const agent = page.locator('section[class*="agentPane"]');
  await agent.locator("textarea").fill("Summarize this board");
  await agent.locator("textarea").press("Enter");
  await agent.getByText("Try grouping the related ideas.", { exact: true }).waitFor();
  assert.equal(chats.at(-1).draftId, `canvas:${firstId}`);
  assert.equal(chats.at(-1).documentKind, "canvas");
  assert.match(chats.at(-1).note, /Project ideas 你好/);
  assert.doesNotMatch(chats.at(-1).note, /data:image/);
  await agent.getByRole("button", { name: /Add to canvas/ }).click();
  await waitSaved();
  assert.ok(boards.get(firstId).scene.elements.some((el) => !el.isDeleted && el.originalText === "Try grouping the related ideas."));
  await page.keyboard.press("Escape");
  const oldZoom = boards.get(firstId).scene.appState.zoom.value;
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await waitSaved();
  assert.ok(boards.get(firstId).scene.appState.zoom.value > oldZoom);
  const oldScroll = boards.get(firstId).scene.appState.scrollX;
  await surface.click({ position: { x: 230, y: 180 } });
  await page.keyboard.down("Space");
  await page.mouse.move(box.x + 230, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 290, box.y + 210, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await waitSaved();
  assert.notEqual(boards.get(firstId).scene.appState.scrollX, oldScroll);
  await page.screenshot({ path: "/tmp/notes-canvas-desktop.png" });
  await page.getByRole("button", { name: "Canvas menu", exact: true }).click();
  await page.getByText("Export image...", { exact: true }).click();
  const svgDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export to SVG", exact: true }).click();
  const svg = readFileSync(await (await svgDownload).path(), "utf8");
  assert.match(svg, /font-family="Georgia[^\"]*serif/, "SVG exports preserve Notes' font stack");
  assert.doesNotMatch(svg, /font-family="Helvetica/);
  const exportButton = page.getByRole("button", { name: "Export to SVG", exact: true });
  if (await exportButton.isVisible()) { await exportButton.focus(); await page.keyboard.press("Escape"); }

  // Official Libraries links return to this board, not an unselected /notes page.
  const toggleAssets = async () => {
    const close = page.getByTestId("sidebar-close");
    if (await close.isVisible()) await close.click();
    else await page.locator(".default-sidebar-trigger").click();
  };
  await toggleAssets();
  const browse = new URL(await page.locator(".library-menu-browse-button").getAttribute("href"));
  assert.equal(browse.origin, "https://libraries.excalidraw.com");
  assert.equal(browse.searchParams.get("referrer"), `${baseURL}/notes?canvas=${firstId}`);
  const assetUnits = page.locator(".library-unit__dragger:not(.library-unit__pulse)");
  const importAsset = async (number) => {
    const url = `https://libraries.excalidraw.com/libraries/robin-test/fixture-${number}.excalidrawlib`;
    const shape = boards.get(firstId).scene.elements.find((el) => el.type === "rectangle");
    const item = { id: `asset-${number}`, status: "published", created: Date.now(), elements: [{ ...shape, id: `library-shape-${number}`, boundElements: null }] };
    await page.route(url, (route) => route.fulfill({ json: { type: "excalidrawlib", version: 2, libraryItems: [item] } }));
    page.once("dialog", (dialog) => dialog.accept());
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith("/api/robin/canvases/library") && res.request().method() === "PUT"),
      // The catalog normally opens a new return URL; also exercise in-page imports.
      number === 1 ? page.goto(`/notes?canvas=${firstId}#addLibrary=${encodeURIComponent(url)}`)
        : page.evaluate((url) => { location.hash = `addLibrary=${encodeURIComponent(url)}`; }, url),
    ]);
    return response;
  };
  assert.equal((await importAsset(1)).status(), 200);
  await waitSaved();
  assert.equal(assetLibrary.libraryItems.length, 1);
  assert.equal(new URL(page.url()).searchParams.get("canvas"), firstId);
  await assetUnits.first().waitFor();
  const countBeforeAsset = boards.get(firstId).scene.elements.length;
  await assetUnits.first().click();
  await waitSaved();
  assert.ok(boards.get(firstId).scene.elements.length > countBeforeAsset, "A library item inserts into the canvas");
  await toggleAssets();
  await page.locator(".library-menu-browse-button").waitFor();
  await assetUnits.locator("svg").first().waitFor();
  await page.screenshot({ path: "/tmp/notes-canvas-library.png" });

  // Failed library saves retain edits and block navigation; Retry saves the whole library.
  failLibrarySave = 500;
  assert.equal((await importAsset(2)).status(), 500);
  await page.getByRole("alert").filter({ hasText: "Simulated library failure" }).waitFor();
  await page.getByRole("button", { name: "New canvas", exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get("canvas"), firstId);
  failLibrarySave = 0;
  await page.locator("main").getByRole("button", { name: "Retry", exact: true }).click();
  await waitSaved();
  assert.equal(assetLibrary.libraryItems.length, 2);
  // A stale tab cannot overwrite a newer library. Explicit reload discards its pending import.
  assetLibrary.revision++;
  assert.equal((await importAsset(3)).status(), 409);
  await page.getByRole("alert").filter({ hasText: "library changed in another tab" }).waitFor();
  assert.equal(assetLibrary.libraryItems.length, 2);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reload saved version", exact: true }).click();
  await page.locator(".excalidraw canvas").first().waitFor();
  await toggleAssets();
  await assetUnits.nth(1).waitFor();
  assert.equal(await assetUnits.count(), 2, "Only the saved library returns after a reload");
  await toggleAssets();

  // Immediate board switching must flush the title, without waiting for debounce.
  await title.fill("Planning board renamed");
  await page.getByRole("button", { name: "New canvas", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("canvas") !== firstId);
  const secondId = new URL(page.url()).searchParams.get("canvas");
  assert.notEqual(firstId, secondId);
  await page.locator(".excalidraw canvas").first().waitFor();
  assert.equal(boards.get(firstId).title, "Planning board renamed");
  await toggleAssets();
  await assetUnits.nth(1).waitFor();
  assert.equal(await assetUnits.count(), 2, "Libraries are shared across independent boards");
  await toggleAssets();
  await title.fill("Second board");
  await waitSaved();
  await page.goBack();
  await page.waitForURL((url) => url.searchParams.get("canvas") === firstId);
  await page.locator(".excalidraw canvas").first().waitFor();
  await page.goForward();
  await page.waitForURL((url) => url.searchParams.get("canvas") === secondId);
  await page.locator(".excalidraw canvas").first().waitFor();
  const library = page.locator("#notes-library");
  await library.getByRole("button", { name: "Planning board renamed Canvas", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("canvas") === firstId);
  await page.locator(".excalidraw canvas").first().waitFor();
  await page.reload();
  await page.locator(".excalidraw canvas").first().waitFor();
  assert.equal(await title.inputValue(), "Planning board renamed");
  assert.ok(boards.get(firstId).scene.elements.length >= 2);
  assert.deepEqual(boards.get(firstId).scene.files, imagesBeforeReload);

  // Native library exports remain available as a backup, and removals persist too.
  await toggleAssets();
  await assetUnits.nth(1).waitFor();
  await page.locator(".library-menu-dropdown-container").getByTestId("dropdown-menu-button").click();
  const [libraryDownload] = await Promise.all([
    page.waitForEvent("download"), page.getByTestId("lib-dropdown--export").click(),
  ]);
  const exportedLibrary = JSON.parse(readFileSync(await libraryDownload.path(), "utf8"));
  assert.equal(exportedLibrary.type, "excalidrawlib");
  assert.equal(exportedLibrary.libraryItems.length, 2);
  await assetUnits.first().click({ modifiers: ["Shift"] });
  await page.locator(".library-menu-dropdown-container").getByTestId("dropdown-menu-button").click();
  await page.locator(".library-menu").getByText("Remove", { exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await waitSaved();
  assert.equal(assetLibrary.libraryItems.length, 1);
  await page.reload();
  await page.locator(".excalidraw canvas").first().waitFor();
  await toggleAssets();
  await assetUnits.first().waitFor();
  assert.equal(await assetUnits.count(), 1);
  await toggleAssets();

  failSave = 500;
  await title.fill("Unsaved board");
  await page.getByRole("alert").filter({ hasText: "Simulated save failure" }).waitFor();
  await library.getByRole("button", { name: "Second board Canvas", exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get("canvas"), firstId, "A failed save must block switching");
  assert.equal(await title.inputValue(), "Unsaved board");
  failSave = 0;
  await page.locator("main").getByRole("button", { name: "Retry", exact: true }).click();
  await waitSaved();
  assert.equal(boards.get(firstId).title, "Unsaved board");

  failSave = 409;
  await title.fill("Conflicting edit");
  await page.getByRole("alert").filter({ hasText: "changed or was deleted elsewhere" }).waitFor();
  assert.equal(boards.get(firstId).title, "Unsaved board");
  await page.getByRole("button", { name: "Canvas menu", exact: true }).click();
  await page.getByText("Save to...", { exact: true }).click();
  await page.getByRole("button", { name: "Save to file", exact: true }).focus();
  await page.keyboard.press("Escape");
  failSave = 0;
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reload saved version", exact: true }).click();
  await page.locator(".excalidraw canvas").first().waitFor();
  await page.waitForFunction(() => document.querySelector('input[aria-label="Canvas title"]')?.value === "Unsaved board");

  // Confirmed deletion affects only that board, and cancelled deletion changes nothing.
  page.once("dialog", (dialog) => dialog.dismiss());
  await library.getByRole("button", { name: "Delete canvas: Second board", exact: true }).click();
  assert.equal(boards.has(secondId), true);
  page.once("dialog", (dialog) => dialog.accept());
  await library.getByRole("button", { name: "Delete canvas: Second board", exact: true }).click();
  await library.getByRole("button", { name: "Second board Canvas", exact: true }).waitFor({ state: "hidden" });
  assert.equal(boards.has(secondId), false);

  for (const width of [375, 844]) {
    await page.setViewportSize({ width, height: 800 });
    const tabs = page.getByRole("tablist").getByRole("tab");
    await tabs.nth(2).click();
    assert.equal(await title.isVisible(), false);
    await tabs.nth(1).click();
    assert.equal(await title.inputValue(), "Unsaved board");
    await toggleAssets();
    await page.locator(".library-menu-browse-button").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await toggleAssets();
  }
  await page.screenshot({ path: "/tmp/notes-canvas-mobile.png" });
  await page.evaluate(() => { localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-theme", "dark"); });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.reload();
  await page.getByRole("button", { name: "添加便签", exact: true }).waitFor();
  await page.locator(".excalidraw.theme--dark canvas").first().waitFor();
  await page.screenshot({ path: "/tmp/notes-canvas-dark-zh.png" });
  assert.deepEqual(errors, []);
  // Validate real editor-generated elements/images through the actual storage domain,
  // not just the browser mock. This process gets a disposable data directory.
  const previousDataDir = process.env.ROBIN_DATA_DIR;
  const directory = mkdtempSync(join(tmpdir(), "canvas-browser-scene-"));
  process.env.ROBIN_DATA_DIR = directory;
  try {
    const { createCanvas, saveCanvas, readCanvas, saveCanvasAssetLibrary, readCanvasAssetLibrary } = await import("../extension/robin/canvas-domain.ts");
    const stored = createCanvas("Browser scene");
    const scene = boards.get(firstId).scene;
    saveCanvas(stored.id, 0, { title: "Browser scene", scene });
    assert.deepEqual(readCanvas(stored.id).scene, scene);
    saveCanvasAssetLibrary(0, assetLibrary.libraryItems);
    assert.deepEqual(readCanvasAssetLibrary().libraryItems, assetLibrary.libraryItems);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previousDataDir;
  }
  console.log("PASS: canvases, typography/exports, official library imports, shared library persistence/removal/recovery, sticky editing/moving, arrows, images, undo/redo, Agent context, failure/conflict recovery, deletion, mobile and Chinese/dark theme");
} catch (error) {
  if (page) await page.screenshot({ path: "/tmp/notes-canvas-failure.png" }).catch(() => {});
  throw error;
} finally { await browser.close(); }
