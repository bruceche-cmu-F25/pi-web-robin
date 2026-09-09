// Run on an authenticated disposable /dashboard session:
// playwright-cli -s=fullstack-card run-code --filename=scripts/check-fullstack-card.playwright.js
// Every learning write is intercepted; no real course progress is changed.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Playwright CLI evaluates this function.
async (page) => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const initial = await page.evaluate(async () => {
    const response = await fetch("/api/robin/learning");
    if (!response.ok) throw new Error(`Snapshot failed (${response.status})`);
    return response.json();
  });
  check(initial.fullstack.next && initial.fullstack.upcoming.length, "Use a session with unfinished course work");
  const cloneInitial = () => JSON.parse(JSON.stringify(initial));
  let snapshot = cloneInitial();
  let fail = true;
  let writes = 0;
  await page.route("**/api/robin/learning", async (route) => {
    if (route.request().method() === "PATCH") {
      writes++;
      if (fail) return route.fulfill({ status: 503, json: { error: "Test completion failed" } });
      const input = route.request().postDataJSON();
      check(input.step === initial.fullstack.next.id, "Complete/undo must target the same checkpoint");
      snapshot = cloneInitial();
      if (input.completed) {
        const course = snapshot.fullstack;
        course.completed++;
        course.completedIds.push(course.next.id);
        course.lastCompleted = course.next;
        course.currentPart.completed++;
        course.currentPart.byKind.find((group) => group.kind === course.next.kind).completed++;
        course.next = course.upcoming.shift();
      }
    }
    await route.fulfill({ json: snapshot });
  });
  await page.reload();
  const card = page.locator("#fullstack-open article").filter({ hasText: "Full Stack Open" });
  const preview = card.getByRole("region", { name: "接下来", exact: true });
  const details = card.locator("summary").filter({ hasText: "章节详情与后续预览" });
  await details.waitFor();
  check(!(await preview.isVisible()), "Course details start collapsed");
  await details.click();
  await preview.waitFor();
  check(await preview.getByRole("link").count() === initial.fullstack.upcoming.length, "Preview uses actual pending steps");
  for (const link of await preview.getByRole("link").all()) {
    check(await link.getAttribute("target") === "_blank", "Preview opens externally without completing work");
  }
  await card.getByRole("button", { name: /完成这一项/ }).click();
  await page.getByRole("alert").filter({ hasText: "Test completion failed" }).waitFor();
  check((await card.innerText()).includes(initial.fullstack.next.title), "Failed save must retain current work");
  fail = false;
  await card.getByRole("button", { name: /完成这一项/ }).click();
  await card.getByRole("button", { name: /撤销/ }).waitFor();
  check((await card.innerText()).includes(initial.fullstack.upcoming[0].title), "Success advances current work");
  check((await card.getByRole("region", { name: "本章进度", exact: true }).innerText()).includes(`${initial.fullstack.currentPart.completed + 1}/${initial.fullstack.currentPart.total}`), "Chapter progress refreshes");
  await card.getByRole("button", { name: /撤销/ }).click();
  await page.waitForFunction((title) => document.querySelector('#fullstack-open article:last-child [aria-live]')?.textContent.includes(title), initial.fullstack.next.title);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => localStorage.setItem("pi-theme", value), theme);
    await page.reload();
    await details.click();
    await preview.waitFor();
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await card.scrollIntoViewIfNeeded();
      check(await card.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= innerWidth + 1), `Card overflows: ${theme}, ${width}px`);
    }
  }
  check(writes === 3, "Rendering, preview and resizing never write course progress");
  return "PASS: chapter/preview data, failed save, completion/undo, read-only preview, 375/768/1440px light/dark layouts";
}
