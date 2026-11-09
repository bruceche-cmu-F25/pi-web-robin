// BSK runtime has no Playwright dependency. This browser is only an isolated local fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { BskJobBrowser } from '../lib/job-application-bsk-browser.ts';
import { captureApplicationForm } from '../scripts/job-application-bsk-dom.mjs';

const url = 'https://job-boards.greenhouse.io/example/jobs/123';
const job = { id: 'fixture', url, title: 'Software Engineer', company: 'Example',
  application: { url, attemptId: 'once' } };
const html = `<!doctype html><html><body><h1>Software Engineer</h1><p>Example careers</p>
<form id="app"><div class="field"><label for="name">Name *</label><input id="name" required></div>
<div class="field"><label for="email">Email *</label><input id="email" type="text" required></div>
<div class="field file-upload"><label for="resume">Resume/CV *</label><input id="resume" type="file"></div>
<fieldset><legend>Preferred office? *</legend><label for="office"><input id="office" type="checkbox" required>San Jose, CA</label></fieldset>
<button type="submit">Submit application</button></form><plasmo-csui id="jobright-helper-plugin"></plasmo-csui>
<script>
window.submits=0;document.querySelector('#app').onsubmit=e=>{e.preventDefault();window.submits++;
document.body.innerHTML='<h1>Success</h1><p>Thanks so much for applying to join us at Example!</p>'};
const root=document.querySelector('plasmo-csui').attachShadow({mode:'open'});
root.innerHTML='<button type="button">Autofill</button><p></p>';
root.querySelector('button').onclick=()=>{root.querySelector('button').textContent='Autofilling';
setTimeout(()=>{document.querySelector('#name').value='Test Candidate';document.querySelector('#email').value='candidate@example.test';
const files=new DataTransfer();files.items.add(new File(['%PDF-old'],'jobright-resume.pdf',{type:'application/pdf'}));
document.querySelector('#resume').files=files.files;
root.querySelector('button').textContent=window.finishButtonMode==='summary'?'Autofill for Another Job':'Autofill';root.querySelector('p').textContent=window.finishButtonMode==='silent'?'':'3 / 4 required fields filled';},window.autofillDelay??700)};
</script></body></html>`;

class FixtureSession {
  constructor(page) { this.page = page; }
  async navigate(target) { await this.page.goto(target); }
  async sync() {
    const button = this.page.locator('plasmo-csui#jobright-helper-plugin button');
    const heading = await this.page.locator('h1').innerText();
    const paragraph = this.page.locator('plasmo-csui#jobright-helper-plugin p');
    const label = await button.count() ? await button.innerText() : '';
    const progress = await paragraph.count() ? await paragraph.innerText() : '';
    return `heading "${heading}"\nExample careers\nParsing your resume. Autofilling key fields...\n` +
      (label ? `@e1 button "${label}"` : '') + '\n' + progress +
      (label === 'Autofill for Another Job' ? `\n@e2 button "${progress}"` : '');
  }
  async tabs() { return [{ tab_id: 1, url: this.page.url(), scope: 'agent' }]; }
  async read(expression) { return this.page.evaluate(expression); }
  locator(target) { return target === '@e1' ? this.page.locator('plasmo-csui#jobright-helper-plugin button') : this.page.locator(target); }
  async check(facts) {
    for (const { target, field, equals } of facts) {
      const node = this.locator(target);
      assert.equal(await node.count(), 1, `target ${target} must be unique`);
      const actual = field === 'text' ? await node.textContent() : field === 'checked' ? await node.isChecked() : await node.inputValue();
      assert.equal(actual, equals, `stale BSK precondition: ${target}`);
    }
  }
  async click(target, facts) { await this.check(facts); await this.locator(target).click(); }
  async fill(target, value, facts) { await this.check(facts); await this.locator(target).fill(value); }
  async select(target, value, facts) { await this.check(facts); await this.locator(target).selectOption(value); }
  async press(target, key, facts) { await this.check(facts); await this.locator(target).press(key); }
}

async function fixture(run, target = job, body = html) {
  const chrome = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await chrome.newContext();
  await context.route(`${target.url}*`, route => route.fulfill({ contentType: 'text/html', body }));
  const page = await context.newPage();
  const session = new FixtureSession(page);
  try { return await run(new BskJobBrowser(session, target), page, session); }
  finally { await chrome.close(); }
}

test('BSK lane: Jobright Autofill → fill only missing office → one Submit → exact receipt', async () => fixture(async (browser, page) => {
  const initial = (await browser.run('autofill', {})).snapshot;
  assert.equal(initial.autofill.summary, '3 / 4 required fields filled');
  assert.equal(initial.resumeVerified, true);
  const office = initial.fields.find(f => f.label.includes('Preferred office'));
  assert.equal(office.value, '');
  const repaired = (await browser.run('repair', { expected: initial, decisions: [
    ...initial.fields.filter(f => f.kind !== 'file' && f.key !== office.key).map(f => ({ key: f.key, action: 'keep', value: f.value, source: 'jobright' })),
    { key: office.key, action: 'set', value: 'San Jose, CA', source: 'confirmed' },
  ] })).snapshot;
  assert.deepEqual(repaired.errors, []);
  assert.equal(repaired.fields.find(f => f.key === office.key).value, 'San Jose, CA');
  assert.equal(repaired.fields.find(f => f.label.includes('Name')).value, 'Test Candidate');
  assert.deepEqual(await browser.run('preflight', { expected: repaired }), { ready: true });
  const grant = { fingerprint: createHash('sha256').update(JSON.stringify(repaired)).digest('hex'),
    nonce: 'once', expiresAt: new Date(Date.now()+60_000).toISOString() };
  const result = await browser.run('submit', { expected: repaired, grant });
  assert.match(result.receipt.text, /applying to join us at Example/);
  assert.equal(await page.evaluate(() => window.submits), 1);
}));

