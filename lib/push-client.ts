/** Web Push registration shared by Settings and the silent permission-granted path. */
let activeSubscriptionPromise: Promise<void> | null = null;
const PUSH_REGISTRATION_TIMEOUT_MS = 30_000;

// Standard base64url → Uint8Array conversion for applicationServerKey.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

// Browser permission, worker readiness and PushManager promises cannot be
// cancelled. Race them as well as aborting fetch, and fence late continuations.
async function withPushTimeout<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException("Push registration timed out", "TimeoutError");
      reject(error);
      controller.abort(error);
    }, PUSH_REGISTRATION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

function subscribe(locale: string): Promise<void> {
  if (activeSubscriptionPromise) return activeSubscriptionPromise;

  const attempt = withPushTimeout(async (signal) => {
    const configResponse = await fetch("/api/push/config", { signal });
    if (!configResponse.ok) throw new Error(`Push config: HTTP ${configResponse.status}`);
    const { publicKey } = await configResponse.json() as { publicKey?: string };
    signal.throwIfAborted();
    if (!publicKey) throw new Error("Push configuration is missing its public key");

    const registration = await navigator.serviceWorker.ready;
    signal.throwIfAborted();
    let subscription = await registration.pushManager.getSubscription();
    signal.throwIfAborted();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    signal.throwIfAborted();

    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON(), locale }),
      signal,
    });
    if (!response.ok) throw new Error(`Push subscription: HTTP ${response.status}`);
  });

  activeSubscriptionPromise = attempt;
  const clearAttempt = () => {
    if (activeSubscriptionPromise === attempt) activeSubscriptionPromise = null;
  };
  void attempt.then(clearAttempt, clearAttempt);
  return attempt;
}

/** Called directly from a click so iOS retains the permission prompt's user gesture. */
export async function registerPushNotifications(locale: string): Promise<void> {
  if (!isPushSupported()) throw new Error("unsupported or not permitted");
  const permission = Notification.permission === "default"
    ? await withPushTimeout(() => Notification.requestPermission())
    : Notification.permission;
  if (permission !== "granted") throw new Error("unsupported or not permitted");
  await subscribe(locale);
}

/** Background callers must never prompt for permission or produce unhandled rejections. */
export async function setupPushSubscription(locale: string): Promise<boolean> {
  if (!isPushSupported() || Notification.permission !== "granted") return false;
  try {
    await subscribe(locale);
    return true;
  } catch {
    return false;
  }
}
