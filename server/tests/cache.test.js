// server/tests/cache.test.js
// ─────────────────────────────────────────────────────────────────────
// Unit tests for the LRU Cache with TTL and Single-Flight protection.
//
// RUN:  node --experimental-vm-modules node_modules/jest/bin/jest.js server/tests/cache.test.js
// ─────────────────────────────────────────────────────────────────────

import { LRUCache, makeKey, schemaHash } from "../cache/cache.js";

describe("LRUCache Core Functionality", () => {
  let cache;

  beforeEach(() => {
    cache = new LRUCache({ maxEntries: 3, ttlSeconds: 10 });
  });

  test("tracks hits and misses accurately", () => {
    expect(cache.stats()).toEqual({ hits: 0, misses: 0, size: 0 });

    cache.set("k1", "v1");
    expect(cache.stats().size).toBe(1);

    expect(cache.get("k1")).toBe("v1");
    expect(cache.stats()).toEqual({ hits: 1, misses: 0, size: 1 });

    expect(cache.get("k2")).toBeUndefined();
    expect(cache.stats()).toEqual({ hits: 1, misses: 1, size: 1 });
  });

  test("has() reports presence without altering hit/miss counters", () => {
    cache.set("k1", "v1");

    expect(cache.has("k1")).toBe(true);
    expect(cache.has("k2")).toBe(false);

    expect(cache.stats()).toEqual({ hits: 0, misses: 0, size: 1 });
  });

  test("expires items according to TTL", () => {
    let fakeNow = 1000;
    const timeBoundedCache = new LRUCache({
      maxEntries: 10,
      ttlSeconds: 5,
      now: () => fakeNow,
    });

    timeBoundedCache.set("temp", "hello");
    expect(timeBoundedCache.get("temp")).toBe("hello");

    // Advance time by 4 seconds (within 5s TTL)
    fakeNow += 4000;
    expect(timeBoundedCache.has("temp")).toBe(true);
    expect(timeBoundedCache.get("temp")).toBe("hello");

    // Advance time past TTL (total 6s from start)
    fakeNow += 2000;
    expect(timeBoundedCache.has("temp")).toBe(false);
    expect(timeBoundedCache.get("temp")).toBeUndefined();
    expect(timeBoundedCache.stats().misses).toBe(1);
    expect(timeBoundedCache.stats().size).toBe(0);
  });

  test("LRU evicts the oldest entry when max capacity is reached", () => {
    const lru = new LRUCache({ maxEntries: 3, ttlSeconds: 100 });

    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);
    expect(lru.stats().size).toBe(3);

    // Adding 4th item should evict 'a' (oldest)
    lru.set("d", 4);
    expect(lru.stats().size).toBe(3);
    expect(lru.get("a")).toBeUndefined();
    expect(lru.get("b")).toBe(2);
    expect(lru.get("c")).toBe(3);
    expect(lru.get("d")).toBe(4);
  });

  test("accessing an item with get() refreshes its LRU priority", () => {
    const lru = new LRUCache({ maxEntries: 3, ttlSeconds: 100 });

    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);

    // Access 'a', making 'b' the oldest entry
    expect(lru.get("a")).toBe(1);

    // Insert 'd' -> 'b' should be evicted, 'a' must remain
    lru.set("d", 4);
    expect(lru.get("b")).toBeUndefined();
    expect(lru.get("a")).toBe(1);
    expect(lru.get("c")).toBe(3);
    expect(lru.get("d")).toBe(4);
  });
});