test('Ashby tabpanel without native form has bounded fields and targetable selectors', async () => fixture(async (_browser, page) => {
  await page.context().route('https://jobs.ashbyhq.com/example/application', route => route.fulfill({ contentType: 'text/html',
    body: '<div id="form" role="tabpanel"><label>Name*<input required></label><label>Email*<input type="email" required></label><label>Resume*<input type="file"></label><button>Submit Application</button></div>' }));
  await page.goto('https://jobs.ashbyhq.com/example/application');
  const result = await page.evaluate(captureApplicationForm);
  assert.equal(result.fields.length, 3);
  assert.deepEqual(result.errors, []);
  assert.ok(result.fields.every(field => field.selector.startsWith('#form[role="tabpanel"]')));
}));

test('a newsletter form cannot conceal a cross-origin Greenhouse application iframe', async () => fixture(async (_browser, page) => {
  await page.context().route('https://job-boards.greenhouse.io/embed/job_app*', route =>
    route.fulfill({ contentType: 'text/html', body: '<form><label>Email<input type="email"></label><button type="submit">Submit application</button></form>' }));
  await page.context().route('https://technologyadvice.example/test', route => route.fulfill({ contentType: 'text/html',
    body: '<form><label>Email<input type="email"></label><button type="submit">Sign up</button></form><iframe src="https://job-boards.greenhouse.io/embed/job_app?for=example&token=123"></iframe>' }));
  await page.goto('https://technologyadvice.example/test');
  await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument === null);
  const result = await page.evaluate(captureApplicationForm);
  assert.equal(result.fields.length, 0);
  assert.match(result.errors[0], /cross-origin Greenhouse iframe/);
}));

test('new completion report is sufficient when BSK misses a brief busy phase', async () => fixture(async (browser, page) => {
  await page.evaluate(() => { window.autofillDelay = 0; });
  const state = (await browser.run('autofill', {})).snapshot;
  assert.equal(state.autofill.summary, '3 / 4 required fields filled');
  assert.equal(await page.evaluate(() => window.submits), 0);
}));

test('Jobright redirect and a transient denied read settle before the single Autofill click', async () => fixture(async (browser, page, session) => {
  const read = session.read.bind(session), click = session.click.bind(session);
  let reads = 0, clicks = 0;
  session.read = async (expression) => {
    if (!expression.includes('performance.timeOrigin')) return read(expression);
    reads++;
    if (reads === 1) throw new Error('BSK evaluate failed (permission_denied/document_changed/none); action not replayed');
    const result = await read(expression);
    if (reads === 2) await page.goto(`${url}?jr_id=fixture`);
    return result;
  };
  session.click = async (target, facts) => {
    assert.equal(page.url(), `${url}?jr_id=fixture`);
    assert.ok(reads >= 5, 'the redirected document was observed three times before input');
    clicks++;
    return click(target, facts);
  };
  const state = (await browser.run('autofill', {})).snapshot;
  assert.equal(clicks, 1);
  assert.match(state.autofill.summary, /required fields filled/);
}));

test('an employer form lost during settlement never clicks Autofill', async () => fixture(async (browser, _page, session) => {
  const read = session.read.bind(session), click = session.click.bind(session);
  let formReads = 0, clicks = 0;
  session.read = async (expression) => {
    const result = await read(expression);
    if (result && Array.isArray(result.fields) && ++formReads === 2)
      return { ...result, fields: [], errors: ['No application form'] };
    return result;
  };
  session.click = async (...args) => { clicks++; return click(...args); };
  await assert.rejects(browser.run('autofill', {}), /APPLICATION_FORM_UNAVAILABLE/);
  assert.equal(formReads, 2);
  assert.equal(clicks, 0);
}));

test('a missing employer form stops before clicking Jobright, not after a 170-second wait', async () => {
  const landing = `<!doctype html><h1>Software Engineer</h1><p>Example careers</p>
    <plasmo-csui id="jobright-helper-plugin"></plasmo-csui><script>
    window.autofillClicks=0;const root=document.querySelector('plasmo-csui').attachShadow({mode:'open'});
    root.innerHTML='<button type="button">Autofill</button>';
    root.querySelector('button').onclick=()=>{window.autofillClicks++};</script>`;
  await fixture(async (browser, page) => {
    await assert.rejects(browser.run('autofill', {}), /APPLICATION_FORM_UNAVAILABLE/);
    assert.equal(await page.evaluate(() => window.autofillClicks), 0);
  }, job, landing);
});

