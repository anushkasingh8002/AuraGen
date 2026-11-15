// server/tests/score.test.js
// ─────────────────────────────────────────────────────────────────────
// Unit tests for the Cognitive Load Score engine.
//
// RUN:  npm test
// ─────────────────────────────────────────────────────────────────────

import { createWindow } from "../friction/sessionWindow.js";
import { computeCLS, stddev, clamp01, CONSTANTS } from "../friction/score.js";

// ── helper: build a batch of steady mouse-move events ────────────────

function steadyMoves(speed, count, startT = 0, interval = 100) {
  return Array.from({ length: count }, (_, i) => ({
    k: "move",
    v: speed,
    t: startT + i * interval,
  }));
}

// =====================================================================
//  score.js — pure function tests
// =====================================================================

describe("clamp01", () => {
  test("clamps values to [0, 1]", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(2)).toBe(1);
  });

  test("NaN / Infinity → 0", () => {
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(0);
    expect(clamp01(-Infinity)).toBe(0);
  });
});

describe("stddev", () => {
  test("empty or single-element → 0", () => {
    expect(stddev([])).toBe(0);
    expect(stddev([5])).toBe(0);
  });

  test("identical values → 0", () => {
    expect(stddev([3, 3, 3, 3])).toBe(0);
  });

  test("known result", () => {
    // [2, 4] → mean=3, variance=1, stddev=1
    expect(stddev([2, 4])).toBeCloseTo(1, 5);
  });
});

describe("computeCLS", () => {
  const emptyMetrics = {
    speeds: [],
    clicks: 0,
    rageClicks: 0,
    inertClicks: 0,
    errors: 0,
    maxIdleSeconds: 0,
    hotField: null,
  };

  test("all-zero metrics → score 0", () => {
    const { score, parts } = computeCLS(emptyMetrics);
    expect(score).toBe(0);
    expect(parts).toEqual({ V: 0, H: 0, R: 0, E: 0 });
  });

  test("max-everything metrics → score 100", () => {
    const { score } = computeCLS({
      // Speeds with huge stddev (> normaliser of 2.0)
      speeds: [0, 10, 0, 10, 0, 10],
      clicks: 5,
      rageClicks: 5,    // saturates R
      inertClicks: 5,   // with errors, saturates E
      errors: 5,
      maxIdleSeconds: 20, // saturates H
      hotField: "f1",
    });
    expect(score).toBe(100);
  });
});

// =====================================================================
//  sessionWindow.js — integration with score.js
// =====================================================================

describe("Calm session", () => {
  test("slow steady moves, no clicks → score < 30", () => {
    const win = createWindow(10_000);
    const now = 10_000;

    // 100 move events at a constant 0.5 px/ms → stddev = 0
    win.add(steadyMoves(0.5, 100, 0, 100));

    const metrics = win.snapshot(now);
    const { score } = computeCLS(metrics);

    expect(score).toBeLessThan(30);
  });
});

describe("Confused session", () => {
  test("jitter + rage clicks + long idle → score > 70", () => {
    const win = createWindow(10_000);
    const now = 10_000;

    // ── jittery mouse: alternating fast/slow speeds ──────────────
    const moves = Array.from({ length: 100 }, (_, i) => ({
      k: "move",
      v: i % 2 === 0 ? 5.0 : 0.1,
      t: i * 100,
    }));

    // ── 4 rage clicks ────────────────────────────────────────────
    const rageClicks = Array.from({ length: 4 }, (_, i) => ({
      k: "click",
      f: "income",
      rage: true,
      inert: false,
      t: 5000 + i * 80,
    }));

    // ── 10 s idle in a focused field (focus at 0, no input, no blur)
    const focusEvents = [{ k: "focus", f: "income", t: 0 }];

    // ── a validation error ───────────────────────────────────────
    const errorEvents = [{ k: "error", f: "income", t: 7000 }];

    win.add([...moves, ...rageClicks, ...focusEvents, ...errorEvents]);

    const metrics = win.snapshot(now);
    const { score, parts } = computeCLS(metrics);

    // Sanity-check the individual parts before the aggregate.
    expect(parts.V).toBeGreaterThan(0.5);   // high jitter
    expect(parts.H).toBeGreaterThan(0.5);   // long idle
    expect(parts.R).toBeGreaterThan(0.9);   // 4 rage / normaliser 3

    expect(score).toBeGreaterThan(70);
  });
});

