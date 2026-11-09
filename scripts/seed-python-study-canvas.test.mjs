import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// The seed is an explicit one-time operation; tests never write the user's boards.
test("Python study canvas has readable Q/A rows and reruns never overwrite edits", () => {
  const dir = mkdtempSync(join(tmpdir(), "python-canvas-"));
  const run = () => execFileSync(process.execPath, ["--experimental-strip-types", new URL("./seed-python-study-canvas.mjs", import.meta.url).pathname], {
    env: { ...process.env, ROBIN_DATA_DIR: dir }, encoding: "utf8",
  });
  try {
    assert.match(run(), /Created 17 chapters/);
    const files = readdirSync(join(dir, "canvases"));
    assert.equal(files.length, 1);
    const board = JSON.parse(readFileSync(join(dir, "canvases", files[0]), "utf8"));
    assert.equal(board.title, "freeCodeCamp · Python 互动学习笔记");
    assert.equal(board.revision, 1);
    const texts = board.scene.elements.filter((element) => element.type === "text");
    assert.equal(texts.length, 3 + 17 * 3);
    for (const topic of ["字符串与切片", "函数 / 参数", "字典与集合", "图 / 树", "动态规划"]) {
      assert.ok(texts.some((element) => element.text.includes(topic)), topic);
    }
    assert.ok(texts.some((element) => element.text.includes("先自己回答")));
    const rectangles = board.scene.elements.filter((element) => element.type === "rectangle");
    assert.ok(rectangles.every((element) => element.width > 0 && element.height > 0));
    assert.equal(new Set(board.scene.elements.map((element) => element.index)).size, board.scene.elements.length);
    for (let i = 0; i < board.scene.elements.length; i += 2) {
      assert.deepEqual(board.scene.elements[i].groupIds, board.scene.elements[i + 1].groupIds);
    }
    for (const element of rectangles) {
      const next = rectangles.find((other) => other.x === element.x && other.y > element.y);
      if (next) assert.ok(element.y + element.height < next.y, `overlap at x=${element.x}`);
    }
    assert.match(run(), /Already exists \(left untouched\)/);
    assert.equal(readdirSync(join(dir, "canvases")).length, 1);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "canvases", files[0]), "utf8")), board);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
