// server/tests/errors.test.js
// ─────────────────────────────────────────────────────────────────────
// Unit tests for server/safety/errors.js and toReason mapping.
// ─────────────────────────────────────────────────────────────────────

import {
  SnapshotTimeoutError,
  CodeGenError,
  LlmTimeoutError,
  LlmApiError,
  ValidationError,
  CompileError,
  RateLimitError,
  CircuitOpenError,
  toReason,
} from "../safety/errors.js";

describe("Safety Errors and Reason Mapping", () => {
  test("SnapshotTimeoutError maps to snapshot_timeout", () => {
    const err = new SnapshotTimeoutError("req-123", 2000);
    expect(err.name).toBe("SnapshotTimeoutError");
    expect(err.requestId).toBe("req-123");
    expect(err.timeoutMs).toBe(2000);
    expect(toReason(err)).toBe("snapshot_timeout");
  });

  test("LlmTimeoutError maps to timeout", () => {
    const err = new LlmTimeoutError(8000);
    expect(err.name).toBe("LlmTimeoutError");
    expect(err.timeoutMs).toBe(8000);
    expect(toReason(err)).toBe("timeout");
  });

  test("LlmApiError and CodeGenError map to llm_error", () => {
    const err1 = new LlmApiError("API failure");
    const err2 = new CodeGenError("Generation error");
    expect(toReason(err1)).toBe("llm_error");
    expect(toReason(err2)).toBe("llm_error");
  });

  test("ValidationError maps to invalid", () => {
    const err = new ValidationError("AST check failed", ["Forbidden global"]);
    expect(err.errors).toEqual(["Forbidden global"]);
    expect(toReason(err)).toBe("invalid");
  });

  test("CompileError maps to compile_error", () => {
    const err = new CompileError("Babel transform failed", ["SyntaxError"]);
    expect(err.errors).toEqual(["SyntaxError"]);
    expect(toReason(err)).toBe("compile_error");
  });

  test("RateLimitError maps to rate_limited", () => {
    const err = new RateLimitError("Rate limit exceeded", "session");
    expect(err.scope).toBe("session");
    expect(toReason(err)).toBe("rate_limited");
  });

  test("CircuitOpenError maps to unavailable", () => {
    const err = new CircuitOpenError();
    expect(toReason(err)).toBe("unavailable");
  });

  test("Unknown or generic errors map to error", () => {
    expect(toReason(new Error("Something strange"))).toBe("error");
    expect(toReason(null)).toBe("error");
    expect(toReason(undefined)).toBe("error");
    expect(toReason("string_error")).toBe("error");
  });
});
