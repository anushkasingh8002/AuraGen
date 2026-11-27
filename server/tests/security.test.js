// server/tests/security.test.js
// ─────────────────────────────────────────────────────────────────────
// Security, safety, rate-limiting, circuit-breaker, logger redaction,
// and WebSocket server hardening tests (Step 12).
// ─────────────────────────────────────────────────────────────────────

import WebSocket from "ws";
import { createCircuitBreaker } from "../safety/breaker.js";
import { createRateLimiter } from "../safety/rateLimit.js";
import { redact } from "../safety/logger.js";
import { requestSnapshot, resolveSnapshot } from "../agent/snapshot.js";
import { CircuitOpenError, RateLimitError, toReason } from "../safety/errors.js";
import { server, sessions } from "../index.js";
import config from "../config.js";

const ALLOWED_ORIGIN = config.ALLOWED_ORIGINS[0];

describe("Circuit Breaker (breaker.js)", () => {
  test("opens after 5 consecutive failures, half-opens after 60s, and closes on success", async () => {
    let fakeNow = 100_000;
    const breaker = createCircuitBreaker({
      failureThreshold: 5,
      resetTimeoutMs: 60_000,
      now: () => fakeNow,
    });

    const failingCall = async () => {
      throw new Error("OpenAI 503");
    };

    // 5 consecutive LLM failures open the breaker
    for (let i = 0; i < 5; i++) {
      await expect(breaker.execute(failingCall)).rejects.toThrow("OpenAI 503");
    }
    expect(breaker._state()).toBe("OPEN");

    // Subsequent calls fail immediately with CircuitOpenError ("unavailable")
    let upstreamCalled = false;
    await expect(
      breaker.execute(async () => {
        upstreamCalled = true;
        return "ok";
      })
    ).rejects.toThrow(CircuitOpenError);
    expect(upstreamCalled).toBe(false);
    expect(toReason(new CircuitOpenError())).toBe("unavailable");

    // Advance clock by 60 seconds -> HALF_OPEN allows 1 trial call -> success closes circuit
    fakeNow += 60_000;
    expect(breaker._state()).toBe("HALF_OPEN");

    const trialResult = await breaker.execute(async () => "recovered");
    expect(trialResult).toBe("recovered");
    expect(breaker._state()).toBe("CLOSED");
  });

  test("failed half-open probe re-opens circuit for another 60s", async () => {
    let fakeNow = 0;
    const breaker = createCircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 60_000,
      now: () => fakeNow,
    });

    await expect(breaker.execute(async () => { throw new Error("fail1"); })).rejects.toThrow();
    await expect(breaker.execute(async () => { throw new Error("fail2"); })).rejects.toThrow();
    expect(breaker._state()).toBe("OPEN");

    fakeNow += 60_000;
    await expect(breaker.execute(async () => { throw new Error("probe fail"); })).rejects.toThrow();
    expect(breaker._state()).toBe("OPEN");

    await expect(breaker.execute(async () => "nope")).rejects.toThrow(CircuitOpenError);
  });
});

describe("Rate Limiter (rateLimit.js)", () => {
  test("session limit blocks >3 redesigns per 10 minutes and resets after window", () => {
    let fakeNow = 1_000_000;
    const limiter = createRateLimiter({
      max: 3,
      windowMs: 600_000,
      scope: "session",
      now: () => fakeNow,
    });

    expect(limiter.consume("sess-1").remaining).toBe(2);
    expect(limiter.consume("sess-1").remaining).toBe(1);
    expect(limiter.consume("sess-1").remaining).toBe(0);

    // 4th attempt within 10 minutes throws RateLimitError -> rate_limited
    let caught;
    try {
      limiter.consume("sess-1");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RateLimitError);
    expect(toReason(caught)).toBe("rate_limited");

    // Separate session is unaffected
    expect(limiter.consume("sess-2").remaining).toBe(2);

    // Advancing 10 minutes clears sliding window
    fakeNow += 600_001;
    expect(limiter.consume("sess-1").remaining).toBe(2);
  });

  test("global limit caps at 30 LLM calls per minute", () => {
    let fakeNow = 5_000_000;
    const limiter = createRateLimiter({
      max: 30,
      windowMs: 60_000,
      scope: "global",
      now: () => fakeNow,
    });

    for (let i = 0; i < 30; i++) {
      limiter.consume("global");
    }
    expect(() => limiter.consume("global")).toThrow(RateLimitError);

    fakeNow += 60_001;
    expect(limiter.consume("global").remaining).toBe(29);
  });
});

