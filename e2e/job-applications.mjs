// Isolated local fixture: clicks a simulated Jobright extension, never a real employer.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { runInNewContext } from "node:vm";
import { chromium } from "playwright";
import { applicationPage } from "../scripts/job-application-page.mjs";

let server, browser, origin;
const html = `<!doctype html><html><body><h1>Software Engineer</h1><p>Example</p>
<form id="application"><div class="field"><label for="name">Name *</label><input id="name" required></div>
<div class="field"><label for="email">Email *</label><input id="email" type="email" required></div>
<div class="field"><label for="resume">Resume/CV *</label><input id="resume" type="file" onchange="document.getElementById('filename').textContent=this.files[0].name;document.getElementById('name').value='Parser guess'"><span id="filename"></span></div>
<fieldset><legend class="_required_label">Sponsorship?</legend><button aria-pressed="false" onclick="for(const b of this.parentElement.querySelectorAll('button')) b.setAttribute('aria-pressed',String(b===this))">Yes</button><button aria-pressed="false" onclick="for(const b of this.parentElement.querySelectorAll('button')) b.setAttribute('aria-pressed',String(b===this))">No</button><input type="checkbox" hidden checked aria-label="Sponsorship?"></fieldset>
<fieldset><legend>Gender</legend><label><input id="male" type="radio" name="gender" onclick="this.checked=false">Male</label></fieldset>
<div class="select"><label for="school">School *</label><input id="school" role="combobox" aria-required="true" oninput="document.getElementById('options').hidden=false"><div role="listbox" id="options" hidden><div role="option" onclick="document.getElementById('school').value=this.innerText;this.parentElement.hidden=true">Carnegie Mellon University</div><div role="option">Carnegie Mellon University Africa</div></div></div>
<button type="submit">Submit Application</button></form>
<plasmo-csui id="jobright-helper-plugin"></plasmo-csui>
<script>
window.submissions=0;window.autofills=0;
document.getElementById('resume').addEventListener('change',()=>{window.resumeChanged=true});
document.getElementById('application').onsubmit=e=>{e.preventDefault();window.submissions++;if(location.pathname.includes('validation')){document.getElementById('application').insertAdjacentHTML('afterbegin','<h2>Your form needs corrections</h2><p>Missing entry for required field: Name</p>');return;}if(!location.pathname.includes('uncertain'))document.body.innerHTML='<h1>Success</h1><p>Thanks so much for applying to join us at Example!</p>'};
const root=document.getElementById('jobright-helper-plugin').attachShadow({mode:'open'});
root.innerHTML='<div><button type="button">Autofill</button><p id="progress"></p></div>';
root.querySelector('button').onclick=()=>{window.autofills++;root.querySelector('button').textContent='Autofilling...';setTimeout(()=>{
 document.getElementById('name').value='Wrong Name';document.getElementById('email').value='candidate@example.com';document.getElementById('male').checked=true;document.getElementById('school').value='Carnegie Mellon University Africa';
 document.querySelector('fieldset button').setAttribute('aria-pressed','true');
 const t=new DataTransfer();t.items.add(new File(['%PDF-old'], 'old-resume.pdf',{type:'application/pdf'}));document.getElementById('resume').files=t.files;document.getElementById('filename').textContent='old-resume.pdf';
 const done=()=>{root.querySelector('button').textContent='Autofill';root.querySelector('#progress').textContent='6/6 required fields filled';};
 if(location.pathname.includes('paused')){root.querySelector('#progress').textContent='93%';const skip=document.createElement('button');skip.textContent='Skip';skip.onclick=()=>{done();skip.remove()};root.querySelector('div').append(skip);}else done();},1000);};
</script></body></html>`;
before(async () => {
  server = createServer((_request, response) => { response.setHeader("Content-Type", "text/html"); response.end(html); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "chrome", headless: true });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
const program = runInNewContext(`(${applicationPage.toString()})`); // No Node URL, Buffer or timers.
const input = (path = "/job") => ({ mode: "autofill", id: "fixture", attemptId: "one", url: `${origin}${path}`, title: "Software Engineer", company: "Example" });
const decisions = (snapshot) => snapshot.fields.filter(f => f.kind !== "file").map(f => ({ key: f.key, action: f.label === "Gender" ? "clear" : "set", value: ({ "Name *": "Test Candidate", "Email *": "candidate@example.com", "Sponsorship?": "No", "School *": "Carnegie Mellon University", Gender: "" })[f.label] }));
async function validated(page, args) {
  let state = (await program(page, args)).snapshot;
  assert.ok(state.autofill.summary.startsWith("6/6 required fields filled"));
  assert.equal(state.resumeVerified, true);
  state = (await program(page, { ...args, mode: "repair", expected: state, decisions: decisions(state) })).snapshot;
  assert.equal(state.resumeVerified, true);
  assert.equal(state.fields.find(f => f.label === "Name *").value, "Test Candidate");
  assert.equal(state.fields.find(f => f.label === "Sponsorship?").value, "No");
  assert.equal(state.fields.find(f => f.label === "Gender").value, "");
  assert.equal(state.fields.find(f => f.label === "School *").value, "Carnegie Mellon University");
  return state;
}
const grant = (state) => ({ nonce: "test-nonce", fingerprint: createHash('sha256').update(JSON.stringify(state)).digest('hex'), expiresAt: new Date(Date.now() + 60000).toISOString() });

test("Jobright supplies the resume unchanged; answers and optional defaults are repaired before a single successful submit", async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage(), args = input();
    const state = await validated(page, args), target = context.pages().at(-1);
    assert.equal(await target.evaluate(() => window.autofills), 1);
    assert.equal(await target.locator('#resume').evaluate(node => node.files[0].name), 'old-resume.pdf', 'Jobright file is accepted without matching a local PDF');
    assert.equal(await target.evaluate(() => window.resumeChanged), undefined, 'No replacement or file change events');
    assert.equal(await target.evaluate(() => window.submissions), 0);
    const result = await program(page, { ...args, mode: "submit", expected: state, grant: grant(state) });
    assert.match(result.receipt.text, /applying to join us at Example/);
    assert.equal(await target.evaluate(() => window.submissions), 1);
    await assert.rejects(program(page, { ...args, mode: "submit", expected: state, grant: grant(state) }), /FORM_CHANGED/);
    assert.equal(await target.evaluate(() => window.submissions), 1);
  } finally { await context.close(); }
});

