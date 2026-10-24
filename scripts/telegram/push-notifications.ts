import { createHash } from "node:crypto";
import type { PushNotification } from "../../lib/web-push.ts";
import type { BridgeLocale } from "./protocol.ts";

/** Reserved delivery-ledger recipient: real Telegram chat IDs are never zero. */
export const PUSH_RECIPIENT = 0;
export type ScheduledNotificationKind = "agenda" | "jobs" | "mail" | "reminder";
const DESTINATIONS = {
  agenda: { en: "Today's agenda", zh: "今日日程与待办", url: "/dashboard" },
  jobs: { en: "New matching jobs", zh: "新匹配岗位", url: "/dashboard/jobs" },
  mail: { en: "Email review", zh: "邮件检查摘要", url: "/dashboard/gmail" },
  reminder: { en: "Upcoming event", zh: "日程即将开始", url: "/dashboard" },
} as const;

/** One glanceable notification, not Telegram's long Markdown report or action buttons. */
export function scheduledPush(
  kind: ScheduledNotificationKind,
  runKey: string,
  text: string,
  locale: BridgeLocale,
  ttl = 3600,
): PushNotification {
  const plain = text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*#`_]/g, "")
    .replace(/[\s\u0000-\u001f\u007f]+/g, " ")
    .trim();
  const chars = Array.from(plain);
  return {
    id: `${kind}:${createHash("sha256").update(runKey).digest("hex").slice(0, 32)}`,
    title: DESTINATIONS[kind][locale],
    body: chars.length > 180 ? `${chars.slice(0, 179).join("")}…` : plain || DESTINATIONS[kind][locale],
    url: DESTINATIONS[kind].url,
    ttl,
  };
}
