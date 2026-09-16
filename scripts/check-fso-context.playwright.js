// Run inside an authenticated disposable browser:
// playwright-cli -s=fso-frame run-code --filename=scripts/check-fso-context.playwright.js
// Uses a fresh tab; all course, note and mentor writes are mocked.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Evaluated by Playwright CLI.
async (hostPage) => {
  const page = await hostPage.context().newPage();
  const check = (value, message) => { if (!value) throw new Error(message); };
  const first = "/en/part0/general_info";
  const second = "/en/part0/fundamentals_of_web_apps";
  const notes = { [first]: { text: "saved note", updatedAt: "2030-01-01T00:00:00Z" } };
  let current = null;
  let release;
  let started;
  const firstSelection = new Promise((resolve) => { started = resolve; });
  const selectionGate = new Promise((resolve) => { release = resolve; });
  let selections = 0;
  let frameLoads = 0;
  let practiceReads = 0;
  let failSelection = false;
  let failNotes = false;
  const mentorCalls = [];
  const errors = [];
  try {
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("pi-locale", "en"));
    await page.route("https://fullstackopen.com/**", (route) => {
      frameLoads++;
      return route.fulfill({ contentType: "text/html", body: '<h1>Mock chapter</h1><textarea aria-label="Frame draft"></textarea>' });
    });
    await page.route("**/api/robin/learning", (route) => {
      practiceReads++;
      return route.fulfill({ status: 500, json: { error: "Corrupt practice must not affect FSO" } });
    });
    await page.route("**/api/robin/assistant", (route) => {
      mentorCalls.push({ chapter: current, ...route.request().postDataJSON() });
      return route.fulfill({ json: { reply: "Mentor fixture", usedTools: [] } });
    });
    await page.route("**/api/robin/fso", async (route) => {
      const method = route.request().method();
      if (method === "PATCH") {
        selections++;
        if (selections === 1) { started(); await selectionGate; }
        if (failSelection) {
          failSelection = false;
          // An error response does not prove that the write was rolled back.
          current = route.request().postDataJSON().chapter;
          return route.fulfill({ status: 500, json: { error: "Chapter save failed" } });
        }
        current = route.request().postDataJSON().chapter;
        return route.fulfill({ json: { openChapterId: current } });
      }
      if (method === "PUT") {
        if (failNotes) return route.fulfill({ status: 500, json: { error: "Note save failed" } });
        const input = route.request().postDataJSON();
        const note = { text: input.text, updatedAt: "2030-01-01T00:00:00Z" };
        notes[input.chapter] = note;
        return route.fulfill({ json: { chapter: input.chapter, note } });
      }
      return route.fulfill({ json: { openChapterId: current, openedAt: null, notes, fullstack: { completedIds: [] } } });
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`http://127.0.0.1:30141/learn/fso?chapter=${encodeURIComponent(first)}`);
    await firstSelection;
    check(await page.locator("iframe").count() === 0, "Deep link must wait for confirmation before framing");
    check(await page.locator("#fso-side").count() === 0, "No mentor with unconfirmed initial context");
    release();
    const frame = page.locator(`iframe[src="https://fullstackopen.com${first}"]`);
    await frame.waitFor();
    await page.getByRole("textbox", { name: "Notes on General info" }).waitFor();
    check(selections === 1 && practiceReads === 0, "StrictMode must not duplicate opens or fetch practice");
    const frameDraft = page.frameLocator(`iframe[src="https://fullstackopen.com${first}"]`).getByRole("textbox");
    await frameDraft.fill("unsaved frame text");
    await page.getByRole("textbox", { name: "Notes on General info" }).fill("draft before chapter switch");
    failSelection = true;
    await page.getByRole("button", { name: "Next · 0b" }).click();
    await page.getByRole("alert").filter({ hasText: "Chapter save failed" }).waitFor();
    check(await frameDraft.inputValue() === "unsaved frame text", "Failure keeps the iframe document");
    check(notes[first].text === "draft before chapter switch", "Chapter switch flushes notes first");
    check(decodeURIComponent(page.url()).includes(first), "Failure keeps the confirmed URL");
    check(current === second, "Fixture simulates a committed write with a failed response");
    await page.locator("#fso-side").getByRole("tab", { name: "Mentor" }).click();
    const mentorInput = page.getByRole("textbox", { name: "Ask about this chapter…" });
    await mentorInput.fill("explain this chapter");
    await mentorInput.press("Enter");
    check(mentorCalls.length === 0 && await mentorInput.inputValue() === "explain this chapter", "Uncertain context blocks send, preserves draft");
    await page.getByRole("alert").getByRole("button", { name: "Retry opening chapter" }).click();
    await page.locator(`iframe[src="https://fullstackopen.com${second}"]`).waitFor();
    await mentorInput.press("Enter");
    await page.getByText("Mentor fixture", { exact: true }).waitFor();
    check(mentorCalls.length === 1 && mentorCalls[0].chapter === second, "Retry confirms context before sending");
    const loaded = frameLoads;
    await page.getByRole("navigation", { name: "Full Stack Open views" }).getByRole("button").filter({ hasText: /^0\s*b$/ }).click();
    await page.waitForFunction(() => document.querySelector('[aria-busy="false"]'));
    check(frameLoads === loaded, "Reopening the same chapter preserves the frame");
    await page.locator("#fso-side").getByRole("tab", { name: "Notes", exact: true }).click();
    const secondNote = page.getByRole("textbox", { name: "Notes on Fundamentals of Web apps" });
    failNotes = true;
    await secondNote.fill("do not lose this draft");
    const before = selections;
    await page.getByRole("button", { name: "Next · 1a" }).click();
    await page.getByRole("alert").filter({ hasText: "Note save failed" }).waitFor();
    check(selections === before && await secondNote.inputValue() === "do not lose this draft", "Failed flush keeps chapter and draft; no selection write");
    check(await page.locator(`iframe[src="https://fullstackopen.com${second}"]`).count() === 1, "Failed note flush leaves frame mounted");
    // Do not leave an unsaved draft for the teardown's best-effort save.
    failNotes = false;
    await secondNote.press("Tab");
    await page.getByRole("status", { name: "", exact: true }).filter({ hasText: /^Saved$/ }).waitFor();
    await page.setViewportSize({ width: 375, height: 812 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile does not overflow horizontally");
    check(practiceReads === 0, "FSO never reads the mixed learning snapshot");
    check(errors.length === 0, errors.join("\n"));
    return "PASS: confirmed deep links, failed selection/URL/frame retention, retry, gated mentor drafts, note flush, same-frame reopen, mobile width; all writes mocked";
  } finally {
    release();
    await page.close();
  }
}