test("post-review edits and expired authorization prevent the click", async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage(), args = input();
    const state = await validated(page, args), target = context.pages().at(-1);
    await target.locator('#name').fill('Changed after review');
    await assert.rejects(program(page, { ...args, mode: "submit", expected: state, grant: grant(state) }), /FORM_CHANGED/);
    await assert.rejects(program(page, { ...args, mode: "submit", expected: state, grant: { ...grant(state), expiresAt: "2000-01-01" } }), /EXPIRED/);
    assert.equal(await target.evaluate(() => window.submissions), 0);
  } finally { await context.close(); }
});

test("ambiguous submission cannot be clicked again, even with a fresh nonce", async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage(), args = input('/uncertain');
    const state = await validated(page, args), target = context.pages().at(-1);
    assert.equal((await program(page, { ...args, mode: "submit", expected: state, grant: grant(state) })).uncertain, true);
    await assert.rejects(program(page, { ...args, mode: "submit", expected: state, grant: { ...grant(state), nonce: 'different' } }), /ALREADY_ATTEMPTED/);
    assert.equal(await target.evaluate(() => window.submissions), 1);
  } finally { await context.close(); }
});

test("Ashby choice repairs await the actual field-save acknowledgement, including clear/reselect of an unchanged answer", async () => {
  const context = await browser.newContext();
  const saves = [];
  let savedValue = null, rejectSave = false;
  const patched = html.replace('<fieldset><legend', '<fieldset data-field-path="authorization"><legend').replaceAll(
    "for(const b of this.parentElement.querySelectorAll('button')) b.setAttribute('aria-pressed',String(b===this))",
    "const selected=this.getAttribute('aria-pressed')==='true';for(const b of this.parentElement.querySelectorAll('button'))b.setAttribute('aria-pressed',String(!selected&&b===this));fetch('/api/non-user-graphql?op=ApiSetFormValue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({variables:{path:'authorization',value:selected?undefined:this.innerText==='Yes'}})})"
  );
  await context.route('https://jobs.ashbyhq.com/**', async route => {
    if (route.request().url().includes('op=ApiSetFormValue')) {
      const value = route.request().postDataJSON().variables.value ?? null;
      await new Promise(resolve => setTimeout(resolve, 150));
      if (rejectSave) return route.fulfill({ json: { errors: [{ message: 'Save rejected' }], data: null } });
      savedValue = value; saves.push(value);
      return route.fulfill({ json: { data: { setFormValue: { value } } } });
    }
    return route.fulfill({ contentType: 'text/html', body: patched });
  });
  try {
    const page = await context.newPage(), args = { ...input(), url: 'https://jobs.ashbyhq.com/example/40659fe7-545e-4b08-b6d7-2567b18b9ed3/application' };
    let state = await validated(page, args);
    assert.equal(savedValue, false);
    savedValue = null; // Model the real failure: DOM still says No but backend did not retain it.
    state = (await program(page, { ...args, mode: 'repair', expected: state, decisions: decisions(state) })).snapshot;
    assert.equal(savedValue, false);
    assert.deepEqual(saves, [null, false, null, false]);
    assert.deepEqual(Array.from(state.errors), []);
    rejectSave = true;
    const plan = decisions(state).map(decision => decision.key.startsWith('sponsorship?') ? { ...decision, value: 'Yes' } : decision);
    state = (await program(page, { ...args, mode: 'repair', expected: state, decisions: plan })).snapshot;
    assert.equal(state.fields.find(field => field.label === 'Sponsorship?').value, 'Yes', 'DOM can look correct even when the server rejected the write');
    assert.ok(state.errors.length > 0);
    await assert.rejects(program(page, { ...args, mode: 'submit', expected: state, grant: grant(state) }), /FORM_CHANGED/);
    assert.equal(await context.pages().at(-1).evaluate(() => window.submissions), 0);
  } finally { await context.close(); }
});

