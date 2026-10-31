import assert from "node:assert/strict";
import test from "node:test";
import { drawerResistance, drawerSpring, drawerTarget, drawerVelocity } from "./drawer-motion.ts";

test("landing follows projected momentum, not just the release position", () => {
  assert.equal(drawerTarget(-40, 0, 232), 0);
  assert.equal(drawerTarget(-40, -1000, 232), -232);
  assert.equal(drawerTarget(-180, 1000, 232), 0);
  assert.equal(drawerTarget(-180, 0, 232), -232);
});
test("spring carries velocity and is frame-rate independent", () => {
  assert.deepEqual(drawerSpring(-40, -500, -232, 0), { x: -40, velocity: -500 });
  const full = drawerSpring(-40, -500, -232, 0.1);
  const half = drawerSpring(-40, -500, -232, 0.05);
  const second = drawerSpring(half.x, half.velocity, -232, 0.05);
  assert.ok(Math.abs(second.x - full.x) < 1e-8);
  assert.ok(Math.abs(second.velocity - full.velocity) < 1e-8);
  const rest = drawerSpring(-40, -500, -232, 1);
  assert.ok(Math.abs(rest.x + 232) < 0.01);
});
test("soft edges are continuous, and a held gesture does not fling on release", () => {
  assert.equal(drawerResistance(-100, 232), -100);
  assert.equal(drawerResistance(0, 232), 0);
  assert.ok(drawerResistance(100, 232) > 0 && drawerResistance(100, 232) < 100);
  assert.ok(drawerResistance(-300, 232) < -232 && drawerResistance(-300, 232) > -300);
  const samples = [{ x: 0, time: 0 }, { x: -30, time: 50 }, { x: -50, time: 100 }];
  assert.equal(drawerVelocity(samples, 100), -500);
  assert.equal(drawerVelocity(samples, 200), 0);
  assert.equal(drawerVelocity([{ x: 0, time: 0 }], 0), 0);
});
