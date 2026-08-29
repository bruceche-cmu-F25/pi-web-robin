import assert from "node:assert/strict";
import test from "node:test";
import { PY_TOKEN_KINDS, highlightPython } from "./python-highlight.ts";
import { HEAT_SOURCE_LINES } from "./heat-source.ts";

const kindsOf = (tokens) => tokens.map((token) => token.kind);
const textOf = (tokens) => tokens.map((token) => token.text).join("");

test("tokens reassemble into the original line, exactly", () => {
  // The page renders tokens instead of text, so any character the lexer drops
  // is a character silently missing from the source the reader is checking.
  const highlighted = highlightPython(HEAT_SOURCE_LINES);
  assert.equal(highlighted.length, HEAT_SOURCE_LINES.length);
  highlighted.forEach((tokens, index) => {
    assert.equal(textOf(tokens), HEAT_SOURCE_LINES[index], `line ${index + 1} does not round-trip`);
  });
});

test("only known kinds are emitted", () => {
  for (const tokens of highlightPython(HEAT_SOURCE_LINES)) {
    for (const token of tokens) {
      assert.ok(PY_TOKEN_KINDS.includes(token.kind), `unknown kind ${token.kind}`);
    }
  }
});

test("a triple-quoted string keeps its state across lines", () => {
  const [open, middle, close, after] = highlightPython([
    'x = """start',
    "def not_really_code():",
    'end"""',
    "y = 1",
  ]);
  assert.deepEqual(kindsOf(open), ["plain", "plain", "string"]);
  assert.deepEqual(kindsOf(middle), ["string"]);
  assert.equal(kindsOf(close)[0], "string");
  assert.ok(kindsOf(after).includes("number"));
});

test("the few-shot demonstrations are strings, not code", () => {
  // Line 300 is inside _FACT_FEW_SHOT, 67 lines into a triple-quoted literal.
  // A lexer started at the displayed block rather than the file gets this
  // wrong, which is the whole reason the scan is whole-file.
  const tokens = highlightPython(HEAT_SOURCE_LINES)[299];
  assert.deepEqual(kindsOf(tokens), ["string"]);
  assert.ok(HEAT_SOURCE_LINES[299].startsWith("- "), "expected a demonstration line");
});

test("a hash inside a string is not a comment", () => {
  const [tokens] = highlightPython(['url = "http://x/#frag"  # real comment']);
  assert.equal(tokens.filter((token) => token.kind === "comment").length, 1);
  assert.equal(tokens.find((token) => token.kind === "comment").text, "# real comment");
});

test("an escaped quote does not end a string", () => {
  const [tokens] = highlightPython(['s = "a \\" b" + 1']);
  const string = tokens.find((token) => token.kind === "string");
  assert.equal(string.text, '"a \\" b"');
});

test("keywords are marked and identifiers are not", () => {
  const [tokens] = highlightPython(["def support(x): return not x"]);
  const keywords = tokens.filter((token) => token.kind === "keyword").map((token) => token.text);
  assert.deepEqual(keywords, ["def", "return", "not"]);
  assert.ok(tokens.some((token) => token.text === "support" && token.kind === "plain"));
});