describe("Window mechanics", () => {
  test("empty window → score 0", () => {
    const win = createWindow(10_000);
    const metrics = win.snapshot(Date.now());
    const { score } = computeCLS(metrics);
    expect(score).toBe(0);
  });

  test("old events are dropped after the window slides", () => {
    const win = createWindow(10_000);

    // Events at t = 1000
    win.add([
      { k: "click", f: "f1", rage: true, inert: false, t: 1000 },
      { k: "click", f: "f1", rage: true, inert: false, t: 1100 },
    ]);

    // Snapshot at t = 20_000 → events are 19 s old, outside 10 s window
    const metrics = win.snapshot(20_000);
    expect(metrics.clicks).toBe(0);
    expect(metrics.rageClicks).toBe(0);
  });

  test("events inside the window are kept", () => {
    const win = createWindow(10_000);

    win.add([
      { k: "click", f: "f1", rage: false, inert: true, t: 15_000 },
    ]);

    // Snapshot at t = 20_000 → event is 5 s old, inside 10 s window
    const metrics = win.snapshot(20_000);
    expect(metrics.clicks).toBe(1);
    expect(metrics.inertClicks).toBe(1);
  });
});

describe("Robustness", () => {
  test("NaN, negative, and undefined values do not crash", () => {
    const win = createWindow(10_000);
    const now = 10_000;

    win.add([
      { k: "move", v: NaN, t: 5000 },
      { k: "move", v: -1, t: 5001 },
      { k: "move", v: undefined, t: 5002 },
      { k: "move", v: Infinity, t: 5003 },
      { k: "click", f: null, rage: false, inert: false, t: 5004 },
      { k: "focus", f: null, t: 5005 },
    ]);

    // Must not throw.
    const metrics = win.snapshot(now);
    const { score } = computeCLS(metrics);

    expect(typeof score).toBe("number");
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test("invalid timestamps are rejected", () => {
    const win = createWindow(10_000);

    win.add([
      { k: "move", v: 1, t: -100 },
      { k: "move", v: 1, t: NaN },
      { k: "move", v: 1, t: "nope" },
      { k: "move", v: 1, t: undefined },
    ]);

    const metrics = win.snapshot(10_000);
    expect(metrics.speeds).toHaveLength(0);
  });
});

describe("hotField", () => {
  test("field with most combined weight is returned", () => {
    const win = createWindow(10_000);
    const now = 10_000;

    win.add([
      // "income" gets: rage(3) + error(2) = 5
      { k: "click", f: "income", rage: true, inert: false, t: 5000 },
      { k: "error", f: "income", t: 5100 },
      // "name" gets: inert(2) only
      { k: "click", f: "name", rage: false, inert: true, t: 5200 },
    ]);

    const metrics = win.snapshot(now);
    expect(metrics.hotField).toBe("income");
  });

  test("null when no field data exists", () => {
    const win = createWindow(10_000);
    win.add(steadyMoves(1, 10, 5000, 100));
    const metrics = win.snapshot(10_000);
    expect(metrics.hotField).toBeNull();
  });
});

describe("maxIdleSeconds", () => {
  test("focus with no input until now → full duration as idle", () => {
    const win = createWindow(10_000);

    win.add([{ k: "focus", f: "email", t: 2000 }]);

    // No input, no blur → idle from t=2000 to now=10000 → 8 s
    const metrics = win.snapshot(10_000);
    expect(metrics.maxIdleSeconds).toBe(8);
  });

  test("focus with inputs → longest gap is reported", () => {
    const win = createWindow(10_000);

    win.add([
      { k: "focus", f: "email", t: 1000 },
      { k: "input", f: "email", t: 2000 }, // gap: 1 s
      { k: "input", f: "email", t: 2200 }, // gap: 0.2 s
      // gap from 2200 to blur at 8000 → 5.8 s (longest)
      { k: "blur", f: "email", t: 8000 },
    ]);

    const metrics = win.snapshot(10_000);
    expect(metrics.maxIdleSeconds).toBeCloseTo(5.8);
  });
});

