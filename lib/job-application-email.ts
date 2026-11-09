import { applicationJob, confirmApplicationEmailReceipt, pendingApplicationEmailReceipts } from "../extension/robin/job-application-domain.ts";
import { getEmail, listRecentEmails, type GmailMessage, type GmailMessageDetail } from "../extension/robin/gmail.ts";
import type { Job } from "../extension/robin/jobs.ts";

/** Gmail is read-only. Match only a unique post-click employer confirmation to its Robin job id. */
export async function reconcileApplicationEmailReceipts(deps: {
  pending?: () => Job[];
  list?: (options: { query: string; maxResults: number }) => Promise<GmailMessage[]>;
  get?: (id: string) => Promise<GmailMessageDetail | null>;
  confirm?: typeof confirmApplicationEmailReceipt;
} = {}): Promise<number> {
  const pending = (deps.pending ?? pendingApplicationEmailReceipts)()
    .filter(job => ["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(new URL(job.application!.url).hostname));
  if (!pending.length) return 0;
  const messages = await (deps.list ?? listRecentEmails)({ query: "from:no-reply@us.greenhouse-mail.io newer_than:2d", maxResults: 30 });
  const companyKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  let confirmed = 0;
  for (const job of pending) {
    const app = applicationJob(job.id).application;
    if (!app?.submission || app.receipt) continue;
    const candidates = messages.filter(message => {
      const company = message.subject.match(/^(?:thank you for applying to|(?:.+,\s*)?we.ve received your application to)\s+(.+)$/i)?.[1];
      const date = Date.parse(message.date), clicked = Date.parse(app.submission!.grantedAt);
      return company && companyKey(company) === companyKey(job.company) && date >= clicked && date - clicked <= 24 * 60 * 60_000;
    });
    if (candidates.length !== 1) continue;
    const detail = await (deps.get ?? getEmail)(candidates[0].id);
    if (detail && (deps.confirm ?? confirmApplicationEmailReceipt)(job.id, app.attemptId, detail)) confirmed++;
  }
  return confirmed;
}
