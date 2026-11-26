// server/agent/chain.js
// ─────────────────────────────────────────────────────────────────────
// LangChain AI code generator using GPT-4o.
//
// WHY stream tokens?
//   Streaming allows the server to detect hangs early, pipe progress
//   events to monitoring, and cut latency compared to buffering full
//   completions.
//
// WHY strip fences?
//   Even with strict instructions ("no markdown"), LLMs occasionally
//   wrap code in ```jsx. Stripping them deterministically prevents
//   Babel parser syntax errors in Step 5.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { SystemMessage } from "@langchain/core/messages";

import config from "../config.js";
import log from "../safety/logger.js";
import { CodeGenError } from "../safety/errors.js";
import { validate as defaultValidate } from "../ast/validate.js";
import { summarizeValuesForLlm } from "./mask.js";
import { mockComponentCode } from "./mockComponent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load prompt templates synchronously on module initialization
const systemPromptText = fs.readFileSync(
  path.join(__dirname, "prompts", "system.txt"),
  "utf8"
);
const designSystemText = fs.readFileSync(
  path.join(__dirname, "prompts", "designSystem.txt"),
  "utf8"
);

const FULL_SYSTEM_PROMPT = `${systemPromptText}\n\n${designSystemText}`;

/**
 * Deterministic hash of the system and design system prompts.
 * Changes automatically whenever prompts are modified to prevent
 * serving stale components from the cache.
 */
export const PROMPT_VERSION = crypto
  .createHash("sha256")
  .update(`${FULL_SYSTEM_PROMPT}\nmaxTokens=${config.MAX_OUTPUT_TOKENS}`, "utf8")
  .digest("hex")
  .slice(0, 16);

// ── Startup Singletons (Optimisation e) ──────────────────────────────
// Created once at module startup so requests never re-allocate the
// SystemMessage, ChatPromptTemplate, OpenAI client, or HTTP connection pool.
const SYSTEM_MESSAGE = new SystemMessage(FULL_SYSTEM_PROMPT);
const PROMPT_TEMPLATE = ChatPromptTemplate.fromMessages([
  SYSTEM_MESSAGE,
  ["human", "{input}"],
]);

let singletonModel = null;
let singletonChain = null;

/**
 * Retrieve (or initialize once) the startup singleton ChatOpenAI chain.
 *
 * @param {string} [apiKey]
 */
export function getStartupChain(apiKey = config.OPENAI_API_KEY) {
  if (singletonChain) return singletonChain;
  if (!apiKey) return null;

  singletonModel = new ChatOpenAI({
    model: "gpt-4o",
    temperature: 0.2,
    maxTokens: config.MAX_OUTPUT_TOKENS,
    streaming: true,
    openAIApiKey: apiKey,
  });
  singletonChain = PROMPT_TEMPLATE.pipe(singletonModel);
  return singletonChain;
}

if (!config.MOCK_LLM && config.OPENAI_API_KEY) {
  getStartupChain(config.OPENAI_API_KEY);
}

/**
 * Strip only a leading markdown code fence if present during streaming.
 */
