// Run in an authenticated disposable browser on about:blank:
// playwright-cli -s=practice-check run-code --filename=scripts/check-practice-ui.playwright.js
// All practice writes and embedded pages are mocked; no user history changes.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Evaluated by Playwright CLI.
async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  await page.unroute("**/api/robin/practice");
  page.on("pageerror", (error) => errors.push(error.message));
  const today = "2026-09-08";
  let currentSlug = "two-sum";
  const records = [{ slug: "two-sum", status: "solved", updatedAt: "2026-09-01T12:00:00Z", nextReviewOn: today, scheduleVersion: 2,
    attempts: [{ at: "2026-09-01T12:00:00Z", on: "2026-09-01", outcome: "solved", hintLevel: 0, confidence: 4 }] }];
  let failNext = true;
  let writes = 0;
  const requests = [];
  await page.route("https://neetcode.io/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Mock problem</h1>" }));
  await page.route("**/api/robin/practice", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      requests.push(route.request().postDataJSON());
      if (failNext) {
        failNext = false;
        return route.fulfill({ status: 500, json: { error: "Test save failed" } });
      }
      writes++;
      const input = route.request().postDataJSON();
      check(input.problem === "two-sum" && input.outcome === "solved" && input.hintLevel === 0, "Explicit independent result must reach POST");
      records[0].attempts.push({ at: `${today}T12:00:00Z`, on: today, kind: "review", ...input });
      records[0].nextReviewOn = "2026-09-11";
      return route.fulfill({ json: { record: records[0], today } });
    }
    if (method === "PATCH") {
      const patch = route.request().postDataJSON();
      if (patch.current) currentSlug = patch.problem;
      if (patch.status) records[0].status = patch.status;
    }
    await route.fulfill({ json: { records, today, currentSlug, list: "neetcode150" } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://127.0.0.1:30141/coding?track=problems&problem=two-sum&list=neetcode150");
  await page.evaluate(() => localStorage.setItem("pi-locale", "zh-CN"));
  await page.reload();
  const bar = page.locator("#practice-record");
  await bar.waitFor();
  check((await bar.innerText()).includes("独立完成 1/6 遍"), "Existing history must show round counts");
  const plan = page.getByRole("region", { name: "今日刷题安排" });
  check((await plan.innerText()).includes("新题 0/1 · 复习 0/3"), "Rail must expose both daily budgets");
  await bar.getByRole("button", { name: /独立做出/ }).click();
  await bar.getByRole("alert").filter({ hasText: "Test save failed" }).waitFor();
  check(writes === 0 && records[0].attempts.length === 1, "A failure cannot inflate progress");
  await bar.getByRole("button", { name: /独立做出/ }).click();
  await bar.getByRole("status").waitFor();
  check((await bar.innerText()).includes("累计练习 2 次"), "Successful save refreshes counts");
  check((await bar.innerText()).includes("独立完成 2/6 遍"), "Successful recall adds one round");
  check(await bar.getByRole("button", { name: /独立做出/ }).isDisabled(), "Saved sitting cannot be accidentally logged again");
  check((await plan.innerText()).includes("复习 1/3"), "Review completion updates today's budget");
  await page.reload();
  await bar.waitFor();
  check((await bar.innerText()).includes("累计练习 2 次"), "Refresh preserves saved progress");
  await bar.getByText("最近 6 次练习", { exact: true }).click();
  check((await bar.innerText()).includes("2026-09-08 · 做出"), "Recent history is accessible");
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: /记录本次练习/ }).click();
    await bar.waitFor({ state: "visible" });
    check(await page.evaluate(() => {
      const el = document.getElementById("practice-record");
      return el.getBoundingClientRect().right <= innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1;
    }), `Record controls overflow at ${width}px`);
    check(await bar.getByRole("button", { name: /独立做出/ }).isVisible(), `Phone record shortcut must reveal controls at ${width}px`);
  }
  check(writes === 1 && requests.length === 2, "Exactly one successful attempt must be recorded");
  check(errors.length === 0, `Browser exceptions: ${errors.join(", ")}`);
  return "PASS: historical counts, daily budgets, failure/retry, explicit attempt POST, duplicate guard, refresh/history, mobile record shortcut at 375/768/1440px";
}
