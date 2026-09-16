// Run in an authenticated disposable tab:
// playwright-cli -s=dashboard run-code --filename=scripts/check-todo-categories.playwright.js
// Synthetic todos; ALL API writes are intercepted.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Evaluated by Playwright CLI.
async (page) => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const today = "2026-09-09";
  const todos = [
    ...Array.from({ length: 9 }, (_, i) => ({ id: `overdue-${i}`, title: `逾期待办 ${i}`, due: "2026-09-08", done: false })),
    { id: "today", title: "今天的任务", due: today, done: false },
    { id: "tomorrow", title: "明天的任务", due: "2026-09-10", done: false },
    { id: "week", title: "本周的任务", due: "2026-09-11", done: false },
    { id: "later", title: "以后的任务", due: "2026-10-01", done: false },
    { id: "none", title: "没有日期的任务", done: false },
    { id: "done", title: "今天已经完成", done: true, completedAt: new Date(`${today}T12:00:00`).toISOString() },
  ];
  const writes = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = request.url().replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    if (request.method() !== "GET") {
      writes.push(path);
      if (path === "/api/robin/todos" && request.method() === "PATCH") {
        const patch = request.postDataJSON();
        Object.assign(todos.find((todo) => todo.id === patch.id), patch, { completedAt: new Date(`${today}T12:00:00`).toISOString() });
      }
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/robin/todos") return route.fulfill({ json: { todos, today } });
    if (path === "/api/robin/events") return route.fulfill({ json: { events: [], today, google: { connected: false } } });
    if (path === "/api/robin/links") return route.fulfill({ json: { links: [] } });
    return route.continue();
  });
  await page.addInitScript(() => {
    localStorage.setItem("pi-locale", "zh-CN");
    localStorage.setItem("robin-calendar-view", "week");
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("http://127.0.0.1:30141/dashboard");
  const panel = (name) => page.locator("section.pi-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
  const todoPanel = panel("待办");
  await todoPanel.getByText("今天的任务", { exact: true }).waitFor();
  const groups = todoPanel.locator(":scope > details");
  const visibleTasks = () => todoPanel.locator('input[type="checkbox"]:visible').count();
  check(await groups.count() === 7, "Every category, including completed, has its own disclosure");
  check(await visibleTasks() === todos.length, "Every category defaults open; no preview cap");
  check(await todoPanel.getByText("没有日期的任务", { exact: true }).isVisible(), "Undated tasks are visible by default");
  const calendarBefore = await panel("日历").boundingBox();
  const overdue = groups.first().locator(":scope > summary");
  check(await overdue.evaluate((el) => {
    const height = el.getBoundingClientRect().height;
    return matchMedia("(pointer: coarse)").matches ? height >= 44 : height >= 24 && height <= 30;
  }), "Category header is slim on desktop and touch-sized on coarse pointers");
  await overdue.focus();
  await overdue.press("Enter");
  check(await visibleTasks() === todos.length - 9, "Overdue can collapse independently of other categories");
  const calendarAfter = await panel("日历").boundingBox();
  check(calendarBefore.width === calendarAfter.width && calendarBefore.height === calendarAfter.height, "Calendar geometry unchanged");
  await overdue.press("Enter");
  check(await visibleTasks() === todos.length, "Keyboard reopens all overdue rows");
  for (const group of await groups.all()) {
    if (!await group.evaluate((el) => el.open)) await group.locator(":scope > summary").click();
  }
  check(await visibleTasks() === todos.length, "Every task reachable after expanding categories");
  check(writes.length === 0, "Collapsing never changes stored todos");
  for (const group of await groups.all()) await group.locator(":scope > summary").click();
  check(await visibleTasks() === 0, "All categories can be collapsed");
  check(await groups.locator(":scope > summary").count() === 7, "Counts remain available while collapsed");

  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => document.documentElement.classList.toggle("dark", value === "dark"), theme);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const boxes = await Promise.all(["日历", "待办", "求职", "学习中心", "链接"].map((name) => panel(name).boundingBox()));
      for (let i = 1; i < boxes.length; i++) {
        check(Math.abs(boxes[i].x - boxes[0].x) < 2 && Math.abs(boxes[i].width - boxes[0].width) < 2, "Original full-width layout restored");
        check(boxes[i].y >= boxes[i - 1].y + boxes[i - 1].height, "Original single-column panel order restored");
      }
      check(await page.locator(".robin-dashboard").evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `No horizontal overflow: ${theme}/${width}`);
    }
  }
  await groups.nth(1).locator(":scope > summary").click();
  await todoPanel.getByRole("checkbox", { name: "完成 今天的任务", exact: true }).click();
  await todoPanel.getByText("13 项未完成", { exact: true }).waitFor();
  check(!await groups.first().evaluate((el) => el.open), "A refresh does not reopen the collapsed overdue category");
  check(await visibleTasks() === 0, "Completed item moves into folded history");
  await todoPanel.locator("summary").filter({ hasText: "2 项已完成" }).click();
  await todoPanel.getByRole("checkbox", { name: "重新打开 今天的任务", exact: true }).click();
  await todoPanel.getByText("14 项未完成", { exact: true }).waitFor();
  check(await todoPanel.getByRole("checkbox", { name: "完成 今天的任务", exact: true }).isVisible(), "Reopened task returns to Today");
  check(writes.length === 2 && writes.every((path) => path === "/api/robin/todos"), "Only mocked completion/reopen writes");
  return "PASS: original single-column layout, all seven categories independently collapsible, no preview cap, keyboard access, counts, refresh stability, completion/reopen, light/dark mobile/desktop; writes mocked";
}