test('Ashby radio fieldsets inherit their ancestor save path and await clear/reselect acknowledgements', async () => {
  const context = await browser.newContext(), saves = [];
  const url = 'https://jobs.ashbyhq.com/example/40659fe7-545e-4b08-b6d7-2567b18b9ed3/application';
  const patched = html.replace('<form id="application">', `<form id="application"><div data-field-path="recording"><fieldset class="ashby-application-form-input-radio-group"><legend>Interview consent</legend><label><input id="recording" type="radio" checked onclick="const n=this;fetch('/api/non-user-graphql?op=ApiSetFormValue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({variables:{path:'recording',value:window.radioState?null:true}})}).then(r=>r.json()).then(r=>{window.radioState=r.data.setFormValue.value;n.checked=!!window.radioState})">Yes</label></fieldset></div><script>window.radioState=true;</script>`);
  await context.route('https://jobs.ashbyhq.com/**', async route => {
    if (route.request().url().includes('op=ApiSetFormValue')) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const value = route.request().postDataJSON().variables.value; saves.push(value);
      return route.fulfill({ json: { data: { setFormValue: { value } } } });
    }
    return route.fulfill({ contentType: 'text/html', body: patched });
  });
  try {
    const page = await context.newPage(), args = { ...input(), url };
    let state = (await program(page, args)).snapshot;
    const field = state.fields.find(f => f.label === 'Interview consent');
    assert.equal(field.canClear, true);
    state = (await program(page, { ...args, mode: 'repair', expected: state, decisions: [{ key: field.key, action: 'keep', value: 'Yes' }] })).snapshot;
    assert.deepEqual(saves, [null, true]);
    assert.equal(state.fields.find(f => f.key === field.key).value, 'Yes');
    assert.deepEqual(Array.from(state.errors), []);
  } finally { await context.close(); }
});

