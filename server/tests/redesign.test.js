// server/tests/redesign.test.js
// ─────────────────────────────────────────────────────────────────────
// Integration tests for Step 8: Redesign pipeline & delivery.
//
// RUN:  node --experimental-vm-modules node_modules/jest/bin/jest.js server/tests/redesign.test.js
// ─────────────────────────────────────────────────────────────────────

import { startRedesign, evictComponent } from "../pipeline/redesign.js";
import { LRUCache } from "../cache/cache.js";
import {
  SnapshotTimeoutError,
  ValidationError,
  CompileError,
} from "../safety/errors.js";

describe("Redesign Pipeline Integration", () => {
  let session;
  let friction;
  let sentMessages;
  let mockSend;
  let mockLog;
  let testCache;

  const sampleSchema = {
    formId: "loan-application",
    fields: [
      { id: "monthlyIncome", label: "Monthly Income", type: "number" },
      { id: "panNumber", label: "PAN", sensitive: true },
    ],
  };

  const sampleValues = {
    monthlyIncome: "50000",
    panNumber: "ABCDE1234F",
  };

  const mockCompiled = {
    ok: true,
    hash: "abc1234567890def1234567890abcdef1234567890def1234567890abcdef",
    js: 'exports.default = function Wizard() { return "wizard"; };',
    bytes: 120,
  };

  beforeEach(() => {
    sentMessages = [];
    session = {
      id: "sess-test-42",
      formId: "loan-application",
      redesigning: false,
    };

    friction = {
      field: "monthlyIncome",
      score: 82,
    };

    mockSend = (sess, type, payload) => {
      sentMessages.push({ type, payload });
    };

    mockLog = {
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    testCache = new LRUCache({ maxEntries: 10, ttlSeconds: 3600 });
  });

  test("1. Success path: executes full pipeline and delivers redesign:ready", async () => {
    let capturedMaskedValues = null;

    const deps = {
      send: mockSend,
      log: mockLog,
      cache: testCache,
      requestSnapshot: async () => ({
        schema: sampleSchema,
        values: sampleValues,
      }),
      maskValues: (schema, values) => {
        capturedMaskedValues = {
          ...values,
          panNumber: "[MASKED]",
        };
        return capturedMaskedValues;
      },
      generate: async () => "export default function W() { return <div />; }",
      validate: () => ({ ok: true, ast: {} }),
      compile: () => mockCompiled,
    };

    const result = await startRedesign(session, friction, deps);

    expect(result).toBeDefined();
    expect(result.hash).toBe(mockCompiled.hash);
    expect(result.js).toBe(mockCompiled.js);

    // Verify messages sent to browser
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0].type).toBe("redesign:started");
    expect(sentMessages[0].payload).toEqual({ friction });

    expect(sentMessages[1].type).toBe("redesign:ready");
    expect(sentMessages[1].payload.componentId).toBe(mockCompiled.hash);
    expect(sentMessages[1].payload.version).toBe(1);
    expect(sentMessages[1].payload.code).toBe(mockCompiled.js);
    expect(sentMessages[1].payload.cached).toBe(false);
    expect(typeof sentMessages[1].payload.ms).toBe("number");

    // Verify PII was masked before passing to generator
    expect(capturedMaskedValues.panNumber).toBe("[MASKED]");

    // Verify session lock was released
    expect(session.redesigning).toBe(false);
  });

  test("2. Validation failure then successful retry: feeds back errors to LLM once", async () => {
    let generateCalls = 0;
    let receivedFeedback = null;

    const deps = {
      send: mockSend,
      log: mockLog,
      cache: testCache,
      requestSnapshot: async () => ({
        schema: sampleSchema,
        values: sampleValues,
      }),
      generate: async (_ctx, { feedback } = {}) => {
        generateCalls++;
        receivedFeedback = feedback;
        if (generateCalls === 1) {
          return "export default function W() { window.hack(); return <div />; }";
        }
        return "export default function W() { return <div />; }";
      },
      validate: (code) => {
        if (code.includes("window")) {
          return { ok: false, errors: ["Forbidden global identifier 'window'"] };
        }
        return { ok: true, ast: {} };
      },
      compile: () => mockCompiled,
    };

    const result = await startRedesign(session, friction, deps);

    expect(generateCalls).toBe(2);
    expect(receivedFeedback).toContain("Forbidden global identifier 'window'");
    expect(result.hash).toBe(mockCompiled.hash);

    const readyMsg = sentMessages.find((m) => m.type === "redesign:ready");
    expect(readyMsg).toBeDefined();
    expect(readyMsg.payload.componentId).toBe(mockCompiled.hash);
    expect(session.redesigning).toBe(false);
  });

  test("3. Double validation failure: throws ValidationError and does not cache", async () => {
    let generateCalls = 0;

    const deps = {
      send: mockSend,
      log: mockLog,
      cache: testCache,
      requestSnapshot: async () => ({
        schema: sampleSchema,
        values: sampleValues,
      }),
      generate: async () => {
        generateCalls++;
        return "invalid code";
      },
      validate: () => ({
        ok: false,
        errors: ["Missing default export"],
      }),
      compile: () => mockCompiled,
    };

    await expect(startRedesign(session, friction, deps)).rejects.toThrow(
      ValidationError
    );

    expect(generateCalls).toBe(2); // Initial + 1 retry

    // redesign:ready was never sent
    const readyMsg = sentMessages.find((m) => m.type === "redesign:ready");
    expect(readyMsg).toBeUndefined();

    // Cache remains empty
    expect(testCache.stats().size).toBe(0);

    // Concurrency lock released
    expect(session.redesigning).toBe(false);
  });

  test("4. Snapshot timeout: rejects with SnapshotTimeoutError and releases session lock", async () => {
    let generateCalled = false;

    const deps = {
      send: mockSend,
      log: mockLog,
      cache: testCache,
      requestSnapshot: async () => {
        throw new SnapshotTimeoutError("req-timeout", 2000);
      },
      generate: async () => {
        generateCalled = true;
      },
    };

    await expect(startRedesign(session, friction, deps)).rejects.toThrow(
      SnapshotTimeoutError
    );

    expect(generateCalled).toBe(false);
    expect(session.redesigning).toBe(false);
  });

  test("5. Cache hit on second redesign: serves component without calling generator", async () => {
    let generateCalls = 0;

    const deps = {
      send: mockSend,
      log: mockLog,
      cache: testCache,
      requestSnapshot: async () => ({
        schema: sampleSchema,
        values: sampleValues,
      }),
      generate: async () => {
        generateCalls++;
        return "valid code";
      },
      validate: () => ({ ok: true, ast: {} }),
      compile: () => mockCompiled,
    };

    // First call (miss)
    const res1 = await startRedesign(session, friction, deps);
    expect(generateCalls).toBe(1);
    expect(sentMessages[1].payload.cached).toBe(false);

    // Second call with same formId and friction field (hit)
    sentMessages = [];
    const res2 = await startRedesign(session, friction, deps);

    expect(generateCalls).toBe(1); // Not called again!
    expect(res2.hash).toBe(res1.hash);
    expect(sentMessages[1].payload.cached).toBe(true);
    expect(sentMessages[1].payload.componentId).toBe(mockCompiled.hash);
  });

  test("6. Concurrent redesign guard: rejects overlapping redesign calls on the same session", async () => {
    let resolveSnapshot;
    const pendingSnapshot = new Promise((resolve) => {
      resolveSnapshot = resolve;
    });

    const deps = {
      send: mockSend,
      log: mockLog,
      cache: testCache,
      requestSnapshot: () => pendingSnapshot,
      generate: async () => "code",
      validate: () => ({ ok: true, ast: {} }),
      compile: () => mockCompiled,
    };

    // Start first redesign (in-flight)
    const run1 = startRedesign(session, friction, deps);
    expect(session.redesigning).toBe(true);

    // Attempt second redesign concurrently
    const run2 = await startRedesign(session, friction, deps);
    expect(run2).toBeUndefined(); // Ignored due to session.redesigning flag

    // Complete first redesign
    resolveSnapshot({ schema: sampleSchema, values: sampleValues });
    await run1;

    expect(session.redesigning).toBe(false);
  });

  test("7. Browser render failure (render:result ok:false) evicts entry from cache", async () => {
    const deps = {
      send: mockSend,
      log: mockLog,
      cache: testCache,
      requestSnapshot: async () => ({
        schema: sampleSchema,
        values: sampleValues,
      }),
      generate: async () => "valid code",
      validate: () => ({ ok: true, ast: {} }),
      compile: () => mockCompiled,
    };

    // Populate cache via redesign
    const result = await startRedesign(session, friction, deps);
    expect(testCache.stats().size).toBe(1);

    // Simulate browser reporting render error
    const evicted = evictComponent(result.hash, testCache);
    expect(evicted).toBe(true);
    expect(testCache.stats().size).toBe(0);
  });
});
