import type { JarvisLead } from "../extension/robin/jarvis-shape.ts";
import { channelSentAt, OUTREACH_CHANNELS, type OutreachChannel } from "../extension/robin/outreach-shape.ts";

export type OutreachActivity = { lead: JarvisLead; channel: OutreachChannel; at: string; kind: "initial" | "followup" };
/** Only confirmed sends are activity; queue claims and connection invitations are not messages. */
export function outreachActivity(leads: JarvisLead[]): OutreachActivity[] {
  return leads.flatMap((lead) => {
    const rows: OutreachActivity[] = [];
    for (const channel of OUTREACH_CHANNELS) {
      const at = channelSentAt(lead, channel) ?? (channel === "email" && lead.sendAttempt?.state === "sent" ? lead.sendAttempt.at : undefined);
      if (at && Number.isFinite(Date.parse(at))) rows.push({ lead, channel, at, kind: "initial" });
    }
    const at = lead.followedUpAt ?? (lead.followUpAttempt?.state === "sent" ? lead.followUpAttempt.at : undefined);
    if (at && Number.isFinite(Date.parse(at))) rows.push({ lead, channel: "email", at, kind: "followup" });
    return rows;
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Browser-local calendar dates, including DST boundaries. */
export function outreachDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function filterOutreachActivity(rows: OutreachActivity[], start: string, end: string, channel: OutreachChannel | "all" = "all") {
  return rows.filter((row) => {
    const day = outreachDate(new Date(row.at));
    return (!start || day >= start) && (!end || day <= end) && (channel === "all" || row.channel === channel);
  });
}
export function summarizeOutreach(rows: OutreachActivity[]) {
  const people = [...new Map(rows.map((row) => [row.lead.id, row.lead])).values()];
  return {
    messages: rows.length, people, followups: rows.filter((row) => row.kind === "followup").length,
    channels: OUTREACH_CHANNELS.map((channel) => {
      const sent = rows.filter((row) => row.channel === channel);
      return { channel, messages: sent.length, people: new Set(sent.map((row) => row.lead.id)).size };
    }),
  };
}
