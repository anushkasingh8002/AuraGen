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
import { fileURLToPath } from "node:url";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

import config from "../config.js";
import log from "../safety/logger.js";
import { CodeGenError } from "../safety/errors.js";
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
 * Builds the human prompt incorporating form schema, friction, and previous errors.
 *
 * @param {object} ctx
 * @param {string} [feedback]
 * @returns {string}
 */
export function buildHumanMessage(ctx, feedback) {
  let content = `USER FRICTION CONTEXT:
${JSON.stringify(ctx.friction ?? {}, null, 2)}

ORIGINAL FORM SCHEMA:
${JSON.stringify(ctx.schema ?? {}, null, 2)}

CURRENT VALUES ENTERED (MASKED):
${JSON.stringify(ctx.values ?? {}, null, 2)}`;

  if (feedback) {
    content += `\n\nYour previous output was rejected for these reasons:
${feedback}
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
export async function generate(ctx, { onToken, signal, feedback } = {}) {
  // ── MOCK MODE ──────────────────────────────────────────────────────
  // If MOCK_LLM is enabled, return the pre-baked valid component
  // after a short 300ms realistic delay.
  if (config.MOCK_LLM) {
    log.info("codegen:mock_mode", { hasFeedback: Boolean(feedback) });
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (onToken) onToken(mockComponentCode);
    return mockComponentCode;
  }

  // ── TIMEOUT & ABORT SIGNAL ─────────────────────────────────────────
  const timeoutSignal = AbortSignal.timeout(config.LLM_TIMEOUT_MS);
  let effectiveSignal = timeoutSignal;

  if (signal) {
    effectiveSignal = typeof AbortSignal.any === "function"
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;
  }

  // ── LANGCHAIN MODEL INVOCATION ─────────────────────────────────────
  try {
    const model = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0.2,
      streaming: true,
      openAIApiKey: config.OPENAI_API_KEY,
    });

    const humanPrompt = buildHumanMessage(ctx, feedback);

    const messages = [
      new SystemMessage(FULL_SYSTEM_PROMPT),
      new HumanMessage(humanPrompt),
    ];

    const chunks = [];
    const stream = await model.stream(messages, { signal: effectiveSignal });

    for await (const chunk of stream) {
      const text = typeof chunk.content === "string" ? chunk.content : "";
      chunks.push(text);
      if (onToken) onToken(text);
    }

    const rawOutput = chunks.join("");
    const cleanedCode = stripCodeFences(rawOutput);

    if (!cleanedCode) {
      throw new CodeGenError("LLM returned empty code output");
    }

    return cleanedCode;
  } catch (err) {
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
