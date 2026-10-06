/** Authorized campaign runner. Instagram transmission remains exclusively in Computer Use. */
import { coldReachSenderEmail } from "../extension/robin/jarvis-mail.ts";
import { readFileSync } from "node:fs";
import { PiWebHttpError, piWeb } from "./telegram/pi-web.ts";
import { readJarvis, recordJarvisEmailSourceCheck } from "../extension/robin/jarvis-domain.ts";
import { automationRoute, beginAutomationRunner, claimAutomatedOutreach, contactedToday, finishAutomatedOutreach, finishAutomationRunner, isHealthcareLead, readOutreachAutomation, reconcileAutomationAttempts, recordContactCheck, releaseUnstartedAutomatedEmailAttempt, type ContactCheck } from "../extension/robin/outreach-automation-domain.ts";
import { checkJarvisEmailSources } from "../extension/robin/jarvis-research.ts";
import { socialDraft } from "../extension/robin/outreach-shape.ts";
import { isCurrentValidationProspect, type JarvisState } from "../extension/robin/jarvis-shape.ts";
import { JARVIS_OUTREACH_API, JARVIS_RESEARCH_API, JARVIS_STATE_API } from "../lib/jarvis-api.ts";
const ctx = { url: process.env.PI_WEB_URL || "http://127.0.0.1:30141", password: process.env.PI_WEB_PASSWORD, fetch };
const [command = "status", id, argument] = process.argv.slice(2);
const lead = () => { const l = readJarvis().leads.find(l => l.id === id); if (!l) throw new Error("Unknown contact"); return l; };
const runner = beginAutomationRunner(command);
let failure = "";
try {
  const reconciled = reconcileAutomationAttempts();
  if (reconciled.sent || reconciled.blocked) console.error(`Reconciled ${reconciled.sent} sent and ${reconciled.blocked} blocked attempt(s) from CRM evidence.`);
  if (command === "status") {
    const crm = readJarvis(), state = readOutreachAutomation();
    const items = crm.leads.map(l => ({ id: l.id, name: l.name, company: l.company, healthcare: isHealthcareLead(l), route: automationRoute(l, state.checks[l.id]), email: l.email, emailCheck: l.emailCheck, socials: l.socials, checked: state.checks[l.id], attempt: state.attempts.find(a => a.leadId === l.id)?.state })).filter(l => l.route !== "skip");
    console.log(JSON.stringify({ dailyTarget: 100, contactedToday: contactedToday(crm.leads), runner: state.runner, counts: Object.fromEntries(["research", "instagram", "email", "linkedin"].map(k => [k, items.filter(l => l.route === k).length])), items }, null, 2));
  } else if (command === "ensure-research") {
    const crm = await piWeb<JarvisState>(ctx, JARVIS_STATE_API, undefined, 30000, "GET");
    const day = (at: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
    const today = day(new Date().toISOString());
    const prospects = crm.leads.filter(isCurrentValidationProspect);
    const added = prospects.filter(l => day(l.createdAt) === today).length;
    const missing = Math.max(0, 100 - added);
    if (!missing || crm.run?.status === "running" || crm.rescore?.status === "running") {
      console.log(JSON.stringify({ addedToday: added, remaining: missing, research: crm.run?.status, action: missing ? "reuse-active-run" : "daily-research-complete" }));
    } else if (crm.run?.status === "error" && day(crm.run.startedAt) === today) {
      throw new Error(`Investigate the failed research run before restarting: ${crm.run.lastError || crm.run.message}`);
    } else {
      console.log(JSON.stringify(await piWeb(ctx, JARVIS_RESEARCH_API, { action: "discover", target: prospects.length + missing, focus: "info_exec" }), null, 2));
    }
  } else if (command === "check") {
    if (!argument) throw new Error("check <lead-id> <JSON-file>");
    recordContactCheck(id!, JSON.parse(readFileSync(argument, "utf8")) as ContactCheck);
    console.log("Contact research saved.");
  } else if (command === "verify-email") {
    const l = lead();
    const found = await checkJarvisEmailSources([l], new AbortController().signal);
    recordJarvisEmailSourceCheck(l.id, l.revision ?? 0, l.email, found.has(l.email));
    console.log(JSON.stringify({ name: l.name, sourceFound: found.has(l.email) }));
  } else if (command === "prepare") {
    let l = lead(); const state = readOutreachAutomation();
    const channel = automationRoute(l, state.checks[l.id]);
    if (!["instagram", "email", "linkedin"].includes(channel) || channel !== argument) throw new Error(`Contact requires ${channel}`);
    const draft = channel === "email" ? l.body : socialDraft(l, channel as "instagram" | "linkedin");
    const route = channel === "email" ? l.email : l.socials![channel as "instagram" | "linkedin"]!;
    if (l.outreachWorkflow?.stage === "send") {
      await piWeb(ctx, JARVIS_OUTREACH_API, { action: "plan-channel", id: l.id, revision: l.revision ?? 0, channel, confirmed: true, route, source: l.emailSource, subject: l.subject, body: draft });
    } else {
      await piWeb(ctx, JARVIS_OUTREACH_API, { action: "review-queue", op: "add", ids: [l.id] }); l = lead();
      await piWeb(ctx, JARVIS_OUTREACH_API, { action: "approve-for-send", channel, confirmed: true, items: [{ id: l.id, revision: l.revision ?? 0, identityChecked: true, draftChecked: true, route, source: l.emailSource, subject: l.subject, body: draft, draft }] });
    }
    console.log(JSON.stringify({ name: l.name, channel, route, subject: channel === "email" ? l.subject : undefined, body: draft }));
  } else if (command === "claim-instagram") {
    console.log(JSON.stringify(claimAutomatedOutreach(id!, "instagram")));
  } else if (command === "finish") {
    if (!argument) throw new Error("finish <attempt-id> <observed-result-JSON-file>");
    const result = JSON.parse(readFileSync(argument, "utf8"));
    if (typeof result.sent !== "boolean") throw new Error("Observed sent must be boolean");
    finishAutomatedOutreach(id!, result.evidence, result.sent, result.blocked === true); console.log("Recorded.");
  } else if (command === "send-email") {
    const l = lead();
    if (coldReachSenderEmail() !== "brucecheng921@gmail.com") throw new Error("Connect the authorized personal Gmail sender");
    const claim = claimAutomatedOutreach(id!, "email");
    try {
      const result = await piWeb(ctx, JARVIS_OUTREACH_API, { action: "send", id: l.id, revision: l.revision ?? 0, confirmed: true }, 60000);
      finishAutomatedOutreach(claim.id, JSON.stringify(result), true); console.log(JSON.stringify(result));
    } catch (error) {
      if (error instanceof PiWebHttpError && error.status === 409 && error.reason === "delivery-busy") releaseUnstartedAutomatedEmailAttempt(claim.id);
      else finishAutomatedOutreach(claim.id, String(error), false);
      throw error;
    }
  } else throw new Error("Commands: status | check <id> <file> | verify-email <id> | prepare <id> <channel> | claim-instagram <id> | finish <attempt-id> <file> | send-email <id>");
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  console.error(failure);
  process.exitCode = 1;
} finally {
  try { finishAutomationRunner(runner.id, failure ? "failed" : "succeeded", failure); }
  catch (error) { console.error(`Could not persist runner outcome: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
