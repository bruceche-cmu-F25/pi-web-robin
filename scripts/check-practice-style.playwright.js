// Run after check-practice-ui.playwright.js in the same disposable session.
// Practice data and iframe stay mocked; this only changes local display state.
// playwright-cli -s=practice-layout run-code --filename=scripts/check-practice-style.playwright.js
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Evaluated by Playwright CLI.
async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => localStorage.setItem("pi-locale", "en"));
  await page.reload();
  const map = page.locator("#practice-roadmap");
  const tree = page.getByRole("region", { name: "Practice topic tree" });
  const desk = page.locator("#practice-desk");
  await tree.getByRole("button", { name: /^Arrays & Hashing/ }).waitFor();
  for (const dark of [true, false]) {
    await page.evaluate((value) => document.documentElement.classList.toggle("dark", value), dark);
    await page.waitForTimeout(180);
    const theme = dark ? "dark" : "light";
    await page.setViewportSize({ width: 1440, height: 1700 });
    await map.screenshot({ path: `/tmp/practice-roadmap-${theme}.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const checks = await tree.getByRole("button").evaluateAll((nodes) => nodes.map((el) => {
      const s = getComputedStyle(el);
      const ctx = document.createElement("canvas").getContext("2d");
      const luminance = (colour) => {
        ctx.fillStyle = colour;
        ctx.fillRect(0, 0, 1, 1);
        const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map((x) => x / 255).map((x) => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
        return rgb.reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
      };
      const ratio = (colour) => {
        const l = [luminance(colour), luminance(s.backgroundColor)].sort((a, b) => b - a);
        return (l[0] + 0.05) / (l[1] + 0.05);
      };
      return { text: el.textContent, ratio: ratio(getComputedStyle(el.firstElementChild).color), height: el.getBoundingClientRect().height,
        overflow: el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth };
    }));
    for (const item of checks) {
      check(item.ratio >= 4.5, `Node contrast in ${theme}: ${item.text}: ${item.ratio}`);
      check(item.height >= 44 && !item.overflow, `Node must fit: ${item.text}`);
    }
    await page.getByRole("button", { name: "Continue · Two Sum ↓" }).click();
    await desk.screenshot({ path: `/tmp/practice-desk-${theme}.png` });
    const width = (await page.locator('iframe[title="NeetCode"]').boundingBox()).width;
    check(width >= 900, "Without the library rail the embedded editor gets most of the desk");
    await page.getByRole("button", { name: "Record this attempt", exact: true }).click();
    await page.locator("#practice-record").screenshot({ path: `/tmp/practice-record-${theme}.png` });
    await page.getByRole("button", { name: "Back to roadmap", exact: true }).click();
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [width, height] of [[375, 812], [812, 375]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole("button", { name: "Back to roadmap", exact: true }).click();
    await page.screenshot({ path: `/tmp/practice-map-${width}.png` });
    await tree.getByRole("button", { name: /^Math & Geometry/ }).focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.id === "practice-topic-problems");
    await page.getByRole("button", { name: "Continue · Two Sum ↓" }).click();
    const editorInput = page.frameLocator('iframe[title="NeetCode"]').getByRole("textbox", { name: "Code editor" });
    await editorInput.fill("mobile draft");
    const coachSwitch = desk.getByRole("button", { name: "[ Coach ]", exact: true });
    await coachSwitch.click();
    await page.locator("#practice-coach textarea").fill("mobile question");
    await desk.getByRole("button", { name: "[ Problem ]", exact: true }).click();
    check(await editorInput.inputValue() === "mobile draft", "Mobile pane switching keeps editor state");
    await page.screenshot({ path: `/tmp/practice-desk-${width}.png` });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('[data-practice-focus]').scrollWidth <= innerWidth), `No outer overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  return "PASS: English node contrast/fit in light and dark, wider editor, mobile and landscape, keyboard topic selection, reduced motion, mobile pane draft retention";
}