describe("Logger Secret & PII Redaction (logger.js)", () => {
  test("scrubs values, code, apiKey fields and inline sk-/Bearer secrets in error strings", () => {
    const cleaned = redact({
      values: { fullName: "Alice" },
      code: "export default function() {}",
      apiKey: "secret",
      message: "Auth failed for key sk-proj-abcdefghijklmnop123456 with Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
    });

    expect(cleaned.values).toBe("[redacted]");
    expect(cleaned.code).toBe("[redacted]");
    expect(cleaned.apiKey).toBe("[redacted]");
    expect(cleaned.message).not.toContain("sk-proj-abcdefghijklmnop123456");
    expect(cleaned.message).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(cleaned.message).toContain("[redacted-key]");
    expect(cleaned.message).toContain("Bearer [redacted]");
  });
});

describe("WebSocket Security & DoS Hardening (server/index.js)", () => {
  let port;

  beforeAll(async () => {
    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    for (const [id, s] of sessions) {
      s.socket?.terminate();
      sessions.delete(id);
    }
    await new Promise((resolve) => server.close(resolve));
  });

  test("rejects disallowed Origin with close code 1008", async () => {
    const closeInfo = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
        headers: { origin: "https://evil-attacker.example" },
      });
      ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
      ws.on("error", reject);
    });

    expect(closeInfo.code).toBe(1008);
  });

  test("drops client flooding > 100 messages/second with close code 1008", async () => {
    const closeInfo = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
        headers: { origin: ALLOWED_ORIGIN },
      });
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "session:start", payload: { formId: "flood-test" } }));
      });
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "session:ready") {
          for (let i = 0; i < 110; i++) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "telemetry:batch", payload: [] }));
            }
          }
        }
      });
      ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
      ws.on("error", reject);
    });

    expect(closeInfo.code).toBe(1008);
    expect(closeInfo.reason).toMatch(/rate limit/i);
  });

  test("closes oversized (> 64 KB) WebSocket payload without crashing server", async () => {
    const result = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
        headers: { origin: ALLOWED_ORIGIN },
      });
      ws.on("open", () => {
        const oversized = "x".repeat(70 * 1024);
        ws.send(JSON.stringify({ type: "session:start", payload: { formId: oversized } }));
      });
      ws.on("close", (code) => resolve({ event: "close", code }));
      ws.on("error", (err) => resolve({ event: "error", message: err.message }));
    });

    expect(["close", "error"]).toContain(result.event);
    if (result.code !== undefined) {
      expect(result.code).toBe(1009);
    }
  });

  test("disconnect mid-redesign cleans up session map and pending snapshots", async () => {
    // Ensure prior test sockets finished closing on server
    await new Promise((r) => setTimeout(r, 40));

    let capturedSessionId = null;
    let pendingReqId = null;
    const baselineCount = sessions.size;

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
        headers: { origin: ALLOWED_ORIGIN },
      });
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "session:start", payload: { formId: "disconnect-test" } }));
      });
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "session:ready") {
          capturedSessionId = msg.sessionId;
          const activeSession = sessions.get(capturedSessionId);
          expect(activeSession).toBeDefined();
          expect(sessions.size).toBe(baselineCount + 1);

          // Simulate pending snapshot request mid-redesign
          requestSnapshot(activeSession, "disconnect-check", 5000).catch(() => {});
        } else if (msg.type === "snapshot:request") {
          pendingReqId = msg.payload.requestId;
          // Disconnect abruptly while snapshot request timer is active
          ws.close();
        }
      });
      ws.on("close", () => setTimeout(resolve, 60));
      ws.on("error", reject);
    });

    expect(sessions.has(capturedSessionId)).toBe(false);
    // Pending snapshot was cleared on socket close so resolveSnapshot returns false
    expect(resolveSnapshot(pendingReqId, { schema: {}, values: {} })).toBe(false);
  });
});
