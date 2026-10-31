// UI data and cleanup are mocked. Never moves real caches or empties Trash.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const screenshots = "/tmp/robin-mac-workspace";
mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  if (process.env.PI_WEB_PASSWORD) {
    const auth = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(auth.ok(), `Authentication failed (${auth.status()})`);
  }
  // Only this check hits the real collector. It is strictly read-only.
  const live = await context.request.get("/api/robin/mac");
  assert.ok(live.ok(), `Live metrics failed (${live.status()})`);
  const liveData = await live.json();
  assert.equal(liveData.supported, true);
  assert.ok(liveData.cpu === null || (liveData.cpu >= 0 && liveData.cpu <= 100));
  assert.ok(liveData.disk?.available > 0);
  console.log("Live metrics:", { cpu: liveData.cpu, gpu: liveData.gpu, issues: liveData.issues });
  await context.addInitScript(() => { localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-theme", "light"); });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let reads = 0, moves = 0, scans = 0, failMove = false, missingGpu = false, libraryReady = false;
  const gi = 1024 ** 3;
  await page.route("**/api/robin/mac", async (route) => {
    if (route.request().method() === "GET") {
      reads++;
      return route.fulfill({ json: { supported: true, sampledAt: new Date().toISOString(), host: "test-mac", model: "Apple M4", cores: 10, uptime: 6000, cpu: 32 + reads % 8, perCore: Array.from({ length: 10 }, (_, i) => 20 + i * 4), gpu: missingGpu ? null : 16, memory: { total: 16 * gi, used: 12 * gi, compressed: 5 * gi }, swap: { used: 2 * gi, total: 4 * gi }, disk: { total: 256 * gi, used: 251 * gi, available: 5 * gi }, issues: missingGpu ? ["gpu"] : [] } });
    }
    const body = route.request().postDataJSON();
    if (body.action === "scan") {
      scans++;
      return route.fulfill({ json: { id: `scan-${scans}`, scannedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(), canTrash: true,
        folders: [["Library", libraryReady ? 57.4 * gi : null], ["Pictures", .85 * gi], ["Movies", .66 * gi], ["Downloads", .25 * gi], ["Documents", .17 * gi], ["Desktop", .003 * gi]].map(([name, size]) => ({ id: name, name, path: `~/${name}`, bytes: size, status: size === null ? "unavailable" : "ready", ...(size === null ? { issue: "timeout" } : {}) })).sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1)),
        caches: [
          { id: "npm", name: "npm", path: "~/.npm/_cacache", bytes: 4 * gi, status: "ready" },
          { id: "uv", name: "uv", path: "~/.cache/uv", bytes: 2 * gi, status: "ready" },
          { id: "pip", name: "pip", path: "~/Library/Caches/pip", bytes: null, status: "missing" },
        ],
      } });
    }
    assert.equal(body.action, "trash"); assert.equal(body.confirmed, true); assert.deepEqual(body.ids, ["npm"]);
    moves++;
    return failMove ? route.fulfill({ status: 500, json: { error: "Simulated lost response" } }) : route.fulfill({ json: { items: [{ id: "npm", path: "~/.npm/_cacache", status: "trashed" }] } });
  });
  await page.goto("/tools");
  await page.getByRole("link", { name: /Mac 监控与清理/ }).click();
  await page.getByRole("heading", { name: "Mac 监控与清理" }).waitFor();
  await page.getByRole("button", { name: "扫描磁盘占用" }).waitFor();
  assert.equal(scans, 0); assert.equal(moves, 0);
  await page.waitForTimeout(6200); // Actual polled samples, never synthetic history in the UI.
  assert.ok(await page.locator('svg path[vector-effect="non-scaling-stroke"]').first().getAttribute("d"));
  await page.getByRole("button", { name: "暂停更新" }).click();
  await page.waitForTimeout(500); const stopped = reads;
  await page.waitForTimeout(3400); assert.equal(reads, stopped, "pause stops network polling");
  await page.getByRole("button", { name: "扫描磁盘占用" }).click();
  await page.getByText("可审核的缓存", { exact: true }).waitFor();
  assert.equal(await page.locator('input[type="checkbox"]:checked').count(), 0);
  assert.ok(await page.getByRole("button", { name: "审核所选项目" }).isDisabled());
  await page.getByText("已测 5 / 6 个目录", { exact: true }).waitFor();
  await page.getByText("不是整盘空间分布", { exact: true }).waitFor();
  await page.getByText("超过扫描时限，未计入统计；可稍后重试。", { exact: true }).waitFor();
  const pictures = page.locator('details[data-folder="Pictures"]');
  assert.match(await pictures.locator("summary").innerText(), /图片/);
  assert.match(await pictures.locator("summary").innerText(), /44\.0%/); // .85 / 1.933, not .85 / largest or whole disk.
  await pictures.locator("summary").focus(); await page.keyboard.press("Enter");
  await pictures.getByText(/照片图库是个人数据/).waitFor();
  assert.equal(moves, 0, "explaining Pictures cannot trigger cleanup");
  await page.getByRole("heading", { name: "磁盘", exact: true }).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: `${screenshots}/partial-scan.png` });
  await pictures.locator("summary").click();
  await page.getByRole("checkbox", { name: /npm 包缓存/ }).check();
  await page.getByRole("button", { name: "审核所选项目" }).click();
  await page.getByRole("dialog").waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /~\/\.npm\/_cacache/);
  assert.match(await page.getByRole("dialog").innerText(), /不会释放磁盘空间/);
  await page.keyboard.press("Escape"); assert.equal(moves, 0);
  await page.getByRole("button", { name: "审核所选项目" }).click();
  await page.getByRole("button", { name: "确认移到废纸篓", exact: true }).click();
  await page.getByText("已移到废纸篓", { exact: true }).waitFor(); assert.equal(moves, 1);
  assert.equal(await page.getByRole("button", { name: "审核所选项目" }).count(), 0);
  await page.getByRole("button", { name: "扫描磁盘占用" }).click();
  await page.getByRole("checkbox", { name: /npm 包缓存/ }).check();
  failMove = true;
  await page.getByRole("button", { name: "审核所选项目" }).click();
  await page.getByRole("button", { name: "确认移到废纸篓", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "不要直接重试" }).waitFor(); assert.equal(moves, 2);
  failMove = false; libraryReady = true;
  await page.getByRole("button", { name: "扫描磁盘占用" }).click();
  await page.getByText("可审核的缓存", { exact: true }).waitFor();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle("dark", theme === "dark"); }, theme);
    for (const width of [320, 375, 900, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(150);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No page overflow at ${width}`);
      assert.ok(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `No tool overflow at ${width}`);
      const cards = page.locator('main section[class*="metric"], main section[class*="diskOverview"], main section[class*="folders"], main section[class*="caches"]');
      assert.equal(await cards.count(), 6);
      assert.deepEqual(await cards.evaluateAll((nodes) => nodes.map((el) => getComputedStyle(el).borderTopLeftRadius)), Array(6).fill("16px"));
      const primaryStyle = await page.getByRole("button", { name: "扫描磁盘占用" }).evaluate((el) => {
        const style = getComputedStyle(el); return { radius: style.borderTopLeftRadius, background: style.backgroundColor, color: style.color };
      });
      assert.deepEqual(primaryStyle, { radius: "8px", background: theme === "dark" ? "rgb(45, 212, 191)" : "rgb(15, 118, 110)", color: theme === "dark" ? "rgb(15, 23, 42)" : "rgb(255, 255, 255)" });
      await page.getByRole("heading", { name: "Mac 监控与清理", exact: true }).evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: `${screenshots}/${theme}-${width}-metrics.png` });
      await page.getByRole("heading", { name: "磁盘", exact: true }).evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: `${screenshots}/${theme}-${width}.png`, fullPage: true });
      if (width <= 375) {
        await page.getByRole("heading", { name: "个人目录分布", exact: true }).evaluate((el) => el.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: `${screenshots}/${theme}-${width}-folders.png` });
      }
    }
  }
  await page.getByText("已测 6 / 6 个目录", { exact: true }).waitFor();
  assert.match(await page.locator('details[data-folder="Library"] summary').innerText(), /96\.7%/);
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("checkbox", { name: /npm 包缓存/ }).check();
    await page.getByRole("button", { name: "审核所选项目" }).click();
    const dialog = page.getByRole("dialog");
    assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    assert.equal(await dialog.evaluate((el) => getComputedStyle(el).borderTopLeftRadius), "24px");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "取消");
    await page.screenshot({ path: `${screenshots}/confirmation-${width}.png` });
    await page.keyboard.press("Escape");
    assert.equal(moves, 2);
  }
  missingGpu = true;
  await page.getByRole("button", { name: "继续更新" }).click();
  await page.getByText(/这台 Mac 未提供 GPU 使用率/).waitFor();
  assert.deepEqual(errors, []);
  console.log(`Mac workspace passed: confirmation/cancellation, paused sampling, retry safety, 8 responsive/theme screenshots in ${screenshots}`);
} finally { await browser.close(); }
