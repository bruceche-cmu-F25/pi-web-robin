// Run on /product/jarvis in a disposable authenticated session:
// playwright-cli -s=jarvis-check run-code --filename=scripts/check-jarvis-ui.playwright.js
// All Jarvis reads/writes are intercepted. No real contacts are changed or emailed.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Playwright CLI evaluates this function.
async (page) => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const at = new Date().toISOString();
  let leads = ["Ada Example", "Bob Example"].map((name, i) => ({ id: String(i), name, company: "Example Inc", role: "CTO", seniority: "Executive", industry: "AI tooling", segment: i ? "professional_services" : "clinic", audienceFit: "core", profileUrl: `https://example.com/${i}`, evidence: "Works on tools for applied AI research.", evidenceUrl: "https://example.com/team", needHypothesis: "可能需要减少阅读时间；待验证。", email: i ? "" : "ada@example.com", emailSource: i ? "" : "https://example.com/contact", emailQuote: i ? "" : "Contact ada@example.com", opener: "Your work on AI tools caught my attention.", subject: "A question & an idea", body: "Hi Ada,\n\nHow do you keep up?\n\nBruce", notes: "", confirmedNeeds: "", status: "new", reviewed: false, emailCheck: i ? "missing" : "source_found", createdAt: at, updatedAt: at, history: [{ status: "new", at }] }));
  let run = null;
  let failSave = false;
  let writes = 0;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/robin/jarvis", async (route) => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: { leads, run } });
    writes++;
    const body = req.postDataJSON();
    if (req.method() === "PATCH") {
      if (failSave) return route.fulfill({ status: 500, json: { error: "Test save failure" } });
      leads = leads.map((lead) => lead.id === body.id ? { ...lead, ...body.patch, ...(body.patch.status === "sent" ? { sentAt: at } : {}), ...(body.patch.status === "replied" ? { repliedAt: at } : {}), ...(body.patch.followUp ? { followedUpAt: new Date().toISOString() } : {}) } : lead);
      return route.fulfill({ json: { lead: leads.find((lead) => lead.id === body.id) } });
    }
    run = { id: "mock", status: body.action === "stop" ? "cancelled" : "running", message: "Mock research only", target: body.target ?? 7, added: 0, batches: 1, startedAt: at };
    return route.fulfill({ json: { run } });
  });
  await page.evaluate(() => localStorage.setItem("pi-locale", "zh-CN"));
  await page.reload();
  const list = page.getByRole("region", { name: "候选人名单", exact: true });
  await list.getByRole("button", { name: /Ada Example/ }).waitFor();
  const queue = page.locator("summary", { hasText: "研究队列" });
  await queue.click();
  await page.getByRole("button", { name: /找下一批 3 人/ }).click();
  await page.getByRole("button", { name: /停止搜索/ }).click();
  if (!await page.getByRole("button", { name: /找下一批 3 人/ }).isVisible()) await queue.click();
  await page.getByRole("button", { name: /找下一批 3 人/ }).waitFor();
  const tab = (name) => page.getByRole("tab", { name, exact: true }).click();
  await list.getByRole("button", { name: /Bob Example/ }).click();
  await tab("邮件");
  check(await page.getByRole("button", { name: /已核对身份/ }).isDisabled(), "Missing email cannot be approved");
  await list.getByRole("button", { name: /Ada Example/ }).click();
  const detail = page.getByRole("region", { name: "联系人详情与邮件", exact: true });
  check(await detail.locator('a[href^="mailto:"]').count() === 0, "Unreviewed contacts must not have compose links");
  await detail.getByRole("textbox", { name: "正文", exact: true }).fill("Edited body & question\nSecond line");
  await page.evaluate(() => { window.confirm = () => false; });
  await list.getByRole("button", { name: /Bob Example/ }).click();
  check(await detail.getByRole("heading", { name: "Ada Example" }).isVisible(), "Dirty contact switch must ask before discarding");
  failSave = true;
  await detail.getByRole("button", { name: /保存修改/ }).click();
  await detail.getByRole("alert").filter({ hasText: "Test save failure" }).waitFor();
  check(await detail.getByRole("textbox", { name: "正文", exact: true }).inputValue() === "Edited body & question\nSecond line", "Failed save must preserve draft");
  failSave = false;
  await detail.getByRole("button", { name: /已核对身份/ }).click();
  const gmail = detail.getByRole("link", { name: /在 Gmail 打开/ });
  await gmail.waitFor();
  const params = await gmail.evaluate((link) => Object.fromEntries(new URL(link.href).searchParams));
  check(params.to === "ada@example.com" && params.body === "Edited body & question\nSecond line", "Compose must use reviewed, encoded draft");
  check(leads[0].status === "ready" && !leads[0].sentAt, "Opening a composer must not mark sent");
  check((await list.getByRole("button").first().textContent()).includes("Ada Example"), "Unsent contact with email must sort before missing email");
  await detail.getByRole("button", { name: /^\[ 已发送 \]$/ }).click();
  await page.waitForFunction(() => document.querySelector('select option[value="sent"]:checked'));
  check(leads[0].status === "sent", "Sent button must persist");
  check((await list.getByRole("button").first().textContent()).includes("Bob Example"), "Sent contact must sort below unsent contacts, even without email");
  leads[0].sentAt = new Date(Date.now() - 8 * 86400000).toISOString();
  await page.reload();
  await page.getByRole("button", { name: /查看待跟进/ }).waitFor();
  await page.getByRole("button", { name: /查看待跟进/ }).click();
  check(await list.getByRole("button", { name: /Ada Example/ }).count() === 1, "Overdue sent contact must be filterable");
  await list.getByRole("button", { name: /Ada Example/ }).click();
  await tab("进度与笔记");
  await page.evaluate(() => { window.confirm = () => true; });
  await detail.getByRole("button", { name: /已手动跟进/ }).click();
  await detail.getByRole("status").filter({ hasText: "已记录手动跟进" }).waitFor();
  check(!!leads[0].followedUpAt, "Manual follow-up must persist without sending");
  await page.getByRole("button", { name: /显示全部/ }).click();
  await detail.getByRole("button", { name: /^\[ 已回复 \]$/ }).click();
  await page.waitForFunction(() => document.querySelector('select option[value="replied"]:checked'));
  await detail.getByRole("textbox", { name: /真实需求/ }).fill("I spend two hours reading every morning.");
  await detail.getByRole("button", { name: /保存记录/ }).click();
  await detail.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  check(leads[0].confirmedNeeds.includes("two hours"), "Interview evidence must be saved separately");
  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => { document.documentElement.classList.toggle("dark", value === "dark"); }, theme);
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      check(await page.evaluate(() => [...document.querySelectorAll("main, main *")].every((el) => !el.getClientRects().length || el.getBoundingClientRect().right <= innerWidth + 1)), `${theme} layout overflows at ${width}px`);
    }
  }
  await detail.getByRole("button", { name: /^\[ 不再联系 \]$/ }).click();
  await page.waitForFunction(() => !document.querySelector('a[href^="mailto:"]'));
  check(leads[0].status === "do_not_contact", "Suppression must persist and remove compose links");
  await page.getByRole("searchbox").fill("does not exist");
  await list.getByRole("button").first().waitFor({ state: "detached", timeout: 2000 }).catch(() => {});
  check(await list.getByRole("button").count() === 0, "Search must filter contacts");
  await page.getByRole("searchbox").fill("");
  await list.getByRole("button").first().waitFor();
  await page.getByRole("group", { name: "人群", exact: true }).getByRole("button", { name: /^专业服务/ }).click();
  check(await list.getByRole("button").count() === 1, "Cohort filter must work");
  check(errors.length === 0, `Browser exceptions: ${errors.join(", ")}`);
  check(writes > 0, "Tests must exercise writes through the mock");
  return "PASS: tabs, research/stop, review gating, encoded compose, no auto-send, overdue follow-up/filter/manual mark, failed-save preservation, dirty-switch guard, sent/replied/suppression, interview notes, filters, 375/768/1440px in both themes";
}
