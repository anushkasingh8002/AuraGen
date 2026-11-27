// server/friction/score.js
// ─────────────────────────────────────────────────────────────────────
// Cognitive Load Score (CLS) – 0 to 100.
//
// The score blends four independent signals that each capture a
// different facet of user frustration:
//
//   V – velocity variance    (erratic mouse → confusion)
//   H – hesitation           (long idle in a focused field → stuck)
//   R – rage clicks          (rapid re-clicking → anger)
//   E – error ratio          (inert clicks + validation errors → lost)
//
// Each part is normalised to [0, 1] before weighting so the tuning
// knobs are easy to reason about.  After recording a few real sessions
// (calm vs. confused), adjust the normalisers and weights in CONSTANTS.
// ─────────────────────────────────────────────────────────────────────

/**
 * Tuning knobs.  Exported so tests (and later a calibration script)
 * can read or temporarily override them.
 *
 *   weights      – how much each signal contributes to the final score
 *   normalisers  – the value at which each signal saturates (= 1.0)
 *
 * HOW TO CALIBRATE (see detailed guide at the bottom of this file):
 *   1. Record 3–5 calm sessions and 3–5 confused sessions.
 *   2. For each, log the raw parts {V,H,R,E} before clamping.
 *   3. Set each normaliser to the ~p90 value across confused sessions
 *      so that "clearly confused" reads ≈ 1.0 and calm reads ≈ 0.
 *   4. Adjust weights so calm sessions cluster under 25 and confused
 *      sessions cluster above 70.
 */
export const CONSTANTS = Object.freeze({
  weights: Object.freeze({ V: 0.25, H: 0.30, R: 0.25, E: 0.20 }),
  normalisers: Object.freeze({
    speedStddev: 2.0,   // px/ms stddev that "saturates" the V signal
    maxIdle: 15,         // seconds of idle that saturate the H signal
    rageClicks: 3,       // rage clicks that saturate the R signal
  }),
});

// ── pure helpers ─────────────────────────────────────────────────────

/** Clamp a number to [0, 1]. NaN becomes 0 for safety. */
function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Population standard deviation.  Returns 0 for empty / single-element arrays. */
function stddev(arr) {
  if (arr.length < 2) return 0;

  const mean = arr.reduce((sum, v) => sum + v, 0) / arr.length;
  const sqSum = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0);
  return Math.sqrt(sqSum / arr.length);
}

// ── main function ────────────────────────────────────────────────────

/**
 * Compute the Cognitive Load Score from a window snapshot.
 *
 * @param {{
 *   speeds: number[],
 *   clicks: number,
 *   rageClicks: number,
 *   inertClicks: number,
 *   errors: number,
 *   maxIdleSeconds: number
 * }} metrics – output of sessionWindow.snapshot()
 *
 * @returns {{ score: number, parts: { V: number, H: number, R: number, E: number } }}
 */
export function computeCLS(metrics) {
  const { weights: w, normalisers: n } = CONSTANTS;

  // V – velocity variance: high stddev of mouse speed → confusion
  const V = clamp01(stddev(metrics.speeds) / n.speedStddev);

  // H – hesitation: long idle in a focused field → stuck
  const H = clamp01(metrics.maxIdleSeconds / n.maxIdle);

  // R – rage clicks: repeated angry clicking → frustration
  const R = clamp01(metrics.rageClicks / n.rageClicks);

  // E – error ratio: what fraction of clicks were inert or produced errors
  const E = clamp01(
    metrics.clicks > 0
      ? (metrics.inertClicks + metrics.errors) / Math.max(metrics.clicks, 1)
      : 0,
  );

  const score = Math.round(100 * (w.V * V + w.H * H + w.R * R + w.E * E));

  return { score, parts: { V, H, R, E } };
}

// Also export helpers so they can be unit-tested independently.
export { clamp01, stddev };

// ─────────────────────────────────────────────────────────────────────
// CALIBRATION GUIDE
// ─────────────────────────────────────────────────────────────────────
//
// 1. RECORD SESSIONS
//    Add a one-liner to the telemetry:batch handler that writes the raw
//    parts object to a JSONL file:
//      fs.appendFileSync("calibration.jsonl", JSON.stringify(parts)+"\n")
//    Run 3-5 sessions where you calmly fill the form, and 3-5 where you
//    deliberately act confused (jitter the mouse, pause, rage-click,
//    trigger validation errors).
//
// 2. FIND NORMALISERS
//    Load calibration.jsonl.  For each part (V_raw, H_raw, R_raw):
//      – Take the 90th percentile across confused sessions.
//      – That value becomes the normaliser (the point at which the
//        signal saturates at 1.0).
//    For E, the ratio is already 0-1 so no normaliser is needed.
//
// 3. FIND WEIGHTS
//    With the new normalisers, replay both session sets and compute
//    scores.  If calm sessions are not all under 25, reduce the weight
//    of the part that is pulling them up.  If confused sessions are not
//    all above 70, increase the weight of the part that is too low.
//    The four weights must sum to 1.0.
//
// 4. VALIDATE
//    Re-run the Jest tests after changing CONSTANTS.  The calm/confused
//    test thresholds should still hold (adjust them if your new values
//    intentionally shift the bands).
// ─────────────────────────────────────────────────────────────────────

