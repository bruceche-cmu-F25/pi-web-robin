import { automationRoute, contactedToday, type readOutreachAutomation } from './outreach-automation-domain.ts';
import { isCurrentValidationProspect, type JarvisState } from './jarvis-shape.ts';
import { isLinkedInConnectionPending } from './outreach-shape.ts';

type Ledger = ReturnType<typeof readOutreachAutomation>;
const RUNNER_STALE_MS = 45 * 60_000;
const localDay = (at: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(at));
export function buildAutomationView(crm: JarvisState, ledger: Ledger, now = new Date().toISOString()) {
  const date = localDay(now);
  const today = (at?: string) => Boolean(at && localDay(at) === date);
  const counts = { research: 0, instagram: 0, email: 0, linkedin: 0, connection: 0 };
  for (const lead of crm.leads) {
    if (isLinkedInConnectionPending(lead)) { counts.connection++; continue; }
    if (ledger.attempts.some(a => a.leadId === lead.id && a.state !== 'blocked')) continue;
    const route = automationRoute(lead, ledger.checks[lead.id]);
    if (route !== 'skip') counts[route]++;
  }
  const events: { id: string; name: string; company: string; channel: string; state: string; at: string; detail: string }[] = [];
  for (const lead of crm.leads) {
    if (today(lead.sentAt)) events.push({id: `${lead.id}-email`, name: lead.name, company: lead.company, channel: 'email', state: 'sent', at: lead.sentAt!, detail: ''});
    for (const [channel, item] of Object.entries(lead.socialOutreach ?? {})) {
      if (today(item.sentAt)) events.push({id: `${lead.id}-${channel}`, name: lead.name, company: lead.company, channel, state: 'sent', at: item.sentAt!, detail: ''});
    }
  }
  for (const attempt of ledger.attempts.filter(a => a.state !== 'sent' && (today(a.at) || ['pending','uncertain'].includes(a.state)))) {
    const lead = crm.leads.find(l => l.id === attempt.leadId);
    events.push({id: attempt.id, name: lead?.name ?? 'Unknown contact', company: lead?.company ?? '', channel: attempt.channel, state: attempt.state, at: attempt.at, detail: attempt.evidence ?? ''});
  }
  events.sort((a,b) => b.at.localeCompare(a.at));
  const runnerAt = ledger.runner?.finishedAt ?? ledger.runner?.startedAt;
  return {
    checkedAt: now, date, target: 100, scheduler: 'external' as const,
    discovered: crm.leads.filter(l => isCurrentValidationProspect(l) && today(l.createdAt)).length,
    contacted: contactedToday(crm.leads, now), counts,
    sent: {email: events.filter(e => e.state === 'sent' && e.channel === 'email').length, instagram: events.filter(e => e.state === 'sent' && e.channel === 'instagram').length},
    unresolved: ledger.attempts.filter(a => ['pending','uncertain'].includes(a.state)).length,
    blocked: ledger.attempts.filter(a => today(a.at) && a.state === 'blocked').length,
    runner: ledger.runner ? { ...ledger.runner, stale: !runnerAt || Date.parse(now) - Date.parse(runnerAt) > RUNNER_STALE_MS } : null,
    research: crm.run ? {status: crm.run.status, added: crm.run.added, message: crm.run.message, error: crm.run.lastError, startedAt: crm.run.startedAt, finishedAt: crm.run.finishedAt, workers: crm.run.pipeline?.activeWorkers ?? 0} : null,
    events: events.slice(0,50),
  };
}
export type AutomationView = ReturnType<typeof buildAutomationView>;
