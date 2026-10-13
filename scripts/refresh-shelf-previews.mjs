/*
 * Capture each fixed Learning Hub link once. The browser never contacts these
 * sites when someone opens the shelf; it only reads files served by this app.
 *
 *   npm run dev                             # watches the catalog, captures new links
 *   node scripts/refresh-shelf-previews.mjs  # one-off capture
 *   node scripts/refresh-shelf-previews.mjs --force  # recapture existing files
 *
 * A site that blocks automation gets a clearly labelled site/title still,
 * never a screenshot of a login, error, or CAPTCHA page. Keep that distinction
 * visible in the image itself. Featured videos already have hand-picked stills.
 */
import { existsSync, mkdirSync, watch, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";
import { LEARNING_SHELF, shelfPreviewFile } from "../extension/robin/learning-shelf.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIR = join(ROOT, "public/robin/previews");
const WIDTH = 560;
const HEIGHT = 315;
const force = process.argv.includes("--force");
const jobs = LEARNING_SHELF.flatMap((group) => group.links.flatMap((link) =>
  link.url === group.preview?.url ? [] : [{ ...link, file: shelfPreviewFile(group.id, link.url) }],
));

function escapeXml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function fallback(link) {
  const host = new URL(link.url).hostname.replace(/^www\./, "");
  const lines = [];
  for (const word of link.title.split(/\s+/)) {
    const last = lines.length - 1;
    if (last >= 0 && `${lines[last]} ${word}`.length <= 32) lines[last] += ` ${word}`;
    else lines.push(word);
  }
  if (lines.length > 3) lines[2] += "…";
  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#212730"/>
    <path d="M0 258 H560 M40 0 V315" stroke="#465361" stroke-width="1"/>
    <rect x="40" y="40" width="3" height="44" fill="#6a9fcc"/>
    <text x="58" y="69" font-family="Arial, sans-serif" font-size="21" fill="#ebe7e4">${escapeXml(host)}</text>
    ${lines.slice(0, 3).map((line, index) => `<text x="40" y="${140 + index * 35}" font-family="Arial, sans-serif" font-size="25" fill="#ebe7e4">${escapeXml(line)}</text>`).join("\n")}
    <text x="40" y="288" font-family="Arial, sans-serif" font-size="15" fill="#bdc7d0">PAGE PREVIEW UNAVAILABLE · 页面预览不可用</text>
  </svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 76 }).toBuffer();
}

async function refresh() {
  mkdirSync(DIR, { recursive: true });
  const pending = jobs.filter((job) => force || !existsSync(join(DIR, job.file)));
  if (!pending.length) {
    console.log(`All ${jobs.length} previews already exist (pass --force to recapture).`);
    return;
  }
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {}),
    });
  } catch {
    try {
      browser = await chromium.launch({ channel: "chrome", headless: true });
    } catch {
      console.warn("No Chromium or Chrome installed; using site/title cards instead of screenshots.");
      for (const job of pending) {
        writeFileSync(join(DIR, job.file), await fallback(job));
      }
      return;
    }
  }
  const workers = Array.from({ length: Math.min(4, pending.length) }, async () => {
    const context = await browser.newContext({ viewport: { width: 1120, height: 630 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    try {
      while (pending.length) {
        const job = pending.shift();
        if (!job) break;
        let image;
        let status = "page";
        try {
          const response = await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 15000 });
          if (!response?.ok()) throw new Error(`HTTP ${response?.status() ?? "unknown"}`);
          await page.waitForLoadState("networkidle", { timeout: 1800 }).catch(() => {});
          const title = await page.title();
          const gate = await page.locator("body").innerText({ timeout: 1000 }).catch(() => "");
          if (/^\s*(sign in|log in|just a moment|access denied|captcha|403|404|not found|privacy error)\b/i.test(title)
            || /sign in to see this page|verify you are human|checking your browser/i.test(gate)) {
            throw new Error(`interstitial: ${title}`);
          }
          image = await sharp(await page.screenshot({ timeout: 8000, animations: "disabled" }))
            .resize(WIDTH, HEIGHT).webp({ quality: 68 }).toBuffer();
          if (image.byteLength < 1500) throw new Error("page is still a blank loading screen");
        } catch (error) {
          image = await fallback(job);
          status = `fallback (${error.message.slice(0, 70)})`;
        }
        writeFileSync(join(DIR, job.file), image);
        console.log(`${status}: ${job.file} ${job.url}`);
      }
    } finally {
      await context.close();
    }
  });
  try {
    await Promise.all(workers);
  } finally {
    await browser.close();
  }
}

if (process.argv.includes("--watch")) {
  let active = false;
  let dirty = false;
  let timer;
  let capture;
  const run = () => {
    if (active) { dirty = true; return; }
    active = true;
    capture = spawn(process.execPath, [fileURLToPath(import.meta.url)], { stdio: "inherit" });
    capture.on("close", () => {
      active = false;
      if (dirty) { dirty = false; run(); }
    });
  };
  // Watch the directory so atomic editor saves (rename over the file) keep working.
  const catalogWatcher = watch(join(ROOT, "extension/robin"), (_event, name) => {
    if (name && String(name) !== "learning-shelf.ts") return;
    clearTimeout(timer);
    timer = setTimeout(run, 350);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      clearTimeout(timer);
      dirty = false;
      catalogWatcher.close();
      capture?.kill(signal);
    });
  }
  run();
} else {
  await refresh();
}
