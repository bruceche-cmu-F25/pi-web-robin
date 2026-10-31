// Isolated prototype: requests to APIs are forbidden (except login before the page).
// No personal data, model turns, CRM writes, or messages.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const output = '/tmp/product-lab-prototype';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
let page;
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1040 }, reducedMotion: 'reduce' });
  if (process.env.PI_WEB_PASSWORD) {
    const response = await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(response.ok());
  }
  const apiRequests = [], externalRequests = [], errors = [];
  await context.route('**/api/**', route => { apiRequests.push(route.request().url()); return route.abort(); });
  page = await context.newPage();
  page.on('request', request => { if (new URL(request.url()).origin !== new URL(baseURL).origin) externalRequests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/prototypes/product-lab/index.html');
  await page.getByRole('heading', { name: '交付笔记', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/desk-light.png`, fullPage: true });
  await page.getByRole('button', { name: '深色外观' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.getByRole('button', { name: '浅色外观' }).click();
  const nav = page.getByRole('navigation', { name: '产品视图' });
  const dialog = page.getByRole('dialog');
  const note = page.locator('#project-note');
  await note.fill('保留这段尚未写入真实产品的笔记。');
  await nav.getByRole('button', { name: '实验', exact: true }).click();
  await page.getByRole('heading', { name: '还原一次真实交付' }).waitFor();
  await page.goBack();
  await note.waitFor();
  assert.equal(await note.inputValue(), '保留这段尚未写入真实产品的笔记。');
  await page.getByRole('button', { name: 'B · 聚焦手记' }).click();
  assert.equal(await note.inputValue(), '保留这段尚未写入真实产品的笔记。');
  await page.screenshot({ path: `${output}/journal-light.png`, fullPage: true });
  await page.getByRole('button', { name: 'A · 三栏工作台' }).click();
  await page.getByRole('button', { name: '挑战这个假设' }).click();
  await page.getByRole('button', { name: '预览并采纳' }).click();
  await dialog.getByLabel('假设内容').fill('经我修改的演示假设');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.getByRole('heading', { name: '经我修改的演示假设' }).count(), 0);
  await page.getByRole('button', { name: '预览并采纳' }).click();
  await dialog.getByLabel('假设内容').fill('经我修改的演示假设');
  await dialog.getByRole('button', { name: '确认加入假设' }).click();
  await page.getByRole('heading', { name: '经我修改的演示假设' }).waitFor();
  assert.equal(await note.inputValue(), '保留这段尚未写入真实产品的笔记。');
  // Project-scoped conversation and note drafts survive navigation and layout changes.
  await page.locator('#chat-input').fill('只属于交付笔记的讨论草稿');
  await page.locator('#navigation').getByRole('button', { name: '读后一步', exact: true }).click();
  assert.equal(await page.locator('#chat-input').inputValue(), '');
  await nav.getByRole('button', { name: '实验', exact: true }).click();
  await page.getByRole('heading', { name: '还没开始，也没关系。' }).waitFor();
  await page.locator('#navigation').getByRole('button', { name: '交付笔记', exact: true }).click();
  assert.equal(await page.locator('#chat-input').inputValue(), '只属于交付笔记的讨论草稿');
  await nav.getByRole('button', { name: '实验', exact: true }).click();
  await page.getByRole('button', { name: '＋ 新实验' }).click();
  for (const [name, value] of [['实验名称', '先试一次任务回放'], ['要验证的假设', '用户能指出一个重复的痛点'], ['找谁、怎样观察', '一次访谈，只还原过去发生的事'], ['什么结果会改变决定？', '不能举出实际例子，就继续收集证据']]) await dialog.getByLabel(name, { exact: true }).fill(value);
  await dialog.getByRole('button', { name: '加入实验草稿' }).click();
  await page.getByRole('heading', { name: '先试一次任务回放' }).waitFor();
  await page.locator('.experiment').filter({ hasText: '先试一次任务回放' }).getByRole('button', { name: '记录本轮结论' }).click();
  await dialog.getByLabel('依据、反例与下一步').fill('样本不足，暂不作需求成立的判断。');
  await dialog.getByRole('button', { name: '记录演示结论' }).click();
  await page.getByText('样本不足，暂不作需求成立的判断。', { exact: true }).waitFor();
  await nav.getByRole('button', { name: '证据与决定' }).click();
  await page.getByRole('button', { name: '＋ 记录观察' }).click();
  await dialog.getByLabel('来源 / 访谈标识').fill('纯演示来源');
  await dialog.getByLabel('原话或实际观察').fill('<img src=x onerror="alert(1)"> 只是文本');
  await dialog.getByLabel('与假设的关系').selectOption('challenges');
  await dialog.getByRole('button', { name: '加入演示证据' }).click();
  await page.getByText('“<img src=x onerror="alert(1)"> 只是文本”', { exact: true }).waitFor();
  assert.equal(await page.locator('main img').count(), 0);
  await nav.getByRole('button', { name: 'Outreach', exact: true }).click();
  await page.getByRole('button', { name: /审核队列/ }).click();
  assert.equal(await dialog.getByRole('link').getAttribute('href'), '/outreach/research?view=review');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: /审核队列/ }).evaluate(el => document.activeElement === el), true);
  await page.screenshot({ path: `${output}/outreach-boundary.png`, fullPage: true });
  // Capture is a local inbox operation, not automatic experiment creation.
  await page.locator('#navigation').getByRole('button', { name: '＋ 记录想法' }).click();
  await dialog.getByLabel('给它一个名字').fill('演示新想法');
  await dialog.getByLabel('你看到了什么问题？').fill('只是样板，不要写入真实产品。');
  await dialog.getByRole('button', { name: '放入想法收件箱' }).click();
  const spark = page.locator('.inbox-item').filter({ hasText: '演示新想法' });
  await spark.getByRole('button', { name: '开始探索 →' }).click();
  await page.getByRole('heading', { name: '演示新想法', exact: true }).waitFor();
  await page.getByRole('button', { name: '设计第一个实验' }).waitFor();
  await page.locator('#navigation').getByRole('button', { name: '实验室总览', exact: true }).click();
  await page.getByRole('button', { name: '收起伙伴' }).click();
  assert.equal(await page.locator('#partner').isVisible(), false);
  await page.getByRole('button', { name: '打开伙伴', exact: true }).click();
  assert.equal(await page.locator('#partner').isVisible(), true);
  await page.locator('#navigation').getByRole('button', { name: '交付笔记', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const layout of ['desk', 'journal']) {
      await page.locator(`button[data-layout="${layout}"]`).click();
      for (const width of [1440, 1024, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const view of ['overview', 'experiments', 'outreach', 'evidence']) {
          await page.locator(`button[data-view="${view}"]`).click();
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
          assert.equal(overflow, false, `${theme}/${layout}/${width}/${view} overflow`);
        }
        await page.locator('button[data-view="overview"]').click();
        if ([1440, 390].includes(width)) await page.screenshot({ path: `${output}/${layout}-${theme}-${width}.png`, fullPage: true });
        if (width === 390) {
          await page.locator('.mobile-tools [data-action="partner"]').click();
          assert.equal(await page.locator('#main').isVisible(), false);
          await page.getByRole('button', { name: '挑战这个假设' }).click();
          await page.screenshot({ path: `${output}/partner-${layout}-${theme}-mobile.png`, fullPage: true });
          await page.getByRole('button', { name: '收起伙伴' }).click();
          assert.equal(await page.locator('#main').isVisible(), true);
          await page.locator('.mobile-tools [data-action="navigation"]').click();
          await page.locator('#navigation').getByRole('button', { name: '读后一步', exact: true }).click();
          await page.getByRole('heading', { name: '读后一步', exact: true }).waitFor();
          await page.locator('.mobile-tools [data-action="navigation"]').click();
          await page.locator('#navigation').getByRole('button', { name: '交付笔记', exact: true }).click();
        }
      }
    }
  }
  await page.setViewportSize({ width: 812, height: 375 });
  await page.locator('button[data-view="overview"]').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.reload();
  await page.locator('#project-note').waitFor();
  assert.notEqual(await page.locator('#project-note').inputValue(), '保留这段尚未写入真实产品的笔记。');
  assert.deepEqual(apiRequests, [], 'Prototype made API requests');
  assert.deepEqual(externalRequests, [], 'Prototype loaded external resources');
  assert.deepEqual(errors, []);
  console.log(`PASS: two layouts, capture, scoped drafts, explicit adoption, experiments, evidence, legacy boundary, keyboard, 320–1440px, both themes, zero API/external requests. Screenshots: ${output}`);
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); }
