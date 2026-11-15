// server/safety/logger.js
// ─────────────────────────────────────────────────────────────────────
// Tiny structured JSON-lines logger.
//
// WHY a custom logger instead of Winston / Pino?
//   – Zero deps keeps the boot fast and the bundle small.
//   – We need a hard redaction rule: form values must NEVER appear in
//     logs, even by accident.  A purpose-built logger makes that a
//     guarantee rather than a "please remember to scrub" convention.
//
// REDACTION
//   Any key in REDACTED_KEYS is replaced with "[redacted]" before the
//   line is printed.  This runs recursively so nested objects are safe.
// ─────────────────────────────────────────────────────────────────────

/** Keys that must never appear in log output (PII / secrets). */
const REDACTED_KEYS = new Set(["values", "value", "text", "code", "apiKey"]);

/**
 * Deep-clone `obj` and replace every value whose key is in REDACTED_KEYS.
 * Returns a new object — the original is never mutated.
 */
function redact(obj) {
  if (obj === null || typeof obj !== "object") return obj;

  // Arrays → redact each element (an event batch could be an array)
  if (Array.isArray(obj)) return obj.map(redact);

  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    if (REDACTED_KEYS.has(key)) {
      clean[key] = "[redacted]";
    } else if (val !== null && typeof val === "object") {
      clean[key] = redact(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

/**
 * Build a log line object and print it as a single JSON string.
 *
 * @param {"info"|"warn"|"error"} level
 * @param {string}                event   – machine-readable event name
 * @param {object}                [data]  – arbitrary context (will be redacted)
 */
function emit(level, event, data = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    ...redact(data),
  };

  // Use stderr for warnings/errors so stdout stays clean for piping.
  const stream = level === "error" || level === "warn" ? "stderr" : "stdout";
  process[stream].write(JSON.stringify(line) + "\n");
}

// ── public API ───────────────────────────────────────────────────────

const log = {
  info: (event, data) => emit("info", event, data),
  warn: (event, data) => emit("warn", event, data),
  error: (event, data) => emit("error", event, data),
};

export default log;

// Also export redact so we can unit-test it independently.
export { redact };

