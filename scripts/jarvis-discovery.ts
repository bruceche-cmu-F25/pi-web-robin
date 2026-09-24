/**
 * Run from the repo root with the existing Pi Web server running:
 * node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts status
 * ... discover 100 | stop | export | report [file.html] | template [file.txt] [--apply] | template [file.txt] [--apply] | update <id> <status> | note <id> "interview notes"
 * Uses the same guarded HTTP/domain interface as the page. Never sends email.
 */
import { piWeb } from "./telegram/pi-web.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { isSendableCore, type JarvisState } from "../extension/robin/jarvis-shape.ts";
import { renderJarvisReport } from "../lib/jarvis-report.ts";

const ctx = { url: process.env.PI_WEB_URL || "http://127.0.0.1:30141", password: process.env.PI_WEB_PASSWORD, fetch };
const [command = "status", argument, value] = process.argv.slice(2);
const api = "/api/robin/jarvis";
try {
  if (command === "discover") {
    const result = await piWeb(ctx, api, { action: "discover", target: Number(argument ?? 100) });
    console.log(JSON.stringify(result, null, 2));
    console.log(`Research started on the server. Track it at ${ctx.url}/product/jarvis or run status. No mail is sent.`);
  } else if (command === "stop") {
    await piWeb(ctx, api, { action: "stop" });
    console.log("Stop requested; saved contacts remain.");
  } else if (command === "update" || command === "note") {
    if (!argument || !value) throw new Error(`Usage: ${command} <id> <${command === "note" ? "notes" : "status"}>`);
    await piWeb(ctx, api, { id: argument, patch: command === "note" ? { notes: value } : { status: value } }, 30000, "PATCH");
    console.log("Saved.");
  } else if (command === "template") {
    // File format: "Subject: ..." on the first line, a blank line, then the body.
    const file = argument && argument !== "--apply" ? argument : "scripts/jarvis-email-template.txt";
    const apply = process.argv.includes("--apply");
    const match = /^Subject:[ \t]*(.+)\r?\n\r?\n([\s\S]+)$/.exec(readFileSync(file, "utf8").trimEnd());
    if (!match) throw new Error(`${file} must start with "Subject: ...", then a blank line, then the body.`);
    const result = await piWeb<{ updated: number; kept: number; sample?: { name: string; subject: string; body: string } }>(
      ctx, api, { action: "template", subject: match[1]!.trim(), body: match[2]!, dryRun: !apply });
    if (result.sample) console.log(`--- Preview for ${result.sample.name} ---\nSubject: ${result.sample.subject}\n\n${result.sample.body}\n---`);
    console.log(apply
      ? `Template saved. ${result.updated} drafts rewritten; ${result.kept} edited, approved or contacted drafts kept.`
      : `Dry run: ${result.updated} drafts would be rewritten; ${result.kept} kept. Re-run with --apply to save.`);
  } else if (command === "report") {
    const state = await piWeb<JarvisState>(ctx, api, undefined, 30000, "GET");
    const file = argument ?? `jarvis-outreach-${new Date().toISOString().slice(0, 10)}.html`;
    writeFileSync(file, renderJarvisReport(state));
    console.log(`Wrote ${file}: ${state.leads.filter(isSendableCore).length}/100 sendable core contacts.`);
  } else if (command === "export" || command === "status") {
    const state = await piWeb<JarvisState>(ctx, api, undefined, 30000, "GET");
    if (command === "export") console.log(JSON.stringify(state, null, 2));
    else {
      const core = state.leads.filter((lead) => lead.audienceFit === "core");
      console.log(JSON.stringify({ sendableCore: state.leads.filter(isSendableCore).length, coreContacts: core.length, adjacentContacts: state.leads.length - core.length, coreEmails: core.filter((l) => l.email).length, coreSent: core.filter((l) => l.sentAt).length, coreReplied: core.filter((l) => l.repliedAt).length, run: state.run }, null, 2));
      console.table(state.leads.map(({ id, name, company, industry, seniority, status }) => ({ id, name, company, industry, seniority, status })));
    }
  } else throw new Error("Commands: status | discover [sendable total up to 100] | stop | export | report [file.html] | template [file.txt] [--apply] | update <id> <status> | note <id> <notes>");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
