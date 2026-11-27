// server/safety/breaker.js
// ─────────────────────────────────────────────────────────────────────
// Circuit breaker protecting upstream LLM calls (OpenAI / LangChain).
//
// STATES
//   CLOSED    – normal operation; consecutive failures counted.
//   OPEN      – tripped after `failureThreshold` consecutive failures;
//               fails fast with CircuitOpenError for `resetTimeoutMs`.
//   HALF_OPEN – after `resetTimeoutMs`, allows ONE trial call.
//               Success closes circuit; failure re-opens immediately.
// ─────────────────────────────────────────────────────────────────────

import { CircuitOpenError } from "./errors.js";

const State = Object.freeze({
  CLOSED: "CLOSED",
  OPEN: "OPEN",
  HALF_OPEN: "HALF_OPEN",
});

/**
 * Create a circuit breaker for LLM invocations.
 *
 * @param {object} [opts]
 * @param {number} [opts.failureThreshold=5]
 * @param {number} [opts.resetTimeoutMs=60000]
 * @param {() => number} [opts.now=Date.now]
 */
export function createCircuitBreaker({
  failureThreshold = 5,
  resetTimeoutMs = 60_000,
  now = Date.now,
} = {}) {
  let state = State.CLOSED;
  let consecutiveFailures = 0;
  let openedAt = 0;
  let halfOpenInFlight = false;

  /**
   * Execute an async operation guarded by the circuit breaker.
   *
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async function execute(fn) {
    const ts = now();

    if (state === State.OPEN) {
      if (ts - openedAt >= resetTimeoutMs) {
        state = State.HALF_OPEN;
        halfOpenInFlight = false;
      } else {
        throw new CircuitOpenError();
      }
    }

    if (state === State.HALF_OPEN) {
      if (halfOpenInFlight) {
        throw new CircuitOpenError();
      }
      halfOpenInFlight = true;
    }

    try {
      const result = await fn();
      consecutiveFailures = 0;
      openedAt = 0;
      halfOpenInFlight = false;
      state = State.CLOSED;
      return result;
    } catch (err) {
      halfOpenInFlight = false;

      if (state === State.HALF_OPEN) {
        state = State.OPEN;
        openedAt = now();
      } else {
        consecutiveFailures++;
        if (consecutiveFailures >= failureThreshold) {
          state = State.OPEN;
          openedAt = now();
        }
      }

      throw err;
    }
  }

  function reset() {
    state = State.CLOSED;
    consecutiveFailures = 0;
    openedAt = 0;
    halfOpenInFlight = false;
  }

  function stats() {
    return {
      state,
      consecutiveFailures,
      openedAt,
    };
  }

  function _state() {
    if (state === State.OPEN && now() - openedAt >= resetTimeoutMs) {
      return State.HALF_OPEN;
    }
    return state;
  }

  return { execute, reset, stats, _state };
}

export const llmBreaker = createCircuitBreaker();
export default llmBreaker;
