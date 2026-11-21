// server/agent/mask.js
// ─────────────────────────────────────────────────────────────────────
// Sensitive form field masking.
//
// WHY mask before sending to the LLM?
//   The LLM needs the form schema, field names, and whether data exists
//   in order to preserve user input and pre-fill the wizard state.
//   However, actual sensitive financial & personal data (PAN, SSN, OTP,
//   card numbers) must NEVER leave our backend to third-party APIs.
//
// Masking replaces these values with "[MASKED]" while preserving the keys.
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
];

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

  // 1. Check ID name patterns
  if (SENSITIVE_ID_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return true;
  }

  // 2. Check schema declaration (e.g., schema.fields array or map)
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
 * Masks sensitive values from a form values object.
 *
 * @param {object|null} schema – the form schema describing fields
 * @param {object|null} values – current user-entered values
 * @returns {Record<string, any>} a new object with sensitive fields replaced by "[MASKED]"
 */
export function maskValues(schema, values) {
  if (!values || typeof values !== "object") {
    return {};
  }

  const result = {};

  for (const [key, val] of Object.entries(values)) {
    if (isFieldSensitive(key, schema)) {
      // Replace with mask indicator if value is non-empty
      result[key] = val !== undefined && val !== null && val !== "" ? "[MASKED]" : val;
    } else if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      // Recursively mask nested objects
      result[key] = maskValues(schema, val);
    } else {
      result[key] = val;
    }
  }

  return result;
}
