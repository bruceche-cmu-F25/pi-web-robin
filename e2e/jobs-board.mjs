// Run against the existing dev server. Every dashboard API is mocked; no job data is written.
// node --env-file-if-exists=.env.local --experimental-strip-types e2e/jobs-board.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { DEFAULT_JOB_PROFILE, sortJobs } from "../extension/robin/jobs.ts";
import { groupJobRoles } from "../components/robin/jobs-view.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
const job = (id, extra = {}) => ({
  id, company: id, title: "Software Engineer", location: "Remote", source: "greenhouse",
  status: "new", url: `https://example.com/jobs/${id}`, discoveredAt: "2026-10-10T12:00:00Z",
  reason: "Backend experience is relevant. Confirm the work authorization and start date requirements before applying.", ...extra,
});
try {
  for (const locale of ["en", "zh-CN"]) {
    const zh = locale === "zh-CN";
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
    if (process.env.PI_WEB_PASSWORD) {
      const login = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
      assert.ok(login.ok(), `Login failed (${login.status()})`);
    }
    await context.addInitScript((locale) => localStorage.setItem("pi-locale", locale), locale);
    let jobs = [
      job("Best", { score: 4.7 }),
      job("Mirror", { company: "Best", score: 2, location: "San Francisco", source: "lever" }),
      job("Recent", { score: 3.9, discoveredAt: "2026-10-14T12:00:00Z" }),
      job("Unknown"), job("Low", { score: 2 }),
      job("Low-mirror", { company: "Low", score: 1 }),
      job("Saved", { status: "shortlist", score: 4 }),
      job("Applied-old", { status: "applied", score: 5, appliedAt: "2026-10-10T12:00:00Z" }),
      job("Applied-new", { status: "applied", score: 3, appliedAt: "2026-10-14T12:00:00Z" }),
    ];
    const writes = [];
    let applicationStage = "attention";
    let autoBatchLimit = zh ? 0 : 10;
    let scheduleEnabled = true;
    let applicationUrl = "https://example.com/fixture";
    let extraApplicationCount = 0;
    const dismissedApplications = new Set();
    const applicationWrites = [];
    const answerWrites = [];
    let answerReads = 0;
    let answerEditor = { confirmedFacts: "", standing: {}, answers: {}, revision: "a".repeat(64) };
    await context.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() !== "GET") {
        const body = request.postDataJSON();
        if (path === "/api/robin/jobs/applications/answers") {
          assert.equal(request.method(), "PATCH");
          answerWrites.push(body);
          if (body.kind === "profile") {
            assert.equal(body.expectedRevision, answerEditor.revision);
            answerEditor = { ...answerEditor, confirmedFacts: body.confirmedFacts, standing: body.standing,
              answers: { ...Object.fromEntries(Object.entries(answerEditor.answers).filter(([key]) => key.startsWith('[job:'))), ...body.generalAnswers }, revision: "b".repeat(64) };
          } else {
            answerEditor = { ...answerEditor, answers: { ...answerEditor.answers, [`[job:${body.id}] ${body.label}`]: body.answer } };
            if (applicationStage === 'attention') applicationStage = 'blocked';
          }
          return route.fulfill({ json: answerEditor });
        }
        if (path === "/api/robin/jobs/applications" && request.method() === 'PATCH') {
          scheduleEnabled = body.enabled;
          autoBatchLimit = body.dailyLimit ?? autoBatchLimit;
          return route.fulfill({ json: { ok: true } });
        }
        if (path === "/api/robin/jobs/applications") {
          assert.equal(request.method(), "POST");
          assert.ok(["dismiss", "drop", "prepare"].includes(body.action), "only explicit rerun, drop or dismissal may write here");
          applicationWrites.push(body);
          if (body.action === "dismiss" || body.action === "drop") dismissedApplications.add(body.id);
          return route.fulfill({ json: { ok: true } });
        }
        assert.equal(path, "/api/robin/jobs");
        writes.push(body);
        jobs = jobs.map((job) => body.ids?.includes(job.id) ? { ...job, status: body.status } : job);
        return route.fulfill({ json: { ok: true } });
      }
      if (path === "/api/robin/jobs/applications/answers") answerReads++;
      const fixtures = {
        "/api/robin/jobs": { jobs, scan: null, minScore: 3.75, configured: true },
        "/api/robin/jobs/profile": { profile: { ...DEFAULT_JOB_PROFILE, minScore: 3.75 }, providers: [], presets: [], starterCompanies: [] },
        "/api/robin/jobs/score": { scoring: null, pending: 1, model: null },
        "/api/robin/jobs/sweep": { sweep: null },
        "/api/robin/jobs/applications/answers": answerEditor,
        "/api/robin/jobs/applications": {
          settings: { enabled: scheduleEnabled, timeZone: "America/Los_Angeles", at: "09:00", dailyLimit: autoBatchLimit, autoSubmit: true, resumeName: "approved.pdf", resumeHash: "a".repeat(64), configured: true, preferencesChanged: false },
          running: false, day: "2026-10-25", today: 2, todaySubmitted: 0, legacy: 0, counts: { preparing: 0, review: 0, attention: 1, error: applicationStage === 'error' ? 2 : 1, unavailable: 1, submitted: 0 }, total: 3,
          dailyCheck: { day: '2026-10-25', timeZone: 'America/Los_Angeles', at: '2026-10-26T02:30:00Z', discovered: 7, unscored: 2,
            pendingScoring: 0, eligible: 0, attempted: 2, confirmed: 0, unresolved: 1, issues: ['supply-empty', 'no-receipts'],
            failures: [{ reason: 'UNCLASSIFIED_ERROR', count: 1, ids: ['incomplete-fixture'] }] },
          report: { day: '2026-10-25', timeZone: 'America/Los_Angeles', asOf: '2026-10-26T01:30:00Z', running: false, enabled: true,
            attempted: 2, confirmed: 0, errors: 0, attention: 1, uncertain: 1, shown: 2, total: 2, delivery: 'accepted',
            rows: [{ id: 'application-fixture', company: 'Example', title: 'Engineer', stage: 'attention', updatedAt: '2026-10-25T17:00:00Z', attemptedToday: true, receiptAt: null },
              { id: 'prior-fixture', company: 'Prior', title: 'Engineer', stage: 'uncertain', updatedAt: '2026-10-24T17:00:00Z', attemptedToday: false, receiptAt: null }] },
          rows: [{ id: "application-fixture", company: "Example", title: "Engineer", status: "new",
            pendingQuestionKeys: [
              !answerEditor.answers['[job:application-fixture] Will you relocate to New York City?'] && !answerEditor.answers['Will you relocate to New York City?'] && 'relocation',
              !answerEditor.answers['[job:application-fixture] Do you have startup experience?'] && !answerEditor.answers['Do you have startup experience?'] && 'startup',
            ].filter(Boolean), application: {
            attemptId: "test", workflowVersion: 2, phase: "Only unresolved personal questions remain", stage: applicationStage, startedAt: "2026-10-25T17:00:00Z", updatedAt: "2026-10-25T17:00:00Z", days: ["2026-10-25"], url: applicationUrl,
            resumeHash: "a".repeat(64), preferencesHash: "test", resumeVerified: true,
            fields: [{ key: "relocation", kind: "select", options: ["Yes", "No"], label: "Will you relocate to New York City?", value: "", required: true, check: "empty" },
              { key: "startup", kind: "select", options: ["Yes", "No"], label: "Do you have startup experience?", value: "", required: true, check: "empty" }], blockers: ["Confirm willingness to relocate to New York City"],
          } }, { id: 'closed-fixture', company: 'Unavailable example', title: 'Engineer', status: 'new', pendingQuestionKeys: [], application: {
            attemptId: 'closed', workflowVersion: 2, phase: 'Posting unavailable at last check', stage: 'unavailable', startedAt: '2026-10-25T17:00:00Z', updatedAt: '2026-10-25T17:00:00Z', days: ['2026-10-25'], url: 'https://example.com/closed',
            resumeVerified: false, fields: [], blockers: ['Posting missing'],
          } }, { id: 'incomplete-fixture', company: 'Autofill example', title: 'Engineer', status: 'new', pendingQuestionKeys: [], application: {
            attemptId: 'incomplete', workflowVersion: 2, phase: 'Stopped before submission', stage: 'error', startedAt: '2026-10-24T17:00:00Z', updatedAt: '2026-10-24T17:00:00Z', days: ['2026-10-24'], url: 'https://example.com/autofill',
            resumeVerified: false, fields: [], blockers: ['JOBRIGHT_INCOMPLETE'],
          } }],
        },
        "/api/robin/rounds": { rounds: [{ id: "round-fixture", kind: "oa", company: "Abridge", due: "2026-11-16", status: "open", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" }] },
        "/api/robin/links": { links: [] },
      };
      const params = new URL(request.url()).searchParams;
      const scope = params.get("status");
      if (path === "/api/robin/jobs" && params.get("view") === "navigation") {
        return route.fulfill({ json: { shortlist: jobs.filter(job => job.status === "shortlist").length, hasNew: jobs.some(job => job.status === "new") } });
      }
      if (path === "/api/robin/jobs" && scope) {
        const ordered = sortJobs(jobs);
        return route.fulfill({ json: { ...fixtures[path], scope,
          jobs: scope === "all" ? ordered : ordered.filter(job => job.status === scope),
          cards: groupJobRoles(ordered).map(({ job, also }) => ({ status: job.status, ids: [job.id, ...also.map(copy => copy.id)] })),
          overview: {
            matches: ordered.filter(job => job.status === "new" && job.score >= 3.75).map(({ id, company, title, discoveredAt }) => ({ id, company, title, discoveredAt })),
            notifications: ordered.filter(job => job.notifiedAt).map(({ id, notifiedAt }) => ({ id, notifiedAt })),
          },
        } });
      }
      const board = fixtures["/api/robin/jobs/applications"];
      board.rows.push(...Array.from({ length: extraApplicationCount }, (_, i) => ({
        ...board.rows[0], id: `extra-application-${i}`, company: `Extra application ${i}`,
      })));
      board.rows = board.rows.filter(row => !dismissedApplications.has(row.id));
      board.total = board.rows.length;
      board.counts = board.rows.reduce((counts, row) => { const stage = row.application.stage; counts[stage] = (counts[stage] ?? 0) + 1; return counts; }, {});
      return route.fulfill({ json: fixtures[path] ?? {} });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/dashboard/jobs");
    const stage = (name) => page.getByRole("group", { name: zh ? "投递状态" : "Application status" }).getByRole("button", { name });
    const rows = page.locator('a[href^="https://example.com/jobs/"]').filter({ has: page.locator("b") });
    const firstCompany = () => rows.first().locator("b").textContent();
    const search = page.getByRole("searchbox");
    const sort = page.getByRole("combobox", { name: zh ? "排序" : "Sort by" });
    await page.getByRole("heading", { name: zh ? "优先看" : "Look here first", exact: true }).waitFor();
    assert.equal(await firstCompany(), "Best");
    assert.equal(await rows.count(), 3);
    const applications = page.getByRole("region", { name: zh ? "自动投递" : "Auto-apply" });
    assert.deepEqual(await applications.evaluate((el) => {
      const style = getComputedStyle(el);
      return { material: style.getPropertyValue("--glass-material").trim(), radius: style.borderRadius, filter: style.backdropFilter };
    }), { material: "frost", radius: "24px", filter: "blur(10px)" }, "auto-apply shares the Glass frost surface without nested glass cards");
    if (!zh) {
      const darkSurface = await applications.evaluate((el) => {
        document.documentElement.dataset.theme = "glass-dark";
        const style = getComputedStyle(el);
        return { material: style.getPropertyValue("--glass-material").trim(), fill: style.backgroundColor };
      });
      assert.equal(darkSurface.material, "frost");
      assert.notEqual(darkSurface.fill, await applications.evaluate((el) => {
        document.documentElement.dataset.theme = "glass";
        return getComputedStyle(el).backgroundColor;
      }), "dark Glass should use its own tint");
    }
    const history = applications.locator('details[data-application-history]');
    const openHistory = async () => { if (!await history.evaluate(el => el.open)) await history.locator(':scope > summary').click(); };
    const applicationRow = () => applications.locator('details[data-application-record] > summary').filter({ hasText: /Example — Engineer/ });
    assert.ok(await page.locator("#application-answers").evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector("#job-discoveries")) & Node.DOCUMENT_POSITION_FOLLOWING)), "application desk precedes positions");
    assert.ok(await page.locator("#job-rounds").evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector("#job-discoveries")) & Node.DOCUMENT_POSITION_FOLLOWING)), "rounds live in the context column before positions");
    assert.ok(await page.locator("#job-rounds").evaluate(el => el.getBoundingClientRect().right < document.querySelector("#job-discoveries").getBoundingClientRect().left), "rounds fit the left margin at desktop width");
    assert.equal(answerReads, 0, "application settings stay private and unfetched until opened");
    const report = applications.locator('#application-report');
    assert.ok(await report.isVisible());
    assert.ok(await report.getByText(zh ? '今日回执确认' : 'receipt-confirmed today').isVisible());
    assert.ok(await report.getByText(zh ? '已尝试' : 'attempted').isVisible());
    assert.ok(await applications.getByText(zh ? '每日流程检查' : 'Daily pipeline check', { exact: false }).isVisible());
    assert.ok(await applications.getByText(zh ? '原因尚未归类' : 'Cause not classified', { exact: false }).isVisible());
    assert.ok(await report.getByText(zh ? '自动运行暂停' : 'Auto-run · up to 10 roles per batch', { exact: false }).isVisible());
    const autoButton = applications.getByRole('button', { name: zh ? '开启自动投递' : 'Pause auto-apply' });
    assert.ok(await autoButton.isEnabled());
    if (zh) {
      await autoButton.click();
      await applications.getByRole('button', { name: '暂停自动投递' }).waitFor();
      assert.equal(autoBatchLimit, 5, 'enabling from the old zero budget starts bounded automatic runs');
      assert.equal(applicationWrites.length, 0, 'enabling never triggers an immediate browser submission');
    }
    const themedButton = applications.getByRole('button', { name: zh ? '暂停自动投递' : 'Pause auto-apply' });
    await page.mouse.move(0, 0);
    assert.ok(await themedButton.evaluate((button) => {
      const swatch = document.createElement('span');
      swatch.style.color = 'var(--todo-teal)';
      button.append(swatch);
      const matches = getComputedStyle(button).backgroundColor === getComputedStyle(swatch).color;
      swatch.remove();
      return matches;
    }), 'primary button uses the Jobs icon color');
    assert.equal(await report.getByRole('img').count(), 0, 'daily attempts are a count, not a quota or success rate');
    assert.equal(await history.evaluate(el => el.open), false, 'history is not the default reading surface');
    if (process.env.E2E_SCREENSHOT_DIR) {
      await mkdir(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
      await applications.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/auto-apply-${locale}-initial.png` });
    }
    await openHistory();
    assert.equal(await applications.getByText('Prior · Engineer').isVisible(), false, 'prior unresolved records stay folded');
    await applications.getByText(zh ? /此前未解决/ : /Earlier unresolved/).click();
    assert.ok(await applications.getByText('Prior · Engineer').isVisible());
    await applications.getByText(zh ? /今日岗位/ : /Today's roles/).click();
    await applications.getByRole('button', { name: zh ? '查看记录' : 'View record' }).first().click();
    await page.waitForFunction(() => document.getElementById('job-application-application-fixture')?.open === true);
    assert.equal(answerReads, 0, 'report navigation does not fetch private approved answers');
    assert.ok(await applications.locator('#application-questions[open]').isVisible());
    assert.ok(await applications.locator('#application-questions').getByText("Will you relocate to New York City?", { exact: false }).isVisible());
    assert.equal(answerReads, 0, "reviewing question labels never fetches private answers");
    await applications.getByRole("button", { name: zh ? "填写答案" : "Answer", exact: true }).first().click();
    await applications.locator('#application-specific-answers[open]').waitFor();
    if (process.env.E2E_SCREENSHOT_DIR) await applications.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/auto-apply-${locale}-answer.png` });
    assert.equal(await applications.getByLabel(zh ? "岗位" : "Application", { exact: true }).count(), 0, 'focused editor hides unrelated profile and job navigation');
    assert.equal(await applications.getByLabel(zh ? "雇主表单原题" : "Exact employer question").count(), 0);
    await applications.getByLabel(zh ? "授权的答案（有选项时须选原文）" : "Approved answer (exact option when provided)").selectOption("No");
    page.once('dialog', dialog => dialog.dismiss());
    await applications.getByRole('button', { name: zh ? /关闭/ : /Close/ }).click();
    assert.ok(await applications.locator('#application-specific-answers[open]').isVisible(), 'closing with an unsaved answer needs confirmation');
    await applications.getByRole("checkbox", { name: zh ? /我知道：此答案可用于后续/ : /I understand: this answer may be used/ }).check();
    await applications.getByRole("button", { name: zh ? "保存答案" : "Save answer" }).click();
    await applications.getByRole('heading', { name: 'Do you have startup experience?' }).waitFor();
    await applications.locator('#application-questions').getByText('Do you have startup experience?', { exact: true }).first().waitFor();
    assert.equal(await applications.locator('#application-questions').getByText('Will you relocate to New York City?').count(), 0,
      'the saved question is hidden, but the next one remains visible after source invalidation');
    assert.equal(applicationWrites.length, 0, "answer approval must not start or submit the application");
    assert.deepEqual(answerWrites[0], { kind: "field", id: "application-fixture", label: "Will you relocate to New York City?", answer: "No" });
    await applications.getByLabel(zh ? "授权的答案（有选项时须选原文）" : "Approved answer (exact option when provided)").selectOption("Yes");
    await applications.getByRole("button", { name: zh ? "保存答案" : "Save answer" }).click();
    await applications.locator('#application-questions').waitFor({ state: 'detached' });
    assert.equal(applicationWrites.length, 0, 'saving all answers waits for automatic processing; it never clicks Submit');
    assert.deepEqual(answerWrites[1], { kind: 'field', id: 'application-fixture', label: 'Do you have startup experience?', answer: 'Yes' });
    assert.equal(await applications.getByRole("button", { name: zh ? "编辑个人答案" : "Edit personal answers" }).count(), 0, "the personal editor is hidden by default");
    if (!await applications.locator('#job-application-application-fixture').evaluate(el => el.open)) await applicationRow().click();
    await applications.locator('#job-application-application-fixture').getByText("Confirm willingness to relocate to New York City", { exact: true }).waitFor();
    assert.equal(await applications.getByRole("button", { name: zh ? "检查提交回执" : "Check submission receipt" }).count(), 1);
    assert.equal(await applications.getByRole("button", { name: /^Submit$/ }).count(), 0);
    const applicationLink = () => applications.getByRole("link", { name: zh ? "打开申请网页" : "Open application page" }).filter({ visible: true });
    assert.equal(await applicationLink().getAttribute("href"), applicationUrl);
    assert.equal(await applicationLink().getAttribute("target"), "_blank");
    assert.equal(await applicationLink().getAttribute("rel"), "noopener noreferrer");
    await applications.getByText(zh ? "设置与授权资料" : "Settings & approved sources").click();
    await applications.getByRole("button", { name: zh ? "编辑个人答案" : "Edit personal answers" }).click();
    await applications.getByLabel(zh ? "代词" : "Pronouns", { exact: true }).fill("he/him");
    await applications.getByLabel(zh ? "族裔／种族" : "Race / ethnicity").fill("Asian");
    await applications.getByLabel(zh ? "现在是否需要雇主签证担保？" : "Require employer visa sponsorship now?").selectOption("No");
    await applications.getByLabel(zh ? "将来是否需要雇主签证担保？" : "Require employer visa sponsorship in the future?").selectOption("No");
    await applications.getByLabel(zh ? "添加常见问题" : "Add a recurring question").fill("Preferred city?");
    await applications.getByLabel(zh ? "答案" : "Answer", { exact: true }).fill("Seattle");
    await applications.getByRole("button", { name: zh ? "加入档案" : "Add to profile" }).click();
    const saveAnswers = applications.getByRole("button", { name: zh ? "保存个人答案" : "Save personal answers" });
    assert.equal(await saveAnswers.isDisabled(), true, "enabled automatic submission requires explicit acknowledgement");
    await applications.getByRole("checkbox", { name: zh ? /我知道：校验后自动提交/ : /I understand: checked submission/ }).check();
    await saveAnswers.click();
    await applications.getByText(zh ? "个人答案已保存，供以后申请复用" : "Personal answers saved for future applications").waitFor();
    assert.deepEqual(answerWrites.map((body) => body.kind), ["field", "field", "profile"], "two job answers and one reusable profile save");
    assert.deepEqual(answerWrites[2].standing, { pronouns: "he/him", raceEthnicity: "Asian", sponsorshipNow: "No", sponsorshipFuture: "No" });
    assert.deepEqual(answerWrites[2].generalAnswers, { "Preferred city?": "Seattle" });
    await applications.getByText(zh ? "回答申请表中的问题" : "Answer a question from an application").click();
    await applications.getByLabel(zh ? "岗位" : "Application", { exact: true }).selectOption('application-fixture');
    await applications.getByLabel(zh ? "雇主表单原题" : "Exact employer question").selectOption('relocation');
    await applications.getByRole("checkbox", { name: zh ? /以后遇到完全相同的问题/ : /Reuse for future applications/ }).check();
    await applications.getByRole("button", { name: zh ? "授权此题" : "Approve this question" }).click();
    await applications.getByText(zh ? /此答案已保存，供本岗位/ : /Answer saved for this and future/).waitFor();
    assert.equal(answerWrites[3].kind, "profile");
    assert.equal(answerWrites[3].generalAnswers["Will you relocate to New York City?"], "No");
    assert.equal(applicationWrites.length, 0, "reusable approval still never starts a browser action");
    await applications.getByRole("button", { name: zh ? /关闭/ : /Close/ }).click();
    await applicationRow().click();
    await applications.getByText(zh ? '历次状态统计' : 'All-time status counts').click();
    assert.match(await applications.getByText(zh ? /职位不可访问 1/ : /Posting unavailable 1/).textContent(), zh ? /职位不可访问 1/ : /Posting unavailable 1/);
    await applications.getByRole('combobox').selectOption('unavailable');
    assert.equal(await applicationRow().count(), 0);
    assert.equal(await applications.locator('#job-application-closed-fixture > summary').count(), 1);
    await applications.locator('#job-application-closed-fixture > summary').click();
    assert.ok(await applications.locator('#job-application-closed-fixture').getByText(zh ? '表单与简历附件均未核查。' : 'Form and resume attachment were not checked.', { exact: true }).isVisible());
    assert.equal(await applicationLink().getAttribute("href"), "https://example.com/closed");
    await applications.locator('#job-application-closed-fixture > summary').click();
    await applications.getByRole('combobox').selectOption('all');
    const incomplete = applications.locator('#job-application-incomplete-fixture');
    await incomplete.locator('summary').click();
    assert.ok(await incomplete.getByText(zh ? '未能确认 Jobright Autofill 完成；表单与简历附件均未核查。' : 'Jobright Autofill completion was not observed; form and resume attachment were not checked.', { exact: true }).isVisible());
    assert.equal(await incomplete.getByText(zh ? '尚未在申请页看到简历附件。' : 'No resume attachment observed on the application page.', { exact: true }).count(), 0);
    await incomplete.locator('summary').click();
    const recovery = applications.getByText(zh ? /需要核查/ : /Needs checking/);
    await recovery.click();
    assert.ok(await applications.getByText(zh ? /未核验到 Jobright 完成/ : /Jobright completion was not verified/).isVisible());
    assert.equal(await applications.getByRole('button', { name: zh ? '修复后重跑' : 'Rerun after fixing' }).count(), 1);
    assert.deepEqual(applicationWrites.map(write => write.action), [], 'saving answers and viewing technical failures never starts a browser run');
    await recovery.click();
    assert.match(await stage(zh ? /待筛选/ : /To review/).textContent(), /4$/);
    assert.ok(await history.locator(':scope > summary').isVisible());

    await sort.selectOption("recent");
    await rows.first().filter({ hasText: "Recent" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: zh ? "优先看" : "Look here first", exact: true }).count(), 0);
    await sort.selectOption("priority");
    await search.fill("francisco");
    await rows.first().filter({ hasText: "Best" }).waitFor();
    assert.equal(await rows.count(), 1);
    assert.ok(await page.getByRole("link", { name: "Lever", exact: true }).isVisible());
    await search.fill("low");
    await rows.first().filter({ hasText: "Low" }).waitFor();
    assert.equal(await rows.count(), 1, "search includes folded low scores");
    await page.getByRole("button", { name: zh ? "全部丢弃（1）" : "Drop all 1", exact: true }).click();
    await page.getByRole("button", { name: zh ? "撤销" : "Undo", exact: true }).waitFor();
    assert.deepEqual(writes.at(-1).ids.sort(), ["Low", "Low-mirror"]);
    await page.getByRole("button", { name: zh ? "撤销" : "Undo", exact: true }).click();
    await rows.first().filter({ hasText: "Low" }).waitFor();
    await search.fill("no-such-company");
    await page.getByRole("button", { name: zh ? "清空搜索" : "Clear search", exact: true }).click();
    await rows.first().filter({ hasText: "Best" }).waitFor();
    await stage(zh ? /^已投/ : /^Applied/).click();
    await rows.first().filter({ hasText: "Applied-new" }).waitFor();
    assert.equal(await sort.count(), 0);
    await stage(zh ? /待筛选/ : /To review/).click();
    await rows.first().filter({ hasText: "Best" }).waitFor();
    await search.fill("Best");
    await page.getByRole("heading", { name: zh ? "优先看" : "Look here first", exact: true }).click();
    await page.keyboard.press("j");
    await page.keyboard.press("s");
    await page.getByRole("button", { name: zh ? "撤销" : "Undo", exact: true }).waitFor();
    assert.deepEqual(writes.at(-1).ids.sort(), ["Best", "Mirror"], "keyboard action retains even low-score duplicate sources");
    await page.getByRole("button", { name: zh ? "撤销" : "Undo", exact: true }).click();
    await rows.first().filter({ hasText: "Best" }).waitFor();
    await search.fill("");

    for (const width of [1440, 375, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle("dark", theme === "dark"); }, theme);
        await page.locator(".robin-dashboard").evaluate((el) => { el.scrollTop = 0; });
        const size = await page.locator(".robin-dashboard").evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
        assert.ok(size.scroll <= size.client + 1, `${locale}/${width}/${theme}: overflow ${JSON.stringify(size)}`);
        if (width === 320 && theme === "light") {
          await applications.getByText(zh ? "设置与授权资料" : "Settings & approved sources").click();
          await applications.getByRole("button", { name: zh ? "编辑个人答案" : "Edit personal answers" }).click();
          await applications.getByLabel(zh ? "代词" : "Pronouns", { exact: true }).waitFor();
          const editorSize = await page.locator(".robin-dashboard").evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
          assert.ok(editorSize.scroll <= editorSize.client + 1, `${locale}/320/editor: overflow ${JSON.stringify(editorSize)}`);
          await applications.getByRole("button", { name: zh ? /关闭/ : /Close/ }).click();
        }
        if (width < 960) {
          const searchBox = await search.boundingBox();
          const filterBox = await page.getByRole("button", { name: zh ? /编辑筛选/ : /edit filter/i }).boundingBox();
          assert.ok(searchBox.y < filterBox.y, "mobile puts jobs before configuration");
        }
        if (process.env.E2E_SCREENSHOT_DIR) {
          await mkdir(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
          await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/jobs-${locale}-${width}-${theme}.png` });
        }
      }
    }
    const directAnswers = await context.newPage();
    await directAnswers.goto("/dashboard/jobs#application-answers");
    await directAnswers.getByRole("heading", { name: zh ? "通用个人申请答案" : "Reusable personal answers" }).waitFor();
    await directAnswers.waitForFunction(() => {
      const box = document.querySelector("#application-answers")?.getBoundingClientRect();
      return box && box.top < innerHeight && box.bottom > 0;
    }, null, { timeout: 5000 });
    await directAnswers.close();
    const readsBeforeQuestions = answerReads;
    const directQuestions = await context.newPage();
    await directQuestions.goto("/dashboard/jobs#application-questions");
    await directQuestions.getByRole('heading', { name: zh ? '自动投递' : 'Auto-apply' }).waitFor();
    assert.equal(await directQuestions.locator('#application-questions').count(), 0, 'answered questions stay absent on reload');
    assert.equal(answerReads, readsBeforeQuestions, "question deep link never reads private approved answers");
    await directQuestions.close();
    // Pagination must reset on a new search rather than leave an empty second page.
    jobs.push(...Array.from({ length: 55 }, (_, i) => job(`Extra-${i}`, { score: 4.1 })));
    await page.reload();
    await rows.first().waitFor();
    assert.equal(await rows.count(), 50);
    await page.getByRole("button", { name: zh ? /再显示/ : /Show \d+ more/ }).click();
    assert.equal(await rows.count(), 58);
    await search.fill("Unknown");
    await rows.first().filter({ hasText: "Unknown" }).waitFor();
    assert.equal(await rows.count(), 1);
    // Direct links survive failures and submission, without invoking browser automation.
    for (const state of ["error", "submitted"]) {
      applicationStage = state;
      await page.reload();
      await openHistory();
      await applicationRow().click();
      assert.equal(await applicationLink().getAttribute("href"), applicationUrl);
      if (state === "error") {
        const errorLabel = applications.locator('#job-application-application-fixture summary > span');
        assert.equal(await errorLabel.evaluate(el => el.style.color), "var(--danger)");
        assert.equal(await applications.locator('#job-application-application-fixture').getByText("Confirm willingness to relocate to New York City", { exact: true }).evaluate(el => el.parentElement.style.color), "var(--danger)");
        const errorCount = applications.getByText(zh ? "技术失败 2" : "Automation error 2", { exact: true });
        assert.equal(await errorCount.evaluate(el => el.style.color), "var(--danger)");
      }
      const remove = applications.getByRole("button", { name: zh ? "移除记录" : "Remove record" });
      const before = applicationWrites.length;
      page.once("dialog", dialog => dialog.dismiss());
      await remove.click();
      assert.equal(applicationWrites.length, before, "cancel keeps the record");
      page.once("dialog", async dialog => {
        assert.match(dialog.message(), /Example — Engineer/);
        await dialog.accept();
      });
      await remove.click();
      await applicationRow().waitFor({ state: "detached" });
      assert.deepEqual(applicationWrites.at(-1), { action: "dismiss", id: "application-fixture" });
      await page.reload();
      await openHistory();
      await applications.locator('#job-application-closed-fixture > summary').waitFor();
      assert.equal(await applicationRow().count(), 0);
      assert.ok(await applications.locator('#application-report').isVisible());
      dismissedApplications.clear();
    }
    applicationUrl = "javascript:alert(1)";
    await page.reload();
    await openHistory();
    await applicationRow().click();
    assert.equal(await applicationLink().count(), 0, "non-web URLs must not become links");
    // Long automation lists collapse independently of job pagination and never write data.
    const writesBeforeDisclosure = applicationWrites.length;
    const applicationSummaries = applications.locator('details[data-application-history] > details[data-application-record] > summary').filter({ hasText: ' — Engineer' });
    const disclosure = applications.getByRole('button', { name: zh ? /展开全部.*条记录|收起列表/ : /Show all .* records|Collapse list/ });
    for (const count of [5, 6, 12]) {
      extraApplicationCount = count - 3;
      await page.reload();
      await openHistory();
      await applicationSummaries.first().waitFor();
      assert.equal(await applicationSummaries.count(), 5);
      assert.equal(await disclosure.count(), count > 5 ? 1 : 0);
      if (count === 5) continue;
      assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
      assert.match(await disclosure.textContent(), new RegExp(String(count)));
      await disclosure.focus();
      await page.keyboard.press('Enter');
      assert.equal(await applicationSummaries.count(), count);
      assert.equal(await disclosure.getAttribute('aria-expanded'), 'true');
      await page.keyboard.press('Space');
      assert.equal(await applicationSummaries.count(), 5);
      assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
      assert.ok(await disclosure.evaluate(el => el === document.activeElement));
      await disclosure.click();
      await applications.getByRole('combobox').selectOption('unavailable');
      assert.equal(await applicationSummaries.count(), 1);
      assert.equal(await disclosure.count(), 0);
      await applications.getByRole('combobox').selectOption('review');
      assert.equal(await applicationSummaries.count(), 0);
      assert.equal(await disclosure.count(), 0);
      await applications.getByRole('combobox').selectOption('all');
      assert.equal(await applicationSummaries.count(), 5, 'changing filters resets to the compact list');
      assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
    }
    assert.equal(applicationWrites.length, writesBeforeDisclosure);
    applicationStage = 'attention';
    answerEditor.answers = {};
    extraApplicationCount = 0;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    const drop = applications.getByRole('button', { name: zh ? '放弃此岗位' : 'Drop this job' }).first();
    await drop.waitFor();
    const beforeDrop = applicationWrites.length;
    page.once('dialog', dialog => dialog.dismiss());
    await drop.click();
    assert.equal(applicationWrites.length, beforeDrop, 'cancel leaves every question and job intact');
    page.once('dialog', dialog => dialog.accept());
    await drop.click();
    await applications.locator('#application-questions').waitFor({ state: 'detached' });
    assert.deepEqual(applicationWrites.at(-1), { action: 'drop', id: 'application-fixture' });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${locale}: priority, search, sources, undo, applied log, pagination and responsive themes passed`);
  }
} finally {
  await browser.close();
}
