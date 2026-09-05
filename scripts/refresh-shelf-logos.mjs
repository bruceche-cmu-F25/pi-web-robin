/**
 * Refresh the Learning Hub and Product Library link logos.
 *
 *   node --experimental-strip-types scripts/refresh-shelf-logos.mjs
 *
 * A row on the shelf is recognised by its mark long before it is read, so the
 * shelf shows each site's own icon. What it must not do is ask the site for it
 * at render time: a favicon fetched from the page is twenty-three third-party
 * requests announcing, every time a shelf opens, exactly which references
 * someone keeps there. Google's favicon endpoint is the
 * same trade with one company instead of twenty-three. So the icons are
 * fetched here — once, into files we commit — and the running app serves them
 * from its own origin like any other asset.
 *
 * Same contract as scripts/refresh-neetcode-catalog.mjs: a snapshot, re-run
 * deliberately, reviewed as a diff. A host that fails is not an error — the
 * shelf falls back to the host name it has always shown — so the script
 * reports what it could not get and writes the rest.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STARTER_PRODUCT_LIBRARY } from "../extension/robin/product-domain.ts";
import { learningShelf } from "../extension/robin/study.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LOGO_DIR = join(ROOT, "public", "robin", "logos");
const MANIFEST_PATH = join(ROOT, "extension", "robin", "shelf-logos.ts");

/** A browser UA: a few of these sites serve a different document to scripts. */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const TIMEOUT_MS = 20_000;
/** Icons are chrome. Anything above this is a photograph someone mislabelled. */
const MAX_BYTES = 96 * 1024;

/** What we are willing to put in an <img>, best first. */
const EXTENSIONS = new Map([
  ["image/svg+xml", "svg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/x-icon", "ico"],
  ["image/vnd.microsoft.icon", "ico"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
]);

async function get(url) {
  return await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,image/*,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * Rank a declared icon.
 *
 * Bigger is better up to a point: a 16px favicon on a 2× display is mush, and
 * a 512px PWA icon is 40KB to draw fourteen pixels. Anything around 32–128
 * scales down cleanly, and an SVG wins outright because it has no size at all.
 */
function score(href, sizes, rel) {
  if (/\.svg($|\?)/i.test(href)) return 1000;
  const largest = Math.max(
    0,
    ...String(sizes ?? "").split(/\s+/).map((size) => Number.parseInt(size, 10) || 0),
  );
  const base = largest === 0 ? 24 : largest <= 128 ? largest * 4 : 512 - largest;
  // An apple-touch-icon is a real logo on a real background where a favicon is
  // sometimes a 16px glyph, so it breaks a tie but does not beat a good size.
  return base + (/apple-touch/i.test(rel) ? 20 : 0);
}

/** Every icon the page declares, best first, then the well-known fallback. */
function iconCandidates(html, pageUrl) {
  const candidates = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
    if (!/\bicon\b/i.test(rel)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    const sizes = /\bsizes\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    try {
      candidates.push({ url: new URL(href, pageUrl).href, rank: score(href, sizes, rel) });
    } catch {
      // A malformed href is the site's problem, not ours.
    }
  }
  candidates.sort((a, b) => b.rank - a.rank);
  candidates.push({ url: new URL("/favicon.ico", pageUrl).href, rank: 0 });
  return candidates;
}

/** Download one candidate, or null if it is not an image we can use. */
async function fetchIcon(url) {
  const response = await get(url);
  if (!response.ok) return null;
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const extension = EXTENSIONS.get(type);
  if (!extension) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;
  return { extension, bytes };
}

function canonicalHost(host) {
  return host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

async function logoFor(host) {
  const pageUrl = `https://${host}/`;
  let html = "";
  try {
    const response = await get(pageUrl);
    if (response.ok) html = await response.text();
  } catch {
    // No homepage is still worth a try at /favicon.ico below.
  }
  for (const candidate of iconCandidates(html, pageUrl)) {
    try {
      const icon = await fetchIcon(candidate.url);
      if (icon) return { ...icon, source: candidate.url };
    } catch {
      // Try the next one.
    }
  }
  return null;
}

const urls = [
  ...learningShelf().flatMap((group) => group.entries.map((entry) => entry.url)),
  ...STARTER_PRODUCT_LIBRARY.flatMap((resource) => resource.url ? [resource.url] : []),
];
const hosts = [...new Set(urls.map((url) => canonicalHost(new URL(url).host)))].sort();

mkdirSync(LOGO_DIR, { recursive: true });
const existing = new Map(
  readdirSync(LOGO_DIR).flatMap((file) => {
    const extension = file.split(".").at(-1);
    if (!extension || ![...EXTENSIONS.values()].includes(extension)) return [];
    return [[canonicalHost(file.slice(0, -(extension.length + 1))), file]];
  }),
);
const found = new Map();
const missing = [];

for (const host of hosts) {
  const logo = await logoFor(host);
  if (!logo) {
    const previous = existing.get(host);
    if (previous) {
      found.set(host, previous);
      console.warn(`  ~ ${host} → kept ${previous}`);
    } else {
      missing.push(host);
      console.warn(`  ✗ ${host}`);
    }
    continue;
  }
  const file = `${host}.${logo.extension}`;
  writeFileSync(join(LOGO_DIR, file), logo.bytes);
  found.set(host, file);
  console.log(`  ✓ ${host} → ${file} (${(logo.bytes.byteLength / 1024).toFixed(1)}KB) ${logo.source}`);
}

// A host dropped from the shelf leaves a file nothing references; a host whose
// icon changed format leaves the old extension behind. Both are dead weight in
// a directory that is committed, so the directory is the manifest's mirror.
const keep = new Set(found.values());
for (const file of readdirSync(LOGO_DIR)) {
  if (!keep.has(file)) {
    rmSync(join(LOGO_DIR, file));
    console.log(`  – removed ${file}`);
  }
}

const entries = [...found.entries()]
  .map(([host, file]) => `  "${host}": "${file}",`)
  .join("\n");

writeFileSync(
  MANIFEST_PATH,
  `/**
 * Host → the icon file for it under \`public/robin/logos/\`.
 *
 * Generated by scripts/refresh-shelf-logos.mjs. Do not edit by hand: the files
 * and this map are written together, and a name here without a file behind it
 * is a broken image on either shelf.
 *
 * A host that is absent is not a bug. Some sites publish nothing usable, and
 * the shelf has always been readable without an icon — it falls back to the
 * host name, which is what it showed before any of these existed.
 */
export const SHELF_LOGOS: Readonly<Record<string, string>> = {
${entries}
};

/** The public URL for a host's icon, or null when it has none. */
export function shelfLogo(host: string): string | null {
  const normalized = host.toLowerCase().replace(/\\.$/, "").replace(/^www\\./, "");
  const file = SHELF_LOGOS[normalized] ?? SHELF_LOGOS[\`www.\${normalized}\`];
  return file ? \`/robin/logos/\${file}\` : null;
}
`,
);

console.log(`\n${found.size}/${hosts.length} logos written to public/robin/logos/`);
if (missing.length > 0) console.log(`no icon: ${missing.join(", ")}`);
