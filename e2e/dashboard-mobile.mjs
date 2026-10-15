// Existing dev server; all dashboard APIs are mocked. No personal data is written.
// node --env-file-if-exists=.env.local --experimental-strip-types e2e/dashboard-mobile.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { fullstackPlan, practicePlan } from "../extension/robin/learning.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  for (const locale of ["en", "zh-CN"]) {
    const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block" });
    if (process.env.PI_WEB_PASSWORD) {
      const login = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
      assert.ok(login.ok(), `Login failed (${login.status()})`);
    }
    await context.addInitScript((locale) => {
      localStorage.setItem("pi-locale", locale);
      // Existing desktop choice must not force Week onto a phone.
      localStorage.setItem("robin-calendar-view", "week");
    }, locale);
    const today = "2030-05-12";
    const fixtures = {
      "/api/robin/todos": { today, todos: [
        { id: "task", title: "Prepare a detailed project walkthrough for the interview, including architecture decisions, deployment failures, performance measurements and what changed after customer feedback", done: false, due: today },
        { id: "ranged-task", title: "Review distributed systems and practise technical interview questions", done: false, startDate: today, due: "2030-05-18" },
        { id: "future", title: "Read the complete design review before the next engineering meeting", done: false, due: "2030-05-17" },
        { id: "done", title: "Completed task", done: true, completedAt: `${today}T12:00:00Z` },
      ] },
      "/api/robin/events": { today, google: { connected: false }, events: [
        { id: "event", title: "Project discussion with the engineering team", date: today, start: "10:00", end: "11:00", source: "local", location: "Video call" },
      ] },
      "/api/robin/jobs": { jobs: [{ id: 'job', company: 'Example', title: 'Software Engineer', url: 'https://example.com/job', source: 'greenhouse', status: 'new', score: 4.5, location: 'Remote', reason: 'A strong match for backend engineering and distributed systems experience. Review the location, start date and work authorization requirements carefully before applying to this position.' }], scan: null, minScore: 4, configured: true },
      "/api/robin/rounds": { rounds: [] },
      "/api/robin/gmail": { connected: true, today, review: null },
      "/api/robin/links": { links: Array.from({ length: 6 }, (_, index) => ({ id: `link-${index}`, title: index === 5 ? 'Docs' : `Engineering handbook ${index + 1}: detailed architecture notes and interview preparation resources for distributed systems`, url: `https://example.com/handbook/${index}`, group: "Reading", iconCheckedAt: today })) },
      "/api/robin/learning": { practice: practicePlan([], "neetcode150", today), fullstack: fullstackPlan([]) },
    };
    const writes = [];
    let mailUnavailable = false;
    await context.route("**/api/**", (route) => {
      if (route.request().method() !== "GET") writes.push(route.request().url());
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/robin/gmail' && mailUnavailable) return route.fulfill({ status: 503, json: { error: 'Fixture unavailable' } });
      return route.fulfill({ json: fixtures[path] ?? {} });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/dashboard");
    const search = page.locator('.robin-assistant-form input');
    await page.locator('#dashboard-todos input[type="checkbox"]').first().waitFor();
    await page.waitForURL((url) => url.searchParams.get("calendar") === "day");
    await page.locator('.robin-calendar [data-single="true"]').waitFor();
    assert.equal(await page.locator('.robin-calendar [data-calendar-minute]').count(), 1);
    const viewSelect = page.locator('.robin-calendar [data-calendar-toolbar] select');
    await viewSelect.selectOption('month');
    await page.goto('/dashboard');
    await page.waitForURL((url) => url.searchParams.get('calendar') === 'month');
    await page.goto('/dashboard?calendar=week');
    await page.waitForFunction(() => document.querySelector('.robin-calendar [data-calendar-toolbar] select')?.value === 'week');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
    await page.waitForURL((url) => url.searchParams.get('calendar') === 'week');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/dashboard');
    await page.waitForURL((url) => url.searchParams.get('calendar') === 'month');
    await viewSelect.selectOption('day');
    await page.goto('/dashboard');
    await page.waitForURL((url) => url.searchParams.get('calendar') === 'day');
    await page.locator('.robin-calendar [data-single]').waitFor();
    assert.equal(await page.locator('[data-single] button[aria-current="date"]').isVisible(), false, 'Phone day view does not repeat its date as a redundant navigation button');
    if (process.env.E2E_SCREENSHOT_DIR) {
      await mkdir(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
      for (const theme of ['dark', 'light']) {
        await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
        await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${locale}-day-${theme}.png`, animations: 'disabled' });
      }
    }
    // Agenda remains available explicitly; the following tests exercise its compact content.
    await page.goto('/dashboard?calendar=agenda');
    await page.getByRole('button', { name: /Project discussion/ }).waitFor();
    const noOverflow = async () => {
      const overflow = await page.locator('.robin-dashboard').evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
      assert.ok(overflow.scroll <= overflow.client + 1, `${locale}: dashboard overflow ${JSON.stringify(overflow)}`);
    };
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 812 });
      if (process.env.E2E_SCREENSHOT_DIR) {
        await mkdir(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${locale}-${width}.png`, animations: 'disabled' });
      }
      await noOverflow();
      const shortcuts = await page.locator('.robin-dashboard-shortcuts a').evaluateAll((links) => links.map((link) => {
        const rect = link.getBoundingClientRect();
        return { top: rect.top, height: rect.height, width: rect.width, scroll: link.scrollWidth, client: link.clientWidth };
      }));
      assert.equal(shortcuts.length, 4);
      for (const link of shortcuts) {
        assert.equal(link.top, shortcuts[0].top, `${locale}/${width}: all four shortcuts must share one line`);
        assert.ok(link.height >= 44 && link.scroll <= link.client + 1, 'Shortcut labels must fit without shrinking or clipping');
      }
      assert.ok((await search.boundingBox()).width >= 120, `${locale}/${width}: search must have room to type`);
      assert.ok(await search.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 16), "Phone inputs must not trigger iOS focus zoom");
      assert.ok((await page.locator('.robin-assistant-row').boundingBox()).height <= 48, 'Search controls occupy one row');
      const toolbar = page.locator('[data-calendar-toolbar]');
      const controls = await toolbar.locator('button, select').evaluateAll((nodes) => nodes.filter((node) => node.getClientRects().length).map((node) => {
        const box = node.getBoundingClientRect(); return { label: node.getAttribute('aria-label') || node.textContent, x: box.x, y: box.y, width: box.width, height: box.height };
      }));
      for (let i = 0; i < controls.length; i++) {
        const a = controls[i];
        assert.ok(a.width >= 43.5 && a.height >= 43.5, `Calendar target must be thumb-sized: ${JSON.stringify(a)}`);
        assert.ok(a.x >= 0 && a.x + a.width <= width + 1);
        for (const b of controls.slice(i + 1)) assert.ok(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1, 'Calendar controls must not overlap');
      }
      assert.equal(new Set(controls.map((control) => Math.round(control.y))).size, 2, 'Calendar actions form exactly two intentional rows');
      const add = await toolbar.locator('.robin-calendar-add').boundingBox();
      const heading = await toolbar.locator('[data-calendar-heading]').boundingBox();
      assert.ok(heading.x + heading.width <= add.x + 1 && heading.y >= add.y - 1 && heading.y + heading.height <= add.y + add.height + 1, 'Date and create action share the first row');
      const event = page.getByRole('button', { name: /Project discussion/ });
      assert.ok((await event.boundingBox()).height >= 44, "Agenda events need a finger-sized target");
    }
    assert.equal(await page.locator('.robin-calendar [data-calendar-toolbar] select').inputValue(), 'agenda');
    // Switching modes must keep the input usable, with no command submitted.
    await search.fill('Unsaved mobile command');
    await page.locator('.robin-assistant-mobile-mode').selectOption('execute');
    assert.ok((await search.boundingBox()).width >= 120);
    assert.equal(await search.inputValue(), 'Unsaved mobile command');
    await page.locator('.robin-assistant-mobile-mode').selectOption('search');
    await page.setViewportSize({ width: 1024, height: 812 });
    assert.equal(await search.inputValue(), 'Unsaved mobile command');
    assert.equal(await page.locator('.robin-assistant-modes button').first().getAttribute('aria-pressed'), 'true');
    await page.setViewportSize({ width: 430, height: 812 });
    assert.equal(await search.inputValue(), 'Unsaved mobile command');
    assert.equal(writes.length, 0, 'Changing mode or layout never executes a command');
    await search.fill("Engineering");
    await page.locator('.robin-assistant-bar [role="region"]').waitFor();
    await noOverflow();
    await search.fill("");

    await page.setViewportSize({ width: 320, height: 812 });
    // Phone copy is directly readable, without an extra disclosure on every row.
    for (const selector of ['.robin-agenda-todo', '#dashboard-todos', '#dashboard-links', '#dashboard-jobs']) {
      const text = page.locator(`${selector} .robin-readable-text`).first();
      assert.equal(await text.locator('button').count(), 0);
      const size = await text.locator('.robin-readable-copy').evaluate((node) => ({ height: node.clientHeight, fullHeight: node.scrollHeight, width: node.clientWidth, fullWidth: node.scrollWidth }));
      assert.ok(size.height > 0 && size.fullHeight <= size.height + 1 && size.fullWidth <= size.width + 1, `${selector} must show its full copy`);
    }
    const linkMenu = page.locator('.robin-link-actions').first();
    await linkMenu.locator('summary').click();
    await page.keyboard.press('Escape');
    assert.equal(await linkMenu.getAttribute('open'), null);
    await linkMenu.locator('summary').click();
    await linkMenu.locator('button').first().click();
    const linkEditor = page.locator('#dashboard-links input').first();
    await linkEditor.fill('Unsaved title');
    await linkEditor.press('Escape');
    assert.equal(await page.locator('#dashboard-links input').count(), 0);
    const todoMenu = page.locator('#dashboard-todos .robin-todo-actions').first();
    await todoMenu.locator(':scope > summary').click();
    const deadlineAction = todoMenu.locator('[data-calendar-todo]');
    assert.ok(await deadlineAction.isVisible(), 'Deadline editing lives with the other secondary actions');
    await todoMenu.locator('.robin-todo-link-editor > summary').click();
    const todoLinkInput = todoMenu.locator('form input');
    await todoLinkInput.fill('https://example.com/unsaved');
    const linkBounds = await todoLinkInput.boundingBox();
    assert.ok(linkBounds.x >= 0 && linkBounds.x + linkBounds.width <= 320, 'Nested link editor stays on-screen');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    assert.equal(await todoMenu.getAttribute('open'), null);
    const moreLinks = page.locator('.robin-links-more');
    assert.equal(await page.locator('.robin-saved-link').count(), 4);
    await moreLinks.click();
    assert.equal(await page.locator('.robin-saved-link').count(), 6);
    const shortLink = page.locator('#dashboard-links .robin-readable-text').last();
    assert.equal(await shortLink.locator('button').count(), 0, 'Short titles must not get a redundant disclosure');
    await moreLinks.click();
    assert.equal(await page.locator('.robin-saved-link').count(), 4);
    const brief = page.locator('.robin-agenda-brief').last();
    assert.equal(await brief.getAttribute('open'), null);
    await brief.locator('summary').click();
    assert.ok(await brief.getByText('Read the complete design review before the next engineering meeting').isVisible());
    assert.equal(await page.locator('.robin-completed-todos').getAttribute('open'), null);
    const sizes = await page.evaluate(() => Object.fromEntries([
      ['body', '#dashboard-todos .robin-readable-copy .text-sm'],
      ['meta', '.robin-calendar footer'],
      ['title', '#fullstack-open .text-lg'],
    ].map(([name, selector]) => [name, getComputedStyle(document.querySelector(selector)).fontSize])));
    assert.deepEqual(sizes, { body: '15px', meta: '12px', title: '18px' });
    // Open forms at the narrowest width, not just on a large phone.
    for (const selector of ['.robin-calendar', '#dashboard-todos', '#dashboard-links']) {
      const card = page.locator(selector);
      await card.locator('header button').last().click();
      await card.locator('form').first().waitFor();
      await noOverflow();
      if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${locale}-form-${selector.slice(1)}.png` });
      const fields = await card.locator('form input:not([type="checkbox"])').evaluateAll((inputs) => inputs.filter((el) => el.checkVisibility()).map((el) => {
        const rect = el.getBoundingClientRect();
        return { width: rect.width, left: rect.left, right: rect.right, font: parseFloat(getComputedStyle(el).fontSize) };
      }));
      assert.ok(fields.length > 0, 'The opened form must expose its fields');
      for (const field of fields) {
        assert.ok(field.width >= 100 && field.left >= 0 && field.right <= 320, `${selector} field must fit: ${JSON.stringify(field)}`);
        assert.ok(field.font >= 16);
      }
      await card.locator('header button').last().click();
    }
    if (process.env.E2E_SCREENSHOT_DIR) {
      for (const id of ['dashboard-todos', 'dashboard-links']) {
        await page.locator(`#${id}`).scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${locale}-${id}.png`, animations: 'disabled' });
      }
    }
    for (const theme of ['dark', 'light']) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.classList.toggle('dark', theme === 'dark');
      }, theme);
      await page.locator('.robin-dashboard').evaluate((el) => { el.scrollTop = 0; });
      await noOverflow();
      if (process.env.E2E_SCREENSHOT_DIR) {
        await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${locale}-${theme}.png`, animations: 'disabled' });
      }
    }
    // Wide calendar grids may scroll inside their card, never the whole page.
    for (const view of ['week', 'month']) {
      await page.goto(`/dashboard?calendar=${view}`);
      await page.locator('.robin-calendar .overflow-x-auto').waitFor();
      await noOverflow();
    }
    await page.goto('/dashboard?calendar=agenda');
    await page.getByRole('button', { name: /Project discussion/ }).waitFor();
    await page.locator('#dashboard-todos input[type="checkbox"]').first().waitFor();
    await page.locator('main > nav a[href="#dashboard-todos"]').click();
    const cardTop = (await page.locator('#dashboard-todos').boundingBox()).y;
    const header = await page.locator('.robin-dashboard-header').boundingBox();
    assert.ok(cardTop >= header.y + header.height - 1, 'Section shortcuts must clear the sticky header');
    await page.locator('.robin-mobile-nav-trigger').click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement === document.querySelector('.robin-mobile-nav-trigger'));
    // Landscape and desktop keep their existing single-line assistant layout.
    for (const [width, height] of [[844, 390], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await noOverflow();
      assert.equal(await page.locator('.robin-assistant-row').evaluate((el) => getComputedStyle(el).flexDirection), 'row');
      await page.waitForFunction(() => document.querySelectorAll('.robin-saved-link').length === 6);
      assert.equal(await page.locator('.robin-saved-link').count(), 6, 'Desktop keeps the full link collection');
      assert.equal(await page.locator('.robin-readable-text button').count(), 0);
    }
    // Reflow is based on workspace width, without reordering or remounting panels.
    await page.goto('/dashboard?calendar=week');
    await page.locator('.robin-calendar [data-calendar-minute]').first().waitFor();
    const checkGrid = async () => {
      // ResizeObserver packs after responsive widths and fetched content settle.
      await page.waitForFunction(() => {
        const grid = document.querySelector('[data-dashboard-panels]');
        const columns = Number(getComputedStyle(grid).getPropertyValue('--dashboard-columns'));
        if (columns === 1) return !grid.dataset.packed;
        if (!grid.dataset.packed) return false;
        const visible = [...grid.children].filter((card) => getComputedStyle(card).display !== 'none');
        const calendar = visible[0].getBoundingClientRect();
        const main = visible.filter((card) => card !== visible[0] && !['dashboard-todos', 'dashboard-links'].includes(card.id)).map((card) => card.getBoundingClientRect());
        const todos = document.querySelector('#dashboard-todos').getBoundingClientRect();
        const links = document.querySelector('#dashboard-links').getBoundingClientRect();
        const gap = parseFloat(getComputedStyle(grid).columnGap);
        const follows = (next, previous) => Math.abs(next.y - previous.bottom - gap) < 2;
        return main.every((card, index) => follows(card, index ? main[index - 1] : calendar))
          && follows(links, todos) && (columns === 3 ? Math.abs(todos.y - calendar.y) < 2 : follows(todos, calendar));
      });
      await noOverflow();
      const layout = await page.locator('[data-dashboard-panels]').evaluate((grid) => ({
        available: document.querySelector('.robin-dashboard').clientWidth,
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        panels: [...grid.children].filter((panel) => getComputedStyle(panel).display !== 'none').map((panel) => {
          const box = panel.getBoundingClientRect();
          return { id: panel.id || 'calendar', x: box.x, y: box.y, width: box.width, right: box.right, bottom: box.bottom };
        }),
      }));
      const expected = layout.available >= 1440 ? 3 : layout.available >= 800 ? 2 : 1;
      assert.equal(layout.columns, expected, `Available width ${layout.available}: ${JSON.stringify(layout)}`);
      const calendar = layout.panels.find((panel) => panel.id === 'calendar');
      const todos = layout.panels.find((panel) => panel.id === 'dashboard-todos');
      const main = layout.panels.filter((panel) => !['calendar', 'dashboard-todos', 'dashboard-links'].includes(panel.id));
      assert.deepEqual(layout.panels.map((panel) => panel.id), ['calendar', 'dashboard-work-queue', 'dashboard-todos',
        ...(layout.panels.some((panel) => panel.id === 'dashboard-attention') ? ['dashboard-attention'] : []),
        ...(layout.panels.some((panel) => panel.id === 'dashboard-jobs') ? ['dashboard-jobs'] : []), 'fullstack-open', 'dashboard-links']);
      if (expected === 3) {
        assert.ok(Math.abs(calendar.y - todos.y) < 1 && todos.x >= calendar.right, 'Calendar and tasks share the first row');
        assert.ok(calendar.width >= 890, 'Wide mode must leave the calendar legible');
        assert.ok(main.every((panel) => Math.abs(panel.x - calendar.x) < 1 && Math.abs(panel.width - calendar.width) < 1), 'Attention, jobs and learning use the wide main lane');
      } else if (expected === 2) {
        assert.ok(todos.y >= calendar.bottom && Math.abs(todos.y - main[0].y) < 1, 'Calendar spans both lanes');
        assert.ok(main.every((panel) => Math.abs(panel.x - calendar.x) < 1 && panel.right <= todos.x), 'Only tasks and links use the right lane');
      } else {
        for (let i = 1; i < layout.panels.length; i++) assert.ok(layout.panels[i].y >= layout.panels[i - 1].bottom);
      }
      return layout;
    };
    for (const width of [768, 1024, 1366, 1440, 1920, 2560]) {
      await page.setViewportSize({ width, height: 1080 });
      await checkGrid();
      const typography = await page.locator('[data-dashboard-panels] > section > header h2').evaluateAll((headings) => headings.map((heading) => ({
        style: getComputedStyle(heading).fontStyle, family: getComputedStyle(heading).fontFamily,
      })));
      assert.equal(typography.length, 6);
      assert.ok(typography.every((heading) => heading.style === 'italic' && heading.family === typography[0].family), `${locale}/${width}: ${JSON.stringify(typography)}`);
      assert.equal(await search.evaluate((el) => getComputedStyle(el).fontStyle), 'normal');
      if (process.env.E2E_SCREENSHOT_DIR && [1024, 1920, 2560].includes(width)) {
        await page.locator('.robin-dashboard').evaluate((el) => { el.scrollTop = 0; });
        await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${locale}-grid-${width}.png`, animations: 'disabled' });
      }
    }
    if (process.env.E2E_SCREENSHOT_DIR) {
      await page.setViewportSize({ width: 1920, height: 1080 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.classList.toggle('dark', theme === 'dark');
        }, theme);
        await page.locator('.robin-dashboard').evaluate((el) => { el.scrollTop = 0; });
        await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${locale}-wide-${theme}.png`, animations: 'disabled' });
        await page.locator('#fullstack-open').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${locale}-supporting-${theme}.png`, animations: 'disabled' });
      }
    }
    // A narrow workspace on a wide display must also reflow. Resize keeps an unsaved task intact.
    const taskCard = page.locator('#dashboard-todos');
    await taskCard.locator('header button').last().click();
    const draft = taskCard.locator('form input').first();
    await draft.fill('Keep this unsaved draft');
    await page.locator('.robin-dashboard').evaluate((el) => { el.style.maxWidth = '1000px'; });
    await checkGrid();
    assert.equal(await draft.inputValue(), 'Keep this unsaved draft');
    for (const input of await taskCard.locator('form input').all()) {
      const bounds = await input.boundingBox(), panel = await taskCard.boundingBox();
      assert.ok(bounds.x >= panel.x && bounds.x + bounds.width <= panel.x + panel.width);
    }
    await page.locator('.robin-dashboard').evaluate((el) => { el.style.removeProperty('max-width'); });
    await checkGrid();
    await taskCard.locator('header button').last().click();
    // Long, unequal lists used to stretch shared grid rows and create huge holes.
    fixtures['/api/robin/todos'].todos.push(...Array.from({ length: 60 }, (_, index) => ({
      id: `dense-task-${index}`, title: `Detailed task ${index}: prepare notes and supporting documents`, done: false, due: '2030-05-25',
    })));
    fixtures['/api/robin/links'].links.push(...Array.from({ length: 80 }, (_, index) => ({
      id: `dense-link-${index}`, title: `Reference ${index}: architecture documentation`, url: `https://example.com/resource/${index}`, group: `Resources ${Math.floor(index / 10)}`, iconCheckedAt: today,
    })));
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.robin-saved-link').length === 86);
    await page.waitForFunction(() => document.querySelectorAll('#dashboard-todos input[type="checkbox"]').length === 64);
    for (const width of [1024, 1920]) {
      await page.setViewportSize({ width, height: 1080 });
      await checkGrid();
      assert.equal(await page.locator('[data-link-groups]').evaluate((el) => getComputedStyle(el).columnCount), '1', 'Link groups use card width, not viewport width');
      const group = taskCard.locator(':scope > details:not(.robin-completed-todos)').last();
      await group.locator(':scope > summary').click();
      await checkGrid();
      await group.locator(':scope > summary').click();
      await checkGrid();
      if (process.env.E2E_SCREENSHOT_DIR) {
        await page.locator('.robin-dashboard').evaluate((el) => { el.scrollTop = 0; });
        await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${locale}-dense-${width}.png`, animations: 'disabled' });
      }
    }
    // Existing work feeds the new action queue; no AI check or mutation is started.
    const makeRound = (id, fields = {}) => ({ id, company: id, kind: 'oa', status: 'open', createdAt: '', updatedAt: '', ...fields });
    fixtures['/api/robin/rounds'].rounds = [
      makeRound('needs-oa', { due: '2030-05-14', threadId: 'oa-thread' }),
      makeRound('needs-call', { kind: 'interview', due: '2030-05-13' }),
      makeRound('tracked-oa', { todoId: 'task', due: today }),
    ];
    const makeMail = (id, fields = {}) => ({ id, threadId: id, subject: id, next: `Reply to ${id}`, summary: 'A concrete next action', category: 'document', triage: 'act', action: 'none', ...fields });
    fixtures['/api/robin/gmail'].review = { day: today, reviewedAt: `${today}T12:00:00Z`, items: [
      makeMail('needs-mail', { due: today }), makeMail('duplicate-invite', { category: 'oa', threadId: 'oa-thread' }),
      makeMail('tracked-mail', { triage: 'tracked' }), makeMail('handled-mail', { done: true }),
      ...Array.from({ length: 6 }, (_, index) => makeMail(`extra-${index}`)),
    ] };
    const highJobs = Array.from({ length: 7 }, (_, index) => ({ ...fixtures['/api/robin/jobs'].jobs[0], id: `high-${index}`, title: `Role ${index}`, score: 4.9 - index * 0.1, url: `https://example.com/high/${index}` }));
    fixtures['/api/robin/jobs'].jobs = [...highJobs,
      { ...highJobs[0], id: 'duplicate-role', url: 'https://example.com/duplicate' },
      { ...highJobs[0], id: 'low', title: 'Low', score: 2, url: 'https://example.com/low' },
      { ...highJobs[0], id: 'unknown', title: 'Unknown', score: undefined, url: 'https://example.com/unknown' },
      { ...highJobs[0], id: 'applied', status: 'applied', url: 'https://example.com/applied' },
    ];
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const attention = page.locator('#dashboard-attention');
    await attention.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelectorAll('[data-attention-id]').length === 5);
    assert.deepEqual(await attention.locator('[data-attention-id]').evaluateAll((items) => items.slice(0, 3).map((item) => item.dataset.attentionId)), ['mail:needs-mail', 'round:needs-call', 'round:needs-oa']);
    assert.equal(await attention.locator('[data-attention-id="round:tracked-oa"], [data-attention-id="mail:duplicate-invite"], [data-attention-id="mail:tracked-mail"], [data-attention-id="mail:handled-mail"]').count(), 0);
    assert.equal(await attention.locator('[data-attention-id="round:needs-oa"] a').getAttribute('href'), '/dashboard/jobs#jobs-rounds');
    assert.equal(await attention.locator('[data-attention-id="mail:needs-mail"] a').getAttribute('href'), 'https://mail.google.com/mail/u/0/#all/needs-mail');
    await page.waitForFunction(() => document.querySelectorAll('#dashboard-jobs a[href^="https://example.com/high/"]').length === 5);
    assert.equal(await page.locator('#dashboard-jobs a[href="https://example.com/low"], #dashboard-jobs a[href="https://example.com/duplicate"], #dashboard-jobs a[href="https://example.com/unknown"], #dashboard-jobs a[href="https://example.com/applied"]').count(), 0);
    for (const width of [390, 1024, 1920]) {
      await page.setViewportSize({ width, height: 1080 }); await checkGrid();
      if (width === 390) {
        const actions = attention.locator('[data-attention-id="round:needs-oa"] button');
        const boxes = await actions.evaluateAll((nodes) => nodes.map((node) => { const box = node.getBoundingClientRect(); return { top: box.top, width: box.width, height: box.height }; }));
        assert.equal(boxes.length, 3);
        for (const box of boxes) assert.ok(box.top === boxes[0].top && box.height >= 44 && box.width >= 44, 'Round actions share one thumb-sized row');
        const groupMenu = page.locator('.robin-group-actions').first();
        await groupMenu.locator('summary').click();
        assert.equal(await groupMenu.locator('button:visible').count(), 2, 'Link ordering is available without permanent up/down buttons');
        await page.keyboard.press('Escape');
        assert.equal(await groupMenu.getAttribute('open'), null);
      }
    }
    if (process.env.E2E_SCREENSHOT_DIR) {
      await attention.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${locale}-attention.png`, animations: 'disabled' });
    }
    mailUnavailable = true;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await attention.getByRole('alert').waitFor();
    await checkGrid();
    mailUnavailable = false;
    fixtures['/api/robin/gmail'].review = null;
    fixtures['/api/robin/rounds'].rounds = [];
    fixtures['/api/robin/jobs'].jobs = [];
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await attention.waitFor({ state: 'hidden' });
    await page.locator('#dashboard-jobs').waitFor({ state: 'hidden' });
    await checkGrid();
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, [], 'Layout checks must not write to any dashboard API');
    await context.close();
  }
  console.log('PASS: mobile dashboard layout, forms, search, calendar, anchors and desktop in English and Chinese');
} finally {
  await browser.close();
}
