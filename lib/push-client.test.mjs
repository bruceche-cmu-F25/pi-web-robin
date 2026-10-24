import assert from "node:assert/strict";
import test from "node:test";

let moduleId = 0;
const load = () => import(`./push-client.ts?test=${moduleId++}`);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const never = () => new Promise(() => {});

function browser(t) {
  const calls = [];
  const subscription = { toJSON: () => ({ endpoint: "https://push.test/device", keys: {} }) };
  const manager = {
    getSubscription: async () => subscription,
    subscribe: async (options) => { calls.push(["subscribe", options]); return subscription; },
  };
  const worker = { ready: Promise.resolve({ pushManager: manager }) };
  const notification = {
    permission: "granted",
    requestPermission: () => {
      calls.push(["permission"]);
      notification.permission = "granted";
      return Promise.resolve("granted");
    },
  };
  const values = {
    window: { PushManager: {}, Notification: notification },
    navigator: { serviceWorker: worker },
    Notification: notification,
    fetch: async (url, init) => {
      calls.push([url, init]);
      return url === "/api/push/config"
        ? { ok: true, json: async () => ({ publicKey: "AQID" }) }
        : { ok: true };
    },
  };
  for (const [key, value] of Object.entries(values)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => original
      ? Object.defineProperty(globalThis, key, original)
      : delete globalThis[key]);
  }
  return { calls, manager, worker, notification };
}

test("manual registration requests permission synchronously and saves an existing subscription", async (t) => {
  const { calls, notification } = browser(t);
  notification.permission = "default";
  const { registerPushNotifications } = await load();
  const pending = registerPushNotifications("zh-CN");
  assert.deepEqual(calls, [["permission"]], "iOS permission must run within the click gesture");
  await pending;
  assert.deepEqual(calls.map(([name]) => name), ["permission", "/api/push/config", "/api/push/subscribe"]);
  assert.deepEqual(JSON.parse(calls.at(-1)[1].body), {
    subscription: { endpoint: "https://push.test/device", keys: {} }, locale: "zh-CN",
  });
});

test("creates a subscription when absent, shares concurrent attempts, and permits re-registration", async (t) => {
  const { calls, manager } = browser(t);
  manager.getSubscription = async () => null;
  const { registerPushNotifications, setupPushSubscription } = await load();
  const background = setupPushSubscription("en");
  await registerPushNotifications("en");
  assert.equal(await background, true);
  assert.equal(calls.filter(([name]) => name === "subscribe").length, 1);
  const options = calls.find(([name]) => name === "subscribe")[1];
  assert.equal(options.userVisibleOnly, true);
  assert.deepEqual([...options.applicationServerKey], [1, 2, 3]);
  await registerPushNotifications("zh-CN");
  assert.equal(calls.filter(([name]) => name === "/api/push/subscribe").length, 2);
});

test("background setup never prompts and manual denial does not subscribe", async (t) => {
  const { calls, notification } = browser(t);
  const { setupPushSubscription, registerPushNotifications } = await load();
  notification.permission = "default";
  assert.equal(await setupPushSubscription("en"), false);
  assert.deepEqual(calls, []);
  notification.permission = "denied";
  await assert.rejects(registerPushNotifications("en"), /not permitted/);
  assert.deepEqual(calls, []);
  delete window.PushManager;
  assert.equal(await setupPushSubscription("en"), false);
  await assert.rejects(registerPushNotifications("en"), /not permitted/);
});

for (const stage of ["permission", "config", "config-body", "worker-ready", "get-subscription", "subscribe", "save"]) {
  test(`${stage} cannot leave registration pending forever; retry works`, async (t) => {
    const env = browser(t);
    const { registerPushNotifications } = await load();
    const originalFetch = fetch;
    let stalledSignal;
    if (stage === "permission") {
      env.notification.permission = "default";
      env.notification.requestPermission = never;
    } else if (stage === "config" || stage === "config-body" || stage === "save") {
      globalThis.fetch = (url, init) => {
        const target = stage === "save" ? "/api/push/subscribe" : "/api/push/config";
        if (url !== target) return originalFetch(url, init);
        stalledSignal = init.signal;
        return stage === "config-body" ? Promise.resolve({ ok: true, json: never }) : never();
      };
    } else if (stage === "worker-ready") env.worker.ready = never();
    else if (stage === "get-subscription") env.manager.getSubscription = never;
    else {
      env.manager.getSubscription = async () => null;
      env.manager.subscribe = never;
    }

    t.mock.timers.enable({ apis: ["setTimeout"] });
    const rejected = assert.rejects(registerPushNotifications("en"), { name: "TimeoutError" });
    await flush();
    t.mock.timers.tick(30_000);
    await rejected;
    await flush();
    if (stalledSignal) assert.equal(stalledSignal.aborted, true);
    t.mock.timers.reset();

    env.notification.permission = "granted";
    env.manager.getSubscription = async () => ({ toJSON: () => ({ endpoint: "retry" }) });
    env.worker.ready = Promise.resolve({ pushManager: env.manager });
    globalThis.fetch = originalFetch;
    await registerPushNotifications("en");
    assert.equal(env.calls.at(-1)[0], "/api/push/subscribe");
  });
}

test("late worker readiness cannot resume a timed-out attempt", async (t) => {
  const { calls, worker, manager } = browser(t);
  let ready;
  worker.ready = new Promise((resolve) => { ready = resolve; });
  const { registerPushNotifications } = await load();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const rejected = assert.rejects(registerPushNotifications("en"), { name: "TimeoutError" });
  await flush();
  t.mock.timers.tick(30_000);
  await rejected;
  ready({ pushManager: manager });
  await flush();
  assert.deepEqual(calls.map(([name]) => name), ["/api/push/config"]);
});

test("HTTP failures are reported to Settings but background callers fail quietly and retry", async (t) => {
  browser(t);
  const { registerPushNotifications, setupPushSubscription } = await load();
  const originalFetch = fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401 });
  await assert.rejects(registerPushNotifications("en"), /HTTP 401/);
  assert.equal(await setupPushSubscription("en"), false);
  globalThis.fetch = originalFetch;
  assert.equal(await setupPushSubscription("en"), true);
});
