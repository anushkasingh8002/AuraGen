// server/cache/cache.js
// ─────────────────────────────────────────────────────────────────────
// In-Memory LRU Cache with TTL and Single-Flight Request Coalescing.
//
// WHY LRU + TTL?
//   - LRU (Least Recently Used) bounds memory usage to a maximum of 200
//     entries, evicting cold entries when capacity is reached.
//   - TTL ensures that even active components expire after
//     config.CACHE_TTL_SECONDS, so designs stay fresh and memory is freed.
//
// WHY SINGLE-FLIGHT (getOrCreate)?
//   - If a surge of frustrated users on the same form field trigger
//     redesigns simultaneously, single-flight coalesces concurrent
//     requests for the same cache key into ONE factory execution.
//   - All callers await the same Promise. If it fails, nothing is cached
//     and the in-flight state is cleaned up.
//
// WHY NOT CACHE USER INPUT VALUES?
//   - Generated React wizards are generic form structures tailored to
//     the schema and the friction field.
//   - User-entered values are injected dynamically as props at runtime
//     ({ initialValues }). Caching per-user values would destroy cache
//     hit rates and leak PII into the cache keys.
// ─────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import config from "../config.js";
import { PROMPT_VERSION } from "../agent/chain.js";

const MAX_CACHE_ENTRIES = 200;

/**
 * Deterministically serialize any JavaScript value, recursively sorting
 * object keys to produce invariant output.
 *
 * @param {any} val
 * @returns {string}
 */
export function stableStringify(val) {
  if (val === null || typeof val !== "object") {
    return JSON.stringify(val);
  }

  if (Array.isArray(val)) {
    return `[${val.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(val).sort();
  const pairs = keys.map(
    (key) => `${JSON.stringify(key)}:${stableStringify(val[key])}`
  );
  return `{${pairs.join(",")}}`;
}

/**
 * Compute a stable SHA-256 hash of a form schema definition.
 * Object key order does not alter the output.
 *
 * @param {object} schema
 * @returns {string} hex hash
 */
export function schemaHash(schema) {
  const serialized = stableStringify(schema ?? {});
  return crypto.createHash("sha256").update(serialized, "utf8").digest("hex");
}

/**
 * Generate a deterministic cache key for a UI redesign request.
 * Values typed by the user are intentionally NOT included.
 *
 * @param {object} params
 * @param {string} params.formId
 * @param {string|null} params.field
 * @param {string} params.schemaHash
 * @param {string} [params.promptVersion]
 * @returns {string} hex hash
 */
export function makeKey({ formId, field, schemaHash: sHash, promptVersion }) {
  const payload = {
    formId: String(formId || ""),
    field: field ? String(field) : null,
    schemaHash: String(sHash || ""),
    promptVersion: String(promptVersion || PROMPT_VERSION),
  };

  const serialized = stableStringify(payload);
  return crypto.createHash("sha256").update(serialized, "utf8").digest("hex");
}

/**
 * In-Memory LRU Cache with TTL and Single-Flight protection.
 */
export class LRUCache {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxEntries=200]
   * @param {number} [opts.ttlSeconds]
   * @param {() => number} [opts.now=Date.now]
   */
  constructor({
    maxEntries = MAX_CACHE_ENTRIES,
    ttlSeconds = config.CACHE_TTL_SECONDS,
    now = Date.now,
  } = {}) {
    this.maxEntries = maxEntries;
    this.ttlMs = (ttlSeconds ?? 3600) * 1000;
    this.now = now;

    /** @type {Map<string, { value: any, expiresAt: number }>} */
    this.store = new Map();

    /** @type {Map<string, Promise<any>>} */
    this.inFlight = new Map();

    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Retrieve an item from the cache.
   * If expired or not found, increments misses and returns undefined.
   * If found, refreshes LRU access order, increments hits, and returns the value.
   *
   * @param {string} key
   * @returns {any|undefined}
   */
  get(key) {
    const entry = this.store.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // TTL Check
    if (this.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }

    // Refresh LRU position (delete and re-insert moves to end of Map iteration)
    this.store.delete(key);
    this.store.set(key, entry);

    this.hits++;
    return entry.value;
  }

  /**
   * Store an item in the cache with TTL.
   * If the cache exceeds maxEntries, evicts the oldest (least recently used) entry.
   *
   * @param {string} key
   * @param {any} value
   * @param {number} [ttlSeconds] – optional custom TTL override
   */
  set(key, value, ttlSeconds) {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      // Evict the oldest key (first item in Map iteration)
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }

    const ttl = typeof ttlSeconds === "number" ? ttlSeconds * 1000 : this.ttlMs;
    this.store.set(key, {
      value,
      expiresAt: this.now() + ttl,
    });
  }

  /**
   * Check whether a key exists in cache and has not expired.
   * Does NOT alter LRU order and does NOT increment hits/misses.
   *
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    const entry = this.store.get(key);
    if (!entry) return false;

    if (this.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Single-flight request coalescer.
   * If key is in cache, returns it immediately.
   * If an in-flight Promise exists for key, returns the existing Promise.
   * Otherwise, executes factory(), stores the result on success, and cleans up in-flight state.
   *
   * @param {string} key
   * @param {() => Promise<any>} factory
   * @param {number} [ttlSeconds]
   * @returns {Promise<any>}
   */
  async getOrCreate(key, factory, ttlSeconds) {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const active = this.inFlight.get(key);
    if (active) {
      return active;
    }

    const promise = (async () => {
      try {
        const result = await factory();
        this.set(key, result, ttlSeconds);
        return result;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  /**
   * Return cache performance and capacity metrics.
   *
   * @returns {{ hits: number, misses: number, size: number }}
   */
  stats() {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.store.size,
    };
  }

  /**
   * Remove an entry from the cache.
   *
   * @param {string} key
   * @returns {boolean} whether an element was removed
   */
  delete(key) {
    return this.store.delete(key);
  }

  /**
   * Clear all stored entries, in-flight promises, and counters.
   */
  clear() {
    this.store.clear();
    this.inFlight.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

// ── CacheAdapter Interface & Redis Skeleton ──────────────────────────
/**
 * @interface CacheAdapter
 * Base interface contract for interchangeable cache backends.
 *
 * Methods:
 *   get(key: string): Promise<any> | any;
 *   set(key: string, value: any, ttlSeconds?: number): Promise<void> | void;
 *   has(key: string): Promise<boolean> | boolean;
 */

/*
// ─────────────────────────────────────────────────────────────────────
// Redis Cache Adapter Skeleton (Example for future multi-instance deployments)
// ─────────────────────────────────────────────────────────────────────
//
// export class RedisCacheAdapter {
//   constructor(redisClient, defaultTtlSeconds = config.CACHE_TTL_SECONDS) {
//     this.client = redisClient;
//     this.defaultTtl = defaultTtlSeconds;
//   }
//
//   async get(key) {
//     const raw = await this.client.get(key);
//     if (!raw) return undefined;
//     try {
//       return JSON.parse(raw);
//     } catch {
//       return raw;
//     }
//   }
//
//   async set(key, value, ttlSeconds = this.defaultTtl) {
//     const payload = JSON.stringify(value);
//     await this.client.set(key, payload, { EX: ttlSeconds });
//   }
//
//   async has(key) {
//     const count = await this.client.exists(key);
//     return count > 0;
//   }
// }
*/

// Export a singleton instance configured with defaults for server usage
export const cache = new LRUCache();
export default cache;