describe("Single-Flight Request Coalescing (getOrCreate)", () => {
  let cache;

  beforeEach(() => {
    cache = new LRUCache({ maxEntries: 10, ttlSeconds: 60 });
  });

  test("10 concurrent getOrCreate calls call the factory exactly ONCE", async () => {
    let factoryInvocations = 0;

    const slowFactory = async () => {
      factoryInvocations++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { component: "WizardComponent" };
    };

    // Trigger 10 concurrent requests for the exact same key
    const promises = Array.from({ length: 10 }, () =>
      cache.getOrCreate("shared-key", slowFactory)
    );

    const results = await Promise.all(promises);

    expect(factoryInvocations).toBe(1);
    for (const res of results) {
      expect(res).toEqual({ component: "WizardComponent" });
    }

    // Subsequent call should hit the cache synchronously without factory
    const immediate = await cache.getOrCreate("shared-key", slowFactory);
    expect(immediate).toEqual({ component: "WizardComponent" });
    expect(factoryInvocations).toBe(1);
  });

  test("a failing factory does NOT cache anything and cleans up in-flight state", async () => {
    let callCount = 0;

    const failingFactory = async () => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error("LLM failure");
    };

    // Run 5 concurrent failing calls
    const attempts = Array.from({ length: 5 }, () =>
      cache.getOrCreate("fail-key", failingFactory).catch((err) => err.message)
    );

    const results = await Promise.all(attempts);

    expect(callCount).toBe(1);
    for (const msg of results) {
      expect(msg).toBe("LLM failure");
    }

    // Nothing was stored in cache
    expect(cache.has("fail-key")).toBe(false);
    expect(cache.get("fail-key")).toBeUndefined();

    // Next attempt should run factory again, not retain rejected promise
    let retried = false;
    const recoveringFactory = async () => {
      retried = true;
      return "recovered";
    };

    const res = await cache.getOrCreate("fail-key", recoveringFactory);
    expect(res).toBe("recovered");
    expect(retried).toBe(true);
  });
});

describe("Hashing & Cache Key Generation", () => {
  const schemaA = {
    formId: "loan-app",
    title: "Loan Form",
    fields: [
      { id: "income", type: "number", label: "Income" },
      { id: "amount", type: "number", label: "Loan Amount" },
    ],
  };

  const schemaB = {
    title: "Loan Form",
    fields: [
      { type: "number", id: "income", label: "Income" },
      { id: "amount", label: "Loan Amount", type: "number" },
    ],
    formId: "loan-app",
  };

  test("schemaHash is deterministic regardless of object key order", () => {
    const hashA = schemaHash(schemaA);
    const hashB = schemaHash(schemaB);

    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
  });

  test("makeKey generates identical keys for identical inputs", () => {
    const sHash = schemaHash(schemaA);

    const key1 = makeKey({
      formId: "loan-app",
      field: "income",
      schemaHash: sHash,
      promptVersion: "v1.0",
    });

    const key2 = makeKey({
      field: "income",
      formId: "loan-app",
      schemaHash: sHash,
      promptVersion: "v1.0",
    });

    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[a-f0-9]{64}$/);
  });

  test("different formId, field, schema, or promptVersion produce different keys", () => {
    const sHash = schemaHash(schemaA);

    const base = makeKey({
      formId: "loan-app",
      field: "income",
      schemaHash: sHash,
      promptVersion: "v1",
    });

    const differentField = makeKey({
      formId: "loan-app",
      field: "amount",
      schemaHash: sHash,
      promptVersion: "v1",
    });

    const differentForm = makeKey({
      formId: "mortgage-app",
      field: "income",
      schemaHash: sHash,
      promptVersion: "v1",
    });

    const differentVersion = makeKey({
      formId: "loan-app",
      field: "income",
      schemaHash: sHash,
      promptVersion: "v2",
    });

    const differentSchema = makeKey({
      formId: "loan-app",
      field: "income",
      schemaHash: schemaHash({ fields: [] }),
      promptVersion: "v1",
    });

    expect(base).not.toBe(differentField);
    expect(base).not.toBe(differentForm);
    expect(base).not.toBe(differentVersion);
    expect(base).not.toBe(differentSchema);
  });

  test("user-entered values are NOT part of the cache key", () => {
    const sHash = schemaHash(schemaA);

    // Two different users with wildly different input data on the same field
    const user1Values = { income: "100000", ssn: "123" };
    const user2Values = { income: "25000", ssn: "999" };

    const keyForUser1 = makeKey({
      formId: "loan-app",
      field: "income",
      schemaHash: sHash,
      promptVersion: "v1",
      // Values are not accepted or included in the key signature
    });

    const keyForUser2 = makeKey({
      formId: "loan-app",
      field: "income",
      schemaHash: sHash,
      promptVersion: "v1",
    });

    expect(keyForUser1).toBe(keyForUser2);
  });
});
