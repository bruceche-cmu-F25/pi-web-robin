// Run in an authenticated disposable browser:
// playwright-cli -s=dashboard-fixes run-code --filename=scripts/check-dashboard-ui.playwright.js
// Todo/link/event reads use fixtures; ALL API writes are intercepted.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Playwright CLI evaluates this function.
async (page) => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const title = "确认一项很长的待办任务标题在手机上可以完整阅读，包括没有空格的VeryLongTaskNameWithoutSpaces123456789";
  const todos = [
    { id: "audit-todo", title, due: "2026-09-01", done: false, createdAt: "2026-09-01T00:00:00Z" },
    { id: "audit-done", title: "已完成的测试任务", done: true, completedAt: "2026-09-09T12:00:00Z" },
  ];
  const links = [{ id: "audit-link", title: "测试书签", url: "https://example.com", group: "Other", iconCheckedAt: "2026-09-09T00:00:00Z" }];
  const reads = { todos: 0, events: 0 };
  const writes = [];
  let failDelete = false;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = request.url().replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    if (request.method() !== "GET") {
      writes.push({ path, method: request.method(), body: request.postDataJSON() });
      if (request.method() === "DELETE" && failDelete) {
        return route.fulfill({ status: 503, json: { error: "Test delete failed" } });
      }
      if (request.method() === "DELETE") {
        const items = path.endsWith("/todos") ? todos : links;
        const index = items.findIndex((item) => item.id === request.postDataJSON().id);
        if (index >= 0) items.splice(index, 1);
      }
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/robin/todos") {
      reads.todos++;
      return route.fulfill({ json: { todos, today: "2026-09-09" } });
    }
    if (path === "/api/robin/events") {
      reads.events++;
      return route.fulfill({ json: { events: [], today: "2026-09-09", google: { connected: false } } });
    }
    if (path === "/api/robin/links") return route.fulfill({ json: { links } });
    return route.continue();
  });
  await page.addInitScript(() => {
    localStorage.setItem("pi-locale", "zh-CN");
    localStorage.setItem("pi-theme", "dark");
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:30141/dashboard");
  await page.evaluate(() => localStorage.removeItem("robin-calendar-view"));
  await page.reload();
  const calendar = page.locator("section.pi-card").filter({ has: page.getByRole("heading", { name: "日历", exact: true }) });
  const panel = page.locator("section.pi-card").filter({ has: page.getByRole("heading", { name: "待办", exact: true }) });
  const bookmarks = page.locator("section.pi-card").filter({ has: page.getByRole("heading", { name: "链接", exact: true }) });
  const more = panel.locator("summary").filter({ hasText: "···" }).first();
  await more.waitFor();
  check(await calendar.getByRole("button", { name: "议程", exact: true }).getAttribute("aria-pressed") === "true", "Phone defaults to agenda");
  await calendar.getByRole("button", { name: "周", exact: true }).click();
  await page.reload();
  await more.waitFor();
  check(await calendar.getByRole("button", { name: "周", exact: true }).getAttribute("aria-pressed") === "true", "Explicit calendar preference survives reload");

  // Fake time verifies cadence without a minute-long browser test.
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.reload();
  await more.waitFor();
  const initialReads = { ...reads };
  await page.clock.fastForward(5_000);
  check(reads.todos === initialReads.todos && reads.events === initialReads.events, "No five-second todo/event polling");
  const nextPoll = page.waitForRequest((request) => request.url().endsWith("/api/robin/events"));
  await page.clock.fastForward(55_000);
  await nextPoll;
  check(reads.todos > initialReads.todos, "Todos still refresh at one minute");
  await page.clock.resume();

  // Readable titles and bounded controls in both themes and at small widths.
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => document.documentElement.classList.toggle("dark", value === "dark"), theme);
    for (const width of [320, 390, 640]) {
      await page.setViewportSize({ width, height: 844 });
      await more.scrollIntoViewIfNeeded();
      const row = panel.getByText(title, { exact: true });
      check(await row.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && getComputedStyle(el).whiteSpace !== "nowrap"), `Full mobile title: ${theme}/${width}`);
      check(await more.evaluate((el) => el.getBoundingClientRect().width >= 44 && el.getBoundingClientRect().height >= 44), "44px action target");
      await more.click();
      const linkEditor = panel.locator(`summary[aria-label="设置 ${title} 的链接"]`);
      await linkEditor.click();
      const form = panel.locator("details[open] > form");
      check(await form.evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), "Link editor stays in viewport");
      await form.locator("input").focus();
      await page.keyboard.press("Escape");
      check(await linkEditor.evaluate((el) => document.activeElement === el && !el.parentElement.open), "Escape closes nested editor and restores focus");
      check(await more.evaluate((el) => el.parentElement.open), "First Escape preserves outer menu");
      const colors = panel.locator(`summary[aria-label="选择 ${title} 的文字颜色"]`);
      await colors.click();
      const palette = colors.locator("..").locator(":scope > div");
      check(await palette.evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), "Color palette stays in viewport");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      check(await more.evaluate((el) => document.activeElement === el && !el.parentElement.open), "Escape closes outer menu and restores focus");
    }
  }
  await page.screenshot({ path: "/tmp/dashboard-fixed-mobile.png" });

  const confirm = async (button, accept) => {
    const before = writes.length;
    // Stub the native confirm so the CLI's modal handler cannot pause this run.
    await page.evaluate((answer) => {
      window.__dashboardConfirm = null;
      window.confirm = (message) => { window.__dashboardConfirm = message; return answer; };
    }, accept);
    // Keyboard activation also exercises focusability (and avoids the dev-only
    // Next.js badge that can cover the last row at the bottom of the viewport).
    await button.focus();
    await button.press("Enter");
    check(await page.evaluate(() => window.__dashboardConfirm?.includes("无法撤销")), "Deletion explains permanence");
    if (!accept) check(writes.length === before, "Cancel never writes");
  };
  await more.click();
  const remove = panel.getByRole("button", { name: `删除 ${title}`, exact: true });
  await confirm(remove, false);
  failDelete = true;
  await confirm(remove, true);
  await panel.getByRole("alert").filter({ hasText: "Test delete failed" }).waitFor();
  check(await panel.getByText(title, { exact: true }).count() === 1, "Failed deletion retains the todo");
  failDelete = false;
  await confirm(remove, true);
  await panel.getByText(title, { exact: true }).waitFor({ state: "hidden" });
  const completedMore = panel.locator("summary").filter({ hasText: "···" }).first();
  await completedMore.click();
  await confirm(panel.getByRole("button", { name: "删除 已完成的测试任务", exact: true }), false);

  const deleteLink = bookmarks.getByRole("button", { name: "删除 测试书签", exact: true });
  await confirm(deleteLink, false);
  await bookmarks.getByRole("button", { name: "编辑 测试书签", exact: true }).click();
  const beforeCancelEdit = writes.length;
  await bookmarks.getByRole("button", { name: "取消", exact: true }).click();
  check(writes.length === beforeCancelEdit, "Cancel editing is not deletion");
  await confirm(deleteLink, true);
  await deleteLink.waitFor({ state: "hidden" });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => localStorage.removeItem("robin-calendar-view"));
  await page.reload();
  const desktopDelete = panel.getByRole("button", { name: "删除 已完成的测试任务", exact: true });
  await desktopDelete.waitFor();
  check(await calendar.getByRole("button", { name: "周", exact: true }).getAttribute("aria-pressed") === "true", "Desktop still defaults to week");
  await desktopDelete.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  check(await desktopDelete.evaluate((el) => getComputedStyle(el).opacity === "1" && getComputedStyle(el).outlineStyle !== "none" && el.getBoundingClientRect().width >= 24), "Desktop delete has a visible keyboard focus and usable target");
  const headings = await page.locator(".robin-dashboard main section.pi-card > header h2").allTextContents();
  check(headings.join(",") === "日历,待办,求职,学习中心,链接", "Homepage order is unchanged");
  check(writes.length === 3, "Only failed todo delete, successful todo delete, and link delete were requested");
  return "PASS: mobile titles/menus, light/dark 320/390/640px, nested Escape/focus, deletion cancel/failure/success, completed todos, link edit cancel, saved calendar choice, desktop layout, 60s polling; all writes mocked";
}
