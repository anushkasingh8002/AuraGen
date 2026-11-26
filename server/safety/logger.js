// server/safety/logger.js
// ─────────────────────────────────────────────────────────────────────
// Tiny structured JSON-lines logger with deep redaction + secret scrubbing.
// ─────────────────────────────────────────────────────────────────────

/** Keys that must never appear in log output (PII / secrets / raw code). */
const REDACTED_KEYS = new Set([
  "values",
  "value",
  "text",
  "code",
  "apiKey",
  "openaiApiKey",
  "authorization",
]);

const OPENAI_KEY_RE = /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{10,}\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi;

function scrubString(str) {
  return str
    .replace(OPENAI_KEY_RE, "[redacted-key]")
    .replace(BEARER_RE, "Bearer [redacted]");
}

/**
 * Deep-clone `obj`, replace sensitive keys with "[redacted]", and scrub
 * secret token patterns inside string fields (e.g. error messages).
 */
function redact(obj) {
  if (typeof obj === "string") return scrubString(obj);
  if (obj === null || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) return obj.map(redact);

  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    if (REDACTED_KEYS.has(key)) {
      clean[key] = "[redacted]";
    } else if (typeof val === "string") {
      clean[key] = scrubString(val);
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
 * @param {string}                event
 * @param {object}                [data]
 */
function emit(level, event, data = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    ...redact(data),
  };

  const stream = level === "error" || level === "warn" ? "stderr" : "stdout";
  process[stream].write(JSON.stringify(line) + "\n");
}

const log = {
  info: (event, data) => emit("info", event, data),
  warn: (event, data) => emit("warn", event, data),
  error: (event, data) => emit("error", event, data),
};

export default log;
export { redact };
