// Run in an authenticated disposable browser on /learn.
// All learning writes are blocked. Both cards share fixtures for visual checks.
// playwright-cli -s=practice-layout run-code --filename=scripts/check-learning-card-style.playwright.js
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Evaluated by Playwright CLI.
async (page) => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  await page.unroute("**/api/robin/learning");
  const initial = await page.evaluate(async () => {
    const response = await fetch("/api/robin/learning");
    if (!response.ok) throw new Error(`Snapshot failed: ${response.status}`);
    return response.json();
  });
  check(initial.fullstack.next, "Use unfinished Full Stack course data");
  let empty = false;
  let writes = 0;
  await page.route("**/api/robin/learning", async (route) => {
    if (route.request().method() !== "GET") {
      writes++;
      return route.fulfill({ status: 405, json: { error: "Visual check is read-only" } });
    }
    const fixture = JSON.parse(JSON.stringify(initial));
    fixture.practice.daily.newProblems = empty ? [] : [{ problem: "Contains Duplicate", link: "contains-duplicate" }];
    fixture.practice.daily.reviews = [];
    await route.fulfill({ json: fixture });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const card = page.locator("#fullstack-open");
  for (const locale of ["en", "zh-CN"]) {
    for (empty of [false, true]) {
      for (const dark of [false, true]) {
        await page.evaluate(({ locale, dark }) => {
          localStorage.setItem("pi-locale", locale);
          localStorage.setItem("pi-theme", dark ? "dark" : "light");
        }, { locale, dark });
        await page.reload();
        const practice = card.locator("article").first();
        const course = card.locator("article").nth(1);
        await course.locator("h4.text-lg").waitFor();
        const typography = (el) => {
          const s = getComputedStyle(el);
          return { family: s.fontFamily, size: parseFloat(s.fontSize), weight: s.fontWeight, style: s.fontStyle, height: s.lineHeight };
        };
        const courseTitle = await course.locator("h4.text-lg").evaluate(typography);
        check(courseTitle.size === 22 && courseTitle.weight === "400" && courseTitle.style === "italic", "Card headlines use the shared 22px regular italic tier");
        check(JSON.stringify(await practice.locator("h4.text-lg").evaluate(typography)) === JSON.stringify(courseTitle), "Both tracks have matching headlines, even with no problem scheduled");
        if (empty) {
          const message = await practice.locator("[aria-live] p").evaluate(typography);
          check(message.size === 13 && message.size < courseTitle.size, "An empty-plan explanation is supporting copy, not a headline");
          check(await practice.locator('a[data-state="accent"]').count() === 1, "Free practice remains the primary empty-state action");
          check(await practice.locator("h4.text-lg").innerText() === (locale === "en" ? "Free practice" : "自由练习"), "Empty practice has a localized title, not an invented problem");
        }
        check(JSON.stringify(await practice.locator("h3").evaluate(typography)) === JSON.stringify(await course.locator("h3").evaluate(typography)), "Track labels share one style");
        for (const width of [375, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          check(await card.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${locale}/${empty}/${dark}/${width}: no horizontal overflow`);
        }
        if (locale === "en") {
          await practice.locator("..").screenshot({ path: `/tmp/learning-cards-${empty ? "empty" : "active"}-${dark ? "dark" : "light"}.png` });
        }
      }
    }
  }
  check(writes === 0, "Typography and layout must never write progress");
  return "PASS: shared card hierarchy, compact empty state, primary free-practice action, English/Chinese and 375/768/1440 light/dark layouts; zero progress writes";
}
