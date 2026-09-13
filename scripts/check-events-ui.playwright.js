// Run in an authenticated disposable browser on /dashboard/events:
// playwright-cli -s=events run-code --filename=scripts/check-events-ui.playwright.js
// All event writes and scans are mocked; no personal data is changed.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Evaluated by Playwright CLI.
async (page) => {
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const event = (id, extra = {}) => ({
    id, title: `Full-stack AI build workshop ${id}`, url: `https://example.com/${id}`,
    source: "test", host: "Builder community", city: "San Francisco", online: false,
    startAt: "2026-10-02T18:00:00Z", timezone: "America/Los_Angeles", score: 5,
    topics: ["ai", "swe"], matched: ["react", "ai"], discoveredAt: "2026-09-09T00:00:00Z", ...extra,
  });
  const initialEvents = [
    event("later", { saved: true, city: "Oakland" }),
    event("early", { startAt: "2026-09-19T18:00:00Z" }),
    event("data", { title: "Database systems", topics: ["data"], score: 2, matched: ["database"] }),
    event("hidden", { hidden: true }),
    event("sold-out", { soldOut: true }),
  ];
  let events = initialEvents.map((item) => ({ ...item }));
  let failLoad = false, failPatch = false, calendarError = false, delayLoad = false;
  let releasePatch, releaseLoad, releaseScan;
  let patches = 0, scans = 0;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/robin/tech-events", async (route) => {
    if (route.request().method() === "PATCH") {
      patches++;
      const change = route.request().postDataJSON();
      await new Promise((resolve) => { releasePatch = resolve; });
      if (failPatch) return route.fulfill({ status: 503, json: { error: "Test update failed" } });
      events = events.map((item) => item.id === change.id ? { ...item, ...change } : item);
      return route.fulfill({ json: {} });
    }
    if (delayLoad) await new Promise((resolve) => { releaseLoad = resolve; });
    return route.fulfill(failLoad ? { status: 503, json: { error: "Test feed unavailable" } } : {
      json: { events, scanning: false, today: "2026-09-09", scan: null },
    });
  });
  await page.route("**/api/robin/events", (route) => route.fulfill({ json: {
    events: [], google: { connected: true, ...(calendarError ? { error: "Test Google unavailable" } : {}) },
  } }));
  await page.route("**/api/robin/tech-events/scan", async (route) => {
    scans++;
    await new Promise((resolve) => { releaseScan = resolve; });
    await route.fulfill({ json: {} });
  });
  await page.evaluate(() => { localStorage.setItem("pi-locale", "en"); localStorage.setItem("pi-theme", "light"); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  const list = page.getByRole("region", { name: "All upcoming events", exact: true });
  const picks = page.getByRole("region", { name: "Recommended for you", exact: true });
  const cards = list.locator("article");
  await cards.first().waitFor();
  check(await cards.count() === 4, "Hidden events are excluded by default");
  check(await picks.locator("article").count() === 2, "Sold-out and hidden events cannot be recommended");
  check((await cards.first().innerText()).includes("workshop early"), "Days must be chronological, regardless of feed order");
  check(!await cards.first().locator("details").evaluate((el) => el.open), "Score breakdown starts collapsed");
  await cards.first().locator("summary").focus();
  await page.keyboard.press("Enter");
  check(await cards.first().locator("details").evaluate((el) => el.open), "Keyboard opens score breakdown");
  await page.keyboard.press("Enter");
  await list.getByRole("searchbox").fill("OAKLAND");
  check(await cards.count() === 1, "Search is case-insensitive and includes city");
  await list.getByRole("button", { name: "Data", exact: true }).click();
  check(await cards.count() === 0, "Topic and search filters combine");
  await list.getByRole("button", { name: "Clear filters" }).click();
  await list.getByRole("button", { name: "Saved only" }).click();
  check(await cards.count() === 1, "Saved filter works");
  await list.getByRole("button", { name: "Clear filters" }).click();
  await list.getByRole("button", { name: "Show hidden" }).click();
  check(await cards.count() === 5 && await list.getByText("Hidden", { exact: true }).count() === 1, "Hidden state is explicit, not opacity-only");
  await list.getByRole("button", { name: "Clear filters" }).click();

  const early = cards.filter({ hasText: "workshop early" });
  await early.getByRole("button", { name: "Save", exact: true }).click();
  await early.getByRole("button", { name: "Updating…" }).waitFor();
  check(await cards.locator("button:enabled").count() === 0, "Writes cannot overlap");
  releasePatch();
  await early.getByRole("button", { name: "Unsave", exact: true }).waitFor();
  check(await picks.getByRole("button", { name: "Unsave", exact: true }).count() === 2, "Recommendation and list state stay in sync");
  failPatch = true;
  await early.getByRole("button", { name: "Unsave", exact: true }).click();
  await early.getByRole("button", { name: "Updating…" }).waitFor();
  releasePatch();
  await page.getByRole("alert").filter({ hasText: "Test update failed" }).waitFor();
  check(await early.getByRole("button", { name: "Unsave", exact: true }).count() === 1, "Failed writes preserve saved state");
  failPatch = false;
  await early.getByRole("button", { name: "Hide", exact: true }).click();
  await early.getByRole("button", { name: "Updating…" }).waitFor();
  releasePatch();
  await early.waitFor({ state: "detached" });
  check(patches === 3 && await picks.locator("article").count() === 1, "Hiding updates both surfaces without duplicate writes");
  await page.getByRole("button", { name: /Scan now/ }).click();
  await page.getByRole("status").filter({ hasText: "Scanning the event feeds" }).waitFor();
  check(await page.getByRole("button", { name: /Scanning/ }).isDisabled(), "Scan cannot be submitted twice");
  check(await cards.count() === 3 && scans === 1, "Scanning preserves the existing list");
  releaseScan();
  await page.getByRole("button", { name: /Scan now/ }).waitFor();

  calendarError = true;
  await page.reload();
  await picks.getByText("Schedule check unavailable", { exact: true }).waitFor();
  check(await picks.locator("article").count() === 0 && await cards.count() === 3, "Calendar failure keeps events but does not claim checked recommendations");
  check(await list.getByText("No schedule conflict", { exact: true }).count() === 0, "Google failure never means no conflict");
  calendarError = false;
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await picks.locator("article").first().waitFor();
  failLoad = true;
  await page.reload();
  await list.getByText("Events could not be loaded. Please retry.").waitFor();
  check(await list.getByText("No upcoming events yet.").count() === 0, "Load errors are not empty states");
  failLoad = false;
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await cards.first().waitFor();
  delayLoad = true;
  await page.reload();
  await list.getByRole("status").filter({ hasText: "Loading upcoming events" }).waitFor();
  for (let attempt = 0; !releaseLoad && attempt < 100; attempt++) await page.waitForTimeout(10);
  check(typeof releaseLoad === "function", "Loading request must reach the mock");
  delayLoad = false;
  releaseLoad();
  await cards.first().waitFor();

  events = [...initialEvents, event("long", { title: "LongTitle".repeat(24), host: "LongHost".repeat(24), score: 1, topics: ["data"], matched: [] })];
  for (const locale of ["en", "zh-CN"]) {
    for (const theme of ["light", "dark"]) {
      await page.evaluate(({ locale, theme }) => { localStorage.setItem("pi-locale", locale); localStorage.setItem("pi-theme", theme); }, { locale, theme });
      await page.reload();
      await page.locator("article").first().waitFor();
      check(!(await page.locator("main").innerText()).includes("robin.events."), `No untranslated labels in ${locale}`);
      const contrastFailures = await page.locator("main").evaluate((main) => {
        const canvas = document.createElement("canvas").getContext("2d");
        const rgba = (color) => {
          canvas.clearRect(0, 0, 1, 1);
          canvas.fillStyle = color;
          canvas.fillRect(0, 0, 1, 1);
          return [...canvas.getImageData(0, 0, 1, 1).data].map((v) => v / 255);
        };
        const over = (front, back) => front.slice(0, 3).map((v, i) => v * front[3] + back[i] * (1 - front[3]));
        const luminance = (rgb) => rgb.reduce((sum, v, i) => sum + (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i], 0);
        return [...main.querySelectorAll("article :is(a, p, .pi-eyebrow, small), label, button")].filter((el) => el.checkVisibility()).flatMap((el) => {
          const ancestors = [];
          for (let node = el; node; node = node.parentElement) ancestors.unshift(node);
          const background = ancestors.reduce((back, node) => over(rgba(getComputedStyle(node).backgroundColor), back), [1, 1, 1]);
          const ink = over(rgba(getComputedStyle(el).color), background);
          const a = luminance(ink), b = luminance(background);
          const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          return ratio < 4.5 ? [`${el.textContent.slice(0, 30)}: ${ratio.toFixed(2)}`] : [];
        });
      });
      check(contrastFailures.length === 0, `${theme} contrast below 4.5:1: ${contrastFailures.join("; ")}`);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const overflow = await page.locator("main").evaluate((el) => el.scrollWidth > el.clientWidth);
        check(!overflow, `No horizontal overflow: ${locale}/${theme}/${width}`);
        check(await page.locator("main button").evaluateAll((buttons) => buttons.every((el) => el.getBoundingClientRect().height >= 44)), "Buttons have 44px touch height");
      }
      if (locale === "zh-CN") {
        await page.screenshot({ path: `/tmp/events-${theme}-desktop.png` });
        await page.setViewportSize({ width: 375, height: 900 });
        await page.screenshot({ path: `/tmp/events-${theme}-mobile.png` });
      }
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("article a").first().focus();
  check(await page.locator("article a").first().evaluate((el) => getComputedStyle(el).outlineStyle !== "none"), "External links have visible keyboard focus");
  check(errors.length === 0, `Browser errors: ${errors.join("; ")}`);
  console.log("PASS: events search, filters, ordering, score disclosure, saves, hide, scan, loading, errors, retry, calendar degradation, locales and responsive themes");
}
