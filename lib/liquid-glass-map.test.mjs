import assert from "node:assert/strict";
import test from "node:test";
import { createGlassMap } from "./liquid-glass-map.ts";

const pixel = (map, x, y) => [...map.data.slice((y * map.width + x) * 4, (y * map.width + x) * 4 + 4)];
test("a rounded lens bends inward at the rim but leaves the centre and outside neutral", () => {
  const map = createGlassMap(160, 80, 28);
  assert.deepEqual(pixel(map, 80, 40), [128, 128, 128, 255]);
  assert.deepEqual(pixel(map, 0, 0), [128, 128, 128, 255]);
  assert.ok(pixel(map, 2, 40)[0] > 128);
  assert.ok(pixel(map, 157, 40)[0] < 128);
  assert.ok(pixel(map, 80, 2)[1] > 128);
  assert.ok(pixel(map, 80, 77)[1] < 128);
  assert.equal(map.scale, 36);
  assert.ok(pixel(map, 10, 40)[0] > pixel(map, 1, 40)[0], 'The lip peaks inside the rim, not on the white edge');
  assert.ok(pixel(map, 10, 40)[0] > pixel(map, 20, 40)[0], 'Refraction eases back toward the flat centre');
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    assert.equal(pixel(map, x, y)[0] + pixel(map, map.width - x - 1, y)[0], 256);
    assert.equal(pixel(map, x, y)[1] + pixel(map, x, map.height - y - 1)[1], 256);
  }
});
test("map storage is bounded and long pills retain their thin-axis detail", () => {
  assert.equal(createGlassMap(7680, 4320, 28).data.byteLength, 256 * 256 * 4);
  const pill = createGlassMap(1600, 44, 999);
  assert.equal(pill.width, 256);
  assert.equal(pill.height, 44);
  assert.ok(pill.scale < 36 && pill.scale <= 44 * 0.56, 'Narrow controls limit sampling to their bezel');
  assert.deepEqual(pill, createGlassMap(1600, 44, 22));
  assert.ok(pixel(pill, 128, 1)[1] > 128);
  assert.deepEqual(pixel(pill, 128, 22), [128, 128, 128, 255]);
});
test("invalid geometry is refused, small finite surfaces remain finite", () => {
  for (const args of [[0, 30, 2], [-1, 10, 1], [NaN, 10, 1], [10, Infinity, 1], [10, 10, -2]]) {
    assert.throws(() => createGlassMap(...args), RangeError);
  }
  const tiny = createGlassMap(0.5, 0.5, 999);
  assert.ok(Number.isFinite(tiny.scale));
  assert.equal(tiny.data.length, 4);
});
