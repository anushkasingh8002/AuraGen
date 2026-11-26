// server/agent/mask.js
// ─────────────────────────────────────────────────────────────────────
// Sensitive form field masking & LLM value minimization.
//
// WHY mask before sending to the LLM?
//   The LLM needs field metadata and presence signals to preserve user
//   input via props ({ initialValues }), NEVER actual raw user input.
//   Masking sensitive values (PAN, Aadhaar, SSN, card, OTP) and reducing
//   non-sensitive inputs to presence indicators prevents PII leakage AND
//   blocks prompt-injection payloads hidden inside user-typed inputs.
// ─────────────────────────────────────────────────────────────────────

/**
 * Substrings that identify a field ID as containing sensitive data.
 * Checked case-insensitively.
 */
const SENSITIVE_ID_PATTERNS = [
  "pan",
  "aadhaar",
  "ssn",
  "account",
  "ifsc",
  "card",
  "cvv",
  "password",
  "otp",
  "passport",
  "license",
  "iban",
  "swift",
  "routing",
  "tin",
  "ein",
  "pin",
  "secret",
  "token",
];

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_MASK_DEPTH = 5;

/**
 * Check if a field is sensitive either by its ID name or by schema annotation.
 *
 * @param {string} fieldId
 * @param {object|null} schema
 * @returns {boolean}
 */
export function isFieldSensitive(fieldId, schema) {
  if (!fieldId || typeof fieldId !== "string") return false;

  const normalized = fieldId.toLowerCase();

  if (SENSITIVE_ID_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return true;
  }

  if (schema && typeof schema === "object") {
    if (Array.isArray(schema.fields)) {
      const fieldDef = schema.fields.find(
        (f) => f && (f.id === fieldId || f.name === fieldId)
      );
      if (fieldDef?.sensitive === true) {
        return true;
      }
    } else if (schema.properties && typeof schema.properties === "object") {
      const prop = schema.properties[fieldId];
      if (prop?.sensitive === true) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Masks sensitive fields in a values object while cloning safely
 * (prevents prototype pollution and bounds array/object depth).
 *
 * @param {object|null} schema – the form schema describing fields
 * @param {object|null} values – current user-entered values
 * @param {number} [depth=0]
 * @returns {Record<string, any>}
 */
export function maskValues(schema, values, depth = 0) {
  if (!values || typeof values !== "object" || depth > MAX_MASK_DEPTH) {
    return {};
  }

  if (Array.isArray(values)) {
    return values.slice(0, 50).map((item) =>
      item && typeof item === "object" ? maskValues(schema, item, depth + 1) : item
    );
  }

  const result = {};

  for (const [key, val] of Object.entries(values)) {
    if (FORBIDDEN_KEYS.has(key)) continue;

    if (isFieldSensitive(key, schema)) {
      result[key] =
        val !== undefined && val !== null && val !== "" ? "[MASKED]" : val;
    } else if (val !== null && typeof val === "object") {
      result[key] = maskValues(schema, val, depth + 1);
    } else {
      result[key] = val;
    }
  }

  return result;
}

/**
 * Reduce ALL form values to inert presence indicators before sending to the LLM.
 * Prevents BOTH non-sensitive PII leaks (names, emails, incomes, DOBs) AND
 * prompt-injection attacks placed inside user-typed input strings.
 *
 * @param {object|null} schema
 * @param {object|null} values
 * @param {number} [depth=0]
 * @returns {Record<string, any>}
 */
export function summarizeValuesForLlm(schema, values, depth = 0) {
  if (!values || typeof values !== "object" || depth > MAX_MASK_DEPTH) {
    return {};
  }

  if (Array.isArray(values)) {
    return `[ARRAY:${Math.min(values.length, 50)}]`;
  }

  const summary = {};
  let count = 0;

  for (const [key, val] of Object.entries(values)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (++count > 50) break;

    if (val === undefined || val === null || val === "") {
      summary[key] = "";
    } else if (isFieldSensitive(key, schema)) {
      summary[key] = "[MASKED]";
    } else if (typeof val === "object" && !Array.isArray(val)) {
      summary[key] = summarizeValuesForLlm(schema, val, depth + 1);
    } else {
      summary[key] = "[PRESENT]";
    }
  }

  return summary;
}