test('stable post-click employer form with attached resume can replace a missing Jobright report', async () => fixture(async (browser, page) => {
  await page.addInitScript(() => { window.finishButtonMode = 'silent'; window.autofillDelay = 0; });
  const { snapshot } = await browser.run('autofill', {});
  assert.match(snapshot.autofill.summary, /completion report not observed/);
  assert.equal(snapshot.resumeVerified, true);
  assert.equal(snapshot.fields.find(f => f.label.includes('Name')).value, 'Test Candidate');
  assert.equal(await page.evaluate(() => window.submits), 0);
}));

test('completed report card is evidence even when Autofill becomes Another Job', async () => fixture(async (browser, page) => {
  await page.evaluate(() => { window.finishButtonMode = 'summary'; window.autofillDelay = 0; });
  const state = (await browser.run('autofill', {})).snapshot;
  assert.equal(state.autofill.summary, '3 / 4 required fields filled');
  assert.equal(await page.evaluate(() => window.submits), 0);
}));

test('Ashby tabpanel submits exactly once using the same Robin job id and receipt gate', async () => {
  const target = { ...job, url: 'https://jobs.ashbyhq.com/example/40659fe7-545e-4b08-b6d7-2567b18b9ed3/application',
    application: { ...job.application, url: 'https://jobs.ashbyhq.com/example/40659fe7-545e-4b08-b6d7-2567b18b9ed3/application' } };
  const ashby = html.replace('<form id="app">', '<div id="form" role="tabpanel">')
    .replace('<button type="submit">', '<section><button>')
    .replace('</button></form>', '</button></section><section><button type="button">Cancel</button></section></form>')
    .replace('</form>', '</div>')
    .replace("document.querySelector('#app').onsubmit=e=>{e.preventDefault();window.submits++;",
      "document.querySelector('#form button').onclick=()=>{window.submits++;");
  await fixture(async (browser, page) => {
    const state = (await browser.run('autofill', {})).snapshot;
    assert.equal(state.resumeVerified, true);
    const office = state.fields.find(f => f.label.includes('Preferred office'));
    const repaired = (await browser.run('repair', { expected: state, decisions: [
      ...state.fields.filter(f => f.kind !== 'file' && f.key !== office.key).map(f => ({ key: f.key, action: 'keep', value: f.value, source: 'jobright' })),
      { key: office.key, action: 'set', value: 'San Jose, CA', source: 'confirmed' },
    ] })).snapshot;
    assert.equal(repaired.errors.length, 0);
    assert.deepEqual(await browser.run('preflight', { expected: repaired }), { ready: true });
    const grant = { fingerprint: createHash('sha256').update(JSON.stringify(repaired)).digest('hex'),
      nonce: 'ashby-once', expiresAt: new Date(Date.now()+60_000).toISOString() };
    const found = await browser.run('submit', { expected: repaired, grant });
    assert.ok(found.receipt);
    assert.equal(await page.evaluate(() => window.submits), 1);
    await assert.rejects(browser.run('submit', { expected: repaired, grant }), /SUBMIT_ALREADY_ATTEMPTED/);
    assert.equal(await page.evaluate(() => window.submits), 1);
  }, target, ashby);
});

test('one Submit without a receipt records only safe observations and stays uncertain', async () => fixture(async (browser, page) => {
  const initial = (await browser.run('autofill', {})).snapshot;
  const office = initial.fields.find(f => f.label.includes('Preferred office'));
  const state = (await browser.run('repair', { expected: initial, decisions: [
    { key: office.key, action: 'set', value: 'San Jose, CA', source: 'confirmed' },
  ] })).snapshot;
  await page.evaluate(() => { document.querySelector('#app').onsubmit = e => { e.preventDefault(); window.submits++; }; });
  const grant = { fingerprint: createHash('sha256').update(JSON.stringify(state)).digest('hex'),
    nonce: 'uncertain-once', expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const result = await browser.run('submit', { expected: state, grant });
  assert.equal(result.uncertain, true);
  assert.match(result.reason, /posting matched; success heading=false; confirmation text=false; form visible=true/);
  assert.equal(await page.evaluate(() => window.submits), 1);
  await assert.rejects(browser.run('submit', { expected: state, grant }), /SUBMIT_ALREADY_ATTEMPTED/);
}));

test('changed form and expired grant never click Submit', async () => fixture(async (browser, page) => {
  const state = (await browser.run('autofill', {})).snapshot;
  const grant = { fingerprint: createHash('sha256').update(JSON.stringify(state)).digest('hex'),
    nonce: 'once', expiresAt: new Date(Date.now()+60_000).toISOString() };
  await page.locator('#name').fill('Changed outside Robin');
  await assert.rejects(browser.run('submit', { expected: state, grant }), /FORM_CHANGED/);
  assert.equal(await page.evaluate(() => window.submits), 0);
  await assert.rejects(browser.run('submit', { expected: state, grant: { ...grant, expiresAt: '2000-01-01' } }), /EXPIRED/);
  assert.equal(await page.evaluate(() => window.submits), 0);
}));
