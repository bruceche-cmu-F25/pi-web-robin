/**
 * Run from the repo root with the existing Pi Web server running:
 * node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts status
 * ... discover 100 | personas <+N> | prepare-social <batch.json> | rescore | stop | stop-rescore | export | report [file.html] | template [file.txt] [--apply] | update <id> <status> | note <id> "interview notes"
 * Uses the same guarded HTTP/domain interface as the page. Never sends or queues email:
 * only the page's batch approval puts contacts in the outbox.
 */
import { piWeb } from "./telegram/pi-web.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { isDtcValidationProspect, isQualifiedInfoExec, isResearchedTargetUser, isSendableCore, type JarvisState } from "../extension/robin/jarvis-shape.ts";
import { renderJarvisReport } from "../lib/jarvis-report.ts";
import { JARVIS_OUTREACH_API, JARVIS_PREFERENCES_API, JARVIS_RESEARCH_API, JARVIS_STATE_API } from "../lib/jarvis-api.ts";

const ctx = { url: process.env.PI_WEB_URL || "http://127.0.0.1:30141", password: process.env.PI_WEB_PASSWORD, fetch };
const [command = "status", argument, value] = process.argv.slice(2);
try {
  if (command === "discover") {
    const result = await piWeb(ctx, JARVIS_RESEARCH_API, { action: "discover", target: Number(argument ?? 100) });
    console.log(JSON.stringify(result, null, 2));
    console.log(`Research started on the server. Track it at ${ctx.url}/product/jarvis or run status. No mail is sent.`);
  } else if (command === "sprint") {
    const target = Number(argument ?? 100);
    console.log(JSON.stringify(await piWeb(ctx, JARVIS_RESEARCH_API, { action: "discover", target, focus: "info_exec" }), null, 2));
    console.log(`Grant/fellowship validation sprint started toward ${target} total reachable prospects. No outreach is sent.`);
  } else if (command === "instagram") {
    const more = Number(argument ?? 20);
    if (!Number.isInteger(more) || more < 1 || more > 100) throw new Error("Instagram batch must add 1–100 people");
    const state = await piWeb<JarvisState>(ctx, JARVIS_STATE_API, undefined, 30000, "GET");
    const current = state.leads.filter((lead) => isDtcValidationProspect(lead) && Boolean(lead.socials?.instagram)).length;
    const target = current + more;
    console.log(JSON.stringify(await piWeb(ctx, JARVIS_RESEARCH_API, { action: "discover", target, focus: "info_exec", channelFocus: "instagram" }), null, 2));
    console.log(`Instagram-first research started toward ${target} current-ICP prospects with trustworthy personal Instagram routes. Healthcare operators still require verified individual work email. No outreach is sent.`);
  } else if (command === "website") {
    console.log(JSON.stringify(await piWeb(ctx, JARVIS_RESEARCH_API, { action: "website-enrich" }), null, 2));
    console.log("Public website contact enrichment started for every current-ICP prospect. Forms are never submitted and no outreach is sent.");
  } else if (command === "stop-website") {
    await piWeb(ctx, JARVIS_RESEARCH_API, { action: "stop-website-enrich" });
    console.log("Website enrichment stop requested; completed checks remain saved for review.");
  } else if (command === "personas") {
    // Target personas are uncapped: +N more contactable strict-ICP people than today.
    const state = await piWeb<JarvisState>(ctx, JARVIS_STATE_API, undefined, 30000, "GET");
    const target = state.leads.filter(isDtcValidationProspect).length + Number(argument ?? 30);
    console.log(JSON.stringify(await piWeb(ctx, JARVIS_RESEARCH_API, { action: "discover", target, focus: "info_exec" }), null, 2));
    console.log(`Persona research started toward ${target} contactable core ICPs. No outreach is sent.`);
  } else if (command === "prepare-social") {
    if (!argument) throw new Error("Usage: prepare-social <batch.json>");
    const batch = JSON.parse(readFileSync(argument, "utf8")) as Array<{ id: string; platform: "instagram" | "linkedin" | "x" | "tiktok"; profileUrl: string; draft: string }>;
    if (!Array.isArray(batch) || !batch.length || batch.length > 50) throw new Error("Social batch needs 1–50 entries");
    let state = await piWeb<JarvisState>(ctx, JARVIS_STATE_API, undefined, 30000, "GET");
    const prepared: Array<{ id: string; name: string; platform: string }> = [];
    for (const item of batch) {
      let lead = state.leads.find((entry) => entry.id === item.id);
      if (!lead) throw new Error(`Contact not found: ${item.id}`);
      if (lead.socials?.[item.platform] !== item.profileUrl) {
        const result = await piWeb<{ lead: typeof lead }>(ctx, JARVIS_STATE_API, { id: lead.id, patch: { socials: { ...lead.socials, [item.platform]: item.profileUrl } } }, 30000, "PATCH");
        lead = result.lead;
      }
      const result = await piWeb<{ lead: typeof lead }>(ctx, JARVIS_OUTREACH_API, { action: "social", op: "save", id: lead.id, platform: item.platform, revision: lead.revision ?? 0, draft: item.draft });
      prepared.push({ id: result.lead.id, name: result.lead.name, platform: item.platform });
      state = { ...state, leads: state.leads.map((entry) => entry.id === result.lead.id ? result.lead : entry) };
    }
    console.log(JSON.stringify({ prepared: prepared.length, contacts: prepared }, null, 2));
    console.log("Drafts and verified profile URLs saved. Nothing was sent or marked sent.");
  } else if (command === "rescore") {
    console.log(JSON.stringify(await piWeb(ctx, JARVIS_RESEARCH_API, { action: "rescore" }), null, 2));
    console.log("Rescoring started on the server. No mail is sent.");
  } else if (command === "stop-rescore") {
    await piWeb(ctx, JARVIS_RESEARCH_API, { action: "stop-rescore" });
    console.log("Rescoring stop requested; saved assessments remain.");
  } else if (command === "stop") {
    await piWeb(ctx, JARVIS_RESEARCH_API, { action: "stop" });
    console.log("Stop requested; saved contacts remain.");
  } else if (command === "update" || command === "note") {
    if (!argument || !value) throw new Error(`Usage: ${command} <id> <${command === "note" ? "notes" : "status"}>`);
    await piWeb(ctx, JARVIS_STATE_API, { id: argument, patch: command === "note" ? { notes: value } : { status: value } }, 30000, "PATCH");
    console.log("Saved.");
  } else if (command === "template") {
    // File format: "Subject: ..." on the first line, a blank line, then the body.
    const file = argument && argument !== "--apply" ? argument : "scripts/jarvis-email-template.txt";
    const apply = process.argv.includes("--apply");
    const match = /^Subject:[ \t]*(.+)\r?\n\r?\n([\s\S]+)$/.exec(readFileSync(file, "utf8").trimEnd());
    if (!match) throw new Error(`${file} must start with "Subject: ...", then a blank line, then the body.`);
    const result = await piWeb<{ updated: number; kept: number; sample?: { name: string; subject: string; body: string } }>(
      ctx, JARVIS_PREFERENCES_API, { action: "template", subject: match[1]!.trim(), body: match[2]!, dryRun: !apply });
    if (result.sample) console.log(`--- Preview for ${result.sample.name} ---\nSubject: ${result.sample.subject}\n\n${result.sample.body}\n---`);
    console.log(apply
      ? `Template saved. ${result.updated} current-ICP drafts rendered; ${result.kept} other drafts (including legacy, edited and contacted) kept.`
      : `Dry run: ${result.updated} drafts would be rewritten; ${result.kept} kept. Re-run with --apply to save.`);
  } else if (command === "report") {
    const state = await piWeb<JarvisState>(ctx, JARVIS_STATE_API, undefined, 30000, "GET");
    const file = argument ?? `jarvis-outreach-${new Date().toISOString().slice(0, 10)}.html`;
    writeFileSync(file, renderJarvisReport(state));
    console.log(`Wrote ${file}: ${state.leads.length} contacts, ${state.leads.filter(isQualifiedInfoExec).length} qualified target users, ${state.leads.filter(isSendableCore).length} sendable core.`);
  } else if (command === "export" || command === "status" || command === "progress") {
    const state = await piWeb<JarvisState>(ctx, JARVIS_STATE_API, undefined, 30000, "GET");
    if (command === "export") console.log(JSON.stringify(state, null, 2));
    else {
      const core = state.leads.filter((lead) => lead.audienceFit === "core");
      console.log(JSON.stringify({ grantProspects: state.leads.filter(isDtcValidationProspect).length, qualifiedTargetUsers: state.leads.filter(isQualifiedInfoExec).length, evidenceComplete: state.leads.filter(isResearchedTargetUser).length, websiteContacts: { checked: state.leads.filter((lead) => isDtcValidationProspect(lead) && lead.websiteResearch).length, found: state.leads.filter((lead) => isDtcValidationProspect(lead) && lead.websiteResearch?.status === "found").length, run: state.websiteRun }, rescore: state.rescore, outbox: state.outbox, sendableCore: state.leads.filter(isSendableCore).length, coreContacts: core.length, adjacentContacts: state.leads.length - core.length, coreEmails: core.filter((l) => l.email).length, coreSent: core.filter((l) => l.sentAt).length, coreReplied: core.filter((l) => l.repliedAt).length, run: state.run }, null, 2));
      if (command === "status") console.table(state.leads.map(({ id, name, company, industry, seniority, status }) => ({ id, name, company, industry, seniority, status })));
    }
  } else throw new Error("Commands: status | progress | discover [sendable total up to 100] | sprint [total] | instagram [+N, default 20] | website | stop-website | personas [+N, default 30] | prepare-social <batch.json> | rescore | stop | stop-rescore | export | report [file.html] | template [file.txt] [--apply] | update <id> <status> | note <id> <notes>");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
