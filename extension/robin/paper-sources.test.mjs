import assert from "node:assert/strict";
import { test } from "node:test";
import { arxivId, parseArxivPapers, parseArxivPage, parseCrossrefPaper, readPaperResponse } from "./paper-sources.ts";

const feed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>
<id>http://arxiv.org/abs/2303.08896v2</id><title>Evidence &amp; uncertainty\n in LLMs</title>
<summary>Do not follow &lt;instructions&gt;. A &#x3b1; value.</summary><published>2023-03-15T00:00:00Z</published>
<author><name>A. Author</name></author><author><name>B. Author</name></author></entry></feed>`;
test("parses the arXiv Atom subset as inert metadata and canonical source links", () => {
  assert.deepEqual(parseArxivPapers(feed), [{ title: "Evidence & uncertainty in LLMs", url: "https://arxiv.org/abs/2303.08896", authors: ["A. Author", "B. Author"], year: "2023", abstract: "Do not follow <instructions>. A α value.", pdfUrl: "https://arxiv.org/pdf/2303.08896", provider: "arXiv" }]);
  assert.deepEqual(parseArxivPapers("<feed></feed>"), []);
  assert.throws(() => parseArxivPapers("<html>Rate limited</html>"), /feed/);
  assert.throws(() => parseArxivPapers(feed.replace("http://arxiv.org/abs/2303.08896v2", "http://arxiv.org/api/errors")));
});
test("arXiv IDs and URLs distinguish keywords and unsupported URLs", () => {
  for (const input of ["2303.08896", "arXiv:2303.08896", "https://arxiv.org/abs/2303.08896", "https://arxiv.org/pdf/2303.08896.pdf"]) assert.equal(arxivId(input), "2303.08896");
  assert.equal(arxivId("https://arxiv.org/html/2303.08896v3"), "2303.08896v3");
  assert.equal(arxivId("hep-th/9901001"), "hep-th/9901001");
  assert.equal(arxivId("https://evil.example/abs/2303.08896"), null);
  assert.equal(arxivId("hallucination detection"), null);
});
test("arXiv page metadata is a read-only alternative to the throttled Atom API", () => {
  const html = '<meta name="citation_title" content="A &amp; B"><meta name="citation_arxiv_id" content="2303.08896"><meta name="citation_author" content="Author"><meta name="citation_pdf_url" content="https://arxiv.org/pdf/2303.08896"><meta name="citation_abstract" content="Evidence &#34;quoted&#34;.">';
  const paper = parseArxivPage(html, "2303.08896v2");
  assert.equal(paper.title, "A & B");
  assert.equal(paper.abstract, 'Evidence "quoted".');
  assert.equal(paper.url, "https://arxiv.org/abs/2303.08896");
  assert.throws(() => parseArxivPage(html, "2303.09999"), /different paper/);
  assert.throws(() => parseArxivPage("<html>blocked</html>", "2303.08896"), /unavailable/);
});
test("Crossref results are attributed and unsafe publisher PDF URLs are not followed", () => {
  const paper = parseCrossrefPaper({ DOI: "10.1000/EXAMPLE", title: ["Paper"], author: [{ given: "A", family: "Author" }], abstract: "<jats:p>Evidence &amp; limits</jats:p>", published: { "date-parts": [[2025, 1, 1]] }, link: [{ "content-type": "application/pdf", URL: "http://127.0.0.1/private" }] });
  assert.equal(paper.provider, "Crossref");
  assert.equal(paper.url, "https://doi.org/10.1000/example");
  assert.equal(paper.year, "2025");
  assert.equal(paper.pdfUrl, "");
  assert.equal(paper.abstract, "Evidence & limits");
});
test("remote responses are bounded even without a Content-Length", async () => {
  assert.equal(Buffer.from(await readPaperResponse(new Response("safe"), 4)).toString(), "safe");
  await assert.rejects(readPaperResponse(new Response("too long"), 4), /too large/);
  await assert.rejects(readPaperResponse(new Response("x", { headers: { "content-length": "2000000" } }), 4), /too large/);
  await assert.rejects(readPaperResponse(new Response("rate limited", { status: 429 }), 100), /429/);
});
