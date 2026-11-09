/** Browser-only, read-only form projection. The caller uses BSK actions for every write. */
export function captureApplicationForm() {
  const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const norm = (value) => clean(value).replace(/\*/g, "").toLowerCase();
  const forms = [...document.querySelectorAll("form")];
  const ashbyRoot = location.hostname === 'jobs.ashbyhq.com' && document.querySelectorAll('#form[role="tabpanel"]').length === 1
    ? document.querySelector('#form[role="tabpanel"]') : null;
  const hasEmail = (root) => [...root.querySelectorAll('input:not([type="hidden"])')].some((input) =>
    input.type === 'email' || input.autocomplete === 'email'
      || [...(input.labels ?? [])].some((label) => /^\s*e-?mail\s*\*?\s*$/i.test(label.textContent ?? '')));
  const nativeForm = forms.find((candidate) => candidate.querySelector('button[type="submit"],input[type="submit"]')
    && hasEmail(candidate) && (candidate.querySelector('input[type="file"]')
      || [...candidate.querySelectorAll('label,legend,h3,h4,.upload-label')]
        .some((node) => /^(?:resume(?:\s*\/\s*cv)?|résumé|cv)\s*\*?$/i.test(clean(node.textContent)))));
  const ashbySubmit = ashbyRoot && [...ashbyRoot.querySelectorAll('button')]
    .some((button) => /^submit application$/i.test(clean(button.textContent)));
  const form = nativeForm ?? (ashbySubmit && hasEmail(ashbyRoot) ? ashbyRoot : null);
  if (!form) {
    const embedded = [...document.querySelectorAll('iframe[src]')].some((frame) => {
      const url = new URL(frame.src, location.href);
      return ['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(url.hostname)
        && url.pathname === '/embed/job_app' && !frame.contentDocument;
    });
    return { fields: [], resumeVerified: false, errors: [embedded ? 'Application form is in a cross-origin Greenhouse iframe; main-frame read-back is unavailable'
      : forms.length > 1 ? 'Ambiguous application form' : 'No application form'], autofill: null };
  }
  const container = '.ashby-application-form-field-entry,[class*="fieldEntry"],.field,.input-wrapper,.select';
  const choice = 'input[type="radio"],input[type="checkbox"],button[aria-pressed],[role="radio"],[role="checkbox"]';
  const path = (node) => {
    if (!node || !form.contains(node)) return "";
    const parts = [];
    for (let current = node; current && current !== form; current = current.parentElement) {
      const siblings = [...(current.parentElement?.children ?? [])].filter((other) => other.tagName === current.tagName);
      parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(current) + 1})`);
    }
    return `${form === ashbyRoot ? '#form[role="tabpanel"]' : 'form'} ${parts.join(" > ")}`;
  };
  const labelFor = (node) => {
    if (node.type === "file" && node.id === "resume") return "Resume";
    if (node.type === "file" && node.id === "cover_letter") return "Cover letter";
    const explicit = [...(node.labels ?? [])].map((label) => label.innerText).join(" ");
    const aria = (node.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? "").join(" ");
    return clean(explicit || node.getAttribute("aria-label") || aria || node.closest(container)?.querySelector("label,legend")?.innerText || node.name || node.id);
  };
  const groups = new Set();
  const nodes = [...form.querySelectorAll(`input:not([type="hidden"]):not([type="password"]):not([type="submit"]):not([type="button"]),textarea,select,[role="combobox"],${choice}`)]
    .filter((node) => !node.closest('[role="listbox"],[role="option"]') && !String(node.className).includes("requiredInput") && (node.type === "file" || node.getClientRects().length > 0))
    .map((node) => {
      const group = node.matches(choice) && (node.closest('.ashby-application-form-texting-consent-description')
        || node.closest('fieldset,[role="radiogroup"],.ashby-application-form-field-entry,[class*="fieldEntry"],.field'));
      if (group) { groups.add(group); return group; }
      return node;
    });
  const unique = [...new Set(nodes)], seen = new Map();
  const fields = unique.slice(0, 150).map((node) => {
    const grouped = groups.has(node), wrapper = grouped ? node : node.closest(container);
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
    const base = `${norm(label)}|${kind}`, occurrence = seen.get(base) ?? 0; seen.set(base, occurrence + 1);
    const listId = node.getAttribute("aria-controls") || node.getAttribute("aria-owns");
    const list = listId ? document.getElementById(listId) : wrapper?.querySelector('[role="listbox"]');
    const options = grouped ? choices.map(optionText) : node.tagName === "SELECT" ? [...node.options].map((option) => option.text)
      : kind === "combobox" ? [...(list?.querySelectorAll('[role="option"]') ?? [])].filter((option) => option.getClientRects().length).map(optionText) : [];
    return { key: `${base}|${occurrence}`, label: label.slice(0, 1000), kind, required, value: String(value).slice(0, 10000), options: options.slice(0, 200),
      selector: path(node), optionValues: node.tagName === "SELECT" ? [...node.options].map((option) => ({ label: option.text, value: option.value })) : [],
      choices: choices.map((option) => ({ text: optionText(option), rawText: option.tagName === "BUTTON" ? option.textContent : (option.labels?.[0] || option).textContent,
        selector: path(option.tagName === "INPUT" && option.labels?.[0] && form.contains(option.labels[0]) ? option.labels[0] : option),
        inputSelector: path(option), checked: Boolean(option.checked || option.getAttribute("aria-pressed") === "true" || option.getAttribute("aria-checked") === "true"),
        type: option.tagName === "BUTTON" ? option.getAttribute("type") || "submit" : option.tagName === "INPUT" ? "input" : "choice" })),
      rawValue: node.value ?? "",
      listSelector: list ? path(list) : "", canClear: !(grouped && !node.matches('.ashby-application-form-input-radio-group') && selected.some((option) => option.matches('input[type="radio"]'))),
      pendingSelection: kind === "combobox" && node.getAttribute("aria-expanded") === "true", check: value ? "needs-review" : "empty" };
  });
  const resumeFields = fields.filter((field) => field.kind === "file" && /resume|résumé|\bcv\b/i.test(field.label));
  const attached = new Set(resumeFields.filter((field) => field.value).map((field) => field.value));
  const headings = [...form.querySelectorAll('label,legend,h3,h4,.upload-label')].filter((node) => /^(resume|résumé|cv)(\s*\/\s*cv)?\s*\*?$/i.test(clean(node.innerText)));
  for (const heading of headings) {
    const section = heading.closest('.file-upload') || heading.closest(container) || heading.parentElement;
    if (!section || section.matches('form,body,html')) continue;
    for (const node of section.querySelectorAll('a,span,p,div')) {
      const name = clean(node.innerText);
      if (node.getClientRects().length && !node.children.length && /^.+\.(pdf|docx?|rtf|txt)$/i.test(name)
        && !/\b(accepted|supported|upload|choose|select|attach|types?)\b/i.test(name)) attached.add(name);
    }
  }
  const resumeVerified = attached.size > 0;
  if (resumeVerified) {
    const value = [...attached].join('; ');
    for (const field of resumeFields) if (!field.value) { field.value = value; field.check = 'needs-review'; }
    if (!resumeFields.length) fields.push({ key: 'resume-attachment|file|0', label: 'Resume', kind: 'file', required: true, value, options: [], check: 'needs-review' });
  }
  const errors = [...form.querySelectorAll('[role="alert"],.ashby-application-form-error,[class*="errorMessage"],.field-error')]
    .filter((node) => node.getClientRects().length && !node.matches('.react-datepicker__aria-live'))
    .map((node) => clean(node.innerText)).filter(Boolean).slice(0, 20);
  if (unique.length > 150) errors.push('Form exceeds the supported field limit');
  if (fields.some((field) => field.kind !== 'file' && !field.label)) errors.push('An unlabeled form control could not be audited');
  if ([...form.querySelectorAll('[contenteditable="true"]')].some((node) => node.getClientRects().length)) errors.push('Uninspected rich-text field');
  return { fields, resumeVerified, errors, autofill: null };
}
