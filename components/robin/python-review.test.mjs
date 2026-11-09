import assert from "node:assert/strict";
import test from "node:test";
import { addDays } from "../../extension/robin/dates.ts";
import { PYTHON_REVIEW_DAYS, pythonReviewForWeek } from "./python-review.ts";
import { PYTHON_REVIEW_CARDS } from "./python-review-cards.ts";

test("the accelerated outline covers every day through the backend transition", () => {
  assert.equal(PYTHON_REVIEW_DAYS.length, 19);
  for (const [index, item] of PYTHON_REVIEW_DAYS.entries()) {
    assert.equal(item.date, addDays("2026-11-04", index));
    for (const key of ["zh", "en", "focusZh", "focusEn"]) assert.ok(item[key].length > 0, `${item.date}: ${key}`);
  }
  assert.deepEqual(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"].map((week) => pythonReviewForWeek(week).length), [5, 7, 7, 0]);
  assert.equal(PYTHON_REVIEW_CARDS.length, 19);
  for (const [index, card] of PYTHON_REVIEW_CARDS.entries()) {
    assert.equal(card.date, PYTHON_REVIEW_DAYS[index].date);
    for (const key of ["lessonZh", "lessonEn", "code"]) {
      assert.ok(card[key].length > 10, `${card.date}: ${key} must contain real study material`);
    }
  }
  const outline = PYTHON_REVIEW_DAYS.map(({ zh, focusZh }) => `${zh} ${focusZh}`).join(" ");
  for (const topic of ["f-string", "maketrans", "zip", "字典", "集合", "pdb", "@property", "Big O", "二分查找", "BFS/DFS", "heapq", "DP"]) {
    assert.ok(outline.includes(topic), `missing ${topic}`);
  }
});
