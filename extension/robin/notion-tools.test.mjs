import assert from "node:assert/strict";
import { test } from "node:test";
import { registerNotionTools } from "./notion-tools.ts";
import { ROBIN_TOOL_NAMES } from "./tools.ts";

const tools = new Map();
registerNotionTools({ registerTool(tool) { tools.set(tool.name, tool); } });

const names = ["notion_search", "notion_read", "notion_append", "notion_create_page"];

test("Notion tools are registered and available to the dashboard assistant", () => {
  assert.deepEqual([...tools.keys()], names);
  for (const name of names) assert.ok(ROBIN_TOOL_NAMES.includes(name));
});

test("Notion writes stop before the API without explicit confirmation", async () => {
  const appended = await tools.get("notion_append").execute("test", {
    pageId: "374a5189-545c-80bf-8e1b-f848a1ecf11c",
    content: "draft",
    confirmed: false,
  });
  const created = await tools.get("notion_create_page").execute("test", {
    parentPageId: "374a5189-545c-80bf-8e1b-f848a1ecf11c",
    title: "Draft",
    content: "draft",
    confirmed: false,
  });
  assert.match(appended.content[0].text, /Not written/);
  assert.match(created.content[0].text, /Not created/);
});
