// Real validation domain in a disposable directory; ALL APIs intercepted.
// No real product records, model turns, sender checks or outreach requests.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { initializeValidation, readValidationBoard, readValidationProject, executeValidationCommand, discussValidation } from '../extension/robin/validation-domain.ts';
import { emptyValidationCriteria } from '../extension/robin/validation-shape.ts';
const previous = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), 'product-lab-'));
process.env.ROBIN_DATA_DIR = dir;
const output = '/tmp/product-lab'; mkdirSync(output, { recursive: true });
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
let page;
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 1050 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => { if (!localStorage.getItem('pi-locale')) localStorage.setItem('pi-locale', 'zh-CN'); if (!localStorage.getItem('pi-theme')) localStorage.setItem('pi-theme', 'light'); });
  const ideas = [{ id: 'one', name: '交付笔记', note: '保留这段原始笔记', step: 'research' }, { id: 'two', name: '读后一步', note: '从当前任务开始', step: 'spot' }].map(i => ({ ...i, links: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  const writes = [], errors = [], unexpected = [];
  let releaseReply, failWrite = false, failRead = false;
  const proposal = { candidates: [{ id: 'segment', name: '独立设计师', situation: '近期交付', problem: '重复确认', alternatives: '邮件模板', signals: '有近期交付', exclusions: '没有交付', unknowns: '频率未知' }], offer: '演示任务回放', criteria: Object.fromEntries(Object.keys(emptyValidationCriteria()).map(key => [key, `人工待审标准 ${key}`])) };
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    try {
      if (req.method() !== 'GET') writes.push({ path, body: req.postDataJSON() });
      if (path === '/api/robin/products') {
        if (req.method() === 'POST') { const idea = { ...ideas[0], ...req.postDataJSON(), id: 'created' }; ideas.push(idea); return route.fulfill({ json: { idea } }); }
        return route.fulfill({ json: { ideas, captures: [] } });
      }
      if (path.startsWith('/api/robin/products/')) { const idea = ideas.find(i => i.id === path.split('/').at(-1)); Object.assign(idea, req.postDataJSON()); return route.fulfill({ json: { idea } }); }
      if (path === '/api/robin/product-assistant') {
        await new Promise(resolve => { releaseReply = resolve; });
        return route.fulfill({ json: { reply: '演示建议：先确认最近一次真实交付。', usedTools: [], sessionId: 'mock-session' } });
      }
      if (path.startsWith('/api/robin/validation')) {
        if (req.method() === 'GET') {
          if (failRead) return route.fulfill({ status: 503, json: { error: 'Synthetic read failure' } });
          return route.fulfill({ json: url.searchParams.get('id') ? { project: readValidationProject(url.searchParams.get('id')) } : readValidationBoard() });
        }
        if (failWrite) { failWrite = false; return route.fulfill({ status: 503, json: { error: 'Synthetic save failure' } }); }
        const body = req.postDataJSON();
        if (body.action === 'initialize') return route.fulfill({ json: initializeValidation() });
        if (path.endsWith('/discuss')) return route.fulfill({ json: { project: await discussValidation(body, async () => ({ reply: JSON.stringify({ reply: '这是未批准的候选人群提案。', plan: proposal }), usedTools: [] })) } });
        return route.fulfill({ json: { project: executeValidationCommand(body) } });
      }
      if (path.includes('jarvis') || path.includes('outreach') || req.method() !== 'GET') unexpected.push(`${req.method()} ${path}`);
      return route.fulfill({ json: { resources: [], opportunities: [], assessments: {}, savedIds: [], todos: [], events: [], jobs: [], rounds: [], records: [], finals: {}, review: null } });
    } catch (error) { return route.fulfill({ status: error.status ?? 500, json: { error: error.message } }); }
  });
  page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  await page.goto('/product?idea=one');
  const rail = page.locator('#product-lab-navigation');
  const partner = page.locator('#product-partner');
  const tabs = page.getByRole('navigation', { name: '项目视图', exact: true });
  const note = page.locator('#product-notebook-one textarea').first();
  await note.waitFor();
  assert.equal(writes.length, 0, 'Opening the lab must be read-only');
  await page.screenshot({ path: `${output}/overview-light.png` });
  assert.equal(await partner.isVisible(), false, 'The product owns the initial space');
  await page.locator('button[aria-controls="product-partner"]').click();
  const input = partner.locator('textarea:visible');
  await input.fill('只属于交付笔记的草稿');
  await rail.getByRole('button', { name: '读后一步', exact: true }).click();
  assert.equal(await input.inputValue(), '');
  await input.fill('第二个产品的草稿');
  await rail.getByRole('button', { name: '交付笔记', exact: true }).click();
  assert.equal(await input.inputValue(), '只属于交付笔记的草稿');
  await input.press('Enter');
  for (let i = 0; !releaseReply && i < 100; i++) await page.waitForTimeout(20);
  assert.ok(releaseReply);
  assert.equal(writes.at(-1).body.productId, 'one');
  await rail.getByRole('button', { name: '读后一步', exact: true }).click();
  releaseReply();
  await page.waitForTimeout(150);
  assert.equal(await partner.getByText('演示建议：先确认最近一次真实交付。', { exact: true }).isVisible(), false, 'Late reply stays in its own scope');
  assert.equal(await input.inputValue(), '第二个产品的草稿');
  await rail.getByRole('button', { name: '交付笔记', exact: true }).click();
  await partner.getByRole('button', { name: '预览并加入笔记' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('准备加入的内容', { exact: true }).fill('人工编辑后的待验证假设');
  const beforeAdopt = writes.length;
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(writes.length, beforeAdopt);
  await partner.getByRole('button', { name: '预览并加入笔记' }).click();
  await dialog.getByLabel('准备加入的内容', { exact: true }).fill('人工编辑后的待验证假设');
  await page.waitForTimeout(150);
  assert.equal(await dialog.locator('textarea').inputValue(), '人工编辑后的待验证假设', 'A reopened preview must not overwrite the edited text');
  await dialog.getByRole('button', { name: '追加到笔记（自动保存）', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#product-notebook-one .save-status')?.getAttribute('data-state') === 'saved');
  assert.equal(ideas[0].note, '保留这段原始笔记\n\n人工编辑后的待验证假设');
  assert.equal(ideas[0].step, 'research');
  // Retained notebooks accept external bet updates only where the local field is clean.
  const legacyTools = page.locator('#product-notebook-one').getByText('阶段参考与原有假设工具', { exact: true });
  await legacyTools.click();
  ideas[0].bet = { claim: '外部保存的假设', by: '' };
  const pollIdeas = async () => {
    await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/robin/products'), page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))]);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  await pollIdeas();
  const bet = page.getByRole('textbox', { name: '什么必须成立', exact: true });
  assert.equal(await bet.inputValue(), '外部保存的假设');
  await bet.fill('尚未提交的本地假设'); ideas[0].bet = { claim: '更新后的外部假设', by: '' };
  await pollIdeas(); assert.equal(await bet.inputValue(), '尚未提交的本地假设');
  await bet.fill('更新后的外部假设'); await bet.blur();
  await legacyTools.click();
  await tabs.getByRole('button', { name: '实验', exact: true }).click();
  await page.getByRole('button', { name: '创建空白验证工作区' }).waitFor();
  assert.equal(writes.filter(w => w.path.includes('validation')).length, 0);
  await page.getByRole('button', { name: '创建空白验证工作区' }).click();
  await page.getByRole('button', { name: '＋ 新实验', exact: true }).click();
  assert.equal(await page.getByLabel('产品名称', { exact: true }).inputValue(), '交付笔记');
  await page.getByLabel('产品名称', { exact: true }).fill('第一次任务回放');
  // Changing tabs and projects must not discard the creation draft.
  await tabs.getByRole('button', { name: '概览', exact: true }).click();
  await rail.getByRole('button', { name: '读后一步', exact: true }).click();
  await rail.getByRole('button', { name: '交付笔记', exact: true }).click();
  await tabs.getByRole('button', { name: '实验', exact: true }).click();
  assert.equal(await page.getByLabel('产品名称', { exact: true }).inputValue(), '第一次任务回放');
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await page.getByRole('heading', { name: '第一次任务回放', exact: true }).waitFor();
  const id = new URL(page.url()).searchParams.get('experiment');
  assert.equal(readValidationProject(id).ideaId, 'one');
  await partner.getByRole('button', { name: '提出候选人群', exact: true }).click();
  await partner.getByText('这是未批准的候选人群提案。', { exact: true }).waitFor();
  assert.equal(readValidationProject(id).status, 'draft');
  await page.getByRole('button', { name: '编辑草案', exact: true }).click();
  await page.getByRole('radio').first().check();
  await page.getByLabel('为什么做这次修订？', { exact: true }).fill('选择近期有交付的人');
  await page.getByRole('button', { name: '全部实验', exact: true }).click();
  await page.goBack();
  assert.equal(await page.getByLabel('为什么做这次修订？', { exact: true }).inputValue(), '选择近期有交付的人', 'Back restores the same dirty experiment editor');
  await tabs.getByRole('button', { name: '证据与决定', exact: true }).click();
  await tabs.getByRole('button', { name: '实验', exact: true }).click();
  assert.equal(await page.getByLabel('为什么做这次修订？', { exact: true }).inputValue(), '选择近期有交付的人');
  failWrite = true;
  await page.getByRole('button', { name: '保存为新的草案版本', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Synthetic save failure' }).waitFor();
  await page.getByRole('button', { name: '保存为新的草案版本', exact: true }).click();
  await page.getByRole('button', { name: '编辑草案', exact: true }).waitFor();
  await page.getByLabel('为什么这份标准适合本轮验证？', { exact: true }).fill('足以决定是否继续');
  failRead = true;
  await page.getByRole('button', { name: '批准这份标准', exact: true }).click();
  await page.getByText('标准已批准', { exact: true }).waitFor(); failRead = false;
  await tabs.getByRole('button', { name: '证据与决定', exact: true }).click();
  await page.locator('summary').filter({ hasText: /^保存观察$/ }).click();
  await page.getByLabel('来源网址或文档／访谈标识', { exact: true }).fill('合成访谈 A');
  await page.getByLabel('原文片段或实际观察', { exact: true }).fill('邮件模板已经解决了这个问题。');
  await page.getByLabel('观察日期', { exact: true }).fill('2026-10-20');
  await page.getByLabel('与假设的关系', { exact: true }).selectOption('challenges');
  await page.getByRole('button', { name: '保存观察', exact: true }).click();
  await page.getByText('邮件模板已经解决了这个问题。', { exact: true }).first().waitFor();
  await page.getByRole('checkbox', { name: '将这条观察作为判断依据' }).check();
  await page.locator('summary').filter({ hasText: /^你的结论$/ }).click();
  await page.getByLabel('结果', { exact: true }).selectOption('fail');
  await page.getByLabel('学到了什么？下一步如何决定？', { exact: true }).fill('寻找模板无法满足的场景。');
  await page.getByRole('button', { name: '记录结论', exact: true }).click();
  await page.getByText('已记录结论', { exact: true }).waitFor();
  assert.equal(readValidationProject(id).decisions[0].outcome, 'fail'); assert.equal(readValidationProject(id).stage, 'A');
  assert.equal(ideas[0].step, 'research', 'Experiment decisions never change idea stage');
  await page.screenshot({ path: `${output}/evidence-light.png` });
  await tabs.getByRole('button', { name: 'Outreach', exact: true }).click();
  assert.equal(await page.getByRole('link', { name: '打开原有 Outreach ↗', exact: true }).getAttribute('href'), '/outreach/research');
  assert.deepEqual(unexpected, []);
  // Deep-link isolation: an experiment cannot be displayed under another idea.
  await page.goto(`/product?idea=two&view=experiments&experiment=${id}`);
  await page.getByRole('alert').filter({ hasText: '不属于当前想法' }).waitFor();
  assert.equal(await page.getByRole('heading', { name: '第一次任务回放' }).count(), 0);
  for (const locale of ['zh-CN', 'en']) {
    await page.evaluate(locale => localStorage.setItem('pi-locale', locale), locale);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => localStorage.setItem('pi-theme', theme), theme);
      await page.goto('/product?idea=one');
      await page.locator('#product-notebook-one').waitFor();
      for (const width of [1600, 1280, 960, 812, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${locale}/${theme}/${width}: body overflow`);
        assert.equal(await page.locator('main').evaluate(el => el.scrollWidth > el.clientWidth + 1), false, `${locale}/${theme}/${width}: reading overflow`);
        if ([1600, 390].includes(width)) await page.screenshot({ path: `${output}/${locale}-${theme}-${width}.png` });
        if (width === 390) {
          await page.getByRole('button', { name: locale === 'en' ? 'Brainstorm partner' : 'Brainstorm 伙伴', exact: true }).click();
          assert.equal(await partner.isVisible(), true); assert.equal(await page.locator('main').isVisible(), false);
          await page.getByRole('button', { name: locale === 'en' ? 'Hide partner' : '收起伙伴', exact: true }).click();
          assert.equal(await page.locator('main').isVisible(), true);
        }
      }
    }
  }
  assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
  console.log(`PASS: scoped late replies/drafts, explicit adoption, in-place validation create/approve/evidence/decide, failures, project isolation, desktop/mobile and themes. Screenshots: ${output}`);
} catch (error) { await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {}); throw error; }
finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; }
