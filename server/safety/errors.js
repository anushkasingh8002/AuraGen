// server/safety/errors.js
// ─────────────────────────────────────────────────────────────────────
// Custom application error classes.
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
