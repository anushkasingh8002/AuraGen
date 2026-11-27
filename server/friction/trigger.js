// server/friction/trigger.js
// ─────────────────────────────────────────────────────────────────────
// Sustained-threshold trigger with cooldown.
//
// WHY a state machine instead of a simple "if score > X, fire"?
//   – A momentary spike (user accidentally dragged the mouse) should NOT
//     trigger an expensive LLM redesign.  We only act when frustration
//     is *sustained* for `sustainMs` milliseconds.
//   – After firing, we enforce a cooldown so the user has time to
//     interact with the new UI before we consider firing again.
//   – The state machine makes these guarantees explicit and testable
//     with an injected fake clock.
//
// STATES
//   IDLE     → score is below threshold, nothing to do.
//   RISING   → score crossed the threshold; waiting to see if it stays.
//   COOLDOWN → we just fired; ignore everything for `cooldownMs`.
//
// TRANSITIONS
//   IDLE → RISING     : score >= threshold
//   RISING → IDLE     : score drops below threshold (user calmed down)
//   RISING → COOLDOWN : score stayed >= threshold for sustainMs → FIRE
//   COOLDOWN → IDLE   : cooldownMs elapsed since last fire
// ─────────────────────────────────────────────────────────────────────

/** @enum {string} */
const State = Object.freeze({
  IDLE: "IDLE",
  RISING: "RISING",
  COOLDOWN: "COOLDOWN",
});

/**
 * Create a redesign trigger.
 *
 * @param {object} opts
 * @param {number} opts.threshold   – CLS score that starts the timer
 * @param {number} opts.sustainMs   – how long the score must stay high
 * @param {number} opts.cooldownMs  – minimum gap between two fires
 * @param {() => number} [opts.now] – clock function (default Date.now),
 *                                     injectable for tests
 * @returns {{
 *   update(score: number, hotField: string|null, ts?: number):
 *     { fire: boolean, friction: null | { field: string|null, score: number } },
 *   reset(): void,
 *   isRising(score: number): boolean,
 *   _state(): string
 * }}
 */
export function createTrigger({ threshold, sustainMs, cooldownMs, now = Date.now }) {
  let state = State.IDLE;
  let risingStart = 0; // timestamp when we entered RISING
  let cooldownStart = 0; // timestamp when we entered COOLDOWN

  /**
   * Feed a new score into the trigger.
   *
   * @param {number} score    – current CLS score (0-100)
   * @param {string|null} hotField – most-frustrated field, if any
   * @param {number} [ts]     – current time (defaults to now())
   * @returns {{ fire: boolean, friction: null | { field: string|null, score: number } }}
   */
  function update(score, hotField, ts = now()) {
    // ── COOLDOWN: ignore everything until the timer expires ──────
    if (state === State.COOLDOWN) {
      if (ts - cooldownStart >= cooldownMs) {
        // Cooldown over → return to IDLE and fall through to
        // process this update normally.
        state = State.IDLE;
      } else {
        return { fire: false, friction: null };
      }
    }

    // ── IDLE: watch for scores crossing the threshold ────────────
    if (state === State.IDLE) {
      if (score >= threshold) {
        state = State.RISING;
        risingStart = ts;
      }
      // Even if we just entered RISING, we still need sustainMs
      // of continuous high scores before firing.
      return { fire: false, friction: null };
    }

    // ── RISING: waiting for sustained frustration ────────────────
    if (state === State.RISING) {
      // User calmed down → abort.
      if (score < threshold) {
        state = State.IDLE;
        return { fire: false, friction: null };
      }

      // Still high — has enough time passed?
      if (ts - risingStart >= sustainMs) {
        // 🔥 FIRE — exactly once for this episode.
        state = State.COOLDOWN;
        cooldownStart = ts;
        return {
          fire: true,
          friction: { field: hotField ?? null, score },
        };
      }

      // Not long enough yet — keep waiting.
      return { fire: false, friction: null };
    }

    // Should never reach here, but be safe.
    return { fire: false, friction: null };
  }

  /**
   * Force the trigger back to IDLE.
   * Useful when a session ends or when a redesign is aborted.
   */
  function reset() {
    state = State.IDLE;
    risingStart = 0;
    cooldownStart = 0;
  }

  /**
   * Check whether a score is "rising" — close enough to the threshold
   * that the pipeline could start pre-warming (e.g. speculatively
   * fetching the DOM snapshot before the trigger actually fires).
   *
   * @param {number} score – current CLS score
   * @returns {boolean}
   */
  function isRising(score) {
    return score >= 0.8 * threshold;
  }

  /**
   * Expose internal state for testing / debugging only.
   * @returns {string}
   */
  function _state() {
    return state;
  }

  return { update, reset, isRising, _state };
}
