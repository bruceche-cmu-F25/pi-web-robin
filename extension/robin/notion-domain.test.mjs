import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";

const previousDataDir = process.env.ROBIN_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), "robin-notion-"));
process.env.ROBIN_DATA_DIR = dataDir;

const {
  appendNotionPage,
  createNotionPage,
  normalizeNotionId,
  notionBlocksFromMarkdown,
  readNotionPage,
  searchNotion,
} = await import("./notion-domain.ts");
const { clearNotion, setNotionToken } = await import("./settings.ts");
const originalFetch = globalThis.fetch;

beforeEach(() => {
  clearNotion();
  setNotionToken("ntn_test-token");
  globalThis.fetch = originalFetch;
});

after(() => {
  globalThis.fetch = originalFetch;
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previousDataDir;
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("search lists only the page metadata the model needs", async () => {
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return jsonResponse({ results: [{
      id: "374a5189545c80bf8e1bf848a1ecf11c",
      url: "https://notion.so/weekly",
      last_edited_time: "2026-09-14T12:00:00.000Z",
      parent: { type: "page_id", page_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      properties: {
        Name: { type: "title", title: [{ plain_text: "变得更强" }] },
      },
    }] });
  };

  const pages = await searchNotion("变得更强", 5);
  assert.deepEqual(pages, [{
    id: "374a5189-545c-80bf-8e1b-f848a1ecf11c",
    title: "变得更强",
    url: "https://notion.so/weekly",
    lastEditedAt: "2026-09-14T12:00:00.000Z",
    parentId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  }]);
  assert.equal(request.url, "https://api.notion.com/v1/search");
  assert.equal(request.init.headers.Authorization, "Bearer ntn_test-token");
  assert.deepEqual(JSON.parse(request.init.body).filter, { property: "object", value: "page" });
});

test("search follows Notion pagination up to the requested limit", async () => {
  let call = 0;
  globalThis.fetch = async (_url, init) => {
    call += 1;
    const request = JSON.parse(init.body);
    if (call === 1) {
      assert.equal(request.page_size, 2);
      return jsonResponse({
        results: [{ id: "11111111111111111111111111111111", properties: {} }],
        has_more: true,
        next_cursor: "next",
      });
    }
    assert.equal(request.start_cursor, "next");
    assert.equal(request.page_size, 1);
    return jsonResponse({ results: [{ id: "22222222222222222222222222222222", properties: {} }], has_more: false });
  };

  assert.equal((await searchNotion("", 2)).length, 2);
  assert.equal(call, 2);
});

test("read renders Notion blocks as bounded text", async () => {
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    if (call === 1) {
      return jsonResponse({
        id: "374a5189-545c-80bf-8e1b-f848a1ecf11c",
        properties: { title: { type: "title", title: [{ plain_text: "Weekly" }] } },
      });
    }
    return jsonResponse({ results: [
      { id: "11111111-1111-1111-1111-111111111111", type: "heading_2", heading_2: { rich_text: [{ plain_text: "API" }] } },
      { id: "22222222-2222-2222-2222-222222222222", type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "HTTP contract" }] } },
    ], has_more: false });
  };

  const page = await readNotionPage("374a5189545c80bf8e1bf848a1ecf11c");
  assert.equal(page.title, "Weekly");
  assert.equal(page.content, "## API\n- HTTP contract");
  assert.equal(page.truncated, false);
});

test("the Markdown subset becomes native Notion blocks", () => {
  const blocks = notionBlocksFromMarkdown("# Week 1\n- HTTP\n- [x] REST\n> ship it\n```\nconst ok = true\n```");
  assert.deepEqual(blocks.map((block) => block.type), [
    "heading_1", "bulleted_list_item", "to_do", "quote", "code",
  ]);
  assert.equal(blocks[2].to_do.checked, true);
  assert.equal(blocks[4].code.language, "plain text");
});

test("append and create send only additive Notion operations", async () => {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), method: init.method, body: JSON.parse(init.body) });
    if (String(url).endsWith("/pages")) {
      return jsonResponse({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", url: "https://notion.so/new" });
    }
    return jsonResponse({});
  };

  const id = normalizeNotionId("374a5189545c80bf8e1bf848a1ecf11c");
  assert.deepEqual(await appendNotionPage(id, "## Review\nDone"), { blocks: 2 });
  const created = await createNotionPage(id, "Week 2", "- Learn APIs");
  assert.equal(created.title, "Week 2");
  assert.equal(created.blocks, 1);
  assert.deepEqual(requests.map((request) => request.method), ["PATCH", "POST"]);
  assert.match(requests[0].url, /\/blocks\/374a5189-545c-80bf-8e1b-f848a1ecf11c\/children$/);
  assert.equal(requests[1].body.parent.page_id, id);
});

test("a note's files are uploaded and placed where the note references them", async () => {
  const calls = [];
  let uploads = 0;
  globalThis.fetch = async (url, init) => {
    const path = String(url).replace("https://api.notion.com/v1", "");
    if (path === "/file_uploads") {
      uploads += 1;
      calls.push({ path, body: JSON.parse(init.body) });
      return jsonResponse({ id: `upload-${uploads}` });
    }
    if (path.endsWith("/send")) {
      assert.ok(init.body instanceof FormData);
      assert.equal(init.headers["Content-Type"], undefined);
      calls.push({ path });
      return jsonResponse({ status: "uploaded" });
    }
    calls.push({ path, body: JSON.parse(init.body) });
    return jsonResponse({ id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" });
  };

  const bytes = new TextEncoder().encode("data");
  await createNotionPage("374a5189545c80bf8e1bf848a1ecf11c", "Batching", "# 批处理\n![白板](attachment:photo1)\n- 要点", [
    { id: "photo1", name: "board.jpg", kind: "image", mimeType: "image/jpeg", bytes },
    { id: "deck1", name: "lecture.pdf", kind: "pdf", mimeType: "application/pdf", bytes },
  ]);

  assert.deepEqual(calls.map((call) => call.path), [
    "/file_uploads", "/file_uploads/upload-1/send", "/file_uploads", "/file_uploads/upload-2/send", "/pages",
  ]);
  assert.deepEqual(calls[0].body, { mode: "single_part", filename: "board.jpg", content_type: "image/jpeg" });
  const children = calls.at(-1).body.children;
  assert.deepEqual(children.map((block) => block.type), ["heading_1", "image", "bulleted_list_item", "heading_2", "pdf"]);
  assert.deepEqual(children[1].image.file_upload, { id: "upload-1" });
  // The deck was never placed, so it is filed at the end under a heading in the note's language.
  assert.equal(children[3].heading_2.rich_text[0].text.content, "附件");
  assert.deepEqual(children[4].pdf.file_upload, { id: "upload-2" });
});
