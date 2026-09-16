// Run in an authenticated disposable tab:
// playwright-cli -s=dashboard run-code --filename=scripts/check-dashboard-jumps.playwright.js
// Only synthetic tasks are displayed and every API write is intercepted.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Evaluated by Playwright CLI.
async (page) => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const writes = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = request.url().replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    if (request.method() !== "GET") {
      writes.push(path);
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/robin/todos") return route.fulfill({ json: {
      today: "2026-09-09",
      todos: Array.from({ length: 30 }, (_, i) => ({ id: `jump-${i}`, title: `Task ${i}`, due: "2026-09-09", done: false })),
    } });
    if (path === "/api/robin/events") return route.fulfill({ json: { events: [], today: "2026-09-09", google: { connected: false } } });
    if (path === "/api/robin/links") return route.fulfill({ json: { links: [] } });
    return route.continue();
  });
  await page.addInitScript(() => {
    localStorage.setItem("pi-locale", "en");
    localStorage.setItem("robin-calendar-view", "week");
  });
  await page.goto("http://127.0.0.1:30141/dashboard?jump-test=1");
  const nav = page.locator("main > nav");
  await page.getByText("Task 29", { exact: true }).last().waitFor();
  check(await nav.getByRole("link").count() === 4, "Exactly four lightweight section shortcuts");
  const targets = ["dashboard-todos", "dashboard-jobs", "fullstack-open", "dashboard-links"];
  const documentIdentity = await page.evaluate(() => performance.timeOrigin);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const motion of ["no-preference", "reduce"]) {
      await page.emulateMedia({ reducedMotion: motion });
      check(await page.locator(".robin-dashboard").evaluate((el) => getComputedStyle(el).scrollBehavior) === (motion === "reduce" ? "auto" : "smooth"), "Respects reduced motion");
      for (const id of targets) {
        await nav.scrollIntoViewIfNeeded();
        const link = nav.locator(`a[href="#${id}"]`);
        await link.focus();
        await link.press("Enter");
        await page.waitForFunction((targetId) => {
          const target = document.getElementById(targetId);
          const title = target?.querySelector("h2");
          if (!target || !title) return false;
          const top = title.getBoundingClientRect().top;
          const masthead = document.querySelector(".robin-dashboard-header").getBoundingClientRect().bottom;
          return location.hash === `#${targetId}` && document.activeElement === target && top >= masthead && top < innerHeight - 30;
        }, id);
        check(await page.evaluate(() => location.search) === "?jump-test=1", "Anchor preserves query context");
        check(await page.evaluate(() => performance.timeOrigin) === documentIdentity, "No document reload");
      }
    }
    check(await page.locator(".robin-dashboard").evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "No horizontal overflow");
  }
  check(writes.length === 0, "Section navigation never writes user data");
  return "PASS: four anchor shortcuts, keyboard focus, sticky-header clearance, no reload, query preserved, mobile/desktop and reduced motion; writes intercepted";
}
