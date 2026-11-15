// server/friction/sessionWindow.js
// ─────────────────────────────────────────────────────────────────────
// Fixed-span sliding window over raw telemetry events.
//
// WHY a window instead of running totals?
//   A running average forgets recency: a user who was confused 2 min ago
//   but is now calm would still show a high score.  A 10 s window tracks
//   the *current* emotional state and lets the score drop as soon as the
//   frustration stops.
//
// The window stores raw events and derives metrics lazily in snapshot()
// so each handler only calls add() on the hot path.
// ─────────────────────────────────────────────────────────────────────

/**
 * Create a sliding window that keeps events within `spanMs` milliseconds.
 *
 * @param {number} [spanMs=10000] – window width in ms (default 10 s)
 * @returns {{ add(events: object[]): void, snapshot(now: number): object }}
 */
export function createWindow(spanMs = 10_000) {
  /** @type {object[]} sorted by ascending `t` */
  let events = [];

  // ── add ──────────────────────────────────────────────────────────

  /**
   * Push new telemetry events into the window.
   * Events with a non-numeric or negative `t` are silently dropped.
   */
  function add(batch) {
    if (!Array.isArray(batch)) return;

    for (const evt of batch) {
      // Guard: every event must carry a valid timestamp.
      if (typeof evt.t !== "number" || !Number.isFinite(evt.t) || evt.t < 0) {
        continue;
      }
      events.push(evt);
    }

    // Keep chronological order so snapshot() can reason about sequences.
    events.sort((a, b) => a.t - b.t);
  }

  // ── snapshot ─────────────────────────────────────────────────────

  /**
   * Prune stale events then derive aggregate metrics for the current
   * window contents.
   *
   * @param {number} now – reference timestamp (usually Date.now())
   * @returns {{
   *   speeds: number[],
   *   clicks: number,
   *   rageClicks: number,
   *   inertClicks: number,
   *   errors: number,
   *   maxIdleSeconds: number,
   *   hotField: string|null
   * }}
   */
  function snapshot(now) {
    // ── prune ────────────────────────────────────────────────────
    const cutoff = now - spanMs;
    events = events.filter((e) => e.t >= cutoff);

    // ── accumulators ─────────────────────────────────────────────
    const speeds = [];
    let clicks = 0;
    let rageClicks = 0;
    let inertClicks = 0;
    let errors = 0;

    // Per-field weight map for hotField calculation.
    // Weights: rage click = 3, error = 2, inert click = 2, idle = 1 per 5 s
    /** @type {Map<string, number>} */
    const fieldWeights = new Map();

    // ── focus / idle tracking ────────────────────────────────────
    // We walk through events chronologically and track focus sessions.
    // A "focus session" runs from a focus event to the next blur (or to
    // `now` if still focused).  Within it we record input timestamps to
    // find the longest gap without typing – that's idle time.

    /** @type {{ field: string, focusAt: number, inputs: number[] } | null} */
    let currentFocus = null;

    // Collected completed focus sessions (used for idle calculation).
    /** @type {{ field: string, focusAt: number, blurAt: number, inputs: number[] }[]} */
    const focusSessions = [];

    // ── walk events ──────────────────────────────────────────────

    for (const evt of events) {
      switch (evt.k) {
        // -- mouse movement speed sample --
        case "move":
          if (typeof evt.v === "number" && Number.isFinite(evt.v) && evt.v >= 0) {
            speeds.push(evt.v);
          }
          break;

        // -- click (may carry rage / inert flags) --
        case "click":
          clicks++;
          if (evt.rage) {
            rageClicks++;
            if (evt.f) addWeight(fieldWeights, evt.f, 3);
          }
          if (evt.inert) {
            inertClicks++;
            if (evt.f) addWeight(fieldWeights, evt.f, 2);
          }
          break;

        // -- validation error shown --
        case "error":
          errors++;
          if (evt.f) addWeight(fieldWeights, evt.f, 2);
          break;

        // -- field focus / blur / input (for idle computation) --
        case "focus":
          // If we were already tracking a focus (missing blur), close it.
          if (currentFocus) {
            focusSessions.push({ ...currentFocus, blurAt: evt.t });
          }
          currentFocus = { field: evt.f, focusAt: evt.t, inputs: [] };
          break;

        case "blur":
          if (currentFocus) {
            focusSessions.push({ ...currentFocus, blurAt: evt.t });
            currentFocus = null;
          }
          break;

        case "input":
          if (currentFocus) {
            currentFocus.inputs.push(evt.t);
          }
          break;

        // Unknown event kinds are silently ignored (forward-compat).
        default:
          break;
      }
    }

    // If a field is still focused at snapshot time, treat `now` as blur.
    if (currentFocus) {
      focusSessions.push({ ...currentFocus, blurAt: now });
    }

    // ── compute idle metrics ─────────────────────────────────────
    // For each focus session, build a timeline [focusAt, …inputs, blurAt]
    // and find the longest gap (= idle stretch without typing).

    let maxIdleMs = 0;

    // Per-field: track the largest idle gap seen so far.
    /** @type {Map<string, number>} */
    const fieldMaxIdleMs = new Map();

    for (const sess of focusSessions) {
      const timeline = [sess.focusAt, ...sess.inputs, sess.blurAt];
      let sessionMaxGap = 0;

      for (let i = 1; i < timeline.length; i++) {
        const gap = timeline[i] - timeline[i - 1];
        if (gap > sessionMaxGap) sessionMaxGap = gap;
      }

      if (sessionMaxGap > maxIdleMs) maxIdleMs = sessionMaxGap;

      // Track per-field max idle for hotField weight.
      if (sess.field) {
        const prev = fieldMaxIdleMs.get(sess.field) || 0;
        if (sessionMaxGap > prev) fieldMaxIdleMs.set(sess.field, sessionMaxGap);
      }
    }

    // Apply idle weights: 1 point per 5 seconds of max idle per field.
    for (const [field, idleMs] of fieldMaxIdleMs) {
      const idleWeight = Math.floor(idleMs / 1000 / 5);
      if (idleWeight > 0) addWeight(fieldWeights, field, idleWeight);
    }

    // ── determine hotField ───────────────────────────────────────
    let hotField = null;
    let highestWeight = 0;

    for (const [field, weight] of fieldWeights) {
      if (weight > highestWeight) {
        highestWeight = weight;
        hotField = field;
      }
    }

    return {
      speeds,
      clicks,
      rageClicks,
      inertClicks,
      errors,
      maxIdleSeconds: maxIdleMs / 1000,
      hotField,
    };
  }

  return { add, snapshot };
}

// ── helpers ──────────────────────────────────────────────────────────

/** Increment a field's weight in the map. */
function addWeight(map, field, delta) {
  map.set(field, (map.get(field) || 0) + delta);
}

