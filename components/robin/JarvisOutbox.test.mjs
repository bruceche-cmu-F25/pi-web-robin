import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { hookHarness } from "../../scripts/react-hook-harness.mjs";

const shape = await import("../../extension/robin/jarvis-shape.ts");
const file = new URL("./JarvisOutbox.tsx", import.meta.url);
const source = await readFile(file, "utf8");
const discoverySource = await readFile(new URL("./JarvisDiscovery.tsx", import.meta.url), "utf8");
const followUpSource = await readFile(new URL("./FollowUpTemplateEditor.tsx", import.meta.url), "utf8");
const harness = hookHarness(file, {
  "@/extension/robin/jarvis-shape": shape,
  "./JarvisDiscovery.module.css": {},
});

test("delivery policy describes the sender's enforced timing", () => {
  assert.deepEqual(shape.JARVIS_DELIVERY_POLICY, {
    recipientWindowEnforced: false,
    minimumGapMinutes: 6,
    maximumGapMinutes: 12,
    replySyncMinutes: 15,
    followUpDelayHours: 24,
    bouncePauseThreshold: 3,
  });
});

test("queue estimates do not invent a recipient working-hours gate", () => {
  const from = new Date("2026-09-26T03:00:00.000Z"); // Friday evening in LA, Saturday in UTC.
  const queue = [
    { id: "a", timeZone: "America/Los_Angeles" },
    { id: "b", timeZone: "Asia/Tokyo" },
  ];
  const estimates = harness.exports.estimateSendTimes(queue, from);
  assert.equal(estimates.get("a").toISOString(), from.toISOString());
  assert.equal(estimates.get("b").getTime() - from.getTime(), 9 * 60_000);
});

test("outbox copy does not promise retired timing rules", () => {
  const timingCopy = [source, discoverySource, followUpSource].join("\n");
  assert.doesNotMatch(timingCopy, /recipient's weekday 8:00/);
  assert.doesNotMatch(timingCopy, /对方工作日 8–18 点/);
  assert.doesNotMatch(timingCopy, /after 7 days|7\+ days|7 天无回复|已满 7 天/);
  assert.match(timingCopy, /JARVIS_DELIVERY_POLICY\.followUpDelayHours/);
});