function stripLeadingFence(raw) {
  return raw.replace(/^\s*```(?:[a-zA-Z0-9_-]+)?\r?\n?/, "");
}

/**
 * Scan streaming JSX/JS source to find the exact index where the
 * `export default` declaration finishes (closing brace `}`, parenthesized
 * arrow body `)`, or identifier export `;`). Returns -1 if incomplete.
 *
 * @param {string} source
 * @returns {number} end index (exclusive) or -1
 */
export function findDefaultExportCloseIndex(source) {
  if (typeof source !== "string") return -1;

  const match = /\bexport\s+default\b/.exec(source);
  if (!match) return -1;

  let i = match.index + match[0].length;
  const len = source.length;

  function skipWsAndComments() {
    while (i < len) {
      const ch = source[i];
      if (/\s/.test(ch)) {
        i++;
      } else if (ch === "/" && source[i + 1] === "/") {
        i += 2;
        while (i < len && source[i] !== "\n") i++;
      } else if (ch === "/" && source[i + 1] === "*") {
        const end = source.indexOf("*/", i + 2);
        i = end === -1 ? len : end + 2;
      } else {
        break;
      }
    }
  }

  function skipString(quote) {
    i++;
    while (i < len) {
      const ch = source[i];
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === quote) {
        i++;
        return true;
      }
      if ((quote === "'" || quote === '"') && ch === "\n") {
        return false;
      }
      i++;
    }
    return false;
  }

  function skipTemplate() {
    i++;
    while (i < len) {
      const ch = source[i];
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "$" && source[i + 1] === "{") {
        i += 2;
        let depth = 1;
        while (i < len && depth > 0) {
          const c = source[i];
          if (c === "{") depth++;
          else if (c === "}") depth--;
          else if (c === '"' || c === "'") { skipString(c); continue; }
          else if (c === "`") { skipTemplate(); continue; }
          i++;
        }
        continue;
      }
      if (ch === "`") {
        i++;
        return true;
      }
      i++;
    }
    return false;
  }

  function isLikelyJsSingleQuote(idx) {
    const prev = idx > 0 ? source[idx - 1] : "";
    return !/[a-zA-Z0-9_]/.test(prev);
  }

  function skipBalancedParens() {
    if (source[i] !== "(") return false;
    let depth = 1;
    i++;
    while (i < len && depth > 0) {
      const ch = source[i];
      if (ch === "/" && source[i + 1] === "/") {
        i += 2;
        while (i < len && source[i] !== "\n") i++;
        continue;
      }
      if (ch === "/" && source[i + 1] === "*") {
        const end = source.indexOf("*/", i + 2);
        if (end === -1) return false;
        i = end + 2;
        continue;
      }
      if (ch === '"') { skipString('"'); continue; }
      if (ch === "'" && isLikelyJsSingleQuote(i)) { skipString("'"); continue; }
      if (ch === "`") { skipTemplate(); continue; }
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    return depth === 0;
  }

  function scanBraceBody() {
    if (source[i] !== "{") return -1;
    let depth = 1;
    i++;
    while (i < len && depth > 0) {
      const ch = source[i];
      if (ch === "/" && source[i + 1] === "/") {
        i += 2;
        while (i < len && source[i] !== "\n") i++;
        continue;
      }
      if (ch === "/" && source[i + 1] === "*") {
        const end = source.indexOf("*/", i + 2);
        if (end === -1) return -1;
        i = end + 2;
        continue;
      }
      if (ch === '"') { skipString('"'); continue; }
      if (ch === "'" && isLikelyJsSingleQuote(i)) { skipString("'"); continue; }
      if (ch === "`") { skipTemplate(); continue; }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    return -1;
  }

  skipWsAndComments();
  if (i >= len) return -1;

  if (/^async\b/.test(source.slice(i))) {
    i += 5;
    skipWsAndComments();
  }

  if (/^function\b/.test(source.slice(i))) {
    i += 8;
    skipWsAndComments();
    if (source[i] === "*") {
      i++;
      skipWsAndComments();
    }
    if (/[a-zA-Z_$]/.test(source[i] || "")) {
      while (i < len && /[a-zA-Z0-9_$]/.test(source[i])) i++;
      skipWsAndComments();
    }
    if (!skipBalancedParens()) return -1;
    skipWsAndComments();
    return scanBraceBody();
  }

  if (source[i] === "(") {
    if (!skipBalancedParens()) return -1;
    skipWsAndComments();
    if (source.slice(i, i + 2) === "=>") {
      i += 2;
      skipWsAndComments();
      if (source[i] === "{") return scanBraceBody();
      if (source[i] === "(" && skipBalancedParens()) return i;
    }
    return -1;
  }

  if (/[a-zA-Z_$]/.test(source[i] || "")) {
    while (i < len && /[a-zA-Z0-9_$.]/.test(source[i])) i++;
    skipWsAndComments();
    if (source.slice(i, i + 2) === "=>") {
      i += 2;
      skipWsAndComments();
      if (source[i] === "{") return scanBraceBody();
      if (source[i] === "(" && skipBalancedParens()) return i;
      return -1;
    }
    if (source[i] === ";") {
      return i + 1;
    }
  }

  return -1;
}

/**
 * Strips markdown code fences (```jsx, ```javascript, ```) and trims.
 *
 * @param {string} raw
 * @returns {string}
 */
export function stripCodeFences(raw) {
  if (typeof raw !== "string") return "";

  let cleaned = raw.trim();

  // Strip leading fence
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:[a-zA-Z0-9_-]+)?\r?\n?/, "");
  }

  // Strip trailing fence
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.replace(/\r?\n?```\s*$/, "");
  }

  return cleaned.trim();
}

/**
 * Sanitize untrusted schema metadata strings before prompting to limit
 * token abuse and prevent delimiter-escape prompt injections.
 */
function sanitizePromptText(str, maxLen = 120) {
  if (typeof str !== "string") return "";
  return str
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLen);
}

/**
 * Normalize and bound form schema sent into LLM prompt context.
 */
export function sanitizeSchemaForLlm(schema) {
  if (!schema || typeof schema !== "object") return {};

  const out = {};
  if (schema.formId) out.formId = sanitizePromptText(String(schema.formId), 64);
  if (schema.title) out.title = sanitizePromptText(String(schema.title), 120);

  if (Array.isArray(schema.fields)) {
    out.fields = schema.fields.slice(0, 50).map((f) => {
      if (!f || typeof f !== "object") return {};
      const cleanField = {
        id: sanitizePromptText(String(f.id || f.name || ""), 64),
        label: sanitizePromptText(String(f.label || ""), 100),
        type: sanitizePromptText(String(f.type || "text"), 32),
      };
      if (f.required !== undefined) cleanField.required = Boolean(f.required);
      if (f.sensitive !== undefined) cleanField.sensitive = Boolean(f.sensitive);
      if (f.placeholder) cleanField.placeholder = sanitizePromptText(String(f.placeholder), 100);
      if (Array.isArray(f.options)) {
        cleanField.options = f.options
          .slice(0, 30)
          .map((opt) =>
            typeof opt === "object" && opt !== null
              ? {
                  label: sanitizePromptText(String(opt.label ?? opt.value ?? ""), 64),
                  value: sanitizePromptText(String(opt.value ?? opt.label ?? ""), 64),
                }
              : sanitizePromptText(String(opt), 64)
          );
      }
      return cleanField;
    });
  }

  return out;
}

/**
 * Builds the human prompt incorporating bounded schema, presence-only
 * masked values, and untrusted-data framing delimiters.
 *
 * @param {object} ctx
 * @param {string} [feedback]
 * @returns {string}
 */
export function buildHumanMessage(ctx, feedback) {
  const cleanFriction = {
    field: ctx.friction?.field ? sanitizePromptText(String(ctx.friction.field), 64) : null,
    score: typeof ctx.friction?.score === "number" ? ctx.friction.score : 0,
  };
  const cleanSchema = sanitizeSchemaForLlm(ctx.schema ?? {});
  const safeValues = summarizeValuesForLlm(cleanSchema, ctx.values ?? {});

  let content = `<UNTRUSTED_FORM_DATA>
USER FRICTION CONTEXT:
${JSON.stringify(cleanFriction, null, 2)}

ORIGINAL FORM SCHEMA:
${JSON.stringify(cleanSchema, null, 2)}

CURRENT VALUES ENTERED (PRESENCE / MASKED ONLY):
${JSON.stringify(safeValues, null, 2)}
</UNTRUSTED_FORM_DATA>`;

  if (feedback) {
    content += `\n\nYour previous output was rejected for these reasons:
${String(feedback).replace(/[<>]/g, "").slice(0, 1500)}
Fix them and output the full component again.`;
  }

  return content;
}

/**
 * Generate a simplified React wizard component via GPT-4o.
 *
 * @param {object} ctx                        – generation context
 * @param {object} ctx.friction               – friction point info { field, score }
 * @param {object} ctx.schema                 – form schema definition
 * @param {object} ctx.values                 – masked current form values
 * @param {object} [opts]                     – options
 * @param {(token: string) => void} [opts.onToken] – token streaming callback
 * @param {AbortSignal} [opts.signal]         – external cancellation signal
 * @param {string} [opts.feedback]            – validator error message to prompt self-correction
 * @returns {Promise<string>} pure JSX code string of the generated component
 */
export async function generate(
  ctx,
  {
    onToken,
    signal,
    feedback,
    validate: customValidate,
    onValidated,
    _stream,
  } = {}
) {
  const validateFn = customValidate ?? defaultValidate;

  // ── MOCK MODE (skipped if custom _stream is injected for tests) ────
  if (config.MOCK_LLM && !_stream) {
    log.info("codegen:mock_mode", { hasFeedback: Boolean(feedback) });
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (onToken) onToken(mockComponentCode);
    return mockComponentCode;
  }

  // ── TIMEOUT & EARLY-STOP ABORT SIGNALS ─────────────────────────────
  const timeoutSignal = AbortSignal.timeout(config.LLM_TIMEOUT_MS);
  const earlyStopController = new AbortController();
  const signals = [timeoutSignal, earlyStopController.signal];
  if (signal) signals.push(signal);

  const effectiveSignal =
    typeof AbortSignal.any === "function"
      ? AbortSignal.any(signals)
      : earlyStopController.signal;

  // ── LANGCHAIN STREAMING WITH EARLY VALIDATION ──────────────────────
  let earlyAborted = false;
  let finalCode = "";

  try {
    let stream = _stream;
    if (!stream) {
      const chain = getStartupChain();
      if (!chain) {
        throw new CodeGenError("OpenAI client not configured (missing API key)");
      }
      const humanPrompt = buildHumanMessage(ctx, feedback);
      stream = await chain.stream(
        { input: humanPrompt },
        { signal: effectiveSignal }
      );
    }

    let buffer = "";
    const checkedIndices = new Set();

    for await (const chunk of stream) {
      const text = typeof chunk?.content === "string"
        ? chunk.content
        : (typeof chunk === "string" ? chunk : "");
      if (!text) continue;

      buffer += text;
      if (onToken) onToken(text);

      // Only scan for export default completion when chunk contains a terminator
      if (text.includes("}") || text.includes(";")) {
        const cleanedSoFar = stripLeadingFence(buffer);
        const closeIdx = findDefaultExportCloseIndex(cleanedSoFar);

        if (closeIdx > 0 && !checkedIndices.has(closeIdx)) {
          checkedIndices.add(closeIdx);
          const candidate = cleanedSoFar.slice(0, closeIdx).trim();
          const valRes = validateFn(candidate);

          if (valRes?.ok) {
            finalCode = candidate;
            earlyAborted = true;
            if (onValidated) onValidated(valRes);
            earlyStopController.abort();
            break;
          }
        }
      }
    }

    if (!finalCode) {
      finalCode = stripCodeFences(buffer);
    }

    if (!finalCode) {
      throw new CodeGenError("LLM returned empty code output");
    }

    return finalCode;
  } catch (err) {
    if (earlyAborted && finalCode) {
      return finalCode;
    }

    if (err.name === "TimeoutError" || err.name === "AbortError") {
      log.error("codegen:timeout", { timeoutMs: config.LLM_TIMEOUT_MS });
      throw new CodeGenError(
        `LLM code generation timed out after ${config.LLM_TIMEOUT_MS}ms`
      );
    }

    log.error("codegen:error", { message: err.message });
    throw new CodeGenError(`LLM generation failed: ${err.message}`, {
      cause: err,
    });
  }
}
