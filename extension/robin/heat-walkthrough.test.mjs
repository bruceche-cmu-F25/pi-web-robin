import assert from "node:assert/strict";
import test from "node:test";
import {
  BLOCK_KINDS,
  EXTRACTION_DEFECT,
  TOTAL_LINES,
  WALKTHROUGH,
} from "./heat-walkthrough.ts";

const blocks = WALKTHROUGH.flatMap((section) => section.blocks);

test("the walkthrough covers every line of visualize.py exactly once", () => {
  // This is the claim the page makes in its title. A gap lets a reader believe
  // they have read the file when they have read the interesting parts — and in
  // this codebase the defect that matters most lives in a four-line string
  // helper nobody would choose to stop at.
  let expected = 1;
  for (const block of blocks) {
    assert.equal(
      block.from,
      expected,
      `line ${expected} is not covered: the next block starts at ${block.from} (${block.title.en})`,
    );
    assert.ok(
      block.to >= block.from,
      `block "${block.title.en}" ends at ${block.to}, before it starts at ${block.from}`,
    );
    expected = block.to + 1;
  }
  assert.equal(expected - 1, TOTAL_LINES, "the last block must end on the last line of the file");
});

test("section bounds agree with the blocks they contain", () => {
  for (const section of WALKTHROUGH) {
    assert.ok(section.blocks.length > 0, `section "${section.id}" has no blocks`);
    assert.equal(section.from, section.blocks[0].from, `section "${section.id}" starts before its first block`);
    assert.equal(
      section.to,
      section.blocks[section.blocks.length - 1].to,
      `section "${section.id}" ends after its last block`,
    );
  }
});

test("section ids are unique and sections run in file order", () => {
  const ids = WALKTHROUGH.map((section) => section.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate section id");
  for (let i = 1; i < WALKTHROUGH.length; i += 1) {
    assert.equal(WALKTHROUGH[i].from, WALKTHROUGH[i - 1].to + 1, "sections must be contiguous");
  }
});

test("every flagged block uses a known kind", () => {
  for (const block of blocks) {
    if (block.kind === undefined) continue;
    assert.ok(BLOCK_KINDS.includes(block.kind), `unknown kind "${block.kind}" on ${block.title.en}`);
  }
});

test("both languages are present on every block", () => {
  // The page renders one or the other; an empty string would render as a gap
  // in the prose rather than as an obvious failure.
  for (const block of [...blocks, EXTRACTION_DEFECT]) {
    for (const [field, value] of Object.entries(block)) {
      if (typeof value !== "object" || value === null || !("en" in value)) continue;
      assert.ok(value.en.trim().length > 0, `empty en for ${field}`);
      assert.ok(value.zh.trim().length > 0, `empty zh for ${field}`);
    }
  }
});

test("the extraction defect names the lines it depends on", () => {
  // The finding is only checkable if it says where to look. If these line
  // references drift out of the prose, the claim stops being verifiable.
  for (const line of [":231", ":169", ":396", ":412"]) {
    assert.ok(
      EXTRACTION_DEFECT.mechanism.en.includes(line),
      `the mechanism should cite ${line}`,
    );
  }
});
