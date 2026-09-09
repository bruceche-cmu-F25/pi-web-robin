// Run on /dashboard/gmail in an authenticated disposable browser:
// playwright-cli -s=email run-code --filename=scripts/check-email-ui.playwright.js
// Gmail checks and Google operations are mocked: no AI calls or personal-data writes.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Evaluated by Playwright CLI.
async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const checkContrast = async (theme) => {
    const failures = await page.evaluate(() => {
      const context = document.createElement("canvas").getContext("2d");
      const rgba = (color) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data].map((value) => value / 255);
      };
      const over = (front, back) => front.slice(0, 3).map((value, i) => value * front[3] + back[i] * (1 - front[3]));
      const luminance = (rgb) => rgb.reduce((sum, value, i) => sum + (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i], 0);
      return [...document.querySelectorAll('main .pi-card :is(p, h2, h3, time, .pi-eyebrow, summary), main a[href^="https://mail.google.com/"] span')].filter((el) => el.checkVisibility()).flatMap((el) => {
        const ancestors = [];
        for (let node = el; node; node = node.parentElement) ancestors.unshift(node);
        const background = ancestors.reduce((back, node) => over(rgba(getComputedStyle(node).backgroundColor), back), [1, 1, 1]);
        const ink = over(rgba(getComputedStyle(el).color), background);
        const a = luminance(ink), b = luminance(background);
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        return ratio < 4.5 ? [`${el.textContent.slice(0, 40)}: ${ratio.toFixed(2)}:1`] : [];
      });
    });
    check(failures.length === 0, `${theme} text contrast below 4.5:1: ${failures.join("; ")}`);
  };
  const now = new Date().toISOString();
  const mail = (id, category, extra = {}) => ({ id, threadId: `thread-${id}`, from: "Robin Team <team@example.com>", subject: "Interview invitation", snippet: "Fallback preview", date: now, category, summary: "Confirm a time for your technical interview.", action: "none", ...extra });
  const review = {
    day: now.slice(0, 10), reviewedAt: now, report: "## Review details\nYour messages have been categorised.",
    items: [
      mail("interview", "interview", { action: "both" }),
      mail("deadline", "deadline", { subject: "Submit your assessment", summary: "Complete the assessment before Friday.", action: "todo" }),
      mail("other", "other", { subject: "Community update", summary: "", from: "Community <hello@example.com>" }),
      mail("long", "document", { subject: "LongSubject".repeat(25), summary: "Details".repeat(45), from: "Sender".repeat(45) }),
    ],
  };
  let response = { connected: true, today: review.day, review };
  let failLoad = false;
  let checkCalls = 0;
  let releaseCheck;
  let releaseLoad;
  let delayLoad = false;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/robin/gmail", async (route) => {
    if (delayLoad) await new Promise((resolve) => { releaseLoad = resolve; });
    await route.fulfill(failLoad ? { status: 503, json: { error: "Test load unavailable" } } : { json: response });
  });
  await page.route("**/api/robin/google", (route) => route.fulfill({ json: { configured: true, connected: response.connected, redirectUri: "" } }));
  await page.route("**/api/robin/gmail/check", async (route) => {
    checkCalls++;
    await new Promise((resolve) => { releaseCheck = resolve; });
    await route.fulfill({ status: checkCalls === 1 ? 503 : 200, json: checkCalls === 1 ? { error: "Test check unavailable" } : {} });
  });
  await page.evaluate(() => { localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-theme", "light"); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  const main = page.locator("main").last();
  const links = main.locator('a[href^="https://mail.google.com/"]');
  await links.first().waitFor();
  check(await links.count() === 4, "All reviewed emails must be visible");
  check(!await main.locator("details").evaluate((el) => el.open), "Report must start collapsed");
  check((await main.innerText()).includes("2 待办 · 1 日程"), "Created actions must count both correctly");
  await main.locator("summary").click();
  await main.getByRole("heading", { name: "Review details" }).waitFor();
  await main.locator("summary").click();
  await main.getByRole("combobox").selectOption("attention");
  check(await links.count() === 3, "Attention excludes other");
  await main.getByRole("searchbox").fill("FRIDAY");
  check(await links.count() === 1, "Search matches summary case-insensitively");
  await main.getByRole("searchbox").fill("no-match");
  await main.getByRole("heading", { name: "没有找到匹配邮件" }).waitFor();
  await main.getByRole("button", { name: "清除筛选" }).click();
  check(await links.count() === 4, "Clear resets search and category");
  await main.getByRole("searchbox").fill("hello@example.com");
  check(await links.count() === 1 && (await links.innerText()).includes("Fallback preview"), "Sender search and snippet fallback work");
  check(await links.getAttribute("href") === "https://mail.google.com/mail/u/0/#all/thread-other", "Link uses thread id");
  await main.getByRole("button", { name: "清除筛选" }).click();
  await main.getByRole("combobox").selectOption("deadline");
  check(await links.count() === 1, "Individual category filter works");
  await main.getByRole("button", { name: "清除筛选" }).click();
  await checkContrast("light");
  await page.screenshot({ path: "/tmp/email-desktop.png", fullPage: true });

  const checkButton = main.getByRole("button", { name: /检查今天/ });
  await checkButton.click();
  await main.getByRole("status").filter({ hasText: "正在读取并分类" }).waitFor();
  check(await main.getByRole("button", { name: /检查中…/ }).isDisabled(), "Check must disable while running");
  check(await links.count() === 4 && checkCalls === 1, "Previous review remains available without duplicate requests");
  releaseCheck();
  await main.getByRole("alert").filter({ hasText: "Test check unavailable" }).waitFor();
  await checkButton.click();
  await main.getByRole("status").filter({ hasText: "正在读取并分类" }).waitFor();
  check(checkCalls === 2, "Retry must issue one new check");
  releaseCheck();
  await checkButton.waitFor();
  check(!await main.getByRole("alert").count(), "Retry success clears action error");

  for (const width of [375, 768]) {
    await page.setViewportSize({ width, height: 900 });
    check(await main.evaluate((el) => el.scrollWidth <= el.clientWidth), `Mail layout must not overflow at ${width}px`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Page must not overflow at ${width}px`);
    if (width === 375) await page.screenshot({ path: "/tmp/email-mobile.png", fullPage: true });
  }
  await page.evaluate(() => localStorage.setItem("pi-theme", "dark"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await links.first().waitFor();
  await checkContrast("dark");
  await page.screenshot({ path: "/tmp/email-dark.png", fullPage: true });
  await links.first().focus();
  check(await links.first().evaluate((el) => getComputedStyle(el).outlineStyle !== "none"), "Mail links have visible keyboard focus");

  const categories = ["important", "interview", "oa", "appointment", "delivery", "deadline", "document", "other"];
  response = { ...response, review: { ...review, items: categories.map((category) => mail(category, category)) } };
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => localStorage.setItem("pi-theme", value), theme);
    await page.reload();
    await links.first().waitFor();
    const colors = await main.locator("h2[data-category]").evaluateAll((headings) => headings.map((el) => getComputedStyle(el).color));
    check(colors.length === categories.length && new Set(colors).size === categories.length, `${theme}: every category needs its own heading color`);
    await checkContrast(`${theme} all categories`);
  }

  response = { ...response, review: { ...review, items: [], report: "" } };
  await page.reload();
  await main.getByRole("heading", { name: "本次没有需要整理的邮件" }).waitFor();
  response = { ...response, review: null };
  await page.reload();
  await main.getByRole("heading", { name: "从今天的邮件开始" }).waitFor();
  response = { ...response, connected: false };
  await page.reload();
  await main.getByRole("heading", { name: "连接 Google，开始整理邮件" }).waitFor();
  check(await checkButton.isDisabled(), "Disconnected accounts cannot check mail");

  failLoad = true;
  await page.reload();
  await main.getByRole("alert").filter({ hasText: "Test load unavailable" }).waitFor();
  failLoad = false;
  response = { connected: true, today: review.day, review };
  await main.getByRole("button", { name: "重新加载" }).click();
  await links.first().waitFor();
  delayLoad = true;
  await page.reload();
  await main.getByRole("status").filter({ hasText: "正在加载邮件检查结果" }).waitFor();
  delayLoad = false;
  releaseLoad();
  await links.first().waitFor();
  for (const locale of ["en", "zh-TW"]) {
    await page.evaluate((value) => localStorage.setItem("pi-locale", value), locale);
    await page.reload();
    await links.first().waitFor();
    check(!(await main.innerText()).includes("robin.gmail."), `No missing translations in ${locale}`);
  }
  check(errors.length === 0, `Browser errors: ${errors.join("; ")}`);
  console.log("PASS: email filters, summaries, states, retry, read-only links, keyboard focus, responsive layouts and locales");
}
