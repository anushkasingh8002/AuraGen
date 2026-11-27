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
  "ifsc",
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

function hasSensitiveIdentifier(value) {
  if (typeof value !== "string") return false;
  const normalized = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  const accountIndex = tokens.indexOf("account");
  const cardIndex = tokens.indexOf("card");
  const accountSuffixes = new Set(["number", "no", "id", "identifier"]);
  const cardSuffixes = new Set([
    "number",
    "no",
    "cvv",
    "cvc",
    "pin",
    "security",
    "verification",
  ]);

  return (
    tokens.some((token) => SENSITIVE_ID_PATTERNS.includes(token)) ||
    normalized.replace(/[^a-z0-9]/g, "").includes("socialsecurity") ||
    (accountIndex >= 0 &&
      (!tokens[accountIndex + 1] ||
        accountSuffixes.has(tokens[accountIndex + 1]))) ||
    (cardIndex >= 0 &&
      (!tokens[cardIndex + 1] || cardSuffixes.has(tokens[cardIndex + 1])))
  );
}

/**
 * Remove sensitive fields from the schema before it is sent to generation.
 * The schema is untrusted client input, so field IDs are also checked even
 * when the client omitted its `sensitive` annotation.
 *
 * @param {object|null} schema
 * @returns {object}
 */
export function sanitizeSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return {};
  }

  const isSafeField = (field) =>
    field &&
    typeof field === "object" &&
    typeof field.id === "string" &&
    !isFieldSensitive(field.id, { fields: [field] });

  const safeSections = Array.isArray(schema.sections)
    ? schema.sections
        .filter((section) => section && typeof section === "object")
        .map((section) => ({
          ...section,
          fields: Array.isArray(section.fields)
            ? section.fields.filter(isSafeField)
            : [],
        }))
    : undefined;
  const safeFields = Array.isArray(schema.fields)
    ? schema.fields.filter(isSafeField)
    : undefined;
  const safeProperties =
    schema.properties && typeof schema.properties === "object" &&
    !Array.isArray(schema.properties)
      ? Object.fromEntries(
          Object.entries(schema.properties).filter(
            ([fieldId, definition]) =>
              !isFieldSensitive(fieldId, {
                properties: { [fieldId]: definition },
              })
          )
        )
      : undefined;

  return {
    ...schema,
    ...(safeSections ? { sections: safeSections } : {}),
    ...(safeFields ? { fields: safeFields } : {}),
    ...(safeProperties ? { properties: safeProperties } : {}),
  };
}

/**
 * Check if a field is sensitive either by its ID name or by schema annotation.
 *
 * @param {string} fieldId
 * @param {object|null} schema
 * @returns {boolean}
 */
export function isFieldSensitive(fieldId, schema) {
  if (!fieldId || typeof fieldId !== "string") return false;

  if (hasSensitiveIdentifier(fieldId)) {
    return true;
  }

  if (schema && typeof schema === "object") {
    if (Array.isArray(schema.fields)) {
      const fieldDef = schema.fields.find(
        (f) => f && (f.id === fieldId || f.name === fieldId)
      );
      if (
        fieldDef?.sensitive === true ||
        fieldDef?.type === "password" ||
        hasSensitiveIdentifier(fieldDef?.label)
      ) {
        return true;
      }
    } else if (schema.properties && typeof schema.properties === "object") {
      const prop = schema.properties[fieldId];
      if (
        prop?.sensitive === true ||
        prop?.type === "password" ||
        hasSensitiveIdentifier(prop?.label)
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Remove sensitive values entirely before they reach the generator.
 *
 * @param {object|null} schema
 * @param {object|null} values
 * @param {number} [depth=0]
 * @returns {Record<string, any>}
 */
export function sanitizeValues(schema, values, depth = 0) {
  if (!values || typeof values !== "object" || depth > MAX_MASK_DEPTH) {
    return {};
  }

  if (Array.isArray(values)) {
    return values.slice(0, 50).map((value) =>
      value && typeof value === "object"
        ? sanitizeValues(schema, value, depth + 1)
        : value
    );
  }

  const result = {};
  for (const [key, value] of Object.entries(values)) {
    if (FORBIDDEN_KEYS.has(key) || isFieldSensitive(key, schema)) continue;
    result[key] =
      value && typeof value === "object"
        ? sanitizeValues(schema, value, depth + 1)
        : value;
  }
  return result;
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
