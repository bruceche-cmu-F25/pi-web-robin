import assert from "node:assert/strict";
import { test } from "node:test";
import { INITIAL_SHELL_PANELS, TOP_PANELS, shellPanelReducer } from "./shell-panels.ts";

const desktop = { isMobile: false, isNarrowMobile: false };
const phone = { isMobile: true, isNarrowMobile: false };
const narrow = { isMobile: true, isNarrowMobile: true };

const move = (state, event, viewport = desktop) => shellPanelReducer(state, event, viewport);
const run = (events, viewport = desktop, from = INITIAL_SHELL_PANELS) =>
  events.reduce((state, event) => move(state, event, viewport), from);

/** How many full-width surfaces are showing at once. */
const overlays = (s) =>
  [s.sidebarOpen, s.activeTopPanel !== null, s.mobileToolbarMoreOpen, s.rightPanelOpen]
    .filter(Boolean).length;

test("the shell opens with the sidebar showing and nothing else", () => {
  assert.deepEqual(INITIAL_SHELL_PANELS, {
    sidebarOpen: true,
    rightPanelOpen: false,
    activeTopPanel: null,
    mobileToolbarMoreOpen: false,
  });
});

test("on a phone, showing any surface hides every other one", () => {
  // Every way of revealing something, from a state where everything is up.
  const crowded = {
    sidebarOpen: true, rightPanelOpen: false,
    activeTopPanel: "system", mobileToolbarMoreOpen: true,
  };
  for (const event of [
    { type: "open_right_panel" },
    { type: "toggle_right_panel" },
    { type: "reveal_workspace" },
  ]) {
    assert.ok(overlays(move(crowded, event, phone)) <= 1, event.type);
  }
});

test("on a desktop the surfaces are independent — nothing closes anything else", () => {
  const both = run([
    { type: "open_top_panel", panel: "tools" },
    { type: "open_right_panel" },
  ]);
  assert.equal(both.sidebarOpen, true);
  assert.equal(both.activeTopPanel, "tools");
  assert.equal(both.rightPanelOpen, true);
});

test("a top panel toggles off when tapped again, and swaps when a different one is tapped", () => {
  const open = move(INITIAL_SHELL_PANELS, { type: "toggle_top_panel", panel: "branches" });
  assert.equal(open.activeTopPanel, "branches");
  assert.equal(move(open, { type: "toggle_top_panel", panel: "branches" }).activeTopPanel, null);
  assert.equal(move(open, { type: "toggle_top_panel", panel: "tools" }).activeTopPanel, "tools");
});

test("opening a top panel on a phone closes the drawer under it", () => {
  const open = move(INITIAL_SHELL_PANELS, { type: "toggle_top_panel", panel: "system" }, phone);
  assert.equal(open.sidebarOpen, false);
  assert.equal(open.activeTopPanel, "system");
});

test("the overflow menu survives a tap that came from inside it, and only there", () => {
  const fromMenu = { type: "toggle_top_panel", panel: "session", keepMobileToolbar: true };

  // Narrow phone: the user is working through the menu, so it stays up.
  assert.equal(move(INITIAL_SHELL_PANELS, fromMenu, narrow).mobileToolbarMoreOpen, true);
  // Wide phone and desktop have no overflow menu to keep.
  assert.equal(move(INITIAL_SHELL_PANELS, fromMenu, phone).mobileToolbarMoreOpen, false);
  assert.equal(move(INITIAL_SHELL_PANELS, fromMenu, desktop).mobileToolbarMoreOpen, false);
  // A tap from the toolbar itself dismisses the menu.
  const open = move(INITIAL_SHELL_PANELS, { type: "toggle_mobile_more" }, narrow);
  assert.equal(
    move(open, { type: "toggle_top_panel", panel: "session" }, narrow).mobileToolbarMoreOpen,
    false,
  );
});

test("the search shortcut shows the sidebar on every viewport", () => {
  for (const viewport of [desktop, phone, narrow]) {
    const after = run([
      { type: "toggle_mobile_more" },
      { type: "open_top_panel", panel: "tools" },
      { type: "focus_sidebar_for_search" },
    ], viewport);
    assert.equal(after.sidebarOpen, true, JSON.stringify(viewport));
    assert.equal(after.activeTopPanel, null);
    assert.equal(after.mobileToolbarMoreOpen, false);
  }
});

test("closing the right panel never disturbs the rest", () => {
  const open = run([{ type: "open_right_panel" }, { type: "open_top_panel", panel: "agents" }]);
  const closed = move(open, { type: "close_right_panel" });
  assert.equal(closed.rightPanelOpen, false);
  assert.equal(closed.activeTopPanel, "agents");
  assert.equal(closed.sidebarOpen, open.sidebarOpen);
});

test("a panel that lost its reason closes, and leaves a different one alone", () => {
  const branches = move(INITIAL_SHELL_PANELS, { type: "open_top_panel", panel: "branches" });
  assert.equal(move(branches, { type: "close_top_panel_if", panel: "branches" }).activeTopPanel, null);
  // The session lost its subagents, but Branches is what is on screen.
  assert.equal(
    move(branches, { type: "close_top_panel_if", panel: "agents" }).activeTopPanel,
    "branches",
  );
});

test("toggling the sidebar closed does not disturb a phone's other surfaces", () => {
  // Closing is never the thing that covers something, so it clears nothing.
  const state = { ...INITIAL_SHELL_PANELS, sidebarOpen: true, rightPanelOpen: true };
  const closed = move(state, { type: "toggle_sidebar" }, phone);
  assert.equal(closed.sidebarOpen, false);
  assert.equal(closed.rightPanelOpen, true);
});

test("an event that changes nothing returns the same object", () => {
  // Cheap identity checks keep React from re-rendering the whole shell.
  const s = INITIAL_SHELL_PANELS;
  assert.equal(move(s, { type: "close_right_panel" }), s);
  assert.equal(move(s, { type: "close_top_panel" }), s);
  assert.equal(move(s, { type: "close_mobile_more" }), s);
  assert.equal(move(s, { type: "close_top_panel_if", panel: "tools" }), s);
  assert.equal(move({ ...s, sidebarOpen: false }, { type: "close_sidebar" }).sidebarOpen, false);
});

test("every top panel can be opened and closed by name", () => {
  for (const panel of TOP_PANELS) {
    const open = move(INITIAL_SHELL_PANELS, { type: "open_top_panel", panel });
    assert.equal(open.activeTopPanel, panel);
    assert.equal(move(open, { type: "close_top_panel" }).activeTopPanel, null);
  }
});
