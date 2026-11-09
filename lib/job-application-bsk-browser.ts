import { createHash } from "node:crypto";
import { applicationPostingMatches, type ApplicationDecision, type ApplicationField, type ApplicationSnapshot, type JobApplication } from "../extension/robin/job-applications.ts";
import { captureApplicationForm } from "../scripts/job-application-bsk-dom.mjs";
import { applicationSettings } from "../extension/robin/job-application-domain.ts";
import type { Job } from "../extension/robin/jobs.ts";
import { BskApplicationSession, withBskApplicationSession } from "./job-application-bsk-transport.ts";

type Field = ApplicationField & { selector?: string; rawValue?: string; optionValues?: { label: string; value: string }[];
  choices?: { text: string; rawText: string; selector: string; inputSelector: string; type: string; checked: boolean }[]; listSelector?: string };
type Snapshot = Omit<ApplicationSnapshot, "fields"> & { fields: Field[] };
type Mode = "autofill" | "inspect" | "repair" | "preflight" | "submit" | "receipt" | "focus";
const norm = (s: string) => s.replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const stable = (s: ApplicationSnapshot) => JSON.stringify({ fields: s.fields.map(({ key, label, kind, required, value, pendingSelection }) =>
  ({ key, label, kind, required, value, pendingSelection })), resumeVerified: s.resumeVerified, autofill: s.autofill });

const posting = (url: string, job: Job, receipt = false) => applicationPostingMatches(url, job.application!.url, job.url, receipt);
const receiptUrl = (raw: string) => {
  const url = new URL(raw), requisition = url.searchParams.get("gh_jid");
  url.search = requisition ? `?gh_jid=${encodeURIComponent(requisition)}` : "";
  url.hash = "";
  return url.href;
};
function checkTitle(title: string, headings: string[]): boolean {
  const words = (s: string) => norm(s).replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter(Boolean).map((w) => ({ i: "1", ii: "2", iii: "3", iv: "4" })[w as "i" | "ii" | "iii" | "iv"] ?? w);
  const core = title.replace(/(?:,\s*|\s+-\s*)(?:summer|fall|autumn|winter|spring)\s+20\d{2}\s*$/i, "");
  const levels = ["senior", "sr", "junior", "jr", "staff", "principal", "lead", "manager", "intern", "internship", "1", "2", "3", "4"];
  return headings.some((heading) => levels.every((level) => words(title).includes(level) === words(heading).includes(level))
    && (words(title).every((word) => words(heading).includes(word)) || (core !== title && words(core).join(" ") === words(heading).join(" "))));
}

/** The BSK backend owns only browser I/O. Robin still owns reservation, grants and receipts. */
export async function withBskApplicationBrowser<T>(job: Job, signal: AbortSignal,
  work: (browser: (mode: Mode, extra?: Record<string, unknown>) => Promise<Record<string, unknown>>) => Promise<T>): Promise<T> {
  const instance = applicationSettings().bskBrowserInstanceId;
  if (!instance) throw new Error("Set the verified Jobright BSK browser instance before enabling scheduled applications");
  return withBskApplicationSession(async (session) => {
    const browser = new BskJobBrowser(session, job);
    return work(async (mode, extra) => {
      try { return await browser.run(mode, extra ?? {}); }
      catch (error) {
        const code = error instanceof Error ? error.message : "";
        const kind = code.split(":", 1)[0];
        if (["POSTING_CHANGED", "POSTING_UNAVAILABLE", "POSTING_TITLE_MISMATCH", "POSTING_COMPANY_MISMATCH",
          "JOBRIGHT_SIGNIN", "JOBRIGHT_MISSING", "JOBRIGHT_NOT_READY", "JOBRIGHT_INCOMPLETE", "APPLICATION_FORM_UNAVAILABLE", "FORM_CHANGED", "NO_RECEIPT"].includes(kind)) {
          throw Object.assign(new Error(code), { code: kind });
        }
        throw error;
      }
    });
  }, { signal, browser: instance });
}

export class BskJobBrowser {
  private autofill: ApplicationSnapshot["autofill"] = null;
  private opened = false;
  private submittedNonce?: string;
  private readonly session: BskApplicationSession;
  private readonly job: Job;
  constructor(session: BskApplicationSession, job: Job) { this.session = session; this.job = job; }
  private get url() { return this.job.application!.url; }

