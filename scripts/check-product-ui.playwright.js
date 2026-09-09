// Run in an authenticated, disposable browser session on /product:
// playwright-cli -s=product-check run-code --filename=scripts/check-product-ui.playwright.js
// Every product write is intercepted; this never changes the user's store or calls AI.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Playwright CLI evaluates this function expression.
async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const now = new Date().toISOString();
  const idea = (id, step, extra = {}) => ({ id, name: id, note: `Notes for ${id}`, step, links: [], createdAt: now, updatedAt: now, ...extra });
  let ideas = [idea("Alpha", "spot"), idea("Beta", "validate", { bet: { claim: "Five people will pay", by: "2000-01-01" } }), idea("Parked", "build", { parked: true })];
  let captures = [];
  let classifications = 0;
  let failClassify = true;
  let libraryReads = 0;
  const resources = [{ id: "source", name: "Example source", category: "source", summary: "A source for testing", price: "Free", status: "saved", stages: [], productTypes: [] }];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/robin/products**", async (route) => {
    const request = route.request();
    const method = request.method();
    const id = decodeURIComponent(request.url().split("?")[0].split("/").pop());
    let body;
    if (method === "GET") body = { ideas, captures };
    else if (method === "DELETE") return route.fulfill({ status: 500, json: { error: "Test delete failed" } });
    else {
      const patch = request.postDataJSON();
      if (method === "PATCH") {
        ideas = ideas.map((item) => item.id === id ? { ...item, ...patch } : item);
        body = { idea: ideas.find((item) => item.id === id) };
      } else if (patch.capture) {
        const capture = { id: `capture-${captures.length}`, text: patch.text, images: [], status: "pending", createdAt: now };
        captures.push(capture);
        body = { capture };
      } else if (patch.captureId) {
        captures = captures.filter((item) => item.id !== patch.captureId);
        body = { capture: { id: patch.captureId, status: "filed" } };
      } else {
        const created = idea("new-product", "spot", { name: patch.name, note: patch.note });
        ideas.push(created);
        body = { idea: created };
      }
    }
    await route.fulfill({ json: body });
  });
  await page.route("**/api/robin/product-library", async (route) => {
    libraryReads++;
    await route.fulfill({ json: { resources } });
  });
  await page.route("**/api/robin/product-classify", async (route) => {
    classifications++;
    if (failClassify) return route.fulfill({ status: 503, json: { error: "Test classifier unavailable" } });
    const capture = captures.find((item) => item.id === route.request().postDataJSON().id);
    await route.fulfill({ json: { suggestion: { kind: "resource", title: capture.text, summary: "Suggested summary", confidence: "high", reason: "Test suggestion" } } });
  });
  await page.evaluate(() => localStorage.setItem("pi-locale", "zh-CN"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  const rows = page.getByRole("list", { name: "想法", exact: true }).locator(":scope > li:visible");
  await rows.first().waitFor();
  check(await rows.count() === 2, "Active view must exclude parked ideas");
  check(!await page.locator("#product-library").isVisible(), "Toolkit must start closed");
  await page.getByRole("group", { name: "步骤", exact: true }).getByRole("button", { name: /验证/ }).click();
  check(await rows.count() === 1 && (await rows.innerText()).includes("Beta"), "Stage filter must work");
  await page.getByRole("button", { name: /^待决策/ }).click();
  check(await rows.count() === 1 && (await rows.innerText()).includes("Beta"), "Decision view must show overdue claim");
  await page.getByRole("button", { name: /^搁置/ }).click();
  check((await rows.innerText()).includes("Parked"), "Parked ideas must remain accessible");
  await page.getByRole("button", { name: /^孵化中/ }).click();
  await rows.first().getByRole("button", { name: "打开笔记" }).click();
  const notebook = page.locator("#product-notebook-Alpha");
  await notebook.getByRole("textbox", { name: "笔记", exact: true }).fill("Unsaved draft");
  await page.getByRole("button", { name: /^搁置/ }).click();
  await page.getByRole("button", { name: /^孵化中/ }).click();
  check(await notebook.getByRole("textbox", { name: "笔记", exact: true }).inputValue() === "Unsaved draft", "Filtering must preserve drafts");
  await notebook.getByRole("button", { name: "保存", exact: false }).click();
  await notebook.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  check(ideas[0].note === "Unsaved draft", "Save must persist the intended draft");
  await page.evaluate(() => { window.confirm = () => true; });
  await notebook.getByRole("button", { name: "删除产品" }).click();
  await page.getByRole("alert").filter({ hasText: "Test delete failed" }).waitFor();
  check(await notebook.isVisible(), "Failed deletion must not close the notebook");

  const capture = page.getByRole("region", { name: "留住一个念头" });
  await capture.getByRole("textbox", { name: "名称", exact: true }).fill("New product");
  await capture.getByRole("textbox", { name: "笔记", exact: true }).fill("A personal problem");
  await capture.getByRole("button", { name: "放到工作台" }).click();
  await page.locator("#product-notebook-new-product").waitFor();
  check(classifications === 0 && ideas.length === 4, "Direct capture must create exactly one idea without AI");
  await capture.getByRole("button", { name: "链接 / 截图" }).click();
  await capture.getByRole("textbox", { name: "原始素材" }).fill("First capture");
  await capture.getByRole("button", { name: "检查并分类" }).click();
  await capture.getByRole("alert").filter({ hasText: "素材已保留" }).waitFor();
  check(captures.length === 1, "AI failure must retain the raw capture");
  failClassify = false;
  await capture.getByRole("button", { name: /First capture/ }).click();
  await capture.getByRole("textbox", { name: "标题", exact: true }).waitFor();
  check(await capture.getByRole("textbox", { name: "标题", exact: true }).inputValue() === "First capture", "Retry must open the saved capture");
  await capture.getByRole("textbox", { name: "原始素材" }).fill("Second capture");
  await capture.getByRole("button", { name: "检查并分类" }).click();
  await page.waitForFunction(() => document.querySelector('section[aria-labelledby="product-capture-title"] input[aria-label="标题"]')?.value === "Second capture");
  const readsBefore = libraryReads;
  await capture.getByRole("button", { name: "确认保存" }).click();
  await page.waitForFunction(() => !document.querySelector('section[aria-labelledby="product-capture-title"] input[aria-label="标题"]'));
  check(libraryReads > readsBefore, "Filing a resource must refresh the shared library snapshot");

  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    check(await page.evaluate(() => [...document.querySelectorAll("main, main *")].every((el) => !el.getClientRects().length || el.getBoundingClientRect().right <= innerWidth + 1)), `Product content overflows at ${width}px`);
  }
  await page.getByRole("button", { name: /打开工具箱/ }).click();
  check(await page.locator("#product-library").isVisible(), "Toolkit must open in place");
  ideas = [];
  await page.reload();
  await page.getByRole("heading", { name: "你的下一个产品，从一个念头开始。" }).waitFor();
  check(errors.length === 0, `Browser exceptions: ${errors.join(", ")}`);
  return "PASS: filters, draft preservation/save, failed deletion, direct creation, AI failure/retry, review reset, library refresh, empty state, 375/768/1440px layouts";
}
