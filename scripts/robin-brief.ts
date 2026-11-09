/** Operator-only storage, deterministic preview and receipt commands. No daemon, model turn or send. */
import { pathToFileURL } from "node:url";
import { localDate } from "../extension/robin/dates.ts";
import { briefPipelineStatus, briefRunDetails, initializeBriefPipeline, upgradeBriefPipeline, runShadowBrief } from "../extension/robin/brief-domain.ts";
import { collectStoredBriefSource } from "../extension/robin/brief-sources.ts";
import { collectGmailBrief } from "../extension/robin/brief-mail.ts";
import { briefDeliveryReceipts, resolveBriefDelivery } from "../extension/robin/brief-delivery-domain.ts";

export async function main(args: string[]): Promise<void> {
  const [command, requestId, ...extra] = args;
  if (command === "delivery-status" && !requestId && !extra.length) { console.log(JSON.stringify(briefDeliveryReceipts(), null, 2)); return; }
  if (command === "resolve" && requestId && extra.length === 1 && (extra[0] === "accepted" || extra[0] === "cancelled")) {
    resolveBriefDelivery(requestId, extra[0]); console.log("Brief receipt resolved; nothing sent."); return;
  }
  if (extra.length || !["init", "upgrade", "status", "shadow", "acquire", "inspect"].includes(command ?? "")
    || (["init", "status"].includes(command) && requestId)
    || (command === "upgrade" && requestId !== "--writers-stopped")
    || (["shadow", "acquire", "inspect"].includes(command) && !requestId)) {
    throw new Error("Usage: robin:brief -- init | upgrade --writers-stopped | status | shadow <stable-request-id> | acquire <new-request-id> | inspect <request-id> | delivery-status | resolve <slot> accepted|cancelled");
  }
  if (command === "init") {
    initializeBriefPipeline();
    console.log("Brief storage initialized; no sources read; automation settings unchanged.");
  } else if (command === "upgrade") {
    const backup = upgradeBriefPipeline(true);
    console.log(JSON.stringify({ upgraded: Boolean(backup), backup, automationChanged: false }));
  } else if (command === "status") {
    const { edition, ...status } = briefPipelineStatus();
    console.log(JSON.stringify({ ...status, edition: edition ? { id: edition.id, day: edition.day, revision: edition.revision, mode: edition.mode, itemCount: edition.items.length, createdAt: edition.createdAt } : null }, null, 2));
  } else if (command === "inspect") {
    // Explicit inspection may contain private mail/record text; never publish this output.
    console.log(JSON.stringify(briefRunDetails(requestId), null, 2));
  } else {
    const now = new Date();
    const edition = await runShadowBrief(requestId, {
      scope: { day: localDate(now), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      inputProfile: command === "acquire" ? "gmail-v1" : "stored-v1",
      collect: (source, scope, signal, acquisition) => command === "acquire" && source === "mail"
        ? collectGmailBrief(scope, signal, acquisition)
        : collectStoredBriefSource(source, scope, signal),
    });
    console.log(JSON.stringify({ id: edition.id, requestId, mode: edition.mode, day: edition.day, revision: edition.revision,
      itemCount: edition.items.length, coverage: edition.coverage }, null, 2));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : "Brief command failed"); process.exitCode = 1; });
}
