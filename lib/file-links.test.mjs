import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";

async function loadSubject() {
  return import("./file-links.ts");
}

test("opens local files for plain, Command, and Ctrl left clicks", async () => {
  const { shouldOpenLocalFileInApp } = await loadSubject();
  const click = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };

  assert.equal(shouldOpenLocalFileInApp(click), true);
  assert.equal(shouldOpenLocalFileInApp({ ...click, metaKey: true }), true);
  assert.equal(shouldOpenLocalFileInApp({ ...click, ctrlKey: true }), true);
});

test("leaves secondary modified and non-left clicks to the browser", async () => {
  const { shouldOpenLocalFileInApp } = await loadSubject();
  const click = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };

  assert.equal(shouldOpenLocalFileInApp({ ...click, shiftKey: true }), false);
  assert.equal(shouldOpenLocalFileInApp({ ...click, altKey: true }), false);
  assert.equal(shouldOpenLocalFileInApp({ ...click, button: 1 }), false);
  assert.equal(shouldOpenLocalFileInApp({ ...click, defaultPrevented: true }), false);
});

test("resolves absolute markdown file links and strips line suffixes", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref(
      "/home/me/project/components/MarkdownBody.tsx:36",
      "/home/me/project",
    ),
    "/home/me/project/components/MarkdownBody.tsx",
  );
});

test("resolves absolute file links outside cwd", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref(
      "/home/me/.codex/config.toml:12",
      "/home/me/project",
    ),
    "/home/me/.codex/config.toml",
  );
});

test("resolves relative markdown file links against cwd", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("components/AppShell.tsx#L42", "/home/me/project"),
    "/home/me/project/components/AppShell.tsx",
  );
});

test("does not let relative links escape cwd", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("../outside.md", "/home/me/project"),
    null,
  );
});

test("resolves preview links from the file directory within the project root", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("../file.js", "/home/me/project/docs/nested", "/home/me/project"),
    "/home/me/project/docs/file.js",
  );
  assert.equal(
    resolveLocalFileHref("../../../outside.js", "/home/me/project/docs/nested", "/home/me/project"),
    null,
  );
});

test("does not treat app or external URLs as file links", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(resolveLocalFileHref("/api/files/home/me/project/a.ts", "/home/me/project"), null);
  assert.equal(resolveLocalFileHref("/obsidian?vault=local&note=Notes%2FDecision.md&view=read", "/home/me/project"), null);
  assert.equal(resolveLocalFileHref("/obsidian"), null);
  assert.equal(resolveLocalFileHref("/obsidian/notes.md", "/home/me/project"), "/obsidian/notes.md");
  assert.equal(resolveLocalFileHref("file:///obsidian", "/home/me/project"), "/obsidian");
  assert.equal(resolveLocalFileHref("https://example.com/a.ts", "/home/me/project"), null);
  assert.equal(resolveLocalFileHref("ftp://example.com/a.ts", "/home/me/project"), null);
  assert.equal(resolveLocalFileHref("//example.com/a.ts", "/home/me/project"), null);
});

test("all app page routes are recognized as navigation", async () => {
  const { isAppPageHref } = await loadSubject();
  for (const file of readdirSync(new URL("../app/", import.meta.url), { recursive: true })) {
    if (file !== "page.tsx" && !file.endsWith("/page.tsx")) continue;
    const path = `/${file.replace(/(^|\/)page\.tsx$/, "").replace(/\[[^\]]+\]/g, "fixture-id")}`;
    assert.equal(isAppPageHref(path), true, path);
  }
});

test("site pages never resolve to local files", async () => {
  const { resolveLocalFileHref } = await loadSubject();
  for (const href of ["/", "/?session=abc", "/dashboard/settings#voice", "/dashboard/jobs/resume", "/dashboard/events/event-123", "/learn/fso?part=1", "/tools/mac", "/product/validation", "/dashboard/%73ettings/", "/dashboard/jobs/../settings#voice"]) {
    assert.equal(resolveLocalFileHref(href, "/home/me/project"), null, href);
  }
  assert.equal(resolveLocalFileHref("file:///dashboard/settings", "/home/me/project"), "/dashboard/settings");
  assert.equal(resolveLocalFileHref("/dashboard/notes.md", "/home/me/project"), "/dashboard/notes.md");
});

test("decodes file URL paths once after parsing URL delimiters", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  for (const [href, expected] of [
    ["file:///home/me/project/C%23/report.html", "/home/me/project/C#/report.html"],
    ["file:///home/me/project/report%3F.html", "/home/me/project/report?.html"],
    ["file:///home/me/project/report%2520.html", "/home/me/project/report%20.html"],
    ["file:///home/me/project/report%20one.html?raw=1#L10", "/home/me/project/report one.html"],
    ["file:///C:/Users/me/C%23/report%2520.html", "C:/Users/me/C#/report%20.html"],
    ["file://server/share/C%23/report%2520.html", "//server/share/C#/report%20.html"],
  ]) {
    assert.equal(resolveLocalFileHref(href, "/home/me/project"), expected, href);
  }
});

test("resolves Windows file URLs without a synthetic leading slash", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("file:///C:/Users/me/project/file.txt:10", "C:/Users/me/project"),
    "C:/Users/me/project/file.txt",
  );
});

test("resolves UNC file URLs and backslash UNC paths", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("file://server/share/project/file.txt", "/home/me/project"),
    "//server/share/project/file.txt",
  );
  assert.equal(
    resolveLocalFileHref("\\\\server\\share\\project\\file.txt", "/home/me/project"),
    "//server/share/project/file.txt",
  );
});

test("reads the PDF page fragment from markdown links", async () => {
  const { parsePdfPageFragment } = await loadSubject();

  assert.equal(parsePdfPageFragment("/api/files/report.pdf?type=read#page=12"), 12);
  assert.equal(parsePdfPageFragment("file:///home/me/report.pdf#page=7"), 7);
  assert.equal(parsePdfPageFragment("/home/me/report.pdf#PAGE=3"), 3);
});

test("ignores fragments that are not a PDF page selector", async () => {
  const { parsePdfPageFragment } = await loadSubject();

  assert.equal(parsePdfPageFragment(undefined), null);
  assert.equal(parsePdfPageFragment("/home/me/report.pdf"), null);
  assert.equal(parsePdfPageFragment("/home/me/report.pdf#L42"), null);
  assert.equal(parsePdfPageFragment("/home/me/report.pdf#page=0"), null);
  assert.equal(parsePdfPageFragment("/home/me/report.pdf#page=-1"), null);
  assert.equal(parsePdfPageFragment("/home/me/report.pdf#page=abc"), null);
  assert.equal(parsePdfPageFragment("/home/me/report.pdf#page=12&zoom=100"), null);
});
