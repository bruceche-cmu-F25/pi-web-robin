/** Self-contained Playwright CLI program. Employer/extension text is data, never executable instructions. */
export async function applicationPage(page, input) {
  const norm = (s) => String(s ?? "").replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const canonical = (url) => String(url).split(/[?#]/)[0]
    .replace(/^(https:\/\/(?:job-boards|boards)\.greenhouse\.io\/[^/]+\/jobs\/\d+)\/confirmation\/?$/, "$1")
    .replace(/\/application\/?$/, "").replace(/\/$/, "");
  const marker = `robin-application:${input.id}:${input.attemptId}`;
  const deadline = Date.now() + (input.mode === "autofill" ? 170000 : 95000);
  // Chrome's extension bridge can leave a tab occluded after bringToFront (zero animation frames).
  // Activate the same DOM control without Playwright's two-frame stability wait; never invoke private ATS/Jobright APIs.
  const click = (locator, allowSubmit = false) => locator.evaluate((node, allowed) => {
    if (!(node instanceof HTMLElement) || node.disabled || node.getAttribute("aria-disabled") === "true" || !node.getClientRects().length) throw new Error("FORM_CONTROL_UNAVAILABLE");
    // Some choice buttons omit type=button. Never let their default activation submit a form.
    const prevent = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    if (!allowed) document.addEventListener("submit", prevent, true);
    try { node.click(); } finally { if (!allowed) document.removeEventListener("submit", prevent, true); }
  }, allowSubmit);
  let target;
  for (const candidate of page.context().pages()) {
    if (canonical(candidate.url()) !== canonical(input.url)) continue;
    const name = await Promise.race([candidate.evaluate(() => window.name).catch(() => ""), candidate.waitForTimeout(2000).then(() => "")]);
    if (name === marker || (input.mode === "autofill" && !input.continueAutofill && name.startsWith(`robin-application:${input.id}:`))) { target = candidate; break; }
  }
  if (!target && (input.mode !== "autofill" || input.continueAutofill)) throw new Error("DRAFT_MISSING");
  if (!target) target = await page.context().newPage();
  target.setDefaultTimeout(6000);
  const samePosting = () => {
    if (Date.now() > deadline) throw new Error("WORKFLOW_TIMEOUT");
    if (canonical(target.url()) !== canonical(input.url)) throw new Error("POSTING_CHANGED");
  };
  if (input.mode === "autofill" && !input.continueAutofill) {
    await target.goto(input.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    samePosting();
    await target.evaluate((name) => { window.name = name; }, marker);
    await target.locator("h1").first().waitFor({ state: "visible", timeout: 20000 });
    const words = (s) => norm(s).replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter(Boolean).map((w) => ({ i: "1", ii: "2", iii: "3", iv: "4" })[w] ?? w);
    const titles = await target.locator("h1,h2").allTextContents();
    if (/^(page|job|position) (not found|unavailable)$|^(this )?(job|position) is no longer available$/i.test(titles[0]?.trim() ?? "")) throw new Error("POSTING_UNAVAILABLE");
    // Aggregators append cohort labels to an unchanged requisition. Accept only an exact core
    // title when the employer omits that suffix; never ignore conflicting years or seniority.
    const coreTitle = input.title.replace(/(?:,\s*|\s+-\s*)(?:summer|fall|autumn|winter|spring)\s+20\d{2}\s*$/i, "");
    const levels = ["senior", "sr", "junior", "jr", "staff", "principal", "lead", "manager", "intern", "internship", "1", "2", "3", "4"];
    if (!titles.some((title) => levels.every((level) => words(input.title).includes(level) === words(title).includes(level))
      && (words(input.title).every((word) => words(title).includes(word))
        || (coreTitle !== input.title && words(coreTitle).join(" ") === words(title).join(" "))))) throw new Error("POSTING_TITLE_MISMATCH");
    // The exact stored ATS requisition is the primary identity. Logos/tenant slugs count as employer evidence too.
    const company = norm(input.company).replace(/[^\p{L}\p{N}]/gu, "");
    const evidence = await target.evaluate(() => [document.title, document.body.innerText, ...[...document.images].map((image) => image.alt)].join(" "));
    const tenant = String(input.url).split("/")[3];
    if (!norm(evidence).replace(/[^\p{L}\p{N}]/gu, "").includes(company) && norm(tenant).replace(/[^\p{L}\p{N}]/gu, "") !== company) throw new Error("POSTING_COMPANY_MISMATCH");
  }
  samePosting();
  await target.bringToFront();
  if (input.mode === "focus") return { focused: true };

  const extension = target.locator("plasmo-csui#jobright-helper-plugin");
  const extensionText = async () => extension.evaluate((host) => [...(host.shadowRoot?.children ?? [])]
    .filter((node) => !["STYLE", "LINK"].includes(node.tagName)).map((node) => node.innerText ?? "").join("\n"));
  if (input.mode === "autofill") {
    await extension.waitFor({ state: "attached", timeout: 20000 }).catch(() => { throw new Error("JOBRIGHT_MISSING"); });
    const progressKey = `robin-autofill:${marker}`;
    const prior = input.continueAutofill ? await target.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || "null"), progressKey) : null;
    if (input.continueAutofill && !prior?.clickedAt) throw new Error("DRAFT_MISSING");
    const clickedAt = prior?.clickedAt ?? new Date().toISOString();
    if (!input.continueAutofill) {
      const button = extension.getByRole("button", { name: "Autofill", exact: true });
      await button.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
      if (!(await button.count()) || !(await button.isEnabled())) {
        const text = await extensionText();
        if (await extension.getByRole("button", { name: /^(sign in|log in)$/i }).count() || /set up (?:your|a) jobright account/i.test(text)) throw new Error("JOBRIGHT_SIGNIN");
        throw new Error("JOBRIGHT_NOT_READY");
      }
      await target.evaluate(({ key, clickedAt }) => sessionStorage.setItem(key, JSON.stringify({ clickedAt, busy: false })), { key: progressKey, clickedAt });
      try { await click(button); } catch (error) { if (!String(error).includes("Execution context was destroyed")) throw error; }
    }
    let busy = Boolean(prior?.busy), completed = false, summary = "", lastProgress = "", lastChange = Date.now(), skipped = 0;
    for (let i = 0; i < 160; i++) {
      samePosting();
      // Jobright's own UI work can stall in an occluded tab too, not only our repairs.
      if (i % 8 === 0) await target.screenshot({ timeout: 6000 }).catch(() => {});
      let text;
      try { text = await extensionText(); }
      catch { samePosting(); await target.waitForTimeout(750); continue; } // Jobright may reload the same posting with a jr_id query.
      busy ||= /Autofilling|AI is scanning|Scanning the page/i.test(text);
      if (busy) await target.evaluate(({ key, clickedAt }) => sessionStorage.setItem(key, JSON.stringify({ clickedAt, busy: true })), { key: progressKey, clickedAt }).catch(() => {});
      if (/sign in to jobright|set up (?:your|a) jobright account/i.test(text) && !busy) throw new Error("JOBRIGHT_SIGNIN");
      const progress = text.match(/\d+\s*\/\s*\d+\s+required fields filled/i)?.[0];
      if (busy && progress && !/Autofilling|AI is scanning|Scanning the page/i.test(text)) { completed = true; summary = progress + (skipped ? ` · ${skipped} paused steps skipped for our review` : ""); break; }
      const percentage = text.match(/\b\d+%/)?.[0] ?? "";
      if (percentage !== lastProgress) { lastProgress = percentage; lastChange = Date.now(); }
      // Jobright can wait indefinitely on an essay/custom widget. Skip only its paused autofill step;
      // our independent audit still has to resolve the employer's field before submission.
      if (busy && percentage && Date.now() - lastChange > 8000 && skipped < 10) {
        const skip = extension.getByText("Skip", { exact: true });
        if (await skip.count() === 1 && await skip.isVisible() && await skip.isEnabled()) { await click(skip); skipped++; lastChange = Date.now(); }
      }
      await target.waitForTimeout(750);
    }
    if (!completed) throw new Error("JOBRIGHT_INCOMPLETE");
    await target.evaluate((proof) => { window.__robinApplicationProof = { autofill: proof }; }, { clickedAt, completedAt: new Date().toISOString(), summary });
  }

  // Never include Jobright's shadow-tree controls in the employer's form snapshot.
  const snapshot = async () => target.evaluate(() => {
    const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
    const normalize = (s) => clean(s).replace(/\*/g, "").toLowerCase();
    const container = '.ashby-application-form-field-entry,[class*="fieldEntry"],.field,.input-wrapper,.select';
    const labelFor = (node) => {
      if (node.type === "file" && node.id === "resume") return "Resume";
      if (node.type === "file" && node.id === "cover_letter") return "Cover letter";
      const explicit = [...(node.labels ?? [])].map((label) => label.innerText).join(" ");
      const aria = (node.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? "").join(" ");
      return clean(explicit || node.getAttribute("aria-label") || aria || node.closest(container)?.querySelector("label,legend")?.innerText || node.name || node.id);
    };
    const choice = 'input[type="radio"],input[type="checkbox"],button[aria-pressed],[role="radio"],[role="checkbox"]';
    const groups = new Set();
    const nodes = [...document.querySelectorAll(`input:not([type="hidden"]):not([type="password"]):not([type="submit"]):not([type="button"]),textarea,select,[role="combobox"],${choice}`)]
      .filter((node) => !node.closest('[role="listbox"],[role="option"]') && !String(node.className).includes("requiredInput") && (node.type === "file" || node.getClientRects().length > 0))
      .map((node) => {
        const group = node.matches(choice) && (node.closest('.ashby-application-form-texting-consent-description')
          || node.closest('fieldset,[role="radiogroup"],.ashby-application-form-field-entry,[class*="fieldEntry"],.field'));
        if (group) { groups.add(group); return group; }
        return node;
      });
    const unique = [...new Set(nodes)];
    const seen = new Map();
    const fields = unique.slice(0, 150).map((node, slot) => {
      node.setAttribute("data-robin-slot", String(slot));
      const grouped = groups.has(node);
      const wrapper = grouped ? node : node.closest(container);
      const heading = wrapper?.querySelector('.ashby-application-form-question-title,legend,label');
      const texting = grouped && node.matches('.ashby-application-form-texting-consent-description');
      const label = texting ? `Text message consent: ${clean(node.querySelector('p')?.innerText || node.innerText.split("\n")[0])}`
        : grouped ? clean(heading?.innerText || node.innerText.split("\n")[0]) : labelFor(node);
      const kind = grouped ? "choice" : node.getAttribute("role") === "combobox" || node.getAttribute("aria-autocomplete") ? "combobox" : node.type || node.tagName.toLowerCase();
      const required = Boolean(node.required || node.getAttribute("aria-required") === "true" || /\*/.test(heading?.innerText ?? label)
        || String(heading?.className).includes("required") || (grouped && node.querySelector('[required],[aria-required="true"]')));
      const choices = grouped ? [...node.querySelectorAll(choice)].filter((option) => option.getClientRects().length > 0) : [];
      const optionText = (option) => clean(option.querySelector('[class*="canonicalSchoolResultName"]')?.innerText || option.innerText || labelFor(option));
      const selected = choices.filter((option) => option.checked || option.getAttribute("aria-pressed") === "true" || option.getAttribute("aria-checked") === "true");
      const custom = kind === "combobox" ? [...(wrapper?.querySelectorAll('[class*="single-value"],[class*="singleValue"],[class*="multi-value__label"]') ?? [])].map((part) => part.innerText).join("; ") : "";
      const value = grouped ? selected.map(optionText).join("; ")
        : ["checkbox", "radio"].includes(kind) ? (node.checked ? "Checked" : "")
        : kind === "file" ? [...(node.files ?? [])].map((file) => file.name).join("; ")
        : node.tagName === "SELECT" ? (node.value ? [...node.selectedOptions].map((option) => option.text).join("; ") : "")
        : clean(custom || node.value || "");
      const base = `${normalize(label)}|${kind}`;
      const occurrence = seen.get(base) ?? 0; seen.set(base, occurrence + 1);
      const listId = node.getAttribute("aria-controls") || node.getAttribute("aria-owns");
      const list = listId ? document.getElementById(listId) : wrapper?.querySelector('[role="listbox"]');
      const options = grouped ? choices.map(optionText) : node.tagName === "SELECT" ? [...node.options].map((option) => option.text)
        : kind === "combobox" ? [...(list?.querySelectorAll('[role="option"]') ?? [])].filter((option) => option.getClientRects().length).map(optionText) : [];
      return { key: `${base}|${occurrence}`, slot, label: label.slice(0, 1000), kind, required, value: String(value).slice(0, 10000),
        options: options.slice(0, 200), canClear: !(grouped && !node.matches('.ashby-application-form-input-radio-group') && selected.some((option) => option.matches('input[type="radio"]'))), pendingSelection: kind === "combobox" && node.getAttribute("aria-expanded") === "true",
        check: value ? "needs-review" : "empty" };
    });
    const proof = window.__robinApplicationProof;
    // Jobright owns the resume. Observe attachment presence, never replace or hash its bytes.
    const resumeFields = fields.filter((field) => field.kind === "file" && /resume|résumé|\bcv\b/i.test(field.label));
    const attached = new Set(resumeFields.filter((field) => field.value).map((field) => field.value));
    const headings = [...document.querySelectorAll('label,legend,h3,h4,.upload-label')].filter((node) => /^(resume|résumé|cv)(\s*\/\s*cv)?\s*\*?$/i.test(clean(node.innerText)));
    for (const heading of headings) {
      // ATSs may remove/clear the file input after upload. Read only the resume section,
      // not a cover letter elsewhere on the form or Jobright's progress/filename text.
      const section = heading.closest('.file-upload') || heading.closest(container) || heading.parentElement;
      if (!section || section.matches('form,body,html')) continue;
      for (const node of section.querySelectorAll('a,span,p,div')) {
        const name = clean(node.innerText);
        if (node.getClientRects().length && !node.children.length && /^.+\.(pdf|docx?|rtf|txt)$/i.test(name)
          && !/\b(accepted|supported|upload|choose|select|attach|types?)\b/i.test(name)) attached.add(name);
      }
    }
    const resumeVerified = attached.size > 0; // Persisted name retained; this is presence, not local-PDF identity.
    if (resumeVerified) {
      const value = [...attached].join("; ");
      for (const field of resumeFields) if (!field.value) { field.value = value; field.check = "needs-review"; }
      if (!resumeFields.length) fields.push({ key: "resume-attachment|file|0", label: "Resume", kind: "file", required: true, value, options: [], check: "needs-review" });
    }
    const errors = [...document.querySelectorAll('[role="alert"],.ashby-application-form-error,[class*="errorMessage"],.field-error')]
      .filter((node) => node.getClientRects().length && !node.matches('.react-datepicker__aria-live'))
      .map((node) => clean(node.innerText)).filter(Boolean).slice(0, 20);
    if ([...document.querySelectorAll('h1,h2,h3,h4,[role="heading"]')].some((node) => node.innerText.trim() === "Your form needs corrections")) {
      errors.push(...(document.body.innerText.match(/Missing entry for required field:[^\n]+/g) ?? []));
    }
    if (unique.length > 150) errors.push("Form exceeds the supported field limit");
    if (fields.some((field) => field.kind !== "file" && !field.label)) errors.push("An unlabeled form control could not be audited");
    if ([...document.querySelectorAll('[contenteditable="true"]')].some((node) => node.getClientRects().length)) errors.push("Uninspected rich-text field");
    return { fields, resumeVerified, errors, autofill: proof?.autofill ?? null };
  });
  const locate = (field) => target.locator(`[data-robin-slot="${field.slot}"]`);
  const stable = (state) => JSON.stringify({ fields: state.fields.map(({ key, label, kind, required, value, pendingSelection }) => ({ key, label, kind, required, value, pendingSelection })), resumeVerified: state.resumeVerified, autofill: state.autofill });

  if (input.mode === "repair") {
    if (stable(await snapshot()) !== stable(input.expected)) throw new Error("FORM_CHANGED");
    const repairErrors = [];
    for (const decision of input.decisions ?? []) {
      if (decision.action === "attention") continue;
      samePosting();
      const state = await snapshot(), field = state.fields.find((item) => item.key === decision.key);
      if (!field) { repairErrors.push(`Field changed: ${decision.key}`); continue; }
      if (field.kind === "file") continue;
      const desired = decision.value;
      if (field.value === desired && !field.pendingSelection && (field.kind !== "choice" || !desired || decision.source === "jobright")) continue;
      const locator = locate(field);
      try {
          const path = String(input.url).startsWith("https://jobs.ashbyhq.com/") ? await locator.evaluate((node) =>
            (node.matches('.ashby-application-form-texting-consent-description') ? null : node.closest('[data-field-path]'))?.getAttribute("data-field-path")) : null;
          // Ashby saves whole-form state in its response. Await each field's save before a
          // later response can overwrite it (including clearing an unsupported optional answer).
          const commitChange = async (action) => {
            const startedAt = Date.now();
            const saved = path ? target.waitForResponse((response) => {
              if (!response.url().includes("op=ApiSetFormValue")) return false;
              try { return response.request().timing().startTime >= startedAt && response.request().postDataJSON()?.variables?.path === path; } catch { return false; }
            }, { timeout: 12000 }).catch(() => null) : null;
            await action();
            // An occluded Chrome renderer can defer React effects. A page capture requests a paint;
            // no image is saved. Crucially, await the draft-save acknowledgement before toggling again.
            if (path) await target.screenshot({ timeout: 6000 });
            if (saved) {
              const response = await saved;
              if (!response?.ok()) throw new Error("Draft save was not acknowledged");
              const body = await response.json();
              const results = Object.values(body.data ?? {});
              if (body.errors?.length || !results.length || results.some((result) => result == null || result === false
                || (typeof result === "object" && (result.success === false || result.error || result.errors?.length || /(?:Error|Failure)$/.test(result.__typename ?? ""))))) throw new Error("Draft save was rejected");
            }
          };
        if (field.kind === "choice") {
          const controls = await locator.locator('input[type="radio"],input[type="checkbox"],button[aria-pressed],[role="radio"],[role="checkbox"]').all();
          for (const control of controls) {
            if (!await control.isVisible()) continue; // Ashby has a hidden checkbox mirroring its Yes/No buttons.
            const info = await control.evaluate((node) => ({ text: (node.innerText || [...(node.labels ?? [])].map((label) => label.innerText).join(" ")).trim(),
              selected: Boolean(node.checked || node.getAttribute("aria-pressed") === "true" || node.getAttribute("aria-checked") === "true") }));
            const wanted = desired.split("; ").some((value) => norm(value) === norm(info.text));
            if (info.selected && wanted) {
              // Commit approved choices through their real handlers, even if Jobright only changed the DOM.
              await commitChange(() => click(control));
              const stillSelected = await control.evaluate((node) => Boolean(node.checked || node.getAttribute("aria-pressed") === "true" || node.getAttribute("aria-checked") === "true"));
              if (!stillSelected) await commitChange(() => click(control));
            } else if (info.selected !== wanted && (info.selected || wanted)) await commitChange(() => click(control));
          }
        } else if (field.kind === "select-one") await commitChange(() => locator.selectOption(desired ? { label: desired } : { value: "" }));
        else if (field.kind === "combobox") {
          const search = async (text) => {
            await locator.fill(text);
            // React Select opens on mousedown/keyboard, not HTMLElement.click(). Never press Enter.
            await locator.press("ArrowDown");
            // Paint between the input event and option inspection: an open-state attribute may
            // still describe the previous React render, even when document.hidden is false.
            await target.screenshot({ timeout: 6000 });
            await target.waitForTimeout(350);
            const listId = await locator.getAttribute("aria-controls") || await locator.getAttribute("aria-owns");
            return listId ? target.locator(`[id=${JSON.stringify(listId)}]`).getByRole("option")
              : locator.locator('xpath=ancestor::*[contains(@class,"ashby-application-form-field-entry") or contains(concat(" ",normalize-space(@class)," ")," select ")][1]').getByRole("option");
          };
          if (desired) {
            let options = await search(desired);
            if (!await options.count() && /school/i.test(field.label) && desired.includes(",")) options = await search(desired.split(",")[0]);
            await options.first().waitFor({ state: "visible", timeout: 6000 });
            const exact = [];
            for (const option of await options.all()) {
              const text = await option.evaluate((node) => node.querySelector('[class*="canonicalSchoolResultName"]')?.innerText || node.innerText);
              if (norm(text) === norm(desired) && await option.evaluate((node) => node.getRootNode() === document)) exact.push(option);
            }
            // Leave the scoped options visible for the next audit. Never guess an institution/campus.
            if (exact.length !== 1) throw new Error("No unique matching option");
            await commitChange(async () => { await click(exact[0]); await locator.blur(); });
          } else { await commitChange(async () => { await locator.fill(""); await locator.press("Escape"); await locator.blur(); }); }
          if (await target.evaluate(() => document.hidden)) await target.screenshot({ timeout: 6000 });
        } else if (["checkbox", "radio"].includes(field.kind)) {
          if (await locator.isChecked() !== Boolean(desired)) await commitChange(() => click(locator));
        }
        else if (["text", "search", "email", "tel", "url", "date", "number", "textarea"].includes(field.kind)) { await commitChange(async () => { await locator.fill(desired); await locator.blur(); }); }
        else throw new Error("Unsupported widget");
      } catch (error) {
        const detail = ["Draft save was not acknowledged", "Draft save was rejected", "No unique matching option"].includes(error.message) ? ` (${error.message})` : "";
        repairErrors.push(`Could not repair ${field.label}; expected ${desired || "blank"}${detail}`);
      }
    }
    const state = await snapshot();
    state.errors.push(...repairErrors); // A correct-looking DOM must not hide a failed server acknowledgement.
    return { snapshot: state, repairErrors };
  }

  const receipt = async () => {
    if (canonical(target.url()) !== canonical(input.url)) return null;
    const headings = await target.getByRole("heading", { name: /^(success|thank you(?: for applying)?|application (?:submitted|received))[.!]?$/i }).all();
    const success = (await Promise.all(headings.map((heading) => heading.isVisible()))).some(Boolean);
    const text = await target.locator("body").innerText();
    const confirmation = text.match(/Your application (?:has been|was) (?:successfully )?(?:submitted|received)[^\n]*|We have received your application[^\n]*|You have successfully applied[^\n]*/i)?.[0]
      ?? text.match(/Thanks so much for applying to join us at[^\n]+|Thank you for applying[^\n]*/i)?.[0];
    const form = await target.locator('input[type="email"],textarea,button[type="submit"],input[type="submit"]').evaluateAll((nodes) => nodes.some((node) => node.getClientRects().length));
    if (!success || !confirmation || form) return null;
    return { at: new Date().toISOString(), url: String(target.url()).split(/[?#]/)[0], text: confirmation.slice(0, 1000) };
  };
  const rejection = async () => {
    if (canonical(target.url()) !== canonical(input.url)) return null;
    const heading = target.getByRole("heading", { name: "Your form needs corrections", exact: true });
    if (await heading.count() !== 1 || !await heading.isVisible()) return null;
    const messages = (await target.locator("body").innerText()).match(/Missing entry for required field:[^\n]+/g);
    if (!messages?.length || !await target.locator('input[type="email"]').evaluateAll((nodes) => nodes.some((node) => node.getRootNode() === document && node.getClientRects().length))) return null;
    return { at: new Date().toISOString(), url: input.url, text: messages.join("\n").slice(0, 1000) };
  };
  if (input.mode === "receipt") {
    const found = await receipt(); if (found) return { receipt: found };
    const rejected = await rejection(); if (rejected) return { rejection: rejected };
    throw new Error("NO_RECEIPT");
  }
  if (input.mode === "submit") {
    if (!input.grant || Date.now() >= Date.parse(input.grant.expiresAt)) throw new Error("SUBMISSION_GRANT_EXPIRED");
    const fingerprint = await target.evaluate(async (serialized) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized)))].map((n) => n.toString(16).padStart(2, "0")).join(""), JSON.stringify(input.expected));
    if (fingerprint !== input.grant.fingerprint) throw new Error("FORM_CHANGED");
    samePosting();
    const state = await snapshot();
    if (stable(state) !== stable(input.expected) || !state.resumeVerified || !state.autofill || state.errors.length || input.expected.errors.length
      || state.fields.some((field) => field.pendingSelection || (field.required && !field.value))) throw new Error("FORM_CHANGED");
    const buttons = target.getByRole("button", { name: /^(submit(?: application)?|submit your application|apply now)$/i });
    const candidates = [];
    for (const button of await buttons.all()) if (await button.isVisible() && await button.evaluate((node) => node.getRootNode() === document)) candidates.push(button);
    if (candidates.length !== 1 || !await candidates[0].isEnabled()) throw new Error("SUBMIT_CONTROL_UNAVAILABLE");
    const used = await target.evaluate((nonce) => {
      const key = `robin-submit:${window.name}`;
      if (sessionStorage.getItem(key)) return true;
      sessionStorage.setItem(key, nonce); return false;
    }, input.grant.nonce);
    if (used) throw new Error("SUBMISSION_ALREADY_ATTEMPTED");
    // Exactly one click. A timeout, server error or missing receipt must never trigger another one.
    try { await click(candidates[0], true); } catch { /* A navigation can destroy the context after the click. Inspect only; never click again. */ }
    for (let i = 0; i < 25; i++) {
      const found = await receipt(); if (found) return { receipt: found };
      const rejected = await rejection(); if (rejected) return { rejection: rejected };
      await target.waitForTimeout(1000);
    }
    return { uncertain: true, snapshot: await snapshot() };
  }
  return { snapshot: await snapshot() };
}
