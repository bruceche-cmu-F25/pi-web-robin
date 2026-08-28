import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const sidebarSource = await read("../SessionSidebar.tsx");
const marginSource = await read("./RobinMargin.tsx");
const shellSource = await read("./RobinShell.tsx");
const dashboardLayout = await read("../../app/dashboard/layout.tsx");
const learnLayout = await read("../../app/learn/layout.tsx");
const css = await read("../../app/globals.css");

test("Robin routes share one persistent compact navigation", () => {
  assert.match(dashboardLayout, /<RobinShell>\{children\}<\/RobinShell>/);
  assert.match(learnLayout, /<RobinShell>\{children\}<\/RobinShell>/);
  assert.match(marginSource, /drawer \? " is-drawer" : " is-horizontal"/);
  assert.match(css, /\.robin-nav\.is-horizontal/);
  assert.match(marginSource, /<IconComponent aria-hidden="true"/);
  assert.match(shellSource, /robin-shell-content\$\{pathname === "\/dashboard" \? " is-dashboard" : ""\}/);
  for (const tone of ["clay", "sage", "teal", "slate", "plum", "honey"]) {
    assert.match(marginSource, new RegExp(`tone: "${tone}"`));
  }
  assert.doesNotMatch(shellSource, /localStorage/);
});

test("dashboard and chat round trips preserve the active workspace", () => {
  assert.match(
    sidebarSource,
    /pathname: "\/dashboard",\s*query: selectedSessionId\s*\? \{ session: selectedSessionId \}\s*: selectedCwd\s*\? \{ cwd: selectedCwd \}/,
  );
  assert.match(
    marginSource,
    /const \{ sessionId, requestedCwd: cwd \} = getInitialNavigation\(searchParams\)/,
  );
  assert.match(
    marginSource,
    /sessionId\s*\? `\$\{path\}\?session=\$\{encodeURIComponent\(sessionId\)\}`\s*: cwd\s*\? `\$\{path\}\?cwd=\$\{encodeURIComponent\(cwd\)\}`/,
  );
});

test("navigation separates primary pages from chat and settings", () => {
  const main = marginSource.slice(marginSource.indexOf("const mainItems"), marginSource.indexOf("const utilityItems"));
  const utility = marginSource.slice(marginSource.indexOf("const utilityItems"), marginSource.indexOf("return (", marginSource.indexOf("const utilityItems")));
  for (const href of ["/dashboard", "/dashboard/gmail", "/dashboard/jobs", "/learn"]) {
    assert.match(main, new RegExp(`path: \"${href.replaceAll("/", "\\/")}\"`));
  }
  assert.match(utility, /href: chatHref/);
  assert.match(utility, /path: "\/dashboard\/settings"/);
});

test("narrow screens use an off-canvas drawer", () => {
  assert.match(shellSource, /className="robin-mobile-nav-trigger"/);
  assert.match(shellSource, /if \(event\.key === "Escape"\) closeDrawer\(\)/);
  assert.match(shellSource, /inert=\{!inline && open\}/);
  assert.match(css, /@media \(max-width: 959px\)[\s\S]*?robin-navigation-container\.robin-navigation-closed[\s\S]*?translateX/);
});
