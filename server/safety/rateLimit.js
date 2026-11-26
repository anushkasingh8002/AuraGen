// server/safety/rateLimit.js
// ─────────────────────────────────────────────────────────────────────
// Sliding-window rate limiters for redesign attempts and LLM calls.
//
// Limits:
//   - Per-session redesign cap: max 3 redesigns per 10 minutes
//   - Global LLM call cap:      max 30 calls per minute (cost guard)
// ─────────────────────────────────────────────────────────────────────

import { RateLimitError } from "./errors.js";

/**
 * Create a sliding-window rate limiter keyed by arbitrary identifier.
 *
 * @param {object} opts
 * @param {number} opts.max
 * @param {number} opts.windowMs
 * @param {"session"|"global"} [opts.scope="session"]
 * @param {() => number} [opts.now=Date.now]
 */
export function createRateLimiter({
  max,
  windowMs,
  scope = "session",
  now = Date.now,
}) {
  /** @type {Map<string, number[]>} */
  const buckets = new Map();

  function prune(key, ts) {
    const arr = buckets.get(key);
    if (!arr) return [];
    const cutoff = ts - windowMs;
    const valid = arr.filter((t) => t > cutoff);
    if (valid.length === 0) {
      buckets.delete(key);
    } else {
      buckets.set(key, valid);
    }
    return valid;
  }

  /**
   * Consume one quota token for `key` or throw RateLimitError.
   *
   * @param {string} [key="global"]
   * @returns {{ remaining: number }}
   */
  function consume(key = "global") {
    const ts = now();
    const valid = prune(key, ts);

    if (valid.length >= max) {
      throw new RateLimitError(
        `Rate limit exceeded for ${scope}: max ${max} per ${Math.round(windowMs / 1000)}s`,
        scope
      );
    }

    valid.push(ts);
    buckets.set(key, valid);

    // Opportunistic sweep if many distinct session keys accumulate
    if (buckets.size > 1000) {
      for (const k of buckets.keys()) {
        prune(k, ts);
      }
    }

    return { remaining: max - valid.length };
  }

  /**
   * Check whether a call for `key` would currently exceed quota without consuming.
   */
  function check(key = "global") {
    const valid = prune(key, now());
    return valid.length < max;
  }

  function clear(key) {
    if (key !== undefined) {
      buckets.delete(key);
    } else {
      buckets.clear();
    }
  }

  return { consume, check, clear };
}

/** Max 3 redesign triggers per 10 minutes per session. */
export const sessionRedesignLimiter = createRateLimiter({
  max: 3,
  windowMs: 10 * 60 * 1000,
  scope: "session",
});

/** Max 30 LLM generations per minute globally (protects API spend). */
export const globalLlmLimiter = createRateLimiter({
  max: 30,
  windowMs: 60 * 1000,
  scope: "global",
});
