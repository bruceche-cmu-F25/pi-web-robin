import assert from "node:assert/strict";
import { test } from "node:test";
import { dashboardPositions } from "./useDashboardLayout.ts";

const ids = ["calendar", "dashboard-todos", "dashboard-attention", "dashboard-jobs", "fullstack-open", "dashboard-links"];
const cards = (heights) => heights.map((height, index) => ({ id: ids[index], height }));
test("only tasks and links use the wide sidebar; long lists do not push the main lane", () => {
  for (const taskHeight of [100, 2400]) {
    const positions = dashboardPositions(3, cards([800, taskHeight, 120, 300, 500, 3000]), 20);
    assert.deepEqual(positions.map((item) => item.top), [0, 0, 820, 960, 1280, taskHeight + 20]);
    assert.deepEqual(positions.map((item) => item.column), ["1 / span 2", "3 / span 1", "1 / span 2", "1 / span 2", "1 / span 2", "3 / span 1"]);
  }
});
test("two columns share a full-width calendar, then advance independently", () => {
  const positions = dashboardPositions(2, cards([800, 2400, 120, 300, 500, 3000]), 16);
  assert.deepEqual(positions.map((item) => item.top), [0, 816, 816, 952, 1268, 3232]);
});
test("work queue sits immediately below the calendar without pushing the sidebar down", () => {
  const cards = [
    { id: "calendar", height: 800 }, { id: "dashboard-work-queue", height: 350 },
    { id: "dashboard-todos", height: 1000 }, { id: "dashboard-attention", height: 200 },
  ];
  assert.deepEqual(dashboardPositions(3, cards, 20).map((item) => item.top), [0, 820, 0, 1190]);
  assert.deepEqual(dashboardPositions(2, cards, 16).map((item) => item.top), [0, 816, 816, 1182]);
});
test("hidden attention/jobs consume no row or gutter and do not change other identities", () => {
  const visible = cards([300.2, 80.1, 0, 0, 400, 800]).filter((item) => item.height > 0);
  const positions = dashboardPositions(3, visible, 20);
  assert.deepEqual(positions.map((item) => item.top), [0, 0, 321, 101]);
  assert.equal(positions[2].column, "1 / span 2");
});
