import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { FDE_ROADMAP_URL, LEARNING_SHELF, shelfPreviewFile } from "../../extension/robin/learning-shelf.ts";

const read = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");
const source = await read("LearningHub.tsx");
const navigationSource = await read("RobinMargin.tsx");
const learnLayoutSource = await read("../../app/learn/layout.tsx");

test("the hub links to both daily tracks", async () => {
  // The hub is the front door. A track with no entry here is a track nobody
  // finds, which is the whole failure mode a landing page exists to prevent.
  // Problems is reached through today's NeetCode track, which the hub renders,
  // rather than through a second card repeating the same count.
  const panel = await read("LearningPanel.tsx");
  assert.match(source, /<LearningPanel showCourseOutline \/>/);
  assert.match(source, /href: "\/learn\/fso"/);
  assert.match(panel, /href=\{`\/coding\?list=/);
  assert.match(panel, /\/learn\/fso\?step=/);
});

test("hub navigation lives in the shared shell; expired page auth redirects to login", async () => {
  assert.match(learnLayoutSource, /<RobinShell>[\s\S]*?\{children\}[\s\S]*?<\/RobinShell>/);
  assert.match(navigationSource, /from ["']next\/link["']/);
  // The old all-anchor restriction assumed page requests issued a Basic 401.
  // Pages now redirect to /login, including RSC requests (covered in browser tests).
  const proxy = await read("../../proxy.ts");
  assert.match(proxy, /if \(!authenticated\) \{\s*if \(!isApiRequest\) \{[\s\S]*?return NextResponse\.redirect\(loginUrl\)/);
  assert.doesNotMatch(proxy, /WWW-Authenticate/i);
  assert.match(navigationSource, /path: "\/dashboard"/);
  assert.match(navigationSource, /href: chatHref/);
});

test("product has its own navigation tone", () => {
  assert.match(navigationSource, /icon: DashboardIcon,[\s\S]*?tone: "clay"/);
  assert.match(navigationSource, /icon: ProductIcon,[\s\S]*?tone: "fern"/);
});

test("the hub stays a front door rather than a second dashboard", async () => {
  // It holds the ways in and the study links. Calendar, todos, the job
  // pipeline, and the saved-links collection live on the dashboard;
  // duplicating them here is how a landing page stops being shorter than what
  // it links to, which is the only reason to land on it.
  for (const panel of ["CalendarPanel", "TodoPanel", "JobsPanel", "AssistantBar", "LinksPanel"]) {
    assert.doesNotMatch(source, new RegExp(`<${panel}\\b`), `${panel} belongs on the dashboard`);
  }
  assert.match(source, /<LearningShelf \/>/);
});

test("the five channels, iOS ideas data and two FDE guides live together in one shelf card", () => {
  const group = LEARNING_SHELF.filter((entry) => entry.id === "ai-creators-fde");
  assert.equal(group.length, 1);
  assert.deepEqual(group[0].links.map((entry) => entry.url), [
    "https://learn.varickagents.com/fde-in-30-days",
    "https://www.youtube.com/@freecodecamp",
    "https://www.youtube.com/@starterstory",
    "https://www.starterstory.com/data/ios-app-ideas",
    "https://www.youtube.com/@GregIsenberg",
    "https://www.youtube.com/@howiaipodcast",
    "https://www.youtube.com/@DanKoeTalks",
    "https://www.varickagents.com/blog/forward-deployed-engineering-101",
  ]);
});

test("every shelf group has a purpose and every link has a local visual preview", async () => {
  const [en, zh] = await Promise.all([
    read("../../lib/i18n/messages/en.ts"), read("../../lib/i18n/messages/zh-CN.ts"),
  ]);
  for (const messages of [en, zh]) {
    assert.ok(messages.includes('"learn.shelf.intro"'));
    assert.ok(messages.includes('"learn.shelf.sitePreview"'));
  }
  const files = new Set();
  for (const group of LEARNING_SHELF) {
    for (const messages of [en, zh]) assert.ok(messages.includes(`"learn.shelf.${group.id}.purpose"`));
    if (group.preview) {
      assert.match(group.preview.url, /^https:\/\/www\.youtube\.com\/watch\?v=/);
      const image = await readFile(new URL(`../../public${group.preview.image}`, import.meta.url));
      assert.ok(image.byteLength > 1000);
    }
    for (const link of group.links) {
      if (link.url === group.preview?.url) continue;
      const file = shelfPreviewFile(group.id, link.url);
      assert.ok(!files.has(file), `preview filename collision: ${file}`);
      files.add(file);
      const image = await readFile(new URL(`../../public/robin/previews/${file}`, import.meta.url));
      assert.ok(image.byteLength > 1000, `${group.id}: ${link.title}`);
    }
  }
  const shelf = await read("LearningShelf.tsx");
  assert.doesNotMatch(shelf, /<details>/);
  assert.match(shelf, /group\.links\.map\(\(entry, index\) =>/);
  assert.match(shelf, /shelfPreviewFile\(group\.id, entry\.url\)/);
  assert.match(shelf, /onError=\{\(\) => \{ setReady\(false\); setFailed\(true\); \}\}/);
  assert.match(shelf, /!videoListed/);
});

test("new shelf links keep a site-info fallback until the dev watcher creates a URL-keyed still", async () => {
  const first = LEARNING_SHELF[0].links[0].url;
  assert.equal(shelfPreviewFile("entry", first), shelfPreviewFile("entry", first));
  assert.notEqual(shelfPreviewFile("entry", first), shelfPreviewFile("entry", `${first}?new=1`));
  const script = await read("../../scripts/refresh-shelf-previews.mjs");
  const dev = await read("../../scripts/dev-with-shelf-previews.mjs");
  assert.match(script, /watch\(join\(ROOT, "extension\/robin"\)/);
  assert.match(script, /shelfPreviewFile\(group\.id, link\.url\)/);
  assert.match(dev, /"--watch"/);
});

test("the hub gives the FDE roadmap a dedicated four-checkpoint card with a calibrated verdict", async () => {
  assert.equal(FDE_ROADMAP_URL, "https://learn.varickagents.com/fde-in-30-days");
  assert.ok(LEARNING_SHELF.some((group) => group.links.some((link) => link.url === FDE_ROADMAP_URL)));
  assert.match(source, /aria-labelledby="fde-roadmap-title"/);
  assert.match(source, /href=\{FDE_ROADMAP_URL\}/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.match(source, /\[1, 2, 3, 4\]\.map\(\(week\) =>/);
  for (const file of ["en.ts", "zh-CN.ts"]) {
    const messages = await read(`../../lib/i18n/messages/${file}`);
    for (const key of ["intro", "value", "limit", "open", ...[1, 2, 3, 4].map((i) => `week${i}.detail`)]) {
      assert.ok(messages.includes(`"learn.fde.${key}"`), `${file} lacks learn.fde.${key}`);
    }
  }
});

test("the hub links to the focused GPT-2 walkthrough page", () => {
  assert.match(source, /id: "gpt2-walkthrough"/);
  assert.match(source, /href: "\/learn\/gpt2"/);
});

test("the GPT-2 page keeps the official video and companion repository links", async () => {
  const page = await read("GPT2Walkthrough.tsx");
  assert.match(page, /https:\/\/www\.youtube\.com\/watch\?v=l8pRSuU81PU/);
  assert.match(page, /https:\/\/github\.com\/karpathy\/build-nanogpt/);
  assert.match(page, /https:\/\/github\.com\/karpathy\/nn-zero-to-hero/);
});

test("the hub's numbers all come from today's panel", async () => {
  // The panel's learning snapshot already carries the practice count, so a
  // poll of the hub's own would fetch the same number twice. The curriculum
  // entry says what it is rather than how far along it is; a study poll here
  // would mean the tracking came back somewhere.
  assert.doesNotMatch(source, /usePolledResource/);
  assert.doesNotMatch(source, /\/api\/robin\/study/);

  const shelf = await read("LearningShelf.tsx");
  assert.doesNotMatch(shelf, /STATUS_MARK|records/, "the shelf must not mark rows read");
});

test("the workspace opens the problem the hub sends it to, and old curriculum links land on the course", async () => {
  const board = await read("CodingBoard.tsx");
  assert.match(board, /initialProblem=\{searchParams\.get\("problem"\)\}/);
  const page = await read("../../app/coding/page.tsx");
  assert.match(page, /track === "curriculum"\) redirect\("\/learn\/fso"\)/);
});
