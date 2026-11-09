// Read-only fixtures: no personal maps, model calls or domain writes.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
const output = "/tmp/mindmap-layout";
mkdirSync(output, { recursive: true });
const topic = (id, label, children = []) => ({ id, label, children });
const dense = topic("root", "开发者知识地图", Array.from({ length: 16 }, (_, i) => topic(`branch-${i}`, `阶段 ${i + 1}：语法、测试与开发`, Array.from({ length: 11 }, (_, j) => ({
  ...topic(`topic-${i}-${j}`, `知识点 ${j + 1}：理解原理、使用场景、边界条件与测试方法；保留完整说明。`),
  ...(j === 0 ? { url: "https://example.com/docs" } : {}),
})))));
const oval = topic("root", "弧形主分支", Array.from({ length: 8 }, (_, i) => topic(`oval-${i}`, "Topic")));
let root = dense, page;
const id = "11111111-1111-4111-8111-111111111111";
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 960 }, reducedMotion: "reduce", serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => { localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-theme", "glass"); });
  const unexpected = [];
  await context.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== "GET") { unexpected.push(`${request.method()} ${url.pathname}`); return route.fulfill({ status: 500, json: { error: "Unexpected fixture write" } }); }
    if (url.pathname === "/api/robin/mindmaps") return route.fulfill({ json: url.searchParams.has("id") ? { map: { id, root, revision: 0, messages: [], explanations: [], canUndo: false, canRedo: false, createdAt: "2026-11-02T00:00:00Z", updatedAt: "2026-11-02T00:00:00Z" } } : { maps: [{ id, title: root.label }] } });
    if (url.pathname === "/api/robin/notes") return route.fulfill({ json: { drafts: [{ id: "layout-fixture", title: "Read-only fixture", text: "", notionParentId: "", updatedAt: "2026-11-02T00:00:00Z" }] } });
    if (url.pathname === "/api/models") return route.fulfill({ json: { modelList: [], defaultModel: null } });
    return route.fulfill({ json: { canvases: [], vaults: [], archives: [], drafts: [], attachments: [], finals: {}, records: [], connected: false, review: null, events: [], jobs: [], rounds: [], todos: [], links: [] } });
  });
  page = await context.newPage(); const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const map = page.getByRole("region", { name: "思维导图", exact: true });
  const load = async count => {
    await page.goto(`/notes?view=mindmap&mindmap=${id}`);
    await map.getByRole("button", { name: root.label, exact: true }).waitFor();
    await page.getByRole("button", { name: "收起 Agent Buddy", exact: true }).click();
    await map.getByRole("combobox", { name: "展开层级" }).selectOption("all");
    await page.waitForFunction(count => document.querySelectorAll("[data-map-node]").length === count, count);
  };
  const geometry = () => map.evaluate(el => {
    const nodes = [...el.querySelectorAll("[data-map-node]")].map(el => ({ id: el.dataset.mapNode, x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) }));
    const collisions = [], crossings = [];
    for (let i = 0; i < nodes.length; i++) for (const b of nodes.slice(i + 1)) {
      const a = nodes[i];
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) collisions.push([a.id, b.id]);
    }
    for (const path of el.querySelectorAll("svg > path")) {
      const length = path.getTotalLength();
      for (let distance = 1; distance < length; distance += 12) {
        const point = path.getPointAtLength(distance);
        const hit = nodes.find(n => point.x > n.x + 1 && point.x < n.x + n.w - 1 && point.y > n.y + 1 && point.y < n.y + n.h - 1);
        if (hit) { crossings.push(hit.id); break; }
      }
    }
    const width = Math.max(...nodes.map(n => n.x + n.w)) - Math.min(...nodes.map(n => n.x));
    const height = Math.max(...nodes.map(n => n.y + n.h)) - Math.min(...nodes.map(n => n.y));
    return { nodes, collisions, crossings, ratio: width / height };
  });
  await load(193);
  const before = await geometry();
  assert.deepEqual(before.collisions, []); assert.deepEqual(before.crossings, []);
  assert.ok(before.ratio > 0.5 && before.ratio < 2);
  assert.ok(new Set(before.nodes.filter(n => n.id.startsWith("topic-0-")).map(n => n.x)).size > 1);
  await map.getByRole("button", { name: "折叠或展开：阶段 1：语法、测试与开发", exact: true }).press("Enter");
  assert.equal(await map.locator("[data-topic]").count(), 182);
  await map.getByRole("button", { name: "折叠或展开：阶段 1：语法、测试与开发", exact: true }).press("Enter");
  assert.deepEqual((await geometry()).nodes, before.nodes, "unfold restores deterministic coordinates");
  for (const theme of ["glass", "glass-dark", "light"]) for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 960 });
    await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    // Next's floating dev badge can overlap the phone footer; exercise keyboard Fit.
    await map.getByRole("button", { name: "适应画布", exact: true }).press("Enter");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    const centre = await map.locator('[data-topic="root"]').boundingBox(), viewport = await map.boundingBox();
    assert.ok(centre.x >= viewport.x && centre.x + centre.width <= viewport.x + viewport.width && centre.y >= viewport.y && centre.y + centre.height <= viewport.y + viewport.height, "Fit keeps the root on the canvas after resize");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${output}/compact-${theme}-${width}.png` });
  }
  root = oval;
  await page.setViewportSize({ width: 1440, height: 960 });
  await load(9);
  const fan = await geometry(), nodes = new Map(fan.nodes.map(n => [n.id, n]));
  assert.deepEqual(fan.collisions, []); assert.deepEqual(fan.crossings, []);
  assert.ok(nodes.get("oval-2").x > nodes.get("oval-0").x);
  assert.ok(nodes.get("oval-3").x < nodes.get("oval-1").x);
  assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
  console.log("PASS: compact dense expansion, oval fan, no box/connector collisions, reversible folds, desktop/mobile and three themes; no writes or models");
} catch (error) { await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {}); throw error; }
finally { await browser.close(); }
