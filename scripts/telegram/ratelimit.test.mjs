import assert from "node:assert/strict";
import { test } from "node:test";
import { createRateLimit } from "./ratelimit.ts";

test("a burst up to the bucket size is allowed, and the next message is not", () => {
  const limit = createRateLimit({ burst: 3, perMinute: 60 });
  assert.equal(limit.take(1, 0), null);
  assert.equal(limit.take(1, 0), null);
  assert.equal(limit.take(1, 0), null);
  assert.ok((limit.take(1, 0) ?? 0) > 0);
});

test("waiting refills the bucket", () => {
  const limit = createRateLimit({ burst: 2, perMinute: 60 });
  limit.take(1, 0);
  limit.take(1, 0);
  assert.ok((limit.take(1, 0) ?? 0) > 0);
  // One per second at 60/min.
  assert.equal(limit.take(1, 1_000), null);
});

test("refusals do not credit the same interval twice", () => {
  const limit = createRateLimit({ burst: 1, perMinute: 60 });
  assert.equal(limit.take(1, 0), null);
  // Half a token's worth of time, asked for repeatedly.
  assert.ok((limit.take(1, 500) ?? 0) > 0);
  assert.ok((limit.take(1, 500) ?? 0) > 0);
  assert.ok((limit.take(1, 900) ?? 0) > 0);
  assert.equal(limit.take(1, 1_000), null);
});

test("an idle chat does not bank more than the burst", () => {
  const limit = createRateLimit({ burst: 2, perMinute: 60 });
  // A week idle, then a burst: still only two.
  assert.equal(limit.take(1, 604_800_000), null);
  assert.equal(limit.take(1, 604_800_000), null);
  assert.ok((limit.take(1, 604_800_000) ?? 0) > 0);
});

test("chats have their own buckets", () => {
  const limit = createRateLimit({ burst: 1, perMinute: 60 });
  assert.equal(limit.take(1, 0), null);
  assert.ok((limit.take(1, 0) ?? 0) > 0);
  assert.equal(limit.take(2, 0), null);
});

test("the wait it reports is enough to actually get a token", () => {
  const limit = createRateLimit({ burst: 1, perMinute: 12 });
  limit.take(7, 0);
  const wait = limit.take(7, 0);
  assert.ok(wait !== null);
  assert.equal(limit.take(7, wait * 1000), null);
});
