// Run in the authenticated disposable practice-layout browser:
// playwright-cli -s=practice-layout run-code --filename=scripts/check-practice-ui.playwright.js
// All practice writes and embedded documents are mocked; no user history changes.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Evaluated by Playwright CLI.
async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  await page.unroute("**/api/robin/practice");
  await page.unroute("https://neetcode.io/**");
  page.on("pageerror", (error) => errors.push(error.message));
  const today = "2026-09-08";
  let currentSlug = null;
  let list = "neetcode150";
  let failNext = true;
  let failSelection = false;
  let writes = 0;
  let frameLoads = 0;
  const records = [{ slug: "two-sum", status: "solved", updatedAt: "2026-09-01T12:00:00Z", nextReviewOn: today, scheduleVersion: 2,
    attempts: [{ at: "2026-09-01T12:00:00Z", on: "2026-09-01", outcome: "solved", hintLevel: 0, confidence: 4 }] }];
  await page.route("https://neetcode.io/**", (route) => {
    frameLoads++;
    return route.fulfill({ contentType: "text/html", body: '<h1>Mock problem</h1><textarea aria-label="Code editor"></textarea>' });
  });
  await page.route("**/api/robin/practice", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      if (failNext) {
        failNext = false;
        return route.fulfill({ status: 500, json: { error: "Test save failed" } });
      }
      const input = route.request().postDataJSON();
      check(input.problem === "two-sum", "Record the open problem only");
      writes++;
      records[0].attempts.push({ at: `${today}T12:0${writes}:00Z`, on: today, kind: "review", ...input });
      records[0].nextReviewOn = input.confidence < 3 ? "2026-09-09" : "2026-09-11";
      return route.fulfill({ json: { record: records[0], today } });
    }
    if (method === "PATCH") {
      const input = route.request().postDataJSON();
      if (input.current && failSelection) {
        failSelection = false;
        return route.fulfill({ status: 500, json: { error: "Test selection failed" } });
      }
      if (input.current) currentSlug = input.problem;
      if (input.list) list = input.list;
      if (input.status) records[0].status = input.status;
    }
    await route.fulfill({ json: { records, today, currentSlug, list } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://127.0.0.1:30141/coding?list=neetcode150");
  await page.evaluate(() => localStorage.setItem("pi-locale", "zh-CN"));
  await page.reload();
  const map = page.locator("#practice-roadmap");
  const tree = page.getByRole("region", { name: "刷题题型树" });
  const panel = page.locator("#practice-topic-problems");
  const desk = page.locator("#practice-desk");
  const bar = page.locator("#practice-record");
  const search = page.getByRole("searchbox", { name: "搜索题名或题型" });
  await tree.getByRole("button", { name: /^Arrays & Hashing/ }).waitFor();
  check(await tree.getByRole("button").count() === 18, "All 18 NeetCode 150 topics are present");
  check(!await desk.isVisible() && frameLoads === 0, "Fresh entry shows the roadmap, not a second embedded roadmap");
  check(await map.locator("h1").evaluate((el) => el.getBoundingClientRect().top < innerHeight), "Full roadmap is the entry point");
  await map.getByRole("button", { name: "全部", exact: true }).click();
  await tree.getByRole("button", { name: /^JavaScript/ }).waitFor();
  check(await tree.getByRole("button").count() === 19, "All list includes the separate JavaScript topic");
  await map.getByRole("button", { name: "NC 150", exact: true }).click();
  await tree.getByRole("button", { name: /^Arrays & Hashing/ }).click();
  await page.waitForFunction(() => document.activeElement?.id === "practice-topic-problems");
  check((await panel.innerText()).includes("Two Sum"), "Clicking a node opens its problems below the tree");
  check(await tree.getByRole("button", { name: /^Arrays & Hashing/ }).getAttribute("aria-pressed") === "true", "Selected topic has a semantic state");
  await search.fill("longest substring");
  check(await panel.getByRole("button", { name: /Longest Substring Without Repeating Characters/ }).count() === 1, "Search crosses topic boundaries");
  await search.fill("not-a-problem-12345");
  await panel.getByRole("status").waitFor();
  await search.fill("two sum");
  await panel.getByRole("button", { name: /^Two Sum Easy/ }).click();
  await page.waitForFunction(() => document.activeElement?.id === "practice-desk");
  const editor = page.frameLocator('iframe[title="NeetCode"]').getByRole("textbox", { name: "Code editor" });
  await editor.fill("my unfinished solution");
  const loaded = frameLoads;
  const coachInput = page.locator("#practice-coach textarea");
  await coachInput.fill("unfinished coach question");
  check(await bar.evaluate((el) => !el.closest("#practice-coach")), "Recording lives below the desk, never inside Coach");
  check((await bar.boundingBox()).y >= (await desk.boundingBox()).y + (await desk.boundingBox()).height, "Recording follows the practice stage");
  await page.getByRole("button", { name: "返回路线", exact: true }).click();
  check(await search.inputValue() === "two sum", "Returning to roadmap retains search");
  check(frameLoads === loaded && await editor.inputValue() === "my unfinished solution", "Browsing the roadmap retains the editor document");
  failSelection = true;
  await panel.getByRole("button", { name: /^Two Sum II/ }).click();
  await page.getByRole("alert").filter({ hasText: "Test selection failed" }).waitFor();
  check(currentSlug === "two-sum" && frameLoads === loaded, "Failed selection must not replace the existing frame");
  await page.getByRole("button", { name: "继续练习 · Two Sum ↓" }).click();
  const divider = page.getByRole("separator");
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  const width = (await page.locator("#practice-coach").boundingBox()).width;
  await page.getByRole("button", { name: "收起 Coach" }).click();
  check(!await coachInput.isVisible(), "Coach can be collapsed independently");
  await page.getByRole("button", { name: "展开 Coach" }).click();
  check((await page.locator("#practice-coach").boundingBox()).width === width, "Restoring Coach retains its resized width");
  const focusButton = page.getByRole("button", { name: "专注模式", exact: true });
  await focusButton.click();
  check(!await map.isVisible() && !await coachInput.isVisible() && !await bar.isVisible(), "Focus removes planning, recording and Coach");
  check(!await page.locator("#robin-navigation").isVisible(), "Focus hides global navigation");
  check((await page.locator('iframe[title="NeetCode"]').boundingBox()).width >= 1400, "Focus gives width back to editor");
  await page.keyboard.press("Escape");
  check(await coachInput.inputValue() === "unfinished coach question", "Focus retains Coach draft");
  check(frameLoads === loaded && await editor.inputValue() === "my unfinished solution", "Focus does not remount iframe");
  const recordButton = page.getByRole("button", { name: "记录本次练习", exact: true });
  await recordButton.click();
  await page.waitForFunction(() => document.activeElement?.id === "practice-record");
  const rounds = bar.getByRole("progressbar", { name: /独立完成/ });
  check(await rounds.getAttribute("aria-valuenow") === "1", "Rounds reflect the saved history");
  check(await bar.getByRole("button", { name: "保存记录", exact: true }).isDisabled(), "Nothing can be saved before choosing a result");
  await bar.getByRole("button", { name: "独立做出", exact: true }).click();
  check(writes === 0 && (await bar.innerText()).includes("独立完成 1 → 2 遍"), "Choosing a result previews the rounds before any write");
  await bar.getByRole("button", { name: "保存记录", exact: true }).click();
  await bar.getByRole("alert").filter({ hasText: "Test save failed" }).waitFor();
  check(writes === 0 && await rounds.getAttribute("aria-valuenow") === "1", "Failure cannot inflate progress");
  check(await bar.getByRole("button", { name: "独立做出", exact: true }).getAttribute("aria-pressed") === "true", "A failed save keeps the chosen result");
  await bar.getByRole("button", { name: "独立做出", exact: true }).click();
  await bar.getByRole("button", { name: "保存记录", exact: true }).click();
  await bar.getByRole("status").waitFor();
  check(await rounds.getAttribute("aria-valuenow") === "2", "Successful save immediately updates rounds");
  check(await bar.locator("[data-attempt-result]").count() === 2, "Recent outcome trail updates");
  check(await bar.getByRole("button", { name: "独立做出", exact: true }).isDisabled(), "Duplicate logging is guarded");
  check((await map.innerText()).includes("复习 1/3"), "Today's plan updates in the roadmap");
  await bar.getByRole("button", { name: "返回练习区" }).click();
  await page.waitForFunction(() => document.activeElement?.id === "practice-desk");
  check(await page.evaluate(() => document.documentElement.scrollTop === 0) && (await page.locator("#robin-navigation").boundingBox()).y === 0,
    "Jumping back to the desk never scrolls global navigation away");
  await recordButton.click();
  check(await bar.getByRole("button", { name: "独立做出", exact: true }).isDisabled(), "Moving between sections keeps the duplicate guard");
  await bar.getByRole("button", { name: "开始另一次练习" }).click();
  await bar.getByRole("button", { name: "看提示做出", exact: true }).click();
  await bar.getByRole("button", { name: "保存记录", exact: true }).click();
  await bar.getByRole("status").waitFor();
  check(await rounds.getAttribute("aria-valuenow") === "1", "Same-day hints do not count as an independent recall");
  check(await bar.locator('[data-attempt-result="assisted"]').count() === 1, "Assisted result has its own trail marker");
  check((await bar.innerText()).includes("2026-09-09"), "Review date updates after an assisted attempt");
  await bar.getByRole("button", { name: "记一条笔记…" }).click();
  await bar.getByRole("textbox").fill("unsaved takeaway");
  await bar.getByRole("button", { name: "返回练习区" }).click();
  await focusButton.click();
  await page.getByRole("button", { name: "退出专注" }).click();
  await recordButton.click();
  check(await bar.getByRole("textbox").inputValue() === "unsaved takeaway", "Layout changes retain note drafts");
  for (const viewportWidth of [375, 768, 1440]) {
    await page.setViewportSize({ width: viewportWidth, height: 900 });
    await page.getByRole("button", { name: "返回路线", exact: true }).click();
    check(await map.isVisible(), `Map available at ${viewportWidth}px`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('[data-practice-focus]').scrollWidth <= innerWidth), `No page-level horizontal overflow at ${viewportWidth}px`);
    await page.getByRole("button", { name: "继续练习 · Two Sum ↓" }).click();
    await recordButton.click();
    check(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `Record fits ${viewportWidth}px`);
    await focusButton.click();
    await page.getByRole("button", { name: "退出专注" }).click();
    check(frameLoads === loaded, "Responsive layouts must retain the iframe document");
  }
  await page.reload();
  await tree.getByRole("button", { name: /^Arrays & Hashing/ }).waitFor();
  check(await map.locator("h1").evaluate((el) => el.getBoundingClientRect().top < innerHeight), "Refresh starts at the complete roadmap");
  await page.getByRole("button", { name: "继续练习 · Two Sum ↓" }).click();
  await recordButton.click();
  check((await bar.innerText()).includes("累计练习 3 次"), "Saved history survives reload");
  await page.getByRole("button", { name: "下一题：Linked List Cycle", exact: true }).click();
  await page.getByRole("heading", { name: "Linked List Cycle", exact: true }).waitFor();
  check(currentSlug === "linked-list-cycle", "Next problem stays easy while rotating to another topic");
  check(errors.length === 0, `Browser exceptions: ${errors.join(", ")}`);
  return "PASS: full tree and list switching; node → topic panel → desk; next problem; search, error recovery, iframe/Coach/note retention, resize, focus, independent/assisted records, truthful rounds and daily plans, reload, responsive 375/768/1440px";
}
