/**
 * Regenerate extension/robin/neetcode-catalog.ts.
 *
 *   node scripts/refresh-neetcode-catalog.mjs
 *
 * Two sources, for two different reasons:
 *
 * 1. `.problemSiteData.json` from neetcode-gh/leetcode (MIT) is the problem
 *    list itself — name, pattern, difficulty, LeetCode slug, solution video.
 *    It is a published, licensed file, so it is what the catalog is built on.
 *
 * 2. NeetCode's own per-problem slug (`ncLink`) exists only inside the site's
 *    JavaScript bundle. Without it a problem row can only link out to
 *    LeetCode, which cannot be embedded. Reading it here — once, at generation
 *    time, into a file we commit — is deliberate: the running app never parses
 *    a minified bundle, and a problem whose slug is missing degrades to its
 *    LeetCode link instead of breaking.
 *
 * Both are snapshots. Re-run this when the roadmap changes; the diff is the
 * review.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROBLEM_DATA_URL =
  "https://raw.githubusercontent.com/neetcode-gh/leetcode/main/.problemSiteData.json";
const SITE_URL = "https://neetcode.io/practice";

const OUT_PATH = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  "extension",
  "robin",
  "neetcode-catalog.ts",
);

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}`);
  return await response.text();
}

/** link (LeetCode slug) → NeetCode's own problem slug. */
async function fetchNeetCodeSlugs() {
  const html = await fetchText(SITE_URL);
  const bundle = /main\.[a-f0-9]+\.js/.exec(html)?.[0];
  if (!bundle) throw new Error("could not find the main bundle in the site HTML");

  const source = await fetchText(`https://neetcode.io/${bundle}`);
  const slugs = new Map();
  // Each problem is an object literal; only some carry ncLink.
  for (const match of source.matchAll(/\{problem:"(?:[^"\\]|\\.)*",pattern:"[^"]*",link:"([^"]*)"[^{}]*?\}/g)) {
    const ncLink = /ncLink:"([^"]*)"/.exec(match[0]);
    if (ncLink) slugs.set(match[1], ncLink[1].replace(/\/$/, ""));
  }
  if (slugs.size === 0) throw new Error("bundle parsed but no ncLink found — the shape changed");
  return { slugs, bundle };
}

const problems = JSON.parse(await fetchText(PROBLEM_DATA_URL));
if (!Array.isArray(problems) || problems.length === 0) {
  throw new Error("problem data is not a non-empty array");
}
const { slugs, bundle } = await fetchNeetCodeSlugs();

const entries = problems.map((entry) => ({
  problem: entry.problem,
  pattern: entry.pattern,
  difficulty: entry.difficulty,
  link: entry.link.replace(/\/$/, ""),
  ...(slugs.has(entry.link) ? { ncSlug: slugs.get(entry.link) } : {}),
  ...(entry.video ? { video: entry.video } : {}),
  ...(entry.code ? { code: entry.code } : {}),
  ...(entry.neetcode150 ? { neetcode150: true } : {}),
  ...(entry.blind75 ? { blind75: true } : {}),
}));

const patterns = [...new Set(entries.map((entry) => entry.pattern))];
const withSlug = entries.filter((entry) => entry.ncSlug).length;
const in150 = entries.filter((entry) => entry.neetcode150);
const slugged150 = in150.filter((entry) => entry.ncSlug).length;

const body = entries
  .map((entry) => `  ${JSON.stringify(entry)},`)
  .join("\n");

writeFileSync(
  OUT_PATH,
  `/**
 * The NeetCode problem catalog — generated, do not edit by hand.
 *
 * Run \`node scripts/refresh-neetcode-catalog.mjs\` to regenerate.
 *
 * Problem list from https://github.com/neetcode-gh/leetcode
 * (.problemSiteData.json, MIT © 2022 neetcode-gh). \`ncSlug\` is NeetCode's own
 * problem slug, read from the site bundle at generation time; problems without
 * one link out to LeetCode instead.
 *
 * Snapshot taken ${new Date().toISOString().slice(0, 10)} from ${bundle}.
 * ${entries.length} problems, ${patterns.length} patterns, ${withSlug} with a NeetCode slug.
 */

export interface CatalogProblem {
  /** Display name, e.g. "Contains Duplicate". */
  problem: string;
  /** Roadmap group, e.g. "Arrays & Hashing". */
  pattern: string;
  difficulty: "Easy" | "Medium" | "Hard";
  /** LeetCode slug — the stable key a practice record is filed under. */
  link: string;
  /** NeetCode's own slug, when the site has a page for it. */
  ncSlug?: string;
  /** YouTube id of NeetCode's walkthrough. */
  video?: string;
  /** Directory name of the reference solutions in the neetcode-gh repo. */
  code?: string;
  neetcode150?: true;
  blind75?: true;
}

export const NEETCODE_CATALOG: readonly CatalogProblem[] = [
${body}
];
`,
  "utf8",
);

console.log(`Wrote ${OUT_PATH}`);
console.log(`  ${entries.length} problems, ${patterns.length} patterns`);
console.log(`  NeetCode slugs: ${withSlug}/${entries.length} overall, ${slugged150}/${in150.length} of NeetCode 150`);
