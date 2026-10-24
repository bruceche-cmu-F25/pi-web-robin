import { existsSync, mkdirSync, readFileSync } from "fs";
import { createHash } from "node:crypto";
import { dirname, join } from "path";
import webpush from "web-push";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { enLocale } from "./i18n/messages/en";
import { zhCNLocale } from "./i18n/messages/zh-CN";
import { getAgentDir } from "./session-reader";

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  locale: string;
}

interface PushStateFile {
  vapidKeys: { publicKey: string; privateKey: string };
  subscriptions: PushSubscriptionRecord[];
  receipts?: { id: string; fingerprint?: string; expiresAt: number; endpoints: string[] }[];
}

export interface PushNotification {
  /** Stable per occurrence, not per retry. */
  id: string;
  title: string;
  body: string;
  /** A same-origin path opened when the notification is tapped. */
  url: string;
  ttl?: number;
}

export class PushNotificationConflictError extends Error {
  constructor() { super("Notification id was already used for different content"); }
}

export interface PushDeliveryResult {
  /** Includes subscriptions that already accepted this id on an earlier request. */
  accepted: number;
  failed: number;
  expired: number;
}

export function parsePushNotification(value: unknown): PushNotification {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid notification");
  const { id, title, body, url, ttl } = value as Record<string, unknown>;
  for (const [name, text, limit] of [["id", id, 200], ["title", title, 120], ["body", body, 500], ["url", url, 1000]] as const) {
    if (typeof text !== "string" || !text.trim() || text.length > limit || /[\u0000-\u001f\u007f]/.test(text)) {
      throw new Error(`Invalid notification ${name}`);
    }
  }
  const path = url as string;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")
    || new URL(path, "https://pi.invalid").origin !== "https://pi.invalid") {
    throw new Error("Notification URL must be a same-origin path");
  }
  if (ttl !== undefined && (typeof ttl !== "number" || !Number.isInteger(ttl) || ttl < 1 || ttl > 86400)) {
    throw new Error("Notification ttl must be 1–86400 seconds");
  }
  const notification = { id, title, body, url, ...(ttl === undefined ? {} : { ttl }) } as PushNotification;
  if (Buffer.byteLength(JSON.stringify(notification), "utf8") > 3000) throw new Error("Notification is too large");
  return notification;
}

interface WebPushEnvironment {
  send: (
    subscription: PushSubscriptionRecord,
    payload: string,
    vapidKeys: PushStateFile["vapidKeys"],
    ttl?: number,
  ) => Promise<void>;
  loadState: () => PushStateFile | null;
  saveState: (state: PushStateFile) => void;
  generateVapidKeys: () => PushStateFile["vapidKeys"];
}

export interface WebPushNotifier {
  getVapidPublicKey: () => string;
  addSubscription: (subscription: PushSubscriptionRecord) => void;
  subscriptionCount: () => number;
  sendNotification: (notification: PushNotification) => Promise<PushDeliveryResult>;
  /** `sessionName` titles the notification; without one it reads "Session complete". */
  notifySessionComplete: (sessionId: string, sessionName?: string) => Promise<void>;
}

function stateFilePath(): string {
  return join(getAgentDir(), "web-push.json");
}

/**
 * VAPID subject must be a valid `mailto:` or `https:` URL. Apple's push
 * service rejects requests whose subject is not a syntactically valid URL
 * (e.g. the previously used `mailto:pi-web@localhost`, which Apple answers
 * with 403 BadJwtToken), so default to the project homepage and let operators
 * override it via PI_WEB_PUSH_SUBJECT.
 */
export function vapidSubject(): string {
  const configured = process.env.PI_WEB_PUSH_SUBJECT?.trim();
  if (configured) return configured;
  return "https://github.com/agegr/pi-web";
}

// Ask the push service to deliver immediately. Lower urgencies let idle
// devices (especially iOS) defer delivery to an arbitrary later window.
export const PUSH_OPTIONS = { TTL: 2419200, urgency: "high" as const };

function getDefaultEnvironment(): WebPushEnvironment {
  return {
    async send(subscription, payload, vapidKeys, ttl) {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: subscription.keys },
        payload,
        {
          vapidDetails: {
            subject: vapidSubject(),
            publicKey: vapidKeys.publicKey,
            privateKey: vapidKeys.privateKey,
          },
          TTL: ttl ?? PUSH_OPTIONS.TTL,
          urgency: PUSH_OPTIONS.urgency,
          timeout: 15_000,
        },
      );
    },
    loadState() {
      const path = stateFilePath();
      if (!existsSync(path)) return null;
      try {
        return JSON.parse(readFileSync(path, "utf8")) as PushStateFile;
      } catch {
        return null;
      }
    },
    saveState(state) {
      const path = stateFilePath();
      mkdirSync(dirname(path), { recursive: true });
      writePrivateFileAtomicSync(path, JSON.stringify(state));
    },
    generateVapidKeys: () => webpush.generateVAPIDKeys(),
  };
}

function pushStatusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return undefined;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode : undefined;
}

/**
 * Locale lookup for push payloads. The browser reports its UI locale when it
 * subscribes; unknown locales fall back to English.
 */
export function localeText(locale: string, key: "sessionComplete" | "taskFinished"): string {
  if (locale === "zh-CN") {
    const message = zhCNLocale.messages[key === "sessionComplete" ? "i18n.sessionComplete" : "i18n.taskFinished"];
    if (message) return message;
  }
  const message = enLocale.messages[key === "sessionComplete" ? "i18n.sessionComplete" : "i18n.taskFinished"];
  return message ?? (key === "sessionComplete" ? "Session complete" : "Task finished.");
}

