/**
 * A per-chat token bucket.
 *
 * The allow-list keeps strangers out, so this is not a security control — it is
 * a cost control. Every message that gets past the allow-list starts a model
 * turn, and a fat-fingered burst (or a client retrying a failed send) can spend
 * real money before anyone notices. The bucket makes the ceiling explicit.
 *
 * Pure apart from the clock, which is injected, so the refill arithmetic is
 * testable without waiting a minute.
 */

export interface RateLimit {
  /**
   * Take one token for `chatId`.
   *
   * Returns how many seconds until the next token when the bucket is empty, and
   * null when the message may proceed.
   */
  take(chatId: number, now: number): number | null;
}

export interface RateLimitOptions {
  /** Bucket size: how many messages may arrive back to back. */
  burst: number;
  /** Sustained rate, in messages per minute. */
  perMinute: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitOptions = { burst: 5, perMinute: 12 };

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export function createRateLimit(options: RateLimitOptions = DEFAULT_RATE_LIMIT): RateLimit {
  const buckets = new Map<number, Bucket>();
  const perMs = options.perMinute / 60_000;

  return {
    take(chatId, now) {
      const bucket = buckets.get(chatId) ?? { tokens: options.burst, updatedAt: now };
      // Refill for the time that passed, capped at the burst size — an idle
      // week must not bank a week's worth of turns.
      const refilled = Math.min(options.burst, bucket.tokens + (now - bucket.updatedAt) * perMs);

      if (refilled < 1) {
        // The clock still advances on a refusal — `refilled` already banked the
        // elapsed time, so it is stamped with it. Leaving `updatedAt` behind
        // would credit that same interval again on the next attempt.
        buckets.set(chatId, { tokens: refilled, updatedAt: now });
        return Math.max(1, Math.ceil((1 - refilled) / perMs / 1000));
      }

      buckets.set(chatId, { tokens: refilled - 1, updatedAt: now });
      return null;
    },
  };
}
