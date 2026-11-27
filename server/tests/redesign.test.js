// server/tests/redesign.test.js
// ─────────────────────────────────────────────────────────────────────
// Integration tests for Step 8: Redesign pipeline & delivery.
//
// RUN:  node --experimental-vm-modules node_modules/jest/bin/jest.js server/tests/redesign.test.js
// ─────────────────────────────────────────────────────────────────────

import { startRedesign, prewarmRedesign, evictComponent } from "../pipeline/redesign.js";
import { LRUCache } from "../cache/cache.js";
import { llmBreaker } from "../safety/breaker.js";
import { sessionRedesignLimiter, globalLlmLimiter } from "../safety/rateLimit.js";
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
    llmBreaker.reset();
    sessionRedesignLimiter.clear();
    globalLlmLimiter.clear();
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
    expect(sentMessages[0].payload).toEqual({
      friction: { score: friction.score, field: null },
    });

    expect(sentMessages[1].type).toBe("redesign:ready");
    expect(sentMessages[1].payload.componentId).toBe(mockCompiled.hash);
    expect(sentMessages[1].payload.version).toBe(1);
    expect(sentMessages[1].payload.code).toBe(mockCompiled.js);
    expect(sentMessages[1].payload.friction).toEqual(friction);
    expect(sentMessages[1].payload.cached).toBe(false);
    expect(typeof sentMessages[1].payload.ms).toBe("number");

    // Verify PII was masked before passing to generator
    expect(capturedMaskedValues.panNumber).toBe("[MASKED]");

    // Verify session lock was released
    expect(session.redesigning).toBe(false);
  });

  test("sensitive schema, values, and friction identifiers never reach generation", async () => {
    let generatedContext = null;
    const deps = {
      send: mockSend,
      log: mockLog,
      cache: testCache,
      requestSnapshot: async () => ({
        schema: {
          formId: "private-form",
          fields: [
            { id: "email", label: "Email", type: "email" },
            { id: "ssn", label: "SSN", type: "text" },
            { id: "privateNotes", label: "Notes", type: "text", sensitive: true },
          ],
        },
        values: {
          email: "person@example.com",
          ssn: "123-45-6789",
          privateNotes: "private",
        },
      }),
      generate: async (context) => {
        generatedContext = context;
        return "export default function W() { return <div />; }";
      },
      validate: () => ({ ok: true, ast: {} }),
      compile: () => mockCompiled,
    };

    await startRedesign(session, { field: "ssn", score: 90 }, deps);

    expect(generatedContext.schema.fields.map((field) => field.id)).toEqual([
      "email",
    ]);
    expect(generatedContext.values).not.toHaveProperty("ssn");
    expect(generatedContext.values).not.toHaveProperty("privateNotes");
    expect(generatedContext.friction.field).toBeNull();
    expect(sentMessages[0].payload.friction.field).toBeNull();
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

    // redesign:ready was never sent, but redesign:failed was sent with reason 'invalid'
    const readyMsg = sentMessages.find((m) => m.type === "redesign:ready");
    expect(readyMsg).toBeUndefined();

    const failedMsg = sentMessages.find((m) => m.type === "redesign:failed");
    expect(failedMsg).toBeDefined();
    expect(failedMsg.payload.reason).toBe("invalid");

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

    const failedMsg = sentMessages.find((m) => m.type === "redesign:failed");
    expect(failedMsg).toBeDefined();
    expect(failedMsg.payload.reason).toBe("snapshot_timeout");

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

  test("8. Speculative pre-warm: leaves result in cache quietly when user calms down", async () => {
    let generateCalls = 0;

    const deps = {
      send: mockSend,
      log: mockLog,
      cache: testCache,
      config: { PREWARM_ENABLED: true },
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

    const res = await prewarmRedesign(session, friction, deps);
    expect(res.hash).toBe(mockCompiled.hash);
    expect(generateCalls).toBe(1);
    expect(testCache.stats().size).toBe(1);
    // Browser must NOT receive redesign:started, progress, ready, or failed
    expect(sentMessages).toHaveLength(0);
    expect(session.prewarming).toBe(false);
  });

  test("9. Speculative pre-warm + startRedesign share single-flight (exactly 1 LLM call)", async () => {
    let generateCalls = 0;
    let resolveGenerate;
    const pendingGen = new Promise((resolve) => {
      resolveGenerate = resolve;
    });

    const deps = {
      send: mockSend,
      log: mockLog,
      cache: testCache,
      config: { PREWARM_ENABLED: true },
      requestSnapshot: async () => ({
        schema: sampleSchema,
        values: sampleValues,
      }),
      generate: async () => {
        generateCalls++;
        return pendingGen;
      },
      validate: () => ({ ok: true, ast: {} }),
      compile: () => mockCompiled,
    };

    // Trigger background pre-warm first
    const prewarmPromise = prewarmRedesign(session, friction, deps);
    await new Promise((r) => setTimeout(r, 15));
    expect(generateCalls).toBe(1);

    // While pre-warm LLM generation is STILL in flight, trigger actual redesign
    const redesignPromise = startRedesign(session, friction, deps);
    await new Promise((r) => setTimeout(r, 15));

    // Single-flight proves generate() was NOT called a second time
    expect(generateCalls).toBe(1);

    resolveGenerate("valid code");
    const [prewarmRes, redesignRes] = await Promise.all([
      prewarmPromise,
      redesignPromise,
    ]);

    expect(prewarmRes.hash).toBe(mockCompiled.hash);
    expect(redesignRes.hash).toBe(mockCompiled.hash);
    expect(generateCalls).toBe(1);

    const readyMsg = sentMessages.find((m) => m.type === "redesign:ready");
    expect(readyMsg).toBeDefined();
    expect(readyMsg.payload.cached).toBe(false); // joined in-flight cold build
  });

  test("10. Cross-session eviction defense: unrelated session cannot evict cached component", async () => {
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

    const result = await startRedesign(session, friction, deps);
    expect(testCache.stats().size).toBe(1);

    // An unrelated session without this component in deliveredComponents tries to evict it
    const attackerSession = {
      id: "sess-attacker",
      deliveredComponents: new Set(),
    };
    const denied = evictComponent(result.hash, testCache, attackerSession);
    expect(denied).toBe(false);
    expect(testCache.stats().size).toBe(1);

    // The legitimate recipient session CAN evict it
    const allowed = evictComponent(result.hash, testCache, session);
    expect(allowed).toBe(true);
    expect(testCache.stats().size).toBe(0);
  });
});