test('clearing an optional Ashby text answer waits for its own save, not just an empty-looking input', async () => {
  const context = await browser.newContext(); let saved = 'Chips', reject = false;
  const url = 'https://jobs.ashbyhq.com/example/40659fe7-545e-4b08-b6d7-2567b18b9ed3/application';
  const patched = html.replace('<form id="application">', `<form id="application"><div class="ashby-application-form-field-entry" data-field-path="snack"><label for="snack">Favorite snack</label><input id="snack" value="Chips" oninput="fetch('/api/non-user-graphql?op=ApiSetFormValue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({variables:{path:'snack',value:this.value}})})"></div>`);
  await context.route('https://jobs.ashbyhq.com/**', async route => {
    if (route.request().url().includes('op=ApiSetFormValue')) {
      await new Promise(resolve => setTimeout(resolve, 250));
      if (reject) return route.fulfill({ json: { errors: [{ message: 'Rejected' }], data: null } });
      saved = route.request().postDataJSON().variables.value;
      return route.fulfill({ json: { data: { setFormValue: { value: saved } } } });
    }
    return route.fulfill({ contentType: 'text/html', body: patched });
  });
  try {
    const page = await context.newPage(), args = { ...input(), url };
    let state = (await program(page, args)).snapshot;
    const key = state.fields.find(f => f.label === 'Favorite snack').key;
    state = (await program(page, { ...args, mode: 'repair', expected: state, decisions: [{ key, action: 'clear', value: '' }] })).snapshot;
    assert.equal(saved, ''); assert.deepEqual(Array.from(state.errors), []);
    reject = true;
    state = (await program(page, { ...args, mode: 'repair', expected: state, decisions: [{ key, action: 'set', value: 'Rejected value' }] })).snapshot;
    assert.equal(saved, ''); assert.match(state.errors[0], /Draft save was rejected/);
  } finally { await context.close(); }
});

test("explicit server validation rejection is detected, but the browser never repeats that attempt", async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage(), args = input('/validation'), state = await validated(page, args);
    const result = await program(page, { ...args, mode: 'submit', expected: state, grant: grant(state) });
    assert.match(result.rejection.text, /^Missing entry for required field: Name/);
    assert.equal(result.receipt, undefined);
    await assert.rejects(program(page, { ...args, mode: 'submit', expected: state, grant: grant(state) }), /FORM_CHANGED/);
    assert.equal(await context.pages().at(-1).evaluate(() => window.submissions), 1);
  } finally { await context.close(); }
});

test('autofill wait periodically paints instead of leaving Jobright stalled in the background', async () => {
  const context = await browser.newContext(); let paints = 0;
  context.on('page', target => { target.screenshot = async () => { paints++; await target.evaluate(() => window.finishAutofill?.()); }; });
  const patched = html.replace('else done();},1000)', 'else window.finishAutofill=done;},1000)');
  await context.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', body: patched }));
  try {
    const page = await context.newPage(), result = await program(page, input());
    assert.ok(paints >= 2); assert.equal(result.snapshot.autofill.summary, '6/6 required fields filled');
  } finally { await context.close(); }
});

test("an occluded renderer needs no animation frames; a paused Jobright step is skipped and independently repaired", async () => {
  const context = await browser.newContext();
  try {
    await context.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    const page = await context.newPage(), state = await validated(page, input('/paused'));
    assert.match(state.autofill.summary, /1 paused steps skipped/);
    assert.deepEqual(Array.from(state.fields.find(field => field.label === 'Sponsorship?').options), ['Yes', 'No']);
    assert.equal(await context.pages().at(-1).evaluate(() => window.submissions), 0);
  } finally { await context.close(); }
});