export function createWebPushNotifier(environment: WebPushEnvironment): WebPushNotifier {
  const state: PushStateFile = (() => {
    const loaded = environment.loadState();
    if (loaded?.vapidKeys?.publicKey && loaded.vapidKeys.privateKey) return loaded;
    return { vapidKeys: environment.generateVapidKeys(), subscriptions: [] };
  })();
  const saveState = () => {
    environment.saveState(state);
  };

  const inFlight = new Map<string, { fingerprint: string; promise: Promise<PushDeliveryResult> }>();
  async function deliver(notification: PushNotification, fingerprint: string): Promise<PushDeliveryResult> {
    const now = Date.now();
    state.receipts = (state.receipts ?? []).filter((entry) => entry.expiresAt > now).slice(-127);
    let receipt = state.receipts.find((entry) => entry.id === notification.id);
    if (receipt?.endpoints.length && receipt.fingerprint && receipt.fingerprint !== fingerprint) {
      throw new PushNotificationConflictError();
    }
    if (!receipt) {
      receipt = { id: notification.id, fingerprint, expiresAt: now + 7 * 86400_000, endpoints: [] };
      state.receipts.push(receipt);
    }
    receipt.fingerprint = fingerprint;
    const result: PushDeliveryResult = { accepted: 0, failed: 0, expired: 0 };
    const { title, body, url, id } = notification;
    const payload = JSON.stringify({ title, body, url, tag: `robin:${id}` });
    for (const subscription of [...state.subscriptions]) {
      if (receipt.endpoints.includes(subscription.endpoint)) { result.accepted++; continue; }
      try {
        await environment.send(subscription, payload, state.vapidKeys, notification.ttl ?? 3600);
      } catch (error) {
        if (pushStatusCode(error) === 404 || pushStatusCode(error) === 410) {
          state.subscriptions = state.subscriptions.filter((s) => s.endpoint !== subscription.endpoint);
          result.expired++;
          saveState();
        } else result.failed++;
        continue;
      }
      receipt.endpoints.push(subscription.endpoint);
      // Save acceptance before replying, so a lost HTTP response can safely retry.
      saveState();
      result.accepted++;
    }
    return result;
  }

  return {
    subscriptionCount: () => state.subscriptions.length,
    sendNotification(value) {
      const notification = parsePushNotification(value);
      const fingerprint = createHash("sha256").update(JSON.stringify({ ...notification, ttl: notification.ttl ?? 3600 })).digest("hex");
      const existing = inFlight.get(notification.id);
      if (existing) return existing.fingerprint === fingerprint ? existing.promise : Promise.reject(new PushNotificationConflictError());
      const attempt = deliver(notification, fingerprint);
      inFlight.set(notification.id, { fingerprint, promise: attempt });
      const clear = () => { inFlight.delete(notification.id); };
      void attempt.then(clear, clear);
      return attempt;
    },
    getVapidPublicKey() {
      saveState();
      return state.vapidKeys.publicKey;
    },
    addSubscription(subscription) {
      state.subscriptions = [
        ...state.subscriptions.filter((s) => s.endpoint !== subscription.endpoint),
        subscription,
      ];
      saveState();
    },
    async notifySessionComplete(sessionId, sessionName) {
      if (state.subscriptions.length === 0) return;
      const payloadFor = (locale: string) => ({
        title: sessionName ?? localeText(locale, "sessionComplete"),
        body: localeText(locale, "taskFinished"),
        url: `/?session=${encodeURIComponent(sessionId)}`,
        tag: `pi-session-complete:${sessionId}`,
      });

      let pruned = false;
      for (const subscription of [...state.subscriptions]) {
        try {
          await environment.send(
            subscription,
            JSON.stringify(payloadFor(subscription.locale)),
            state.vapidKeys,
          );
        } catch (error) {
          const statusCode = pushStatusCode(error);
          if (statusCode === 404 || statusCode === 410) {
            state.subscriptions = state.subscriptions.filter((s) => s.endpoint !== subscription.endpoint);
            pruned = true;
          }
        }
      }
      if (pruned) saveState();
    },
  };
}

declare global {
  var __piWebPushNotifier: Promise<WebPushNotifier> | undefined;
  var __piWebPushNotifierVersion: number | undefined;
}

function getNotifier(): Promise<WebPushNotifier> {
  if (!globalThis.__piWebPushNotifier || globalThis.__piWebPushNotifierVersion !== 3) {
    globalThis.__piWebPushNotifierVersion = 3;
    globalThis.__piWebPushNotifier = Promise.resolve().then(() => createWebPushNotifier(getDefaultEnvironment()));
  }
  return globalThis.__piWebPushNotifier;
}

export function getVapidPublicKey(): Promise<string> {
  return getNotifier().then((notifier) => notifier.getVapidPublicKey());
}

export function addSubscription(subscription: PushSubscriptionRecord): Promise<void> {
  return getNotifier().then((notifier) => notifier.addSubscription(subscription));
}

export async function pushSubscriptionCount(): Promise<number> {
  return (await getNotifier()).subscriptionCount();
}

export async function sendPushNotification(notification: PushNotification): Promise<PushDeliveryResult> {
  return (await getNotifier()).sendNotification(notification);
}

export async function notifySessionComplete(sessionId: string, sessionName?: string): Promise<void> {
  const notifier = await getNotifier();
  await notifier.notifySessionComplete(sessionId, sessionName);
}