  private async identity(first = false): Promise<void> {
    const deadline = Date.now() + (first ? 18_000 : 0);
    while (true) {
      const text = await this.session.sync();
      const tabs = await this.session.tabs();
      if (tabs.length !== 1 || !posting(tabs[0].url, this.job)) throw new Error("POSTING_CHANGED");
      if (!first) return;
      const headings = [...text.matchAll(/\bheading "([^"]{1,200})"/g)].map(match => match[1]);
      if (headings.some(h => /^(page|job|position) (not found|unavailable)$|^(this )?(job|position) is no longer available$/i.test(h))) throw new Error("POSTING_UNAVAILABLE");
      const company = norm(this.job.company).replace(/[^\p{L}\p{N}]/gu, "");
      const tenant = new URL(this.url).pathname.split("/")[1] ?? "";
      if (checkTitle(this.job.title, headings)
        && (norm(text).replace(/[^\p{L}\p{N}]/gu, "").includes(company)
          || norm(tenant).replace(/[^\p{L}\p{N}]/gu, "") === company)) return;
      if (Date.now() >= deadline) throw new Error("POSTING_TITLE_MISMATCH");
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }

  private async snapshot(): Promise<Snapshot> {
    await this.session.sync();
    const state = await this.session.read(`(${captureApplicationForm.toString()})()`) as Snapshot;
    if (!state || !Array.isArray(state.fields) || !Array.isArray(state.errors)) throw new Error("Invalid BSK form snapshot");
    state.autofill = this.autofill;
    return state;
  }

  private async extensionText(): Promise<string> {
    // VOM is a passive observation; strict evaluate receipts can be invalidated by
    // dynamic employer pages before a script ever runs.
    return this.session.sync();
  }

  private async runAutofill(): Promise<{ snapshot: Snapshot }> {
    if (!this.opened) { await this.session.navigate(this.url); this.opened = true; await this.identity(true); }
    // Jobright can render on a branded landing page with no auditable employer form.
    // Do not spend an Autofill credit (or 170 seconds) on an iframe/empty page.
    let before = await this.snapshot();
    for (let i = 0; !before.fields.length && i < 5 && before.errors.includes("No application form"); i++) {
      await new Promise(resolve => setTimeout(resolve, 600));
      await this.identity();
      before = await this.snapshot();
    }
    if (!before.fields.length || before.errors.some(error => /cross-origin Greenhouse iframe|Ambiguous application form/i.test(error)))
      throw new Error("APPLICATION_FORM_UNAVAILABLE");
    let ref = "", priorProgress = false, previousPage = "", settledReads = 0;
    const readyBy = Date.now() + 25_000;
    while (Date.now() < readyBy) {
      try {
        const view = await this.extensionText();
        if (/sign in to jobright|set up (?:your|a) jobright account/i.test(view)) throw new Error("JOBRIGHT_SIGNIN");
        const buttons = [...view.matchAll(/@(e\d+) button "Autofill"(?:\s|$)/g)];
        if (buttons.length === 1) {
          // Jobright can expose Autofill before reloading the posting with jr_id.
          // Wait for the URL and document to survive three read-only observations;
          // refresh the button ref once more before the one permitted click.
          const page = await this.session.read('({url:location.href,started:performance.timeOrigin})') as { url: string; started: number };
          if (!page || typeof page.url !== "string" || !Number.isFinite(page.started) || !posting(page.url, this.job)) throw new Error("POSTING_CHANGED");
          const key = `${page.url}\n${page.started}`;
          settledReads = key === previousPage ? settledReads + 1 : 1;
          previousPage = key;
          if (settledReads >= 3) {
            const fresh = await this.extensionText();
            const current = [...fresh.matchAll(/@(e\d+) button "Autofill"(?:\s|$)/g)];
            if (current.length === 1) { ref = `@${current[0][1]}`; priorProgress = /\d+\s*\/\s*\d+\s+required fields filled/i.test(fresh); break; }
            settledReads = 0;
          }
        } else { settledReads = 0; previousPage = ""; }
      } catch (error) {
        // A pre-click read can lose its context during the Jobright redirect.
        // Only read-only observations are retried; never replay an ambiguous click.
        if (!/^BSK (?:cooperate|evaluate) failed \(permission_denied\/(?:control_context_invalid|document_changed|observation_changed|cooperation_sync_required)\/(?:none|unknown)\)/.test((error as Error).message)) throw error;
        settledReads = 0; previousPage = "";
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ref) throw new Error("JOBRIGHT_NOT_READY");
    // The settled document may not be the one whose form we inspected above.
    before = await this.snapshot();
    if (!before.fields.length || before.errors.some(error => /cross-origin Greenhouse iframe|Ambiguous application form/i.test(error)))
      throw new Error("APPLICATION_FORM_UNAVAILABLE");
    const fresh = await this.extensionText();
    const current = [...fresh.matchAll(/@(e\d+) button "Autofill"(?:\s|$)/g)];
    if (current.length !== 1) throw new Error("JOBRIGHT_NOT_READY");
    ref = `@${current[0][1]}`;
    priorProgress = /\d+\s*\/\s*\d+\s+required fields filled/i.test(fresh);
    const startedAt = new Date().toISOString();
    await this.session.click(ref, [{ target: ref, field: "text", equals: "Autofill" }]);
    let busy = false, summary = "", progressSeen = false, lastBusy = false, lastIdle = false;
    let stableForm = "", stableReads = 0, lastForm: Snapshot | undefined;
    const baseline = stable(before);
    const deadline = Date.now() + 170_000;
    while (Date.now() < deadline) {
      await this.identity();
      const text = await this.extensionText();
      busy ||= /@e\d+ button "Autofilling|@e\d+ button "AI is scanning/i.test(text);
      const progress = text.match(/\d+\s*\/\s*\d+\s+required fields filled/i)?.[0];
      progressSeen ||= Boolean(progress);
      lastBusy = /@e\d+ button "Autofilling|@e\d+ button "AI is scanning/i.test(text);
      // Jobright can leave "Autofilling key fields" copy in its finished report.
      // Require an idle Autofill button or Jobright's completed report card;
      // the report must be new or follow an observed busy state.
      const idle = /@e\d+ button "Autofill"(?:\s|$)/.test(text);
      lastIdle = idle;
      const completedCard = /@e\d+ button "\d+\s*\/\s*\d+\s+required fields filled(?:\s|\")/i.test(text);
      if (progress && (idle || completedCard) && !lastBusy && (busy || !priorProgress)) { summary = progress; break; }
      if (/sign in to jobright/i.test(text)) throw new Error("JOBRIGHT_SIGNIN");
      // A completion badge can be missed while the employer form was actually filled.
      // Require a post-click change, an observed resume attachment, no errors, and
      // several identical read-backs while Jobright is idle. Never infer completion
      // from the pre-existing profile resume or from an Autofill click alone.
      if (idle && !lastBusy) {
        const form = await this.snapshot();
        lastForm = form;
        const fingerprint = stable(form);
        stableReads = form.fields.length && !before.resumeVerified && form.resumeVerified && !form.errors.length && fingerprint !== baseline
          ? fingerprint === stableForm ? stableReads + 1 : 1 : 0;
        stableForm = fingerprint;
        if (stableReads >= 5) { summary = "Employer form and resume stable after Jobright Autofill; completion report not observed"; break; }
      } else { stableReads = 0; stableForm = ""; }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    if (!summary) {
      // Keep bounded, non-personal observations on the job: console objects can be
      // flattened by Next and the worker discards the browser after this attempt.
      throw new Error(`JOBRIGHT_INCOMPLETE: busySeen=${busy}; progressSeen=${progressSeen}; busyAtEnd=${lastBusy}; idleAtEnd=${lastIdle}; formObserved=${Boolean(lastForm)}; resumeObserved=${lastForm?.resumeVerified ?? "unknown"}; formErrors=${lastForm?.errors.length ?? "unknown"}; stableReads=${stableReads}`);
    }
    this.autofill = { clickedAt: startedAt, completedAt: new Date().toISOString(), summary };
    return { snapshot: await this.snapshot() };
  }

  private async repair(expected: ApplicationSnapshot, decisions: ApplicationDecision[]): Promise<{ snapshot: Snapshot }> {
    const before = await this.snapshot();
    if (stable(before) !== stable(expected)) throw new Error("FORM_CHANGED");
    const errors: string[] = [];
    for (const decision of decisions) {
      if (decision.action === "attention") continue;
      const state = await this.snapshot(), field = state.fields.find((item) => item.key === decision.key);
      if (!field) { errors.push(`Field changed: ${decision.key}`); continue; }
      if (field.kind === "file" || (field.value === decision.value && !field.pendingSelection)) continue;
      if (!field.selector) { errors.push(`No unique control for ${field.label}`); continue; }
      const selector = field.selector;
      try {
        await this.identity();
        const location = await this.session.read(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});return {count:document.querySelectorAll(${JSON.stringify(selector)}).length, value:n?.value ?? "", visible:!!n?.getClientRects().length}})()` ) as { count: number; value: string; visible: boolean };
        if (location.count !== 1 || !location.visible) throw new Error("FORM_CONTROL_UNAVAILABLE");
        await this.session.sync();
        const expectedValue = [{ target: selector, field: "value", equals: location.value }];
        if (["text", "search", "email", "tel", "url", "date", "number", "textarea"].includes(field.kind ?? "")) {
          await this.session.fill(selector, decision.value, expectedValue);
        } else if (field.kind === "select-one") {
          const matches = field.optionValues?.filter((option) => norm(option.label) === norm(decision.value)) ?? [];
          if (matches.length !== 1) throw new Error("No unique matching option");
          await this.session.select(selector, matches[0].value, expectedValue);
        } else if (field.kind === "checkbox" || field.kind === "radio") {
          await this.session.click(selector, [{ target: selector, field: "checked", equals: false }]);
        } else if (field.kind === "choice") {
          const matches = field.choices?.filter((option) => norm(option.text) === norm(decision.value) && option.type !== "submit") ?? [];
          if (matches.length !== 1 || matches[0].checked) throw new Error("No unique unselected safe choice");
          const choice = matches[0];
          await this.session.click(choice.selector, choice.type === "input"
            ? [{ target: choice.inputSelector, field: "checked", equals: false }]
            : [{ target: choice.selector, field: "text", equals: choice.rawText }]);
        } else if (field.kind === "combobox") {
          await this.session.fill(selector, decision.value, expectedValue);
          await this.session.sync();
          await this.session.press(selector, "ArrowDown", [{ target: selector, field: "value", equals: decision.value }]);
          await this.session.sync();
          const options = await this.session.read(`(()=>{const input=document.querySelector(${JSON.stringify(selector)}),id=input?.getAttribute("aria-controls")||input?.getAttribute("aria-owns");const list=id?document.getElementById(id):input?.closest('.ashby-application-form-field-entry,.select')?.querySelector('[role=listbox]');return [...(list?.querySelectorAll('[role=option]')??[])].filter(n=>n.getClientRects().length).map((n,i)=>({text:(n.querySelector('[class*=canonicalSchoolResultName]')?.innerText||n.innerText||'').trim(),rawText:n.textContent,selector:list?.id?'#'+CSS.escape(list.id)+' [role=option]:nth-of-type('+(i+1)+')':null}))})()`) as Array<{ text: string; rawText: string; selector: string | null }>;
          const exact = options.filter((option) => norm(option.text) === norm(decision.value) && option.selector);
          if (exact.length !== 1) throw new Error("No unique matching option");
          await this.session.sync();
          await this.session.click(exact[0].selector!, [{ target: exact[0].selector!, field: "text", equals: exact[0].rawText }]);
        } else throw new Error("Unsupported form control");
      } catch { errors.push(`Could not repair ${field.label}`); }
    }
    const state = await this.snapshot();
    state.errors.push(...errors);
    return { snapshot: state };
  }

  private receiptObservation = "not inspected";
  private async inspectReceipt(): Promise<{ receipt?: JobApplication["receipt"]; rejection?: JobApplication["receipt"] }> {
    await this.session.sync();
    const page = await this.session.read('({url:location.href,headings:[...document.querySelectorAll("h1,h2,h3,h4,[role=heading]")].filter(n=>n.getClientRects().length).map(n=>n.innerText.trim()),text:document.body.innerText,form:[...document.querySelectorAll("input[type=email],textarea,button[type=submit],input[type=submit],#form[role=tabpanel] input")].some(n=>n.getClientRects().length)})') as {
      url: string; headings: string[]; text: string; form: boolean };
    const matched = posting(page.url, this.job, true);
    if (!matched) { this.receiptObservation = "posting mismatch"; return {}; }
    const at = new Date().toISOString();
    const success = page.headings.some((heading) => /^(success|thank you(?: for applying)?|application (?:submitted|received))[.!]?$/i.test(heading));
    const confirmation = page.text.match(/Your application (?:has been|was) (?:successfully )?(?:submitted|received)[^\n]*|We have received your application[^\n]*|You have successfully applied[^\n]*|Thanks so much for applying to join us at[^\n]+|Thank you for applying[^\n]*/i)?.[0];
    if (success && confirmation && !page.form) return { receipt: { at, url: receiptUrl(page.url), text: confirmation.slice(0, 1000) } };
    const correctionHeading = page.headings.includes("Your form needs corrections");
    if (correctionHeading && page.form) {
      const missing = page.text.match(/Missing entry for required field:[^\n]+/g);
      if (missing?.length) return { rejection: { at, url: receiptUrl(page.url), text: missing.join("\n").slice(0, 1000) } };
    }
    this.receiptObservation = `posting matched; success heading=${success}; confirmation text=${Boolean(confirmation)}; form visible=${page.form}; correction heading=${correctionHeading}`;
    return {};
  }

  private async preflight(expected: ApplicationSnapshot): Promise<{ text: string; selector: string; input: boolean }> {
    await this.identity();
    const fresh = await this.snapshot();
    if (stable(fresh) !== stable(expected) || fresh.errors.length || !fresh.resumeVerified || !fresh.autofill
      || fresh.fields.some((field) => field.pendingSelection || (field.required && !field.value))) throw new Error("FORM_CHANGED");
    await this.session.sync();
    const control = await this.session.read('(()=>{const root=location.hostname==="jobs.ashbyhq.com"?document.querySelector("#form[role=tabpanel]"):document.forms.length===1?document.forms[0]:null;if(!root)return null;const buttons=[...root.querySelectorAll("button,input[type=submit]")].filter(n=>n.getClientRects().length&&!n.disabled&&n.getAttribute("aria-disabled")!=="true"&&/^(submit(?: application)?|submit your application|apply now)$/i.test((n.innerText||n.value||"").trim()));if(buttons.length!==1)return null;const button=buttons[0],parts=[];for(let n=button;n&&n!==root;n=n.parentElement){const siblings=[...(n.parentElement?.children??[])].filter(other=>other.tagName===n.tagName);parts.unshift(n.tagName.toLowerCase()+":nth-of-type("+(siblings.indexOf(n)+1)+")")}return {text:button.tagName==="INPUT"?button.value:button.textContent,selector:(root.matches("form")?"form":"#form[role=tabpanel]")+" > "+parts.join(" > "),input:button.tagName==="INPUT"}})()') as { text: string; selector: string; input: boolean } | null;
    if (!control || !control.selector || typeof control.text !== "string") throw new Error("SUBMIT_CONTROL_UNAVAILABLE: no unique enabled button");
    await this.session.sync();
    const target = await this.session.read(`(()=>{const nodes=document.querySelectorAll(${JSON.stringify(control.selector)});const n=nodes[0];return {count:nodes.length,visible:!!n?.getClientRects().length,text:${control.input ? "n?.value" : "n?.textContent"}}})()`) as { count: number; visible: boolean; text: string };
    if (target.count !== 1 || !target.visible || target.text !== control.text) throw new Error(`SUBMIT_CONTROL_UNAVAILABLE: ${target.count !== 1 ? "selector count" : !target.visible ? "hidden" : "label changed"}`);
    return control;
  }

  private async submit(expected: ApplicationSnapshot, grant: NonNullable<JobApplication["submission"]>): Promise<Record<string, unknown>> {
    if (!grant || Date.now() >= Date.parse(grant.expiresAt)) throw new Error("SUBMISSION_GRANT_EXPIRED");
    if (this.submittedNonce) throw new Error("SUBMIT_ALREADY_ATTEMPTED");
    if (createHash("sha256").update(JSON.stringify(expected)).digest("hex") !== grant.fingerprint) throw new Error("FORM_CHANGED");
    const control = await this.preflight(expected);
    await this.session.sync();
    // Grant is durable before this EXACTLY ONE input. A transport error can mean the click happened.
    this.submittedNonce = grant.nonce;
    await this.session.click(control.selector, [{ target: control.selector, field: control.input ? "value" : "text", equals: control.text }]);
    for (let i = 0; i < 25; i++) {
      const found = await this.inspectReceipt();
      if (found.receipt || found.rejection) return found;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return { uncertain: true, reason: `No definitive receipt after Submit (${this.receiptObservation}); do not resubmit automatically.` };
  }

  async run(mode: Mode, extra: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (mode === "autofill") return this.runAutofill();
    if (!this.opened && (mode === "focus" || mode === "inspect")) throw new Error("DRAFT_MISSING");
    if (!this.opened) { await this.session.navigate(this.url); this.opened = true; }
    if (mode === "focus") { await this.identity(); return { focused: true }; }
    if (mode === "receipt") { const found = await this.inspectReceipt(); if (!found.receipt && !found.rejection) throw new Error("NO_RECEIPT"); return found; }
    if (mode === "inspect") { await this.identity(); return { snapshot: await this.snapshot() }; }
    if (mode === "repair") return this.repair(extra.expected as ApplicationSnapshot, extra.decisions as ApplicationDecision[]);
    if (mode === "preflight") { await this.preflight(extra.expected as ApplicationSnapshot); return { ready: true }; }
    return this.submit(extra.expected as ApplicationSnapshot, extra.grant as NonNullable<JobApplication["submission"]>);
  }
}