test('a rendered resume survives an emptied or removed input; no Replace control is needed or clicked', async () => {
  for (const remove of [false, true]) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage(), args = input();
      await program(page, args);
      const target = context.pages().at(-1);
      await target.evaluate(remove => {
        const node = document.getElementById('resume');
        node.parentElement.className = 'file-upload';
        document.querySelector('label[for="resume"]').outerHTML = '<div class="label upload-label">Resume/CV*</div>';
        node.value = '';
        if (remove) node.remove();
        document.getElementById('filename').insertAdjacentHTML('afterend', '<button type="button" onclick="window.replaced=true">Replace</button>');
      }, remove);
      let state = (await program(page, { ...args, mode: 'inspect' })).snapshot;
      assert.equal(state.resumeVerified, true);
      assert.equal(state.fields.find(f => f.kind === 'file').value, 'old-resume.pdf');
      state = (await program(page, { ...args, mode: 'repair', expected: state, decisions: decisions(state) })).snapshot;
      assert.equal(await target.evaluate(() => window.replaced), undefined);
      const result = await program(page, { ...args, mode: 'submit', expected: state, grant: grant(state) });
      assert.ok(result.receipt);
    } finally { await context.close(); }
  }
});

test('cover letters and attachment format hints are not mistaken for a resume', async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage(), args = input();
    await program(page, args);
    await context.pages().at(-1).evaluate(() => {
      document.getElementById('resume').value = '';
      document.getElementById('filename').textContent = 'Accepted types: .pdf';
      document.getElementById('application').insertAdjacentHTML('beforeend', '<div class="field"><label for="cover_letter">Cover letter</label><input type="file" id="cover_letter"><span>cover-letter.pdf</span></div>');
      const files = new DataTransfer(); files.items.add(new File(['cover'], 'cover-letter.pdf'));
      document.getElementById('cover_letter').files = files.files;
    });
    assert.equal((await program(page, { ...args, mode: 'inspect' })).snapshot.resumeVerified, false);
  } finally { await context.close(); }
});

test('Greenhouse confirmation navigation is inspected without a second submit or a fresh draft', async () => {
  const context = await browser.newContext(); let confirmations = 0;
  const url = 'https://job-boards.greenhouse.io/example/jobs/1';
  await context.route('https://job-boards.greenhouse.io/**', route => {
    if (route.request().url().endsWith('/confirmation')) {
      confirmations++;
      return route.fulfill({ contentType: 'text/html', body: '<h1>Thank you for applying.</h1><p>Your application has been received. We will contact you.</p>' });
    }
    return route.fulfill({ contentType: 'text/html', body: html.replace("window.submissions++;", "window.submissions++;location.href='/example/jobs/1/confirmation';return;") });
  });
  try {
    const page = await context.newPage(), args = { ...input(), url };
    const state = await validated(page, args);
    const result = await program(page, { ...args, mode: 'submit', expected: state, grant: grant(state) });
    assert.equal(result.receipt.url, `${url}/confirmation`);
    assert.match(result.receipt.text, /application has been received/);
    assert.ok((await program(page, { ...args, mode: 'receipt' })).receipt);
    assert.equal(confirmations, 1);
    await assert.rejects(program(page, { ...args, mode: 'submit', expected: state, grant: grant(state) }), /FORM_CHANGED/);
  } finally { await context.close(); }
});

test('same requisition may omit a feed cohort suffix, but conflicting cohorts, seniority and missing pages are refused', async () => {
  for (const [title, expectedError] of [['Software Engineer', null], ['Software Engineer, Summer 2026', /TITLE_MISMATCH/], ['Senior Software Engineer', /TITLE_MISMATCH/], ['Page not found', /POSTING_UNAVAILABLE/]]) {
    const context = await browser.newContext();
    await context.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', body: html.replace('<h1>Software Engineer</h1>', `<h1>${title}</h1>`) }));
    try {
      const page = await context.newPage(), args = { ...input(), title: title.startsWith('Senior') ? 'Software Engineer' : 'Software Engineer, Summer 2027' };
      if (expectedError) {
        await assert.rejects(program(page, args), expectedError);
        assert.equal(await context.pages().at(-1).evaluate(() => window.autofills), 0);
      } else assert.ok((await program(page, args)).snapshot.autofill);
    } finally { await context.close(); }
  }
});

