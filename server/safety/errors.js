// server/safety/errors.js
// ─────────────────────────────────────────────────────────────────────
// Custom application error classes and reason mapping.
//
// WHY custom errors instead of generic Error?
//   – Explicit instanceof checks in handlers and pipeline stages.
//   – Consistent error names and metadata across the system.
//   – Clean propagation without losing failure causes.
// ─────────────────────────────────────────────────────────────────────

/**
 * Thrown when the browser does not respond to snapshot:request
 * within the allowed time limit.
 */
export class SnapshotTimeoutError extends Error {
  /**
   * @param {string} requestId – the ID of the timed-out request
   * @param {number} timeoutMs – the duration waited in milliseconds
   */
  constructor(requestId, timeoutMs) {
    super(`DOM snapshot request '${requestId}' timed out after ${timeoutMs}ms`);
    this.name = "SnapshotTimeoutError";
    this.requestId = requestId;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when LLM code generation fails or times out.
 */
export class CodeGenError extends Error {
  /**
   * @param {string} message
   * @param {object} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = "CodeGenError";
    this.details = details;
  }
}

/**
 * Thrown when the LLM call times out.
 */
export class LlmTimeoutError extends Error {
  /**
   * @param {number} timeoutMs
   */
  constructor(timeoutMs) {
    super(`LLM call timed out after ${timeoutMs}ms`);
    this.name = "LlmTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when the LLM API returns an error or status failure.
 */
export class LlmApiError extends Error {
  /**
   * @param {string} message
   * @param {object} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = "LlmApiError";
    this.details = details;
  }
}

/**
 * Thrown when generated code fails AST validation after retry.
 */
export class ValidationError extends Error {
  /**
   * @param {string} message
   * @param {string[]} [errors]
   */
  constructor(message, errors = []) {
    super(message);
    this.name = "ValidationError";
    this.errors = errors;
  }
}

/**
 * Thrown when Babel compilation of a validated AST fails.
 */
export class CompileError extends Error {
  /**
   * @param {string} message
   * @param {string[]} [errors]
   */
  constructor(message, errors = []) {
    super(message);
    this.name = "CompileError";
    this.errors = errors;
  }
}

/**
 * Thrown when session or global redesign rate limits are exceeded.
 */
export class RateLimitError extends Error {
  /**
   * @param {string} message
   * @param {"session"|"global"} [scope]
   */
  constructor(message, scope = "session") {
    super(message);
    this.name = "RateLimitError";
    this.scope = scope;
  }
}

/**
 * Thrown when the circuit breaker is open (consecutive LLM failures).
 */
export class CircuitOpenError extends Error {
  /**
   * @param {string} [message]
   */
  constructor(message = "Circuit breaker open: LLM service temporarily unavailable") {
    super(message);
    this.name = "CircuitOpenError";
  }
}

/**
 * Map an error to a standard client reason code.
 *
 * @param {Error|any} err
 * @returns {string}
 */
export function toReason(err) {
  if (!err) return "error";

  if (err instanceof SnapshotTimeoutError || err.name === "SnapshotTimeoutError") {
    return "snapshot_timeout";
  }
  if (err instanceof LlmTimeoutError || err.name === "LlmTimeoutError") {
    return "timeout";
  }
  if (err instanceof LlmApiError || err.name === "LlmApiError" || err instanceof CodeGenError || err.name === "CodeGenError") {
    return "llm_error";
  }
  if (err instanceof ValidationError || err.name === "ValidationError") {
    return "invalid";
  }
  if (err instanceof CompileError || err.name === "CompileError") {
    return "compile_error";
  }
  if (err instanceof RateLimitError || err.name === "RateLimitError") {
    return "rate_limited";
  }
  if (err instanceof CircuitOpenError || err.name === "CircuitOpenError") {
    return "unavailable";
  }

  return "error";
}
