import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./ProductIdeas.tsx", import.meta.url), "utf8");
const copy = await readFile(new URL("./product-copy.ts", import.meta.url), "utf8");
const shell = await readFile(new URL("./ProductIncubatorShell.tsx", import.meta.url), "utf8");

test("the page can put the agent to work on one idea", () => {
  // The agent is the only part of this section that can do the expensive half
  // of deciding — going and looking — and for a long time it was a drawer that
  // did nothing until you typed into it.
  assert.match(source, /agent\.ask\(\{ ideaId: idea\.id, brief: researchBrief\(\{ name, note \}, locale\) \}\)/);
  assert.match(shell, /export function useProductAgent/);
  // Scoped to that idea, which is what lets it read the idea and save links back.
  assert.match(shell, /requestBody=\{ideaId \? \{ productId: ideaId \} : \{\}\}/);
  assert.match(shell, /if \(brief\) setPending/);
});

test("the brief asks for the discouraging answer", () => {
  // A tool that only accumulates ideas is a graveyard.
  assert.match(copy, /discouraging/);
  assert.match(copy, /劝退/);
  // Sources, not the agent's own conclusions dressed as evidence.
  assert.match(copy, /Save sources only, never your own conclusions/);
  for (const marker of ["Who already does this", "Does anyone pay", "complain about", "worth a month"]) {
    assert.ok(copy.includes(marker), `brief should ask: ${marker}`);
  }
});

test("saving another field never clears an unsaved name or note", () => {
  assert.match(source, /if \(saved && clearsDraft\) setDirty\(false\)/);
  assert.match(source, /save\(\{ name: name\.trim\(\), note \}, true\)/);
  assert.doesNotMatch(source, /if \(saved\) setDirty\(false\)/);
});

test("an idea can be wrong, and says so on the row", () => {
  assert.match(source, /ideaAttention\(idea, today\)/);
  assert.match(source, /attention === "overdue" \? copy\.overdue : copy\.stale/);
  // Counted once at the top, so it is seen without going looking.
  assert.match(source, /const needsAttention/);
  // Settling is a real verdict with two ways out.
  assert.match(source, /settle\("held"\)/);
  assert.match(source, /settle\("broke"\)/);
});

test("the page says what the steps are, and each one says what to do", () => {
  // The six-column board was a set of buckets: it assumed you already knew the
  // process and only needed somewhere to record your position in it. What was
  // wanted is the opposite — tell me the steps, and what this one means.
  assert.match(source, /counts\.map\(\(\{ step, n \}, index\)/);
  assert.match(source, /step\.name\[zh \? "zh" : "en"\]/);
  assert.match(source, /<StepCard/);
  for (const part of ["copy.whatFor", "copy.whatToDo", "copy.whatDone", "copy.toolsHere"]) {
    assert.ok(source.includes(part), `the step card must show ${part}`);
  }
  // Done is the only gate, and it does not lock you out: the row's own step
  // control can still set any step at any time.
  assert.match(source, /onSave\(\{ step: after \}\)/);
  assert.match(source, /PLAYBOOK\.map\(\(item\) => <option/);
});

test("the next action stays visible while the full step guide starts closed", () => {
  assert.match(source, /const \[guideOpen, setGuideOpen\] = useState\(false\)/);
  assert.match(source, /\{copy\.nextAction\}/);
  assert.match(source, /\{step\.does\[0\]\?\.\[lang\]\}/);
  assert.match(source, /\{guideOpen \? copy\.hideGuide : copy\.showGuide\}/);
  assert.match(source, /\{guideOpen \? \(/);
});

test("the library arrives at the bench, not on a route of its own", () => {
  // The five categories were built for this and then orphaned as a directory
  // you had to think to visit.
  assert.match(source, /step\.categories\.includes\(item\.category\)/);
  assert.match(source, /resources=\{library\?\.resources \?\? \[\]\}/);
});

test("there is one page — the library is on it, not behind it", async () => {
  const shelf = await readFile(new URL("./ProductResourceShelf.tsx", import.meta.url), "utf8");
  // A second route meant the shelf was somewhere you had to remember to visit,
  // and getting back from it was a real complaint. Folding it in dissolved the
  // problem instead of signposting it, so the sub-nav went too.
  assert.doesNotMatch(shell, /product\/library/);
  assert.doesNotMatch(shell, /<nav/);
  assert.doesNotMatch(source, /product\/library/);
  // One card per kind, flowing like the Learning Hub shelf so unequal groups
  // do not leave grid-sized holes between rows.
  assert.match(shelf, /columns: "300px"/);
  assert.match(shelf, /break-inside-avoid/);
  assert.match(shelf, /const ORDER: LibraryCategory\[\] = \["source", "test", "tool", "stack", "distribution"\]/);
  // Opened, it takes the full measure rather than staying in one column.
  assert.match(shelf, /columnSpan: "all"/);
  // Closed cards remain shelves, not dot-separated link clouds: every resource
  // keeps its mark, complete title, host, summary, and price visible.
  assert.match(shelf, /<CompactResourceRow key=\{item\.id\} resource=\{item\} \/>/);
  assert.match(shelf, /<ResourceMark resource=\{resource\} \/>/);
  assert.match(shelf, /hostOf\(resource\.url\)/);
  assert.match(shelf, /\{resource\.summary\}/);
  assert.match(shelf, /\{resource\.price\}/);
  assert.doesNotMatch(shelf, /items\.map\(\(item, index\)/);
  // The search box and four filter selects went with the route: with
  // thirty-four rows across five kinds, the kinds are the filter.
  assert.doesNotMatch(shelf, /searchLibrary|allTypes|allPrices/);
});

test("the page owns the library poll and shares one snapshot", async () => {
  const shelf = await readFile(new URL("./ProductResourceShelf.tsx", import.meta.url), "utf8");
  assert.equal(source.match(/\/api\/robin\/product-library/g)?.length, 1);
  assert.doesNotMatch(shelf, /usePolledResource/);
  assert.match(source, /<ProductResourceShelf[\s\S]*?resources=\{library\?\.resources \?\? \[\]\}[\s\S]*?onRefresh=\{refreshLibrary\}/);
});

test("capture previews can be reviewed or removed without duplicate filing", () => {
  assert.match(source, /images\.map\(\(image, index\)/);
  assert.match(source, /data:\$\{image\.mimeType\};base64,\$\{image\.data\}/);
  assert.match(source, /setImages\(\(current\) => current\.filter/);
  assert.match(source, /captures\.map\(\(capture\)/);
  assert.match(source, /const \[submitting, setSubmitting\] = useState\(false\)/);
  assert.match(source, /if \(disabled\) return/);
  assert.match(source, /submitting \? copy\.saving : copy\.confirm/);
});

test("idea controls reflow and remain touchable on a phone", () => {
  assert.match(source, /basis-full[^"]*split:basis-auto[^"]*split:flex-1/);
  assert.match(source, /flex flex-col items-start gap-2 border-t[^"]*split:flex-row/);
  assert.match(source, /pi-bracket min-h-\[44px\] shrink-0 px-2 text-xs split:min-h-0/);
  assert.match(shell, /pi-bracket ml-auto min-h-\[44px\] px-2 split:min-h-0/);
});