test('keyboard-opened menus use scoped, canonical options; matching search text cannot authorize submit', async () => {
  const context = await browser.newContext();
  const patched = html.replace('id="school" role="combobox"', 'id="school" role="combobox" aria-controls="options" aria-expanded="false" onkeydown="if(event.key===\'ArrowDown\'){document.getElementById(\'options\').hidden=false;this.setAttribute(\'aria-expanded\',\'true\')}"')
    .replace('oninput="document.getElementById(\'options\').hidden=false"', 'oninput="document.getElementById(\'options\').hidden=true;this.setAttribute(\'aria-expanded\',\'false\')"')
    .replace("document.getElementById('school').value=this.innerText;this.parentElement.hidden=true", "document.getElementById('school').value=this.querySelector('span').innerText;document.getElementById('school').setAttribute('aria-expanded','false');this.parentElement.hidden=true")
    .replace('>Carnegie Mellon University</div>', '><span class="_canonicalSchoolResultName_test">Carnegie Mellon University</span><span>United States</span><span>cmu.edu</span></div>')
    .replace('<form id="application">', '<div role="listbox"><div role="option">Wrong unrelated option</div></div><form id="application">');
  await context.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', body: patched }));
  try {
    const page = await context.newPage(), args = input();
    await validated(page, args);
    const target = context.pages().at(-1);
    await target.locator('#school').fill('Carnegie Mellon University');
    await target.locator('#school').press('ArrowDown');
    const state = (await program(page, { ...args, mode: 'inspect' })).snapshot;
    const school = state.fields.find(f => f.label === 'School *');
    assert.equal(school.pendingSelection, true);
    assert.deepEqual(Array.from(school.options), ['Carnegie Mellon University', 'Carnegie Mellon University Africa']);
    await assert.rejects(program(page, { ...args, mode: 'submit', expected: state, grant: grant(state) }), /FORM_CHANGED/);
  } finally { await context.close(); }
});

test('phone and optional texting consent are distinct; a calendar month announcement is not a validation error', async () => {
  const context = await browser.newContext();
  const patched = html.replace('<form id="application">', `<form id="application"><div class="ashby-application-form-field-entry"><label for="phone">Phone *</label><input id="phone" type="tel" required value="1234567890"><div class="ashby-application-form-texting-consent-description"><p>Check Yes or No to indicate consent to text messages.</p><label><input type="radio" name="sms" value="yes">Yes</label><label><input type="radio" name="sms" value="no">No</label></div></div><div role="alert" class="react-datepicker__aria-live">December 2026</div><div role="alert">A real validation error</div>`);
  await context.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', body: patched }));
  try {
    const page = await context.newPage(), state = (await program(page, input())).snapshot;
    const phone = state.fields.find(f => f.kind === 'tel'), consent = state.fields.find(f => f.label.startsWith('Text message consent:'));
    assert.equal(phone.value, '1234567890'); assert.equal(phone.required, true);
    assert.equal(consent.kind, 'choice'); assert.equal(consent.required, false); assert.equal(consent.value, '');
    assert.deepEqual(Array.from(state.errors), ['A real validation error']);
  } finally { await context.close(); }
});

test("a claimed 100% autofill does not permit submission without an attached resume", async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage(), args = input();
    await program(page, args);
    await context.pages().at(-1).evaluate(() => { document.getElementById('resume').value='';document.getElementById('filename').textContent=''; });
    const state = (await program(page, { ...args, mode: 'inspect' })).snapshot;
    assert.equal(state.resumeVerified, false);
    await assert.rejects(program(page, { ...args, mode: 'submit', expected: state, grant: grant(state) }), /FORM_CHANGED/);
    assert.equal(await context.pages().at(-1).evaluate(() => window.submissions), 0);
  } finally { await context.close(); }
});
