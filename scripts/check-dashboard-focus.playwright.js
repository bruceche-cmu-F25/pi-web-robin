// Run in an authenticated disposable browser:
// playwright-cli -s=dashboard-focus run-code --filename=scripts/check-dashboard-focus.playwright.js
// All API writes are intercepted; no AI run or real learning update occurs.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Playwright CLI evaluates this function.
async (page) => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const problem = { problem: "Contains Duplicate", link: "contains-duplicate", difficulty: "Easy" };
  const next = { id: "test-reading", part: 0, kind: "reading", title: "General info", url: "https://fullstackopen.com/en/part0/general_info" };
  const upcoming = { id: "test-exercise", part: 0, kind: "exercise", title: "0.1: HTML", url: "https://fullstackopen.com/en/part0/fundamentals_of_web_apps" };
  const snapshot = {
    practice: { list: "neetcode150", next: problem, stats: { solved: 0, total: 150 }, daily: {
      today: "2026-09-09", newProblems: [problem], reviews: [], newDone: 0, newTarget: 1, reviewDone: 0, reviewTarget: 3,
      dueCount: 0, rounds: 0, roundTarget: 900,
    } },
    fullstack: { next, upcoming: [upcoming], completed: 0, total: 2, completedIds: [], lastCompleted: null,
      currentPart: { part: 0, completed: 0, total: 2, topics: ["Web fundamentals"], byKind: [{ kind: "reading", completed: 0, total: 1 }] },
    },
  };
  let aiCalls = 0;
  let failAI = true;
  let releaseAI;
  const writes = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = request.url().replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    if (request.method() !== "GET") {
      writes.push(path);
      if (path === "/api/robin/assistant") {
        aiCalls++;
        check(request.postDataJSON().message === "daily", "Explicit execute mode sends even route-like instructions to Pi");
        if (failAI) return route.fulfill({ status: 503, json: { error: "Test assistant unavailable" } });
        await new Promise((resolve) => { releaseAI = resolve; });
        return route.fulfill({ json: { reply: "Mock reply", usedTools: [] } });
      }
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/robin/learning") return route.fulfill({ json: snapshot });
    if (path === "/api/robin/links") return route.fulfill({ json: { links: [
      { id: "test-link", title: "测试资料", url: "https://example.com", iconCheckedAt: "2026-09-09T00:00:00Z" },
    ] } });
    if (path === "/api/robin/todos") return route.fulfill({ json: { todos: [], today: "2026-09-09" } });
    return route.continue();
  });
  await page.addInitScript(() => {
    localStorage.setItem("pi-locale", "zh-CN");
    localStorage.setItem("pi-theme", "dark");
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://127.0.0.1:30141/dashboard?session=audit-session");
  const bar = page.locator(".robin-dashboard-header .robin-assistant-bar");
  const input = bar.getByRole("textbox");
  await input.fill("测试");
  const results = bar.getByRole("region", { name: "全局搜索结果" });
  await results.getByRole("link", { name: /测试资料/ }).waitFor();
  await input.press("Enter");
  check(await results.getByRole("link").first().evaluate((el) => document.activeElement === el), "Search Enter focuses the first result");
  check(aiCalls === 0, "Search Enter cannot execute AI");
  await input.fill("没有匹配的测试xyz987");
  await bar.getByRole("status").filter({ hasText: "没有匹配" }).waitFor();
  await input.press("Enter");
  check(aiCalls === 0, "Empty search results cannot fall through to AI");
  await input.fill("daily");
  check(await bar.locator("a").first().getAttribute("href") === "/dashboard?session=audit-session", "Search commands preserve workspace context");
  await bar.getByRole("button", { name: "让 Pi 执行", exact: true }).click();
  check(await input.getAttribute("aria-describedby"), "Instruction has a mode-specific hint");
  check(await input.getAttribute("name") === "instruction", "Execution is an explicit input mode");
  await input.evaluate((el) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })));
  check(aiCalls === 0, "IME confirmation cannot execute AI");
  await input.press("Enter");
  await bar.getByRole("alert").filter({ hasText: "Test assistant unavailable" }).waitFor();
  check(await input.inputValue() === "daily" && aiCalls === 1, "Failed execution retains text for retry");
  failAI = false;
  await bar.getByRole("button", { name: "执行", exact: true }).click();
  await bar.getByRole("status").filter({ hasText: "处理中" }).waitFor();
  check(await input.isDisabled(), "Executing state disables editing");
  await input.evaluate((el) => el.form.requestSubmit());
  check(aiCalls === 2, "Concurrent submits are ignored");
  releaseAI();
  await bar.getByText("Mock reply", { exact: true }).waitFor();
  check(await input.evaluate((el) => document.activeElement === el), "Reply restores input focus");
  await bar.getByRole("button", { name: "搜索", exact: true }).click();

  const learning = page.locator("#fullstack-open");
  const course = learning.locator("article").filter({ hasText: "Full Stack Open" });
  const practice = learning.locator("article").filter({ hasText: "NeetCode" });
  const startNew = practice.getByRole("link", { name: /开始今天的新题/ });
  await startNew.waitFor();
  check((await startNew.getAttribute("href")).includes("problem=contains-duplicate"), "Primary practice action opens the daily problem");
  check(await course.getByRole("link", { name: /继续当前课程/ }).getAttribute("href") === next.url, "Primary course action opens current checkpoint");
  check(!(await course.getByRole("region", { name: "接下来", exact: true }).isVisible()), "Course preview starts collapsed");
  await course.locator("summary").filter({ hasText: "章节详情与后续预览" }).click();
  await course.getByRole("region", { name: "接下来", exact: true }).waitFor();
  await practice.locator("summary").filter({ hasText: "今日安排与进度" }).click();
  await practice.getByRole("region", { name: "今日刷题安排", exact: true }).waitFor();
  check(writes.length === 2, "Opening details never writes learning progress");
  await course.locator("summary").click();
  await practice.locator("summary").first().click();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => document.documentElement.classList.toggle("dark", value === "dark"), theme);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const element of [bar, learning]) {
        check(await element.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= innerWidth + 1), `No overflow: ${theme}/${width}`);
      }
    }
  }
  await learning.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/dashboard-focus-learning.png" });
  await page.locator(".robin-dashboard").evaluate((el) => { el.scrollTop = 0; });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/dashboard-focus-search-mobile.png" });

  snapshot.practice.daily.newProblems = [];
  snapshot.practice.daily.reviews = [problem];
  await page.reload();
  await practice.getByRole("link", { name: /开始今天的复习/ }).waitFor();
  snapshot.practice.daily.reviews = [];
  snapshot.fullstack.next = null;
  snapshot.fullstack.upcoming = [];
  snapshot.fullstack.currentPart = null;
  await page.reload();
  await practice.getByText("今天安排的练习已经完成。", { exact: true }).waitFor();
  check(await course.getByRole("link", { name: /继续当前课程/ }).count() === 0, "Completed course has no stale primary action");
  await page.keyboard.press("Control+k");
  const palette = page.locator("dialog.robin-command-dialog");
  await palette.waitFor();
  check(await palette.getByRole("button", { name: "搜索", exact: true }).first().getAttribute("aria-pressed") === "true", "Command palette also defaults to safe search");
  await page.keyboard.press("Escape");
  check(writes.length === 2, "Only two explicitly requested, mocked AI attempts occurred");
  return "PASS: read-only search/Enter/no-results, command context, explicit execution, IME, duplicate guard, failure/retry/status/focus, daily new/review/clear states, course CTA/completion, collapsed details, palette default, light/dark 320–1440px; all writes mocked";
}
