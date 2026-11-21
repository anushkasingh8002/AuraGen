// server/tests/trigger.test.js
// ─────────────────────────────────────────────────────────────────────
// Unit tests for the redesign trigger state machine.
// All tests use an injected fake clock so they run instantly.
//
// RUN:  npm test
// ─────────────────────────────────────────────────────────────────────

import { createTrigger } from "../friction/trigger.js";

// ── test constants ───────────────────────────────────────────────────

const THRESHOLD = 70;
const SUSTAIN_MS = 3000;
const COOLDOWN_MS = 60_000;
const HIGH_SCORE = 80; // above threshold
const LOW_SCORE = 30; // well below threshold

/** Create a trigger with deterministic options. */
function makeTrigger() {
  return createTrigger({
    threshold: THRESHOLD,
    sustainMs: SUSTAIN_MS,
    cooldownMs: COOLDOWN_MS,
    now: () => 0, // unused — we always pass ts explicitly
  });
}

// =====================================================================
//  Core state-machine transitions
// =====================================================================

describe("Trigger state machine", () => {
  test("score above threshold for LESS than sustainMs does NOT fire", () => {
    const trigger = makeTrigger();

    // Score goes high at t=0
    let result = trigger.update(HIGH_SCORE, "income", 0);
    expect(result.fire).toBe(false);

    // Still high at t=2999 (1 ms short of sustainMs)
    result = trigger.update(HIGH_SCORE, "income", 2999);
    expect(result.fire).toBe(false);
    expect(trigger._state()).toBe("RISING");
  });

  test("score above threshold for EXACTLY sustainMs fires ONCE", () => {
    const trigger = makeTrigger();

    trigger.update(HIGH_SCORE, "income", 0); // → RISING
    const result = trigger.update(HIGH_SCORE, "income", 3000); // → FIRE

    expect(result.fire).toBe(true);
    expect(result.friction).toEqual({ field: "income", score: HIGH_SCORE });
    expect(trigger._state()).toBe("COOLDOWN");
  });

  test("after firing, further high scores do NOT fire during cooldown", () => {
    const trigger = makeTrigger();

    // Fire at t=3000
    trigger.update(HIGH_SCORE, "income", 0);
    trigger.update(HIGH_SCORE, "income", 3000);

    // Scores stay high during cooldown → never fires again
    for (let t = 4000; t < 63_000; t += 1000) {
      const result = trigger.update(HIGH_SCORE, "income", t);
      expect(result.fire).toBe(false);
    }

    expect(trigger._state()).toBe("COOLDOWN");
  });

  test("after cooldown expires, a new sustained episode fires again", () => {
    const trigger = makeTrigger();

    // First fire at t=3000
    trigger.update(HIGH_SCORE, "income", 0);
    trigger.update(HIGH_SCORE, "income", 3000); // fire #1
    expect(trigger._state()).toBe("COOLDOWN");

    // Cooldown ends at t = 3000 + 60000 = 63000
    // New episode: score goes high at t=63000, sustained until t=66000
    trigger.update(HIGH_SCORE, "email", 63_000); // cooldown expires → IDLE → RISING
    const result = trigger.update(HIGH_SCORE, "email", 66_000); // → fire #2

    expect(result.fire).toBe(true);
    expect(result.friction).toEqual({ field: "email", score: HIGH_SCORE });
  });

  test("a dip below threshold resets the rising timer", () => {
    const trigger = makeTrigger();

    // Start rising at t=0
    trigger.update(HIGH_SCORE, "income", 0);
    expect(trigger._state()).toBe("RISING");

    // High at t=2000 — still rising
    trigger.update(HIGH_SCORE, "income", 2000);
    expect(trigger._state()).toBe("RISING");

    // Dip at t=2500 — user calmed down → IDLE
    trigger.update(LOW_SCORE, null, 2500);
    expect(trigger._state()).toBe("IDLE");

    // Score goes high again at t=5000 — timer restarts from scratch
    trigger.update(HIGH_SCORE, "income", 5000);
    expect(trigger._state()).toBe("RISING");

    // At t=7999 (2999 ms since t=5000) — not long enough
    let result = trigger.update(HIGH_SCORE, "income", 7999);
    expect(result.fire).toBe(false);

    // At t=8000 (3000 ms since t=5000) — fires
    result = trigger.update(HIGH_SCORE, "income", 8000);
    expect(result.fire).toBe(true);
  });
});

// =====================================================================
//  Edge cases
// =====================================================================

describe("Trigger edge cases", () => {
  test("score exactly at threshold counts as 'above'", () => {
    const trigger = makeTrigger();

    trigger.update(THRESHOLD, "f1", 0); // exactly 70
    expect(trigger._state()).toBe("RISING");

    const result = trigger.update(THRESHOLD, "f1", 3000);
    expect(result.fire).toBe(true);
  });

  test("score at threshold - 1 does not trigger RISING", () => {
    const trigger = makeTrigger();

    trigger.update(THRESHOLD - 1, "f1", 0); // 69
    expect(trigger._state()).toBe("IDLE");
  });

  test("hotField null is preserved in friction object", () => {
    const trigger = makeTrigger();

    trigger.update(HIGH_SCORE, null, 0);
    const result = trigger.update(HIGH_SCORE, null, 3000);

    expect(result.fire).toBe(true);
    expect(result.friction.field).toBeNull();
  });

  test("reset() brings trigger back to IDLE from any state", () => {
    const trigger = makeTrigger();

    // Push into RISING
    trigger.update(HIGH_SCORE, "f1", 0);
    expect(trigger._state()).toBe("RISING");

    trigger.reset();
    expect(trigger._state()).toBe("IDLE");

    // Push into COOLDOWN
    trigger.update(HIGH_SCORE, "f1", 100);
    trigger.update(HIGH_SCORE, "f1", 3100);
    expect(trigger._state()).toBe("COOLDOWN");

    trigger.reset();
    expect(trigger._state()).toBe("IDLE");
  });

  test("fire is true on exactly ONE call, never twice per episode", () => {
    const trigger = makeTrigger();
    let fireCount = 0;

    // Run 100 updates at high score, spanning well past sustainMs
    for (let t = 0; t <= 10_000; t += 100) {
      const result = trigger.update(HIGH_SCORE, "f1", t);
      if (result.fire) fireCount++;
    }

    expect(fireCount).toBe(1);
  });
});

// =====================================================================
//  isRising — pre-warm hint
// =====================================================================

describe("isRising", () => {
  test("returns true when score >= 80% of threshold", () => {
    const trigger = makeTrigger();

    // 80% of 70 = 56
    expect(trigger.isRising(56)).toBe(true);
    expect(trigger.isRising(70)).toBe(true);
    expect(trigger.isRising(100)).toBe(true);
  });

  test("returns false when score < 80% of threshold", () => {
    const trigger = makeTrigger();

    expect(trigger.isRising(55)).toBe(false);
    expect(trigger.isRising(0)).toBe(false);
  });
});
