import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_MESSAGE_LENGTH,
  chunkHtml,
  stripTelegramHtml,
  toTelegramHtml,
} from "./format.ts";

test("headings become bold lines, because Telegram has no headings", () => {
  assert.equal(toTelegramHtml("## Today"), "<b>Today</b>");
  assert.equal(toTelegramHtml("###### deep"), "<b>deep</b>");
});

test("bullets become a bullet character and keep their indentation", () => {
  assert.equal(
    toTelegramHtml("- rent\n  - sub item\n* other"),
    "• rent\n  • sub item\n• other",
  );
});

test("emphasis converts, longest marker first", () => {
  assert.equal(toTelegramHtml("**bold**"), "<b>bold</b>");
  assert.equal(toTelegramHtml("***both***"), "<b><i>both</i></b>");
  assert.equal(toTelegramHtml("~~gone~~"), "<s>gone</s>");
  assert.equal(toTelegramHtml("an *emphasis* here"), "an <i>emphasis</i> here");
});

test("an underscore inside a word is an identifier, not emphasis", () => {
  assert.equal(toTelegramHtml("call todo_add then job_score"), "call todo_add then job_score");
});

test("markdown inside a code span stays literal", () => {
  assert.equal(
    toTelegramHtml("use `**not bold**` here"),
    "use <code>**not bold**</code> here",
  );
});

test("angle brackets and ampersands are escaped", () => {
  assert.equal(toTelegramHtml("a < b && c > d"), "a &lt; b &amp;&amp; c &gt; d");
});

test("an escaped character cannot smuggle in a tag", () => {
  assert.equal(
    toTelegramHtml("<script>alert(1)</script>"),
    "&lt;script&gt;alert(1)&lt;/script&gt;",
  );
});

test("links become anchors and keep their URL intact", () => {
  assert.equal(
    toTelegramHtml("[the posting](https://example.com/a?b=1&c=2)"),
    '<a href="https://example.com/a?b=1&amp;c=2">the posting</a>',
  );
});

test("a non-http link is left as visible text rather than rendered", () => {
  assert.equal(
    toTelegramHtml("[click](javascript:alert(1))"),
    "[click](javascript:alert(1))",
  );
});

test("fenced code becomes a pre block with its language", () => {
  assert.equal(
    toTelegramHtml("```js\nconst a = 1 < 2;\n```"),
    '<pre><code class="language-js">const a = 1 &lt; 2;</code></pre>',
  );
});

test("an unterminated fence still renders as code", () => {
  assert.equal(toTelegramHtml("```\nhalf"), "<pre><code>half</code></pre>");
});

test("a horizontal rule becomes a line, not three dashes", () => {
  assert.equal(toTelegramHtml("---"), "──────────");
});

test("stripping recovers plain text, keeping link targets", () => {
  const html = toTelegramHtml("**Today**\n- see [the posting](https://example.com/a)\n- a < b");
  assert.equal(stripTelegramHtml(html), "Today\n• see the posting (https://example.com/a)\n• a < b");
});

test("a short message is one chunk, unchanged", () => {
  assert.deepEqual(chunkHtml("<b>hi</b>"), ["<b>hi</b>"]);
});

test("chunks break on line boundaries and stay under the limit", () => {
  const html = Array.from({ length: 40 }, (_, i) => `line ${i} ${"x".repeat(50)}`).join("\n");
  const chunks = chunkHtml(html, 200);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 200, `chunk was ${chunk.length}`);
  assert.equal(chunks.join("\n"), html);
});

test("a chunk boundary never lands inside a tag", () => {
  const html = Array.from({ length: 30 }, (_, i) => `<b>item ${i}</b> tail`).join("\n");
  for (const chunk of chunkHtml(html, 60)) {
    assert.equal(chunk.includes("<") && !chunk.includes(">"), false);
    // Every `<` in a chunk must find its `>` inside the same chunk.
    for (let at = chunk.indexOf("<"); at !== -1; at = chunk.indexOf("<", at + 1)) {
      assert.notEqual(chunk.indexOf(">", at), -1, `unterminated tag in ${JSON.stringify(chunk)}`);
    }
  }
});

test("a code block spanning a boundary is closed and reopened", () => {
  const body = Array.from({ length: 30 }, (_, i) => `row ${i}`).join("\n");
  const chunks = chunkHtml(`<pre><code>${body}</code></pre>`, 120);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    const opens = chunk.split("<pre>").length - 1;
    const closes = chunk.split("</pre>").length - 1;
    assert.equal(opens, closes, `unbalanced pre in ${JSON.stringify(chunk)}`);
    assert.ok(chunk.length <= 120);
  }
});

test("a single line longer than the limit is cut without breaking an entity", () => {
  const chunks = chunkHtml(`${"&amp;".repeat(200)}`, 100);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 100);
    assert.match(chunk, /^(&amp;)+$/);
  }
  assert.equal(chunks.join(""), "&amp;".repeat(200));
});

test("chunking a real reply keeps every chunk sendable", () => {
  const markdown = Array.from({ length: 120 }, (_, i) =>
    `- **job ${i}** at [Acme](https://example.com/${i}) — a reason that runs on a bit`).join("\n");
  const chunks = chunkHtml(toTelegramHtml(markdown));
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= MAX_MESSAGE_LENGTH);
});
