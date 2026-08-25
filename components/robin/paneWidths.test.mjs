import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_CENTRE_WIDTH,
  PANEL_LIMITS,
  RAIL_LIMITS,
  clampPaneWidth,
  parseStoredWidth,
} from "./paneWidths.ts";

/** A roomy window with the other side pane at its default. */
const roomy = { viewport: 1600, otherPane: PANEL_LIMITS.preferred };

test("a width inside the limits is taken as asked", () => {
  assert.equal(clampPaneWidth(340, RAIL_LIMITS, roomy), 340);
  assert.equal(clampPaneWidth(340.6, RAIL_LIMITS, roomy), 341);
});

test("the limits hold at both ends", () => {
  assert.equal(clampPaneWidth(20, RAIL_LIMITS, roomy), RAIL_LIMITS.min);
  assert.equal(clampPaneWidth(9999, RAIL_LIMITS, roomy), RAIL_LIMITS.max);
});

/**
 * The centre pane holds a whole third-party application — an editor and a
 * judge, or someone else's documentation site. Letting the rail eat it is not
 * a smaller version of the workspace, it is the workspace gone.
 */
test("the centre pane cannot be squeezed away", () => {
  const tight = { viewport: 1000, otherPane: 360 };
  const width = clampPaneWidth(600, RAIL_LIMITS, tight);

  assert.equal(width, 1000 - 360 - MIN_CENTRE_WIDTH);
  assert.ok(1000 - 360 - width >= MIN_CENTRE_WIDTH);
});

/**
 * On a window too narrow for all three, something has to overflow. Better the
 * centre, which scrolls, than a rail clamped to an unreadable sliver that
 * still costs its own width.
 */
test("an impossible window keeps the rail legible rather than the centre intact", () => {
  const cramped = { viewport: 600, otherPane: 360 };

  assert.equal(clampPaneWidth(400, RAIL_LIMITS, cramped), RAIL_LIMITS.min);
  assert.equal(clampPaneWidth(20, RAIL_LIMITS, cramped), RAIL_LIMITS.min);
});

test("hiding the rail hands its room to the panel", () => {
  const withRail = { viewport: 1200, otherPane: 288 };
  const withoutRail = { viewport: 1200, otherPane: 0 };

  assert.ok(clampPaneWidth(700, PANEL_LIMITS, withoutRail)
    > clampPaneWidth(700, PANEL_LIMITS, withRail));
  assert.equal(clampPaneWidth(700, PANEL_LIMITS, withoutRail), 700);
});

test("an unusable stored value falls back to the preferred width", () => {
  // localStorage holds strings written by earlier versions and by hand.
  assert.equal(parseStoredWidth(null, RAIL_LIMITS), RAIL_LIMITS.preferred);
  assert.equal(parseStoredWidth("", RAIL_LIMITS), RAIL_LIMITS.preferred);
  assert.equal(parseStoredWidth("wide", RAIL_LIMITS), RAIL_LIMITS.preferred);
  assert.equal(parseStoredWidth("312", RAIL_LIMITS), 312);
});

test("a stored width still goes through the clamp before it is used", () => {
  // Windows change size between visits; a width that fitted last time is only
  // a request this time.
  const stored = parseStoredWidth("500", RAIL_LIMITS);
  assert.equal(clampPaneWidth(stored, RAIL_LIMITS, { viewport: 900, otherPane: 300 }), 280);
});
